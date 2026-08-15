/**
 * Pet host service — the `pet.*` RPC domain. A composition facade: it wires
 * the pure event projection (`event-projection`) onto the state machine,
 * delegates the affinity economy to the ledger (`ledger`), and routes
 * persistence through `persist`. The API gateway maps these methods onto
 * `pet.state` / `pet.interact` / `pet.setVisible` / `pet.setConfig` for
 * browser consumers.
 * @module @linxin666/dsh-pet/service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AffinityConfig, PetAffinityView, PetInteraction } from './affinity.ts'
import type { TreatConfig } from './treats.ts'
import {
  createActivityProjectionRuntime,
  projectOfficialEvent,
  type ActivityProjectionRuntime,
  type ProjectedActivity,
} from './core/activity-projection.ts'
import { ActivityRegistry } from './core/activity-registry.ts'
import { NarrationEngine } from './core/narration.ts'
import {
  isPetTaskPhase,
  type PetAggregateSnapshot,
  type PetTaskIdentity,
  type PetTaskPhase,
} from './core/protocol.ts'
import { PetLedger, type LedgerConfig, type LedgerInteractionResult } from './ledger.ts'
import {
  DISPLAY_INSET_MAX,
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  PET_NAME_MAX_LENGTH,
  loadPetPersist,
  petHomeDir,
  savePetPersist,
  type PetDisplayConfig,
} from './persist.ts'
import {
  defaultPetStateConfig,
  PetStateMachine,
  type PetStateConfig,
  type PetStateInput,
  type PetStateSnapshot,
} from './state.ts'

/** Plugin configuration. */
export interface PetConfig {
  /** Affinity tuning. */
  affinity?: Partial<AffinityConfig>
  /** State machine tuning. */
  state?: Partial<PetStateConfig>
  /** Treat economy tuning. */
  treats?: Partial<TreatConfig>
  /** Persistence directory override (defaults to $DSH_HOME). */
  persistDir?: string
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
  /** Optional process metadata used by the multi-task activity snapshot. */
  activity?: {
    /** Host instance identity; generated for this service when omitted. */
    instanceId?: string
    /** Process-start identity; generated for this service when omitted. */
    bootId?: string
    /** Human-readable DSH profile label. */
    profile?: string
    /** Optional safe workspace label. */
    workspaceLabel?: string
  }
}

/**
 * The pet's settings-namespace section: the display fields and name the web
 * settings surface edits. `right`/`bottom` are also updated by drag
 * interactions, which keep the settings document in sync through the service.
 */
export interface PetSettingsSection {
  /** Master switch. */
  visible: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size: number
  /** Horizontal inset from the viewport right edge, px. */
  right: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom: number
  /** User-customizable pet display name. */
  name: string
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
}

/** Settings namespace of the pet capability. Spelled here rather than imported: the browser half spells the same value. */
export const PET_SETTINGS_NAMESPACE = 'pet'

/** Snapshot returned by `pet.state`. */
export interface PetStateView {
  animation: PetStateSnapshot['animation']
  bubble?: string
  phase: PetStateSnapshot['phase']
  sessionActive: boolean
  /** Affinity ledger snapshot. */
  affinity: PetAffinityView
  /** Display configuration. */
  display: PetDisplayConfig
  /** User-customizable pet display name. */
  name: string
  /** Treat (小鱼干) stock snapshot. */
  treats: {
    /** Stocked treats now. */
    stocked: number
    /** Stock cap. */
    max: number
  }
}

/** Result of `pet.interact`. */
export type PetInteractResult = LedgerInteractionResult

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
  }
}

/** Runtime shape of the optional legacy activity event. */
interface ActivityStatusEventLike {
  phase?: string
  line?: string
  phrase?: string
}

/** Map the extended Core vocabulary onto the unchanged sprite state machine. */
function legacyPhase(phase: PetTaskPhase): PetStateInput['phase'] {
  return phase === 'waiting_input' ? 'waiting' : phase
}

/** Listener used by event-driven web and desktop state adapters. */
export type PetStateListener = (snapshot: PetStateView) => void

