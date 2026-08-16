/**
 * Browser-side fallback for standalone dsh-pet installs. The official scope
 * remains authoritative whenever it exposes the namespace; this controller
 * touches the package-owned loopback route only after an unavailable result.
 */

import {
  createSnapshotStore,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  PET_SETTINGS_BRIDGE_PREFIX,
  type PetSettingsBridgeResult,
  type PetSettingsBridgeView,
  type PetSettingsField,
} from '../settings-protocol.ts'

type BridgeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isBridgeResult(value: unknown): value is PetSettingsBridgeResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.ok === true) return typeof record.value === 'object' && record.value !== null
  return record.ok === false && typeof record.code === 'string' && typeof record.message === 'string'
}

async function post(fetchFn: BridgeFetch, path: string, body: unknown): Promise<PetSettingsBridgeResult> {
  try {
    const response = await fetchFn(`${PET_SETTINGS_BRIDGE_PREFIX}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) return { ok: false, code: 'http', message: `settings bridge HTTP ${response.status}` }
    const parsed: unknown = await response.json()
    return isBridgeResult(parsed)
      ? parsed
      : { ok: false, code: 'malformed', message: 'settings bridge returned malformed JSON' }
  } catch {
    return { ok: false, code: 'unreachable', message: 'settings bridge is unreachable' }
  }
}

class BridgeScope<T> implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly fetchFn: BridgeFetch) {
    this.store = createSnapshotStore<SettingsScopeSnapshot<T>>({
      status: 'loading',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: 'host',
    })
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  load(): Promise<void> {
    return this.enqueue(() => this.read())
  }

  set(field: string, value: unknown): Promise<void> {
    if (typeof value !== 'boolean') return Promise.resolve()
    return this.enqueue(() => this.write({ op: 'set', path: [field as PetSettingsField], value }))
  }

  unset(field: string): Promise<void> {
    return this.enqueue(() => this.write({ op: 'unset', path: [field as PetSettingsField] }))
  }

  dispose(): void {
    this.disposed = true
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const task = this.tail.then(async () => {
      if (!this.disposed) await operation()
    })
    this.tail = task.catch(() => undefined)
    return task
  }

  private async read(): Promise<void> {
    const result = await post(this.fetchFn, '/describe', {})
    if (this.disposed) return
    if (!result.ok) {
      this.store.update((draft) => { draft.status = 'unavailable' })
      return
    }
    this.accept(result.value)
  }

  private async write(op: { op: 'set' | 'unset'; path: [PetSettingsField]; value?: boolean }): Promise<void> {
    const revision = this.getSnapshot().revision
    const result = await post(this.fetchFn, '/mutate', {
      ops: [op],
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    })
    if (this.disposed) return
    if (!result.ok) {
      await this.read()
      return
    }
    this.accept(result.value)
  }

  private accept(view: PetSettingsBridgeView): void {
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.value = view.value as T
      draft.base = view.base
      draft.user = view.user
      draft.revision = view.revision
      draft.writable = view.writable
      draft.mode = 'host'
    })
  }
}

/**
 * Stable scope that falls back to dsh-pet's own bridge only when the official
 * Host reports the namespace unavailable.
 */
export class StandalonePetSettingsScope<T> implements SettingsScope<T> {
  private readonly fallback: BridgeScope<T> | undefined
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private readonly unsubscribePrimary: () => void
  private readonly unsubscribeFallback: (() => void) | undefined
  private fallbackStarted = false
  private disposed = false

  constructor(private readonly primary: SettingsScope<T>, fetchFn?: BridgeFetch) {
    this.fallback = fetchFn === undefined ? undefined : new BridgeScope<T>(fetchFn)
    this.store = createSnapshotStore(this.project())
    this.unsubscribePrimary = primary.subscribe(this.onPrimary)
    this.unsubscribeFallback = this.fallback?.subscribe(this.publish)
    if (primary.getSnapshot().status === 'unavailable') this.startFallback()
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  set(field: string, value: unknown): Promise<void> {
    return this.active().set(field, value)
  }

  unset(field: string): Promise<void> {
    return this.active().unset(field)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribePrimary()
    this.unsubscribeFallback?.()
    this.fallback?.dispose()
  }

  private readonly onPrimary = (): void => {
    if (this.primary.getSnapshot().status === 'unavailable') this.startFallback()
    this.publish()
  }

  private readonly publish = (): void => {
    if (!this.disposed) this.store.set(this.project())
  }

  private startFallback(): void {
    if (this.fallback === undefined || this.fallbackStarted) return
    this.fallbackStarted = true
    void this.fallback.load()
  }

  private project(): SettingsScopeSnapshot<T> {
    const primary = this.primary.getSnapshot()
    if (primary.status === 'ready' || this.fallback === undefined) return primary
    if (primary.status === 'loading') return primary
    const fallback = this.fallback.getSnapshot()
    if (fallback.status === 'ready') return fallback
    if (fallback.status === 'loading') return { ...primary, status: 'loading' }
    return primary
  }

  private active(): SettingsScope<T> {
    return this.primary.getSnapshot().status === 'ready'
      ? this.primary
      : this.fallback ?? this.primary
  }
}

/** Same-origin fetch only for a loopback Web Harness surface. */
export function loopbackSettingsFetch(): BridgeFetch | undefined {
  if (typeof location === 'undefined' || typeof fetch === 'undefined') return undefined
  if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost' && location.hostname !== '[::1]') return undefined
  return fetch.bind(globalThis)
}
