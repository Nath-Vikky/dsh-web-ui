/**
 * Pet-owned SettingsScope fallback for standalone installs.
 *
 * Official DSH deliberately allowlists browser-visible settings namespaces,
 * while the dsh-web-ui aggregate supplies its own authenticated compatibility
 * bridge. A standalone third-party pet has neither. This wrapper keeps either
 * official/family scope authoritative when it is ready and falls back only on
 * loopback to the pet Host's narrow `/api/pet/settings` route.
 */

import {
  createSnapshotStore,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { BatchResult, BatchedWrite } from './settings-form.ts'

const PET_SETTINGS_PATH = '/api/pet/settings'

interface PetSettingsWireView<T> {
  value: T
  base?: Partial<T>
  user?: Partial<T>
  revision: number
  writable: boolean
}

interface PetSettingsMutation {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

async function fetchJson<T>(fetchFn: typeof fetch, path: string, body?: unknown): Promise<T> {
  const response = await fetchFn(path, body === undefined
    ? {}
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
  if (!response.ok) throw new Error(`pet settings ${path} failed: ${String(response.status)}`)
  return (await response.json()) as T
}

/** The direct loopback scope behind the primary/fallback selector. */
class DirectPetSettingsScope<T> implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly fetchFn: typeof fetch) {
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
    return this.enqueue(async () => {
      try {
        this.accept(await fetchJson<PetSettingsWireView<T>>(this.fetchFn, PET_SETTINGS_PATH))
      } catch {
        this.store.update((draft) => {
          draft.status = 'unavailable'
          draft.writable = false
        })
      }
    })
  }

  set(field: string, value: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.write([{ op: 'set', path: [field], value }])
    })
  }

  unset(field: string): Promise<void> {
    return this.enqueue(async () => {
      await this.write([{ op: 'unset', path: [field] }])
    })
  }

  mutate(fields: BatchedWrite[]): Promise<BatchResult> {
    return this.enqueue(async () => {
      const ops: PetSettingsMutation[] = fields.map(field => field.op === 'set'
        ? { op: 'set', path: [field.field], value: field.value }
        : { op: 'unset', path: [field.field] })
      const accepted = await this.write(ops)
      if (!accepted) {
        return { ok: false, fields: [], code: 'settings-rejected', message: 'pet settings write was rejected' }
      }
      const user = this.getSnapshot().user as Record<string, unknown> | undefined
      return {
        ok: true,
        fields: fields.map(field => ({
          field: field.field,
          landed: field.op === 'set'
            ? user !== undefined && Object.hasOwn(user, field.field) && user[field.field] === field.value
            : user === undefined || !Object.hasOwn(user, field.field),
        })),
      }
    })
  }

  private enqueue<U>(operation: () => Promise<U>): Promise<U> {
    const task = this.tail.then(operation)
    this.tail = task.catch(() => undefined)
    return task
  }

  private async write(ops: PetSettingsMutation[]): Promise<boolean> {
    const revision = this.getSnapshot().revision
    try {
      const view = await fetchJson<PetSettingsWireView<T>>(
        this.fetchFn,
        `${PET_SETTINGS_PATH}/mutate`,
        { ops, ...(revision === undefined ? {} : { expectedRevision: revision }) },
      )
      this.accept(view)
      return true
    } catch {
      await this.loadDirect()
      return false
    }
  }

  /** Refresh without entering the serialized queue a second time. */
  private async loadDirect(): Promise<void> {
    try {
      this.accept(await fetchJson<PetSettingsWireView<T>>(this.fetchFn, PET_SETTINGS_PATH))
    } catch {
      this.store.update((draft) => {
        draft.status = 'unavailable'
        draft.writable = false
      })
    }
  }

  private accept(view: PetSettingsWireView<T>): void {
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.value = view.value
      draft.base = view.base
      draft.user = view.user
      draft.revision = view.revision
      draft.writable = view.writable
    })
  }
}

/**
 * Prefer an already-served official/family settings scope and use the pet's
 * private loopback route only after that scope reports `unavailable`.
 */
export function createPetSettingsScope<T>(
  primary: SettingsScope<T>,
  fetchFn: typeof fetch,
): SettingsScope<T> & {
  load(): Promise<void>
  mutate?: (fields: BatchedWrite[]) => Promise<BatchResult>
  dispose(): void
} {
  const fallback = new DirectPetSettingsScope<T>(fetchFn)
  const store = createSnapshotStore<SettingsScopeSnapshot<T>>(primary.getSnapshot())
  let fallbackStarted = false

  const project = (): SettingsScopeSnapshot<T> => {
    const primarySnapshot = primary.getSnapshot()
    if (primarySnapshot.status === 'ready' || primarySnapshot.status === 'loading') return primarySnapshot
    const fallbackSnapshot = fallback.getSnapshot()
    return fallbackSnapshot.status === 'loading'
      ? { ...primarySnapshot, status: 'loading' }
      : fallbackSnapshot
  }
  const publish = (): void => { store.set(project()) }
  const startFallback = (): void => {
    if (fallbackStarted) return
    fallbackStarted = true
    void fallback.load()
  }

  const unsubscribes: Array<() => void> = []
  unsubscribes.push(primary.subscribe(() => {
    if (primary.getSnapshot().status === 'unavailable') startFallback()
    publish()
  }))
  unsubscribes.push(fallback.subscribe(publish))
  if (primary.getSnapshot().status === 'unavailable') startFallback()

  const active = (): SettingsScope<T> => primary.getSnapshot().status === 'ready' ? primary : fallback
  return {
    dispose: () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
    },
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    set: (field, value) => active().set(field, value),
    unset: field => active().unset(field),
    load: async () => {
      fallbackStarted = true
      await fallback.load()
    },
    get mutate() {
      if (primary.getSnapshot().status === 'ready') return undefined
      return fallback.mutate.bind(fallback)
    },
  }
}
