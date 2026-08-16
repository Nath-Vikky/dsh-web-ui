import type {
  DesktopCompanionSettings,
  DesktopWindowSettings,
  PetAnimation,
  PetBridgeState,
  PetExpression,
  PetIntent,
  PetInteraction,
  PetInteractionResult,
  PetMotion,
  PetSnapshot,
} from '../shared/desktop-api.ts'
import { DEFAULT_WEB_DSH_URL, normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

export const PET_ORIGIN = DEFAULT_WEB_DSH_URL
const POLL_INTERVAL_MS = 800
const REQUEST_TIMEOUT_MS = 2_500
const STREAM_RETRY_MS = 5_000
const MAX_EVENT_BUFFER = 64 * 1024

type PetStateListener = (state: PetBridgeState) => void
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const animations = new Set<PetAnimation>([
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
])
const expressions = new Set<PetExpression>([
  'neutral',
  'curious',
  'focused',
  'happy',
  'worried',
  'questioning',
])
const motions = new Set<PetMotion>([
  'idle',
  'look-around',
  'thinking',
  'working',
  'cheer',
  'confused',
  'wave',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseCompanionSettings(value: unknown): DesktopCompanionSettings {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.visible !== 'boolean'
    || typeof value.alwaysOnTop !== 'boolean' || typeof value.locked !== 'boolean') {
    throw new TypeError('invalid desktop companion settings')
  }
  return {
    enabled: value.enabled,
    visible: value.visible,
    alwaysOnTop: value.alwaysOnTop,
    locked: value.locked,
  }
}

function parsePetIntent(value: unknown): PetIntent {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === ''
    || !finiteNumber(value.createdAt) || !finiteNumber(value.priority)
    || !finiteNumber(value.ttlMs) || value.ttlMs <= 0
    || !expressions.has(value.expression as PetExpression)
    || !motions.has(value.motion as PetMotion)
    || (value.speech !== undefined && typeof value.speech !== 'string')
    || !Array.isArray(value.sourceTaskIds)
    || !value.sourceTaskIds.every(taskId => typeof taskId === 'string')
    || typeof value.interruptible !== 'boolean') {
    throw new TypeError('invalid pet intent')
  }
  return {
    id: value.id,
    createdAt: value.createdAt,
    priority: value.priority,
    ttlMs: value.ttlMs,
    expression: value.expression as PetExpression,
    motion: value.motion as PetMotion,
    ...(typeof value.speech === 'string' ? { speech: value.speech } : {}),
    sourceTaskIds: [...value.sourceTaskIds] as string[],
    interruptible: value.interruptible,
  }
}

export function parsePetSnapshot(value: unknown): PetSnapshot {
  if (!isRecord(value) || !animations.has(value.animation as PetAnimation)
    || typeof value.phase !== 'string' || typeof value.sessionActive !== 'boolean'
    || !isRecord(value.affinity) || !isRecord(value.treats)) {
    throw new TypeError('invalid pet snapshot')
  }
  const affinity = value.affinity
  const treats = value.treats
  if (!finiteNumber(affinity.points) || typeof affinity.rank !== 'string'
    || !finiteNumber(affinity.pets) || !finiteNumber(affinity.feeds) || !finiteNumber(affinity.turns)
    || typeof affinity.petCooldown !== 'boolean' || typeof affinity.feedCooldown !== 'boolean'
    || !finiteNumber(treats.stocked) || !finiteNumber(treats.max)
    || (value.bubble !== undefined && typeof value.bubble !== 'string')) {
    throw new TypeError('invalid pet snapshot')
  }
  return {
    animation: value.animation as PetAnimation,
    ...(typeof value.bubble === 'string' ? { bubble: value.bubble } : {}),
    phase: value.phase,
    sessionActive: value.sessionActive,
    ...(value.companion === undefined ? {} : { companion: parseCompanionSettings(value.companion) }),
    ...(value.intent === undefined ? {} : { intent: parsePetIntent(value.intent) }),
    affinity: {
      points: affinity.points,
      rank: affinity.rank,
      pets: affinity.pets,
      feeds: affinity.feeds,
      turns: affinity.turns,
      petCooldown: affinity.petCooldown,
      feedCooldown: affinity.feedCooldown,
    },
    treats: {
      stocked: treats.stocked,
      max: treats.max,
    },
  }
}

/** Incremental decoder for the `data:` records emitted by the Web DSH SSE route. */
export class PetEventDecoder {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    if (this.buffer.length > MAX_EVENT_BUFFER) throw new Error('pet event is too large')
    const messages: string[] = []
    let boundary = /\r?\n\r?\n/.exec(this.buffer)
    while (boundary !== null) {
      const event = this.buffer.slice(0, boundary.index)
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length)
      const data = event.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data !== '') messages.push(data)
      boundary = /\r?\n\r?\n/.exec(this.buffer)
    }
    return messages
  }
}

