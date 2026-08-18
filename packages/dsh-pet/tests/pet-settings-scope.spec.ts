import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => {
        value = next
        for (const listener of listeners) listener()
      },
      update: (mutate: (draft: never) => void) => {
        mutate(value as never)
        for (const listener of listeners) listener()
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  },
}))

import { createPetSettingsScope } from '../src/client/pet-settings-scope.ts'
import type { PetSettings } from '../src/client/PetSettingsCard.tsx'

class PrimaryScope implements SettingsScope<PetSettings> {
  snapshot: SettingsScopeSnapshot<PetSettings>
  readonly set = vi.fn(async () => undefined)
  readonly unset = vi.fn(async () => undefined)
  private readonly listeners = new Set<() => void>()

  constructor(status: 'ready' | 'unavailable') {
    this.snapshot = status === 'ready'
      ? {
          status,
          value: { desktopEnabled: false },
          base: {},
          user: {},
          revision: 1,
          writable: true,
          mode: 'host',
        }
      : {
          status,
          value: undefined,
          base: undefined,
          user: undefined,
          revision: undefined,
          writable: false,
          mode: 'host',
        }
  }

  getSnapshot(): SettingsScopeSnapshot<PetSettings> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  listenerCount(): number {
    return this.listeners.size
  }

  publish(): void {
    for (const listener of this.listeners) listener()
  }
}

describe('standalone pet settings scope', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('uses the pet loopback route when the official namespace is unavailable', async () => {
    let desktopEnabled = false
    let revision = 2
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/mutate')) {
        const request = JSON.parse(String(init?.body)) as { ops: Array<{ value?: boolean }> }
        desktopEnabled = request.ops[0]?.value === true
        revision += 1
      }
      return new Response(JSON.stringify({
        value: { desktopEnabled },
        base: { desktopEnabled: false },
        user: desktopEnabled ? { desktopEnabled: true } : {},
        revision,
        writable: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const scope = createPetSettingsScope(new PrimaryScope('unavailable'), fetchFn as typeof fetch)

    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({
      status: 'ready',
      value: { desktopEnabled: false },
      writable: true,
    })
    await expect(scope.mutate?.([
      { field: 'desktopEnabled', op: 'set', value: true },
    ])).resolves.toEqual({
      ok: true,
      fields: [{ field: 'desktopEnabled', landed: true }],
    })
    expect(scope.getSnapshot()).toMatchObject({
      value: { desktopEnabled: true },
      user: { desktopEnabled: true },
      revision: 3,
    })
  })

  it('keeps a served official or Web UI family scope authoritative', async () => {
    const primary = new PrimaryScope('ready')
    const fetchFn = vi.fn()
    const scope = createPetSettingsScope(primary, fetchFn as typeof fetch)

    await scope.set('desktopEnabled', true)
    expect(primary.set).toHaveBeenCalledWith('desktopEnabled', true)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(scope.mutate).toBeUndefined()
  })

  it('releases primary and fallback subscriptions on plugin unload', () => {
    const primary = new PrimaryScope('ready')
    const scope = createPetSettingsScope(primary, vi.fn() as typeof fetch)
    const listener = vi.fn()
    scope.subscribe(listener)

    expect(primary.listenerCount()).toBe(1)
    scope.dispose()
    expect(primary.listenerCount()).toBe(0)
    primary.publish()
    expect(listener).not.toHaveBeenCalled()
  })
})
