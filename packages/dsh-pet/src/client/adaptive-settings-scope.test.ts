import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { AdaptiveSettingsScope } from './adaptive-settings-scope.ts'

function fakeScope<T>(value: T) {
  const listeners = new Set<() => void>()
  let snapshot: SettingsScopeSnapshot<T> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const set = vi.fn(async () => undefined)
  const unset = vi.fn(async () => undefined)
  const scope: SettingsScope<T> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset,
  }
  return {
    listeners,
    scope,
    set,
    unset,
    update(next: T) {
      snapshot = { ...snapshot, value: next, revision: (snapshot.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
    },
  }
}

describe('AdaptiveSettingsScope', () => {
  it('switches snapshots and forwards writes to the active source', async () => {
    const official = fakeScope({ enabled: true })
    const compatibility = fakeScope({ enabled: false })
    const scope = new AdaptiveSettingsScope(official.scope)
    const changed = vi.fn()
    const unsubscribe = scope.subscribe(changed)

    scope.replace(compatibility.scope)
    expect(scope.getSnapshot().value).toEqual({ enabled: false })
    expect(changed).toHaveBeenCalledOnce()
    expect(official.listeners.size).toBe(0)
    expect(compatibility.listeners.size).toBe(1)

    await scope.set('enabled', true)
    await scope.unset('enabled')
    expect(compatibility.set).toHaveBeenCalledWith('enabled', true)
    expect(compatibility.unset).toHaveBeenCalledWith('enabled')

    compatibility.update({ enabled: true })
    expect(changed).toHaveBeenCalledTimes(2)

    unsubscribe()
    scope.dispose()
    expect(compatibility.listeners.size).toBe(0)
  })
})