export function parseInteractionResult(value: unknown): PetInteractionResult {
  if (!isRecord(value) || typeof value.reaction !== 'string') {
    throw new TypeError('invalid pet interaction result')
  }
  const accepted = typeof value.accepted === 'boolean'
    ? value.accepted
    : finiteNumber(value.delta)
      ? value.delta > 0
      : undefined
  if (accepted === undefined) throw new TypeError('invalid pet interaction result')
  return {
    reaction: value.reaction,
    accepted,
  }
}

export class PetClient {
  private current: PetBridgeState = { connection: 'connecting', snapshot: null }
  private pollTimer: NodeJS.Timeout | undefined
  private reconnectTimer: NodeJS.Timeout | undefined
  private streamAbort: AbortController | undefined
  private streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private refreshing = false
  private running = false
  private readonly listeners = new Set<PetStateListener>()
  private origin: string

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    origin: string = PET_ORIGIN,
  ) {
    this.origin = normalizeWebDshUrl(origin)
  }

  state(): PetBridgeState {
    return this.current
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startPolling()
    void this.connectEventStream()
  }

  stop(): void {
    this.running = false
    this.stopPolling()
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.streamAbort?.abort()
    this.streamAbort = undefined
    void this.streamReader?.cancel().catch(() => undefined)
    this.streamReader = undefined
    this.listeners.clear()
  }

  subscribe(listener: PetStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  originUrl(): string {
    return this.origin
  }

  setOrigin(origin: string): PetBridgeState {
    const next = normalizeWebDshUrl(origin)
    if (next === this.origin) return this.current
    this.origin = next
    this.setState({ connection: 'connecting', snapshot: this.current.snapshot })
    if (!this.running) return this.current
    this.stopPolling()
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.streamAbort?.abort()
    this.streamAbort = undefined
    void this.streamReader?.cancel().catch(() => undefined)
    this.streamReader = undefined
    this.startPolling()
    void this.connectEventStream()
    return this.current
  }

  async refresh(): Promise<PetBridgeState> {
    if (this.refreshing) return this.current
    this.refreshing = true
    const origin = this.origin
    try {
      const snapshot = await this.getJson('/api/pet/state', origin)
      if (origin !== this.origin) return this.current
      this.setState({ connection: 'ready', snapshot: parsePetSnapshot(snapshot) })
    } catch {
      if (origin !== this.origin) return this.current
      this.setState({ connection: 'unavailable', snapshot: this.current.snapshot })
    } finally {
      this.refreshing = false
    }
    return this.current
  }

  async interact(kind: PetInteraction): Promise<PetInteractionResult> {
    const result = parseInteractionResult(await this.postJson('/api/pet/interact', { kind }))
    await this.refresh()
    return result
  }

  async setCompanionSettings(patch: Partial<DesktopWindowSettings>): Promise<void> {
    const result = await this.postJson('/api/pet/companion-settings', patch)
    if (!isRecord(result) || result.ok !== true) throw new Error('companion settings were rejected')
    parseCompanionSettings(result.companion)
  }

  private async connectEventStream(): Promise<void> {
    if (!this.running || this.streamAbort !== undefined) return
    const abort = new AbortController()
    this.streamAbort = abort
    const origin = this.origin
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await this.fetchImpl(`${origin}/api/pet/events`, {
        headers: { accept: 'text/event-stream' },
        signal: abort.signal,
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')
        || response.body === null) {
        throw new Error(`pet event stream failed: ${response.status}`)
      }
      reader = response.body.getReader()
      this.streamReader = reader
      const text = new TextDecoder()
      const events = new PetEventDecoder()
      while (this.running && !abort.signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('pet event stream closed')
        for (const data of events.push(text.decode(chunk.value, { stream: true }))) {
          if (origin !== this.origin) return
          const snapshot = parsePetSnapshot(JSON.parse(data))
          this.stopPolling()
          this.setState({ connection: 'ready', snapshot })
        }
      }
    } catch {
      if (this.running && !abort.signal.aborted) {
        this.setState({ connection: 'unavailable', snapshot: this.current.snapshot })
        this.startPolling()
        this.scheduleReconnect()
      }
    } finally {
      if (this.streamReader === reader) this.streamReader = undefined
      try {
        reader?.releaseLock()
      } catch {
        // A reader cancelled during shutdown may already have released its lock.
      }
      if (this.streamAbort === abort) this.streamAbort = undefined
    }
  }

  private startPolling(): void {
    if (!this.running || this.pollTimer !== undefined) return
    void this.refresh()
    this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== undefined) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connectEventStream()
    }, STREAM_RETRY_MS)
    this.reconnectTimer.unref?.()
  }

  private async getJson(path: string, origin: string = this.origin): Promise<unknown> {
    const response = await this.fetchImpl(`${origin}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`pet request failed: ${response.status}`)
    return response.json()
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`pet request failed: ${response.status}`)
    return response.json()
  }

  private setState(state: PetBridgeState): void {
    if (state.connection === this.current.connection && state.snapshot === this.current.snapshot) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }
}
