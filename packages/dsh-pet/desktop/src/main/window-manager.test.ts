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
})
