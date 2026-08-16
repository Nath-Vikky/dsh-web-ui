/**
 * dsh-pet host half — mounts the pet service, desktop companion lifecycle,
 * and its local HTTP bridge. The browser half only contributes the desktop
 * settings card. Install via `dsh plugin --profile web add
 * link:<dsh-web-ui>/packages/dsh-pet`; the cordis.patch.yml inserts this plugin row.
 * @module @linxin666/dsh-pet
 */

import { Context } from '@deepseek-ai/cordis'
import {
  installSettingsSection,
  settingsNamespace,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { defaultAffinityConfig } from './affinity.ts'
import { launchDesktopCompanion } from './desktop-companion.ts'
import {
  DEFAULT_PET_COMPANION_SETTINGS,
  PetService,
  PET_SETTINGS_NAMESPACE,
  type PetConfig,
  type PetSettingsSection,
} from './service.ts'
import { makePetRoutes } from './routes.ts'
import { makePetSettingsBridgeRoutes } from './settings-bridge.ts'
import { legacyWebSettingOps } from './settings-migration.ts'
import { defaultPetStateConfig } from './state.ts'
import { defaultTreatConfig } from './treats.ts'

export { PetService } from './service.ts'
export type {
  PetCompanionSettings,
  PetCompanionState,
  PetConfig,
  PetInteractResult,
  PetStateView,
} from './service.ts'
export {
  AFFINITY_MAX,
  AFFINITY_RANKS,
  applyInteraction,
  applyTurnReward,
  emptyAffinity,
  rankOf,
} from './affinity.ts'
export type {
  AffinityConfig,
  AffinityState,
  InteractionOutcome,
  PetInteraction,
} from './affinity.ts'
export {
  animationForPhase,
  PetStateMachine,
  rowOf,
} from './state.ts'
export type {
  ActivityPhase,
  PetAnimation,
  PetStateConfig,
  PetStateInput,
  PetStateSnapshot,
} from './state.ts'
export {
  consumeTreat,
  defaultTreatConfig,
  emptyTreatLedger,
  settleTreatGrants,
} from './treats.ts'
export type { TreatConfig, TreatLedger, TreatSettlement } from './treats.ts'
export {
  emptyPersist,
  loadPetPersist,
  petHomeDir,
  savePetPersist,
} from './persist.ts'
export type { PetPersist } from './persist.ts'

export { ActivityRegistry } from './core/activity-registry.ts'
export type { ActivityRegistryOptions, PetTaskUpdate } from './core/activity-registry.ts'
export {
  createActivityProjectionRuntime,
  displayToolName,
  projectOfficialEvent,
} from './core/activity-projection.ts'
export type {
  ActivityProjectionRuntime,
  ProjectedActivity,
} from './core/activity-projection.ts'
export { mapActivityToIntent } from './core/intent.ts'
export type {
  PetExpression,
  PetIntent,
  PetMotion,
} from './core/intent.ts'
export { NarrationEngine, narrateActivity } from './core/narration.ts'
export type {
  NarrationContext,
  NarrationDecision,
  NarrationEngineOptions,
  NarrationReason,
} from './core/narration.ts'
export { selectPrimaryTask } from './core/primary-task.ts'
export type { PrimaryTaskSelection } from './core/primary-task.ts'
export { sanitizeActivityText } from './core/sanitize.ts'
export type { ActivityTextOptions } from './core/sanitize.ts'
export {
  isPetTaskPhase,
  PET_ACTIVITY_PROTOCOL_VERSION,
  petTaskId,
} from './core/protocol.ts'
export type {
  PetActivityEnvelope,
  PetActivityMessage,
  PetAggregateSnapshot,
  PetAggregateSummary,
  PetInstanceDescriptor,
  PetTaskIdentity,
  PetTaskPhase,
  PetTaskSnapshot,
  PetTaskTokenUsage,
  PetTaskToolSnapshot,
} from './core/protocol.ts'

export {
  makePetRoutes,
  PET_API_PREFIX,
} from './routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'pet'

/** Services required before the pet can mount its surfaces. */
export const inject = ['webServer']

/** Cordis deployment configuration, validated by the same-named schema. */
export interface Config extends PetConfig {}

export const Config: z<Config> = z.object({
  affinity: z.object({
    turnReward: z.number().step(1).min(0).max(100).default(defaultAffinityConfig.turnReward),
    petReward: z.number().step(1).min(0).max(100).default(defaultAffinityConfig.petReward),
    petCooldownMs: z.number().step(1).min(0).max(86_400_000).default(defaultAffinityConfig.petCooldownMs),
    feedReward: z.number().step(1).min(0).max(100).default(defaultAffinityConfig.feedReward),
    feedCooldownMs: z.number().step(1).min(0).max(86_400_000).default(defaultAffinityConfig.feedCooldownMs),
  }),
  state: z.object({
    celebrateMs: z.number().step(1).min(0).max(60_000).default(defaultPetStateConfig.celebrateMs),
  }),
  treats: z.object({
    turnsPerTreat: z.number().step(1).min(1).max(10_000).default(defaultTreatConfig.turnsPerTreat),
    timeTreatMs: z.number().step(1).min(1).max(2_592_000_000).default(defaultTreatConfig.timeTreatMs),
    maxTreats: z.number().step(1).min(1).max(1_000).default(defaultTreatConfig.maxTreats),
  }),
  persistDir: z.string(),
  enabled: z.boolean().default(true),
  activity: z.object({
    instanceId: z.string().min(1).max(128),
    bootId: z.string().min(1).max(128),
    profile: z.string().min(1).max(64),
    workspaceLabel: z.string().min(1).max(128),
  }),
})

/** Settings section schema for the Electron desktop companion. */
export const PET_SETTINGS_SCHEMA = z.object({
  visible: z.boolean().default(true),
  alwaysOnTop: z.boolean().default(true),
  locked: z.boolean().default(false),
  enabled: z.boolean().default(true),
})

/** Register the pet service, bridge routes, settings, and desktop lifecycle. */
export function apply(ctx: Context, config: Config = {}): void {
  const service = new PetService(ctx, config)
  const petSettingsNamespace = settingsNamespace(PET_SETTINGS_NAMESPACE)

  // The `pet` namespace is the single Host-side source for the desktop
  // lifecycle and window preferences. Electron mirrors tray/drawer changes
  // back through `/api/pet/companion-settings`.
  let current: () => PetSettingsSection = () => base
  const base: PetSettingsSection = {
    ...DEFAULT_PET_COMPANION_SETTINGS,
    enabled: config.enabled ?? true,
  }
  const routes = makePetRoutes({ service })
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'pet: routes')

  let disposeDesktop: (() => void) | undefined
  let migratingLegacySettings = false
  const migrateLegacySettings = (): void => {
    if (migratingLegacySettings) return
    const settings = ctx.get('settings', false) as SettingsProvider | undefined
    const descriptor = settings?.describe().find(item => item.ns === petSettingsNamespace)
    const operations = legacyWebSettingOps(descriptor?.user)
    if (settings === undefined || operations.length === 0) return
    migratingLegacySettings = true
    void settings.mutate(petSettingsNamespace, operations).catch(() => {
      // A read-only or restarting provider can leave harmless legacy keys;
      // they are ignored by the new schema and retried on the next boot.
    }).finally(() => { migratingLegacySettings = false })
  }
  const syncDesktop = (): void => {
    if (current().enabled && disposeDesktop === undefined) {
      disposeDesktop = launchDesktopCompanion(import.meta.url)
    } else if (!current().enabled && disposeDesktop !== undefined) {
      disposeDesktop()
      disposeDesktop = undefined
    }
  }
  ctx.effect(() => () => {
    disposeDesktop?.()
    disposeDesktop = undefined
  }, 'pet: desktop companion')
  installSettingsSection(ctx, petSettingsNamespace, PET_SETTINGS_SCHEMA, base, {
    setSource: (source) => { current = source },
    onChange: () => {
      const section = current()
      service.applySettingsSection(section)
      service.setEnabled(section.enabled)
      syncDesktop()
      migrateLegacySettings()
    },
  })
  service.applySettingsSection(current())
  service.setEnabled(current().enabled)
  syncDesktop()

  // Current DSH releases intentionally omit third-party namespaces from the
  // official Web settings RPC allowlist. A package-owned, loopback-only
  // fallback keeps standalone installs configurable; aggregate installs keep
  // using dsh-web-ui-settings through the browser-side compatibility binder.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const disposers = makePetSettingsBridgeRoutes(settingsCtx.settings)
        .map(route => settingsCtx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'pet: standalone settings bridge')
  })
}
