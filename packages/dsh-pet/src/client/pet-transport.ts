/** SSE-first browser transport with visibility-aware polling fallback. */

import type { PetStateView } from '../service.ts'

/** Existing compatibility poll cadence while SSE is unavailable. */
export const PET_POLL_MS = 800

/** Delay before trying the event stream again while fallback polling works. */
export const PET_SSE_RETRY_MS = 10_000

export interface PetEventSource {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

export interface PetStateTransportOptions {
  fetchState: () => Promise<PetStateView>
  onSnapshot: (snapshot: PetStateView) => void
  onError: (error: Error) => void
  eventUrl?: string
  pollMs?: number
  retryMs?: number
  createEventSource?: (url: string) => PetEventSource
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const animations = new Set([
  'idle', 'running-right', 'running-left', 'waving', 'jumping',
  'failed', 'waiting', 'running', 'review',
])
const phases = new Set(['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Runtime boundary check for untrusted or version-skewed SSE payloads. */
export function isPetStateView(value: unknown): value is PetStateView {
  if (!isRecord(value) || !isRecord(value.display) || !isRecord(value.affinity) || !isRecord(value.treats)) {
    return false
  }
  return typeof value.animation === 'string'
    && animations.has(value.animation)
    && typeof value.phase === 'string'
    && phases.has(value.phase)
    && typeof value.sessionActive === 'boolean'
    && (value.bubble === undefined || typeof value.bubble === 'string')
    && typeof value.name === 'string'
    && typeof value.display.visible === 'boolean'
    && isFiniteNumber(value.display.size)
    && isFiniteNumber(value.display.right)
    && isFiniteNumber(value.display.bottom)
    && isFiniteNumber(value.affinity.points)
    && typeof value.affinity.rank === 'string'
    && typeof value.affinity.rankEmoji === 'string'
    && isFiniteNumber(value.affinity.pets)
    && isFiniteNumber(value.affinity.feeds)
    && isFiniteNumber(value.affinity.turns)
    && typeof value.affinity.petCooldown === 'boolean'
    && typeof value.affinity.feedCooldown === 'boolean'
    && isFiniteNumber(value.treats.stocked)
    && isFiniteNumber(value.treats.max)
}

function browserEventSourceFactory(): ((url: string) => PetEventSource) | undefined {
  return typeof EventSource === 'undefined' ? undefined : (url) => new EventSource(url)
}

/** Owns exactly one stream, fallback interval, and reconnect timer. */
export class PetStateTransport {
  private readonly eventUrl: string
  private readonly pollMs: number
  private readonly retryMs: number
  private readonly createEventSource: ((url: string) => PetEventSource) | undefined
  private source: PetEventSource | undefined
  private pollTimer: number | undefined
  private retryTimer: number | undefined
  private started = false
  private inFlight = false

  constructor(private readonly options: PetStateTransportOptions) {
    this.eventUrl = options.eventUrl ?? '/api/pet/events'
    this.pollMs = options.pollMs ?? PET_POLL_MS
    this.retryMs = options.retryMs ?? PET_SSE_RETRY_MS
    this.createEventSource = options.createEventSource ?? browserEventSourceFactory()
  }

  /** Start visibility tracking and the preferred event stream. */
  start(): void {
    if (this.started) return
    this.started = true
    document.addEventListener('visibilitychange', this.onVisibility)
    if (document.visibilityState === 'visible') this.activate()
  }

  /** Stop every browser resource owned by this transport. */
  stop(): void {
    if (!this.started) return
    this.started = false
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.closeSource()
    this.stopPolling()
    this.clearRetry()
  }

  /** Immediate compatibility refresh, used on mount and after writes. */
  refresh(): void {
    if (!this.started || document.visibilityState !== 'visible' || this.inFlight) return
    this.inFlight = true
    this.options.fetchState().then((snapshot) => {
      if (this.started && document.visibilityState === 'visible') this.options.onSnapshot(snapshot)
    }, (error) => {
      if (this.started) this.options.onError(error instanceof Error ? error : new Error(String(error)))
    }).finally(() => {
      this.inFlight = false
    })
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      this.activate()
      this.refresh()
    } else {
      this.closeSource()
      this.stopPolling()
      this.clearRetry()
    }
  }

  private activate(): void {
    this.startPolling()
    this.openSource()
  }

  private openSource(): void {
    if (!this.started
      || document.visibilityState !== 'visible'
      || this.source !== undefined
      || this.createEventSource === undefined) return
    this.clearRetry()
    let source: PetEventSource
    try {
      source = this.createEventSource(this.eventUrl)
    } catch (error) {
      this.options.onError(error instanceof Error ? error : new Error(String(error)))
      this.scheduleRetry()
      return
    }
    this.source = source
    source.onopen = () => {
      if (this.source !== source || !this.started) return
      this.stopPolling()
    }
    source.onmessage = (event) => {
      if (this.source !== source || document.visibilityState !== 'visible') return
      try {
        const value: unknown = JSON.parse(event.data)
        if (!isPetStateView(value)) throw new Error('invalid pet event snapshot')
        this.options.onSnapshot(value)
      } catch (error) {
        this.options.onError(error instanceof Error ? error : new Error(String(error)))
      }
    }
    source.onerror = () => {
      if (this.source !== source) return
      this.options.onError(new Error('pet event stream unavailable'))
      this.closeSource()
      this.startPolling()
      this.scheduleRetry()
    }
  }

  private closeSource(): void {
    const source = this.source
    this.source = undefined
    if (source === undefined) return
    source.onopen = null
    source.onmessage = null
    source.onerror = null
    source.close()
  }

  private startPolling(): void {
    if (this.pollTimer !== undefined || !this.started || document.visibilityState !== 'visible') return
    this.pollTimer = window.setInterval(() => { this.refresh() }, this.pollMs)
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return
    window.clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private scheduleRetry(): void {
    if (this.createEventSource === undefined
      || this.retryTimer !== undefined
      || !this.started
      || document.visibilityState !== 'visible') return
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined
      this.openSource()
    }, this.retryMs)
  }

  private clearRetry(): void {
    if (this.retryTimer === undefined) return
    window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }
}
