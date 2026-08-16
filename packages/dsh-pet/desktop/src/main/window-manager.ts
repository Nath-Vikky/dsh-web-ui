import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'

import {
  DESKTOP_CHANNELS,
  type DesktopWindowSettings,
  type DesktopState,
  type DragResult,
  type MoveTarget,
  type PetBridgeState,
} from '../shared/desktop-api.ts'
import { type ConfigStore, type DesktopConfig } from './config-store.ts'
import { createDragSession, cursorChanged, dragTargetAt, type DragSession } from './drag-session.ts'
import { clampWindowPosition, resizedContentBounds } from './window-bounds.ts'

export const COLLAPSED_WIDTH = 224
export const EXPANDED_WIDTH = 528
export const WINDOW_HEIGHT = 300
const EDGE_MARGIN = 24
const DRAG_POLL_MS = 16

type StateListener = (state: DesktopState) => void

export class WindowManager {
  private window: BrowserWindow | undefined
  private drawerOpen = false
  private quitting = false
  private saveTimer: NodeJS.Timeout | undefined
  private dragTimer: NodeJS.Timeout | undefined
  private dragSession: DragSession | undefined
  private readonly listeners = new Set<StateListener>()

  constructor(
    private config: DesktopConfig,
    private readonly configStore: ConfigStore,
    private readonly onCompanionSettingsChange: (patch: Partial<DesktopWindowSettings>) => void = () => undefined,
  ) {}

