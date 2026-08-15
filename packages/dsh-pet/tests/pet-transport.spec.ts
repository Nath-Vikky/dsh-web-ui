// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetStateView } from '../src/service.ts'
import {
  PET_POLL_MS,
  PET_SSE_RETRY_MS,
  PetStateTransport,
  type PetEventSource,
} from '../src/client/pet-transport.ts'

const snapshot: PetStateView = {
  animation: 'idle',
  phase: 'idle',
  sessionActive: false,
  affinity: {
    points: 0,
    rank: '幼鲸',
    rankEmoji: '*',
    pets: 0,
    feeds: 0,
    turns: 0,
    petCooldown: false,
    feedCooldown: false,
  },
  display: { visible: true, size: 160, right: 24, bottom: 20 },
  name: '鲸鱼娘',
  treats: { stocked: 0, max: 20 },
}

function createSource(): PetEventSource {
  return {
    onopen: null,
    onmessage: null,
    onerror: null,
    close: vi.fn<() => void>(),
  }
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('PetStateTransport', () => {
  it('prefers a valid SSE snapshot and stops fallback polling after open', () => {
    const source = createSource()
    const onSnapshot = vi.fn()
    const onError = vi.fn()
    const createEventSource = vi.fn((_url: string) => source)
    const transport = new PetStateTransport({
      fetchState: vi.fn(async () => snapshot),
      onSnapshot,
      onError,
      eventUrl: '/pet-events',
      createEventSource,
    })

    transport.start()
    expect(createEventSource).toHaveBeenCalledWith('/pet-events')
    expect(vi.getTimerCount()).toBe(1)

    source.onopen?.(new Event('open'))
    expect(vi.getTimerCount()).toBe(0)

    source.onmessage?.(new MessageEvent('message', { data: JSON.stringify(snapshot) }))
    expect(onSnapshot).toHaveBeenCalledWith(snapshot)

    source.onmessage?.(new MessageEvent('message', { data: '{"animation":42}' }))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'invalid pet event snapshot',
    }))

    transport.stop()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it('falls back to polling and reconnects after a stream error', async () => {
    const first = createSource()
    const second = createSource()
    const sources = [first, second]
    const fetchState = vi.fn(async () => snapshot)
    const onSnapshot = vi.fn()
    const createEventSource = vi.fn((_url: string) => sources.shift() ?? createSource())
    const transport = new PetStateTransport({
      fetchState,
      onSnapshot,
      onError: vi.fn(),
      createEventSource,
    })

    transport.start()
    first.onerror?.(new Event('error'))
    expect(first.close).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(fetchState).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledWith(snapshot)

    await vi.advanceTimersByTimeAsync(PET_SSE_RETRY_MS - PET_POLL_MS)
    expect(createEventSource).toHaveBeenCalledTimes(2)

    second.onopen?.(new Event('open'))
    expect(vi.getTimerCount()).toBe(0)
    transport.stop()
  })

  it('releases browser resources while hidden and restores them when visible', async () => {
    const first = createSource()
    const second = createSource()
    const createEventSource = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const fetchState = vi.fn(async () => snapshot)
    const transport = new PetStateTransport({
      fetchState,
      onSnapshot: vi.fn(),
      onError: vi.fn(),
      createEventSource,
    })

    transport.start()
    setVisibility('hidden')
    expect(first.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)

    setVisibility('visible')
    await Promise.resolve()
    expect(createEventSource).toHaveBeenCalledTimes(2)
    expect(fetchState).toHaveBeenCalledOnce()

    transport.stop()
    expect(second.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
