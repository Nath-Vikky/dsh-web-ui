// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const roots: Array<{ render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }> = []

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => {
    const root = { render: vi.fn(), unmount: vi.fn() }
    roots.push(root)
    return root
  }),
}))

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    return {
      get: () => value,
      set: (next: unknown) => { value = next },
      subscribe: () => () => undefined,
    }
  },
}))

vi.mock('../src/client/pet-store.ts', () => ({
  createPetStore: () => ({
    create: () => ({
      getSnapshot: () => ({ snapshot: null, state: 'loading', error: null, feedback: null }),
      subscribe: () => () => undefined,
      actions: {
        setSnapshot: vi.fn(),
        setState: vi.fn(),
        setFeedback: vi.fn(),
      },
    }),
  }),
}))

import { apply } from '../src/client/index.ts'

type SettingsSnapshot =
  | { status: 'loading'; writable: false; value?: undefined }
  | { status: 'unavailable'; writable: false; value?: undefined }
  | { status: 'ready'; writable: true; value: { enabled?: boolean }; base?: object; user?: object }

function setup(initial: SettingsSnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const effects: Array<{ label: string; dispose: () => void }> = []
  const settingsScope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => undefined,
    unset: async () => undefined,
  }
  const ctx = {
    effect: (factory: () => unknown, label = '') => {
      const result = factory()
      const dispose = typeof result === 'function' ? result as () => void : () => undefined
      effects.push({ label, dispose })
      return dispose
    },
    get: () => undefined,
    locale: { register: () => () => undefined },
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory()
        return () => undefined
      },
      register: () => () => undefined,
    },
    settingsScope: { bind: () => settingsScope },
  }

  apply(ctx as never)
  return {
    effects,
    listeners,
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
  roots.length = 0
  document.body.replaceChildren()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('pet client apply lifecycle', () => {
  it('owns one global root and releases every subscription on unload', () => {
    const runtime = setup({ status: 'unavailable', writable: false })

    expect(roots).toHaveLength(1)
    expect(roots[0]?.render).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
    expect(runtime.listeners.size).toBe(2)

    runtime.dispose()

    expect(roots[0]?.unmount).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()
    expect(runtime.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmounts while disabled and remounts without duplicating the root', () => {
    const runtime = setup({ status: 'ready', writable: true, value: { enabled: true } })
    expect(roots).toHaveLength(1)

    runtime.setSnapshot({ status: 'ready', writable: true, value: { enabled: false } })
    expect(roots[0]?.unmount).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()

    runtime.setSnapshot({ status: 'ready', writable: true, value: { enabled: true } })
    expect(roots).toHaveLength(2)
    expect(document.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)

    runtime.dispose()
    expect(roots[1]?.unmount).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()
  })
})
