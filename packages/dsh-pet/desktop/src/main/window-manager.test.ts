import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const cursor = { x: 600, y: 700 }
  return {
    cursor,
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ ...cursor })),
      getAllDisplays: vi.fn(() => [{ workArea }]),
      getDisplayMatching: vi.fn(() => ({ workArea })),
      off: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  screen: electronMock.screen,
}))

import { DEFAULT_DESKTOP_CONFIG } from './config-store.ts'
import { WindowManager } from './window-manager.ts'

describe('WindowManager drag layout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    electronMock.cursor.x = 600
    electronMock.cursor.y = 700
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('updates the panel reserve during the same drag that crosses the display midpoint', () => {
    let bounds = { x: 500, y: 600, width: 224, height: 300 }
    const window = {
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
      getBounds: vi.fn(() => ({ ...bounds })),
      getContentBounds: vi.fn(() => ({ ...bounds })),
      isVisible: vi.fn(() => true),
      setContentBounds: vi.fn(),
      setPosition: vi.fn((x: number, y: number) => {
        bounds = { ...bounds, x, y }
      }),
    }
    const manager = new WindowManager(
      structuredClone(DEFAULT_DESKTOP_CONFIG),
      { save: vi.fn(async () => undefined) } as never,
    )
    const internals = manager as unknown as { window: typeof window }
    internals.window = window

    expect(manager.state().panelPlacement).toBe('above')
    manager.beginDrag()
    electronMock.cursor.y = 100
    vi.advanceTimersByTime(16)

    expect(window.setPosition).toHaveBeenCalledWith(500, 0)
    expect(manager.state().panelPlacement).toBe('below')
    expect(window.webContents.send).toHaveBeenCalledWith(
      'pet-desktop:state-changed',
      expect.objectContaining({ panelPlacement: 'below' }),
    )

    manager.endDrag()
    manager.destroy()
  })

  it('self-calibrates stale drawer-sized content before establishing the drag origin', () => {
    let bounds = { x: 1_000, y: 600, width: 528, height: 300 }
    let content = { ...bounds }
    const window = {
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
      getBounds: vi.fn(() => ({ ...bounds })),
      getContentBounds: vi.fn(() => ({ ...content })),
      isVisible: vi.fn(() => true),
      setContentBounds: vi.fn((next: typeof content) => {
        content = { ...next }
        bounds = { ...next }
      }),
      setPosition: vi.fn((x: number, y: number) => {
        bounds = { ...bounds, x, y }
        content = { ...content, x, y }
      }),
    }
    const manager = new WindowManager(
      structuredClone(DEFAULT_DESKTOP_CONFIG),
      { save: vi.fn(async () => undefined) } as never,
    )
    const internals = manager as unknown as { window: typeof window }
    internals.window = window

    const calibrated = manager.beginDrag()

    expect(window.setContentBounds).toHaveBeenCalledWith({
      x: 1_304,
      y: 600,
      width: 224,
      height: 300,
    })
    expect(calibrated.bounds).toEqual({ x: 1_304, y: 600, width: 224, height: 300 })
    electronMock.cursor.x = 700
    vi.advanceTimersByTime(16)
    expect(window.setPosition).toHaveBeenLastCalledWith(1_404, 600)

    manager.endDrag()
    manager.destroy()
  })
})
