// @vitest-environment jsdom

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T>(initial: T) => {
    let snapshot = { ...initial }
    const listeners = new Set<() => void>()
    const publish = (): void => { for (const listener of listeners) listener() }
    return {
      getSnapshot: (): T => snapshot,
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: T): void => {
        snapshot = { ...next }
        publish()
      },
      update: (mutator: (draft: T) => void): void => {
        const draft = { ...snapshot }
        mutator(draft)
        snapshot = { ...draft }
        publish()
      },
    }
  },
}))

import { StandalonePetSettingsScope } from './fallback-settings-scope.ts'

interface SettingsValue {
  enabled?: boolean
  visible?: boolean
}

function primaryScope(status: SettingsScopeSnapshot<SettingsValue>['status']) {
  const listeners = new Set<() => void>()
  let snapshot: SettingsScopeSnapshot<SettingsValue> = {
    status,
    value: status === 'ready' ? { enabled: true } : undefined,
    base: undefined,
    user: undefined,
    revision: status === 'ready' ? 1 : undefined,
    writable: status === 'ready',
    mode: 'host',
  }
  const scope: SettingsScope<SettingsValue> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
  return {
    scope,
    update(next: SettingsScopeSnapshot<SettingsValue>) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('StandalonePetSettingsScope', () => {
  it('keeps the official settings scope authoritative when it is ready', async () => {
    const primary = primaryScope('ready')
    const fetchFn = vi.fn()
    const scope = new StandalonePetSettingsScope(primary.scope, fetchFn)

    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', value: { enabled: true } })
    await scope.set('enabled', false)
    expect(primary.scope.set).toHaveBeenCalledWith('enabled', false)
    expect(fetchFn).not.toHaveBeenCalled()
    scope.dispose()
  })

  it('loads and writes through the package bridge after official unavailability', async () => {
    const primary = primaryScope('unavailable')
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        value: {
          value: { enabled: true, visible: true },
          base: { enabled: true, visible: true },
          user: {},
          revision: 7,
          writable: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        value: {
          value: { enabled: true, visible: false },
          base: { enabled: true, visible: true },
          user: { visible: false },
          revision: 8,
          writable: true,
        },
      }))
    const scope = new StandalonePetSettingsScope(primary.scope, fetchFn)

    await vi.waitFor(() => {
      expect(scope.getSnapshot()).toMatchObject({
        status: 'ready',
        value: { enabled: true, visible: true },
        revision: 7,
      })
    })
    await scope.set('visible', false)
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/pet/settings/mutate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        ops: [{ op: 'set', path: ['visible'], value: false }],
        expectedRevision: 7,
      }),
    }))
    expect(scope.getSnapshot()).toMatchObject({
      status: 'ready',
      value: { enabled: true, visible: false },
      revision: 8,
    })
    scope.dispose()
  })
})