  create(): BrowserWindow {
    const initialPosition = this.initialPosition()
    const window = new BrowserWindow({
      x: initialPosition.x,
      y: initialPosition.y,
      width: COLLAPSED_WIDTH,
      height: WINDOW_HEIGHT,
      useContentSize: true,
      transparent: true,
      frame: false,
      thickFrame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: this.config.alwaysOnTop,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.window = window
    window.setMovable(!this.config.locked)
    window.setMenuBarVisibility(false)

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.on('ready-to-show', () => {
      if (this.config.visible) window.showInactive()
    })
    window.on('show', () => this.emitState())
    window.on('hide', () => this.emitState())
    window.on('moved', () => {
      if (this.dragSession === undefined) this.schedulePositionSave()
    })
    window.on('close', event => {
      if (this.quitting) return
      event.preventDefault()
      this.hide()
    })
    window.on('closed', () => {
      this.window = undefined
      this.emitState()
    })

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl === undefined) {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    } else {
      void window.loadURL(rendererUrl)
    }

    screen.on('display-removed', this.ensureVisible)
    screen.on('display-metrics-changed', this.ensureVisible)
    return window
  }

  ownsWebContents(id: number): boolean {
    return this.window?.webContents.id === id
  }

  state(): DesktopState {
    const bounds = this.window?.getBounds() ?? {
      x: 0,
      y: 0,
      width: COLLAPSED_WIDTH,
      height: WINDOW_HEIGHT,
    }
    return {
      bounds,
      drawerOpen: this.drawerOpen,
      locked: this.config.locked,
      visible: this.window?.isVisible() === true,
      alwaysOnTop: this.config.alwaysOnTop,
      webDshUrl: this.config.webDshUrl,
      pixelModelId: this.config.pixelModelId,
      pixelModelNames: { ...this.config.pixelModelNames },
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setDrawerOpen(open: boolean): DesktopState {
    const window = this.requiredWindow()
    if (this.drawerOpen === open) return this.state()
    this.cancelDrag()
    const currentOuter = window.getBounds()
    const currentContent = window.getContentBounds()
    const contentWidth = open ? EXPANDED_WIDTH : COLLAPSED_WIDTH
    const nextContent = resizedContentBounds(
      currentOuter,
      currentContent,
      contentWidth,
      WINDOW_HEIGHT,
      this.workAreas(),
    )
    this.drawerOpen = open
    window.setContentBounds(nextContent)
    this.emitState()
    return this.state()
  }

  setLocked(locked: boolean): DesktopState {
    if (this.config.locked === locked) return this.state()
    if (locked) this.cancelDrag()
    this.config = { ...this.config, locked }
    this.window?.setMovable(!locked)
    this.persistConfig()
    this.onCompanionSettingsChange({ locked })
    this.emitState()
    return this.state()
  }

  setAlwaysOnTop(alwaysOnTop: boolean): DesktopState {
    if (this.config.alwaysOnTop === alwaysOnTop) return this.state()
    this.config = { ...this.config, alwaysOnTop }
    this.window?.setAlwaysOnTop(alwaysOnTop)
    this.persistConfig()
    this.onCompanionSettingsChange({ alwaysOnTop })
    this.emitState()
    return this.state()
  }

  /** Apply Host settings without echoing them back over HTTP. */
  applyCompanionSettings(settings: DesktopWindowSettings): DesktopState {
    const changed = this.config.visible !== settings.visible
      || this.config.alwaysOnTop !== settings.alwaysOnTop
      || this.config.locked !== settings.locked
    if (!changed) return this.state()
    if (settings.locked) this.cancelDrag()
    this.config = { ...this.config, ...settings }
    this.window?.setMovable(!settings.locked)
    this.window?.setAlwaysOnTop(settings.alwaysOnTop)
    if (settings.visible) this.window?.showInactive()
    else this.window?.hide()
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  setWebDshUrl(webDshUrl: string): DesktopState {
    if (this.config.webDshUrl === webDshUrl) return this.state()
    this.config = { ...this.config, webDshUrl }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  setPixelModel(modelId: string): DesktopState {
    if (this.config.pixelModelId === modelId) return this.state()
    this.config = { ...this.config, pixelModelId: modelId }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  renamePixelModel(name: string): DesktopState {
    if (this.config.pixelModelNames[this.config.pixelModelId] === name) return this.state()
    this.config = {
      ...this.config,
      pixelModelNames: {
        ...this.config.pixelModelNames,
        [this.config.pixelModelId]: name,
      },
    }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  moveTo(target: MoveTarget): DesktopState {
    if (this.config.locked) return this.state()
    const window = this.requiredWindow()
    const bounds = window.getBounds()
    const position = clampWindowPosition(target, bounds, this.workAreas())
    window.setPosition(position.x, position.y)
    this.emitState()
    return this.state()
  }

  beginDrag(): DesktopState {
    if (this.config.locked) {
      this.cancelDrag()
      return this.state()
    }
    this.cancelDrag()
    const window = this.requiredWindow()
    this.dragSession = createDragSession(screen.getCursorScreenPoint(), window.getBounds())
    this.dragTimer = setInterval(() => this.updateDrag(), DRAG_POLL_MS)
    this.dragTimer.unref?.()
    return this.state()
  }

  private updateDrag(): void {
    const session = this.dragSession
    if (session === undefined || this.config.locked) return
    const window = this.requiredWindow()
    const cursor = screen.getCursorScreenPoint()
    if (!cursorChanged(session.lastCursor, cursor)) return
    session.lastCursor = { ...cursor }
    const update = dragTargetAt(session, cursor)
    if (!update.moved) return
    session.moved = true
    const bounds = window.getBounds()
    const position = clampWindowPosition(update.target, bounds, this.workAreas())
    if (position.x !== bounds.x || position.y !== bounds.y) {
      window.setPosition(position.x, position.y)
    }
  }

  endDrag(): DragResult {
    this.updateDrag()
    const moved = this.dragSession?.moved === true
    this.cancelDrag()
    if (moved) this.schedulePositionSave()
    this.emitState()
    return { state: this.state(), moved }
  }

  sendPetState(state: PetBridgeState): void {
    const webContents = this.window?.webContents
    if (webContents !== undefined && !webContents.isDestroyed()) {
      webContents.send(DESKTOP_CHANNELS.petStateChanged, state)
    }
  }

  show(): void {
    const window = this.requiredWindow()
    const changed = !this.config.visible
    this.config = { ...this.config, visible: true }
    window.showInactive()
    this.ensureVisible()
    if (changed) {
      this.persistConfig()
      this.onCompanionSettingsChange({ visible: true })
    }
  }

  hide(): void {
    this.cancelDrag()
    const changed = this.config.visible
    this.config = { ...this.config, visible: false }
    this.window?.hide()
    if (changed) {
      this.persistConfig()
      this.onCompanionSettingsChange({ visible: false })
    }
  }

  toggleVisibility(): void {
    if (this.window?.isVisible() === true) this.hide()
    else this.show()
  }

  setQuitting(): void {
    this.quitting = true
  }

  destroy(): void {
    screen.off('display-removed', this.ensureVisible)
    screen.off('display-metrics-changed', this.ensureVisible)
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.cancelDrag()
    this.listeners.clear()
  }

  private requiredWindow(): BrowserWindow {
    if (this.window === undefined) throw new Error('desktop pet window is not ready')
    return this.window
  }

  private cancelDrag(): void {
    if (this.dragTimer !== undefined) clearInterval(this.dragTimer)
    this.dragTimer = undefined
    this.dragSession = undefined
  }

  private initialPosition(): MoveTarget {
    const display = screen.getPrimaryDisplay().workArea
    const requested = this.config.position ?? {
      x: display.x + display.width - COLLAPSED_WIDTH - EDGE_MARGIN,
      y: display.y + display.height - WINDOW_HEIGHT - EDGE_MARGIN,
    }
    return clampWindowPosition(requested, { width: COLLAPSED_WIDTH, height: WINDOW_HEIGHT }, this.workAreas())
  }

  private workAreas(): Rectangle[] {
    return screen.getAllDisplays().map(display => display.workArea)
  }

  private readonly ensureVisible = (): void => {
    const window = this.window
    if (window === undefined) return
    const bounds = window.getBounds()
    const position = clampWindowPosition(bounds, bounds, this.workAreas())
    if (position.x !== bounds.x || position.y !== bounds.y) {
      window.setPosition(position.x, position.y)
      this.emitState()
    }
  }

  private schedulePositionSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      const window = this.window
      if (window === undefined) return
      const bounds = window.getBounds()
      const contentBounds = window.getContentBounds()
      const collapsedOuterWidth = COLLAPSED_WIDTH + bounds.width - contentBounds.width
      this.config = {
        ...this.config,
        position: {
          x: bounds.x + bounds.width - collapsedOuterWidth,
          y: bounds.y,
        },
      }
      this.persistConfig()
      this.emitState()
    }, 180)
  }

  private persistConfig(): void {
    void this.configStore.save(this.config).catch(error => {
      console.error('failed to persist desktop pet settings', error)
    })
  }

  private emitState(): void {
    const state = this.state()
    const webContents = this.window?.webContents
    if (webContents !== undefined && !webContents.isDestroyed()) {
      webContents.send(DESKTOP_CHANNELS.stateChanged, state)
    }
    for (const listener of this.listeners) listener(state)
  }
}
