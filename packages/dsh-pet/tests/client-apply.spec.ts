// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    const publish = (): void => { for (const listener of listeners) listener() }
    return {
      get: () => value,
      getSnapshot: () => value,
      set: (next: unknown) => {
        value = next
        publish()
      },
      update: (mutate: (draft: unknown) => void) => {
        const draft = typeof value === 'object' && value !== null ? { ...value } : value
        mutate(draft)
        value = draft
        publish()
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  },
}))

import { apply } from '../src/client/index.ts'

type SettingsSnapshot =
  | { status: 'loading'; writable: false; value?: undefined }
  | { status: 'unavailable'; writable: false; value?: undefined }
  | { status: 'ready'; writable: true; value: { enabled?: boolean }; base?: object; user?: object }

function setup(initial: SettingsSnapshot, options: { compatBinder?: boolean; groupedSlot?: boolean } = {}) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const effects: Array<{ label: string; dispose: () => void }> = []
  const activeRegistrations: string[] = []
  const injectedSlots: string[] = []
  const registeredSlots: string[] = []
  const declaredSlots = new Set<string>([
    'settings.plugin.item',
    ...(options.groupedSlot === true ? ['web-ui.plugin.item'] : []),
  ])
  const slotInjections = new Map<string, { factory: () => unknown; dispose?: () => void }>()
  const settingsScope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => undefined,
    unset: async () => undefined,
  }
  const officialBind = vi.fn(() => settingsScope)
  const groupedBind = vi.fn(() => settingsScope)
  const webUiSettings = options.compatBinder === true ? { bind: groupedBind } : undefined
  const ctx = {
    effect: (factory: () => unknown, label = '') => {
      const result = factory()
      const dispose = typeof result === 'function' ? result as () => void : () => undefined
      effects.push({ label, dispose })
      return dispose
    },
    get: (name: string) => name === 'webUiSettings' ? webUiSettings : undefined,
    inject: (_dependencies: string[], callback: (scope: unknown) => unknown) => {
      if (webUiSettings !== undefined) callback(ctx)
      return undefined
    },
    locale: { register: () => () => undefined },
    slots: {
      inject: (name: string, factory: () => unknown) => {
        injectedSlots.push(name)
        const injection: { factory: () => unknown; dispose?: () => void } = { factory }
        slotInjections.set(name, injection)
        const activate = () => {
          if (!declaredSlots.has(name) || injection.dispose !== undefined) return
          const result = factory()
          injection.dispose = typeof result === 'function' ? result as () => void : () => undefined
        }
        activate()
        const dispose = () => {
          injection.dispose?.()
          injection.dispose = undefined
          slotInjections.delete(name)
        }
        effects.push({ label: `slots.inject(${name})`, dispose })
        return dispose
      },
      register: (registration: { name: string }) => {
        registeredSlots.push(registration.name)
        activeRegistrations.push(registration.name)
        let active = true
        return () => {
          if (!active) return
          active = false
          const index = activeRegistrations.indexOf(registration.name)
          if (index >= 0) activeRegistrations.splice(index, 1)
        }
      },
    },
    settingsScope: { bind: officialBind },
  }

  apply(ctx as never)
  return {
    activeRegistrations,
    declareSlot(name: string) {
      declaredSlots.add(name)
      const injection = slotInjections.get(name)
      if (injection === undefined || injection.dispose !== undefined) return
      const result = injection.factory()
      injection.dispose = typeof result === 'function' ? result as () => void : () => undefined
    },
    effects,
    groupedBind,
    injectedSlots,
    listeners,
    officialBind,
    registeredSlots,
    setSnapshot(next: SettingsSnapshot) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    dispose() {
      for (const effect of [...effects].reverse()) effect.dispose()
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('pet client apply lifecycle', () => {
  it('registers a top-level plugin card when installed standalone', () => {
    const runtime = setup({ status: 'unavailable', writable: false })

    expect(runtime.injectedSlots).toEqual(['web-ui.plugin.item', 'settings.plugin.item'])
    expect(runtime.registeredSlots).toEqual(['settings.plugin.item'])
    expect(runtime.activeRegistrations).toEqual(['settings.plugin.item'])
    expect(runtime.officialBind).toHaveBeenCalledWith({ namespace: 'pet' })
    expect(runtime.groupedBind).not.toHaveBeenCalled()

    runtime.dispose()
  })

  it('registers inside Web UI Plugins when the aggregate group is already present', () => {
    const runtime = setup(
      { status: 'unavailable', writable: false },
      { compatBinder: true, groupedSlot: true },
    )

    expect(runtime.injectedSlots).toEqual(['web-ui.plugin.item', 'settings.plugin.item'])
    expect(runtime.registeredSlots).toEqual(['web-ui.plugin.item'])
    expect(runtime.activeRegistrations).toEqual(['web-ui.plugin.item'])
    expect(runtime.groupedBind).toHaveBeenCalledWith({ namespace: 'pet' })
    expect(runtime.officialBind).toHaveBeenCalledWith({ namespace: 'pet' })

    runtime.dispose()
  })

  it('uses the declared Web UI child slot even when the compatibility binder is not visible', () => {
    const runtime = setup({ status: 'unavailable', writable: false }, { groupedSlot: true })

    expect(runtime.injectedSlots).toEqual(['web-ui.plugin.item', 'settings.plugin.item'])
    expect(runtime.registeredSlots).toEqual(['web-ui.plugin.item'])
    expect(runtime.activeRegistrations).toEqual(['web-ui.plugin.item'])
    expect(runtime.officialBind).toHaveBeenCalledWith({ namespace: 'pet' })
    expect(runtime.groupedBind).not.toHaveBeenCalled()

    runtime.dispose()
  })

  it('moves the standalone card into Web UI Plugins when its child slot appears later', () => {
    const runtime = setup({ status: 'unavailable', writable: false })
    expect(runtime.activeRegistrations).toEqual(['settings.plugin.item'])

    runtime.declareSlot('web-ui.plugin.item')

    expect(runtime.registeredSlots).toEqual(['settings.plugin.item', 'web-ui.plugin.item'])
    expect(runtime.activeRegistrations).toEqual(['web-ui.plugin.item'])

    runtime.dispose()
  })

  it('does not mount the retired web pet and releases settings subscriptions', () => {
    const runtime = setup({ status: 'unavailable', writable: false })

    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()
    expect(runtime.listeners.size).toBe(1)

    runtime.dispose()

    expect(runtime.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the browser surface empty when the desktop lifecycle setting changes', () => {
    const runtime = setup({ status: 'ready', writable: true, value: { enabled: true } })
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()

    runtime.setSnapshot({ status: 'ready', writable: true, value: { enabled: false } })
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()

    runtime.setSnapshot({ status: 'ready', writable: true, value: { enabled: true } })
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()

    runtime.dispose()
  })
})
