// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetIntent } from '../src/core/intent.ts'
import { FRAME_HEIGHT } from '../src/client/spritesheet.ts'
import {
  PET_MANIFEST_URL,
  PET_SPRITESHEET_URL,
  SpritePetRenderer,
} from '../src/client/renderers/sprite/SpritePetRenderer.ts'

class FakeImage {
  onload: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  naturalWidth = 1536
  naturalHeight = 1872
  private value = ''

  get src(): string {
    return this.value
  }

  set src(value: string) {
    this.value = value
    queueMicrotask(() => { this.onload?.(new Event('load')) })
  }
}

const intent: PetIntent = {
  id: 'intent-1',
  createdAt: 1,
  priority: 50,
  ttlMs: 8_000,
  expression: 'happy',
  motion: 'cheer',
  sourceTaskIds: ['task-1'],
  interruptible: false,
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ frames: [6, 8, 8, 4, 5, 8, 6, 6, 6] }),
  } as Response)))
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('SpritePetRenderer', () => {
  it('owns sprite model loading, animation paint, pause, intent, and teardown', async () => {
    let nextFrameId = 0
    const frames = new Map<number, FrameRequestCallback>()
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    })
    const cancelFrame = vi.fn((id: number) => { frames.delete(id) })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const runFrame = (timestamp: number): void => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      if (entry === undefined) throw new Error('missing animation frame')
      frames.delete(entry[0])
      entry[1](timestamp)
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const renderer = new SpritePetRenderer()
    renderer.setRenderScale(160 / FRAME_HEIGHT)
    renderer.applyAnimation('running-right')
    await renderer.mount(container)

    expect(fetch).toHaveBeenCalledWith(PET_MANIFEST_URL)
    expect(container.style.backgroundImage).toContain(PET_SPRITESHEET_URL)
    expect(container.style.height).toBe('160px')
    expect(container.style.width).toBe('148px')
    expect(container.style.backgroundPosition).toBe('0px -160px')

    runFrame(1)
    runFrame(251)
    expect(container.style.backgroundPosition).not.toBe('0px -160px')

    renderer.setPaused(true)
    expect(frames.size).toBe(0)
    expect(cancelFrame).toHaveBeenCalled()

    renderer.setPaused(false)
    expect(frames.size).toBe(1)
    renderer.applyIntent(intent)
    expect(container.style.backgroundPosition).toBe('0px -640px')

    renderer.destroy()
    expect(frames.size).toBe(0)
    expect(container.style.backgroundImage).toBe('')
    expect(container.style.width).toBe('')
  })

  it('rejects incompatible model sources without replacing the sprite fallback', async () => {
    const renderer = new SpritePetRenderer()
    await expect(renderer.loadModel({ kind: 'live2d', modelUrl: '/model.json' }))
      .rejects.toThrow('requires a sprite model')
    renderer.destroy()
  })
})