/**
 * Cordis service exposing the pet RPC domain. Lazy: nothing is scanned or
 * written until an economic event or interaction arrives; event listeners
 * update only in-memory state, and persistence happens on economic changes
 * (turn rewards, feeds, config/name changes) — never on a read.
 */
export class PetService extends Service {
  static inject: string[] = []

  private readonly machine: PetStateMachine
  private readonly celebrateMs: number
  private readonly activityRegistry: ActivityRegistry
  private readonly narrationEngine: NarrationEngine
  private readonly activityInstance: Omit<PetTaskIdentity, 'sessionId'>
  private readonly activityProfile: string | undefined
  private readonly activityWorkspaceLabel: string | undefined
  private readonly ledger: PetLedger
  private readonly persistDir: string
  private enabled: boolean
  private disposeActivity: (() => void) | undefined
  /** Session whose most recent meaningful event currently drives the global pet. */
  private displaySession: Session | undefined
  private readonly sessionActivity = new WeakMap<Session, ActivityProjectionRuntime>()
  private readonly stateListeners = new Set<PetStateListener>()
  private presentationTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context, config: PetConfig = {}) {
    super(ctx, 'pet')
    this.persistDir = config.persistDir ?? petHomeDir()
    const ledgerConfig: LedgerConfig = { affinity: config.affinity, treats: config.treats }
    this.ledger = new PetLedger(loadPetPersist(this.persistDir), ledgerConfig)
    const stateConfig = {
      ...defaultPetStateConfig,
      ...(config.state ?? {}),
    }
    this.machine = new PetStateMachine(stateConfig)
    this.celebrateMs = stateConfig.celebrateMs
    this.activityRegistry = new ActivityRegistry()
    this.narrationEngine = new NarrationEngine()
    this.activityInstance = {
      instanceId: config.activity?.instanceId ?? randomUUID(),
      bootId: config.activity?.bootId ?? randomUUID(),
    }
    this.activityProfile = config.activity?.profile
    this.activityWorkspaceLabel = config.activity?.workspaceLabel
    this.enabled = config.enabled ?? true

    this.syncActivity()
  }

  /** Whether the pet service consumes session activity while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** RPC: current pet state snapshot. */
  async state(): Promise<PetStateView> {
    return this.view()
  }

  /** Full multi-session activity snapshot for future web and desktop adapters. */
  activitySnapshot(): PetAggregateSnapshot {
    return this.activityRegistry.snapshot()
  }

  /** Subscribe to complete state snapshots, including one synchronous initial value. */
  subscribeState(listener: PetStateListener): () => void {
    this.stateListeners.add(listener)
    try {
      listener(this.view())
    } catch {
      // A stream that closes during its initial write is already disposable.
    }
    return () => { this.stateListeners.delete(listener) }
  }

  /** Current persisted display config (read-only view). */
  display(): PetDisplayConfig {
    return { ...this.ledger.snapshot.display }
  }

  /** Current persisted pet name (read-only view). */
  petName(): string {
    return this.ledger.snapshot.name
  }

  /** Start or stop the session-activity listeners that drive the pet. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.syncActivity()
    if (!enabled) {
      this.clearPresentationTimer()
      this.activityRegistry.clear()
      this.narrationEngine.reset()
    }
    this.publishState()
  }

  private syncActivity(): void {
    if (this.disposeActivity !== undefined) {
      this.disposeActivity()
      this.disposeActivity = undefined
    }
    if (!this.enabled) return
    this.disposeActivity = (() => {
      const disposers = [
        this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
          const runtime = this.activityRuntime(session)
          // `activity/status` is an optional compatibility input. It is not
          // declared as a durable event type by this package because current
          // Harness installations publish the official session vocabulary.
          if ((event.type as string) === 'activity/status') {
            const payload = ((event as unknown as { data?: unknown }).data ?? {}) as ActivityStatusEventLike
            if (typeof payload.phase !== 'string' || !isPetTaskPhase(payload.phase)) return
            const activity: ProjectedActivity = {
              phase: payload.phase,
              ...(typeof payload.line === 'string' ? { statusLine: payload.line } : {}),
              ...(typeof payload.phrase === 'string' ? { narration: payload.phrase } : {}),
            }
            this.applyActivity(session, activity, {
              phase: legacyPhase(payload.phase),
              ...(typeof payload.line === 'string' ? { line: payload.line } : {}),
              ...(typeof payload.phrase === 'string' ? { phrase: payload.phrase } : {}),
            })
            // On a legacy-only stream the compatibility event owns turn
            // rewards. Once any official activity is observed, turn/end owns
            // them and a derived legacy `done` cannot double-count.
            if (payload.phase === 'done' && !runtime.officialEventsSeen) {
              this.rewardLegacyTurn()
            }
            this.publishState()
            return
          }

          const transition = projectOfficialEvent(event, runtime)
          if (transition === undefined) return
          runtime.officialEventsSeen = true
          this.applyActivity(session, transition, {
            phase: legacyPhase(transition.phase),
            ...(transition.statusLine === undefined ? {} : { line: transition.statusLine }),
            ...(transition.narration === undefined ? {} : { phrase: transition.narration }),
          })
          if (transition.completedTurn !== undefined) {
            this.rewardTurn(String(session.id), transition.completedTurn)
          }
          this.publishState()
        }),
        this.ctx.on('session/disposed', (session: Session) => {
          this.activityRegistry.remove(this.taskIdentity(session))
          if (session === this.displaySession) {
            this.clearPresentationTimer()
            this.displaySession = undefined
            this.machine.onSessionDisposed()
          }
          this.publishState()
        }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    })()
  }

  /** Return the projection state associated with one live session. */
  private activityRuntime(session: Session): ActivityProjectionRuntime {
    let runtime = this.sessionActivity.get(session)
    if (runtime === undefined) {
      runtime = createActivityProjectionRuntime()
      this.sessionActivity.set(session, runtime)
    }
    return runtime
  }

  /** Build the protocol identity for one local session. */
  private taskIdentity(session: Session): PetTaskIdentity {
    return { ...this.activityInstance, sessionId: String(session.id) }
  }

  /** Update Core and the unchanged host-global compatibility state. */
  private applyActivity(
    session: Session,
    activity: ProjectedActivity,
    input: PetStateInput,
  ): void {
    this.activityRegistry.update({
      ...this.taskIdentity(session),
      ...(this.activityProfile === undefined ? {} : { profile: this.activityProfile }),
      ...(this.activityWorkspaceLabel === undefined
        ? {}
        : { workspaceLabel: this.activityWorkspaceLabel }),
      phase: activity.phase,
      ...(activity.statusLine === undefined ? {} : { statusLine: activity.statusLine }),
      ...(activity.narration === undefined ? {} : { narration: activity.narration }),
      ...(activity.tool === undefined ? {} : { tool: activity.tool }),
    })
    this.displaySession = session
    this.machine.onActivityStatus(input)
    this.machine.onSessionActive()
    this.schedulePresentationRefresh(activity.phase)
  }

  /** RPC: pet or feed the pet. */
  async interact(kind: PetInteraction): Promise<PetInteractResult> {
    const nowMs = Date.now()
    const result = this.ledger.interact(kind, nowMs)
    if (this.ledger.takeDirty()) {
      this.flush()
      this.publishState()
    }
    return result
  }

  /** RPC: show or hide the pet. */
  async setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }> {
    this.ledger.setDisplay({ ...this.ledger.snapshot.display, visible })
    this.flush()
    this.syncSettingsFromPet()
    this.publishState()
    return { ok: true, display: this.ledger.snapshot.display }
  }

  /** RPC: update display config (size / position). Values are clamped to whole pixels. */
  async setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }> {
    const next = { ...this.ledger.snapshot.display, ...patch }
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, next.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.bottom)))
    this.ledger.setDisplay(next)
    this.flush()
    this.syncSettingsFromPet()
    this.publishState()
    return { ok: true, display: this.ledger.snapshot.display }
  }

  /** RPC: rename the pet (trimmed, 1–20 chars). */
  async setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'name-empty' }
    if (trimmed.length > PET_NAME_MAX_LENGTH) return { ok: false, error: 'name-too-long' }
    this.ledger.setName(trimmed)
    this.flush()
    this.syncSettingsFromPet()
    this.publishState()
    return { ok: true, name: trimmed }
  }

  /**
   * Apply a committed settings section to the persisted display config. Called
   * by the settings surface on every change; values are clamped exactly like
   * the setConfig RPC so both write paths converge.
   * @param section - the resolved settings section.
   */
  applySettingsSection(section: PetSettingsSection): void {
    const next = { ...this.ledger.snapshot.display }
    next.visible = section.visible && (section.enabled ?? true)
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, section.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.bottom)))
    this.ledger.setDisplay(next)
    this.ledger.setName(section.name.trim())
    this.flush()
    this.publishState()
  }

  /** Mirror the persisted display config into the settings document (best-effort). */
  private syncSettingsFromPet(): void {
    const settings = this.ctx.get('settings', false) as { update(ns: string, patch: object): Promise<void> } | undefined
    if (settings === undefined) return
    const snapshot = this.ledger.snapshot
    void settings.update(PET_SETTINGS_NAMESPACE, {
      visible: snapshot.display.visible,
      size: snapshot.display.size,
      right: snapshot.display.right,
      bottom: snapshot.display.bottom,
      name: snapshot.name,
    }).catch(() => {
      // A settings write failure must not break the pet's own persistence.
    })
  }

  /** Award the turn reward once per completed turn (idempotent per session + turn). */
  private rewardTurn(sessionId: string, turn: number): void {
    if (this.ledger.rewardTurn(sessionId, turn, Date.now())) this.flush()
  }

  /** Preserve turn rewards for installations that only emit legacy activity. */
  private rewardLegacyTurn(): void {
    if (this.ledger.rewardLegacyTurn(Date.now())) this.flush()
  }

  private view(): PetStateView {
    const snapshot = this.machine.render()
    const activities = this.activityRegistry.snapshot()
    const narration = this.narrationEngine.next(activities)
    // The sprite renderer and PetStateView shape stay unchanged. Only the
    // bubble copy switches to the scheduler while multiple tasks coexist;
    // single-session installations retain their exact compatibility line.
    const bubble = activities.tasks.length > 1 ? narration.text ?? snapshot.bubble : snapshot.bubble
    // Read-only: the ledger settles on economic events only, never on a read,
    // so snapshots and SSE subscriptions cannot trigger pet.json writes.
    return {
      animation: snapshot.animation,
      ...(bubble === undefined ? {} : { bubble }),
      phase: snapshot.phase,
      sessionActive: snapshot.sessionActive,
      affinity: this.ledger.affinityView(Date.now()),
      display: { ...this.ledger.snapshot.display },
      name: this.ledger.snapshot.name,
      treats: {
        stocked: this.ledger.snapshot.treats.treats,
        max: this.ledger.treatMax,
      },
    }
  }

  /** Publish the time-based end of a completion pose without browser polling. */
  private schedulePresentationRefresh(phase: PetTaskPhase): void {
    this.clearPresentationTimer()
    if (phase !== 'done') return
    this.presentationTimer = setTimeout(() => {
      this.presentationTimer = undefined
      this.publishState()
    }, this.celebrateMs + 1)
    this.presentationTimer.unref?.()
  }

  private clearPresentationTimer(): void {
    if (this.presentationTimer === undefined) return
    clearTimeout(this.presentationTimer)
    this.presentationTimer = undefined
  }

  /** Publish one fully settled snapshot; one faulty adapter cannot break others. */
  private publishState(): void {
    if (this.stateListeners.size === 0) return
    const snapshot = this.view()
    for (const listener of [...this.stateListeners]) {
      try {
        listener(snapshot)
      } catch {
        // Adapter callbacks are isolated from the Agent activity path.
      }
    }
  }

  private flush(): void {
    try {
      savePetPersist(this.ledger.snapshot, this.persistDir)
    } catch {
      // Persistence is best-effort; the in-memory ledger keeps working.
    }
  }
}
