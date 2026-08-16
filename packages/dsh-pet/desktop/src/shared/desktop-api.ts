export const DESKTOP_CHANNELS = {
  getState: 'pet-desktop:get-state',
  stateChanged: 'pet-desktop:state-changed',
  setDrawerOpen: 'pet-desktop:set-drawer-open',
  setLocked: 'pet-desktop:set-locked',
  setWebDshUrl: 'pet-desktop:set-web-dsh-url',
  beginDrag: 'pet-desktop:begin-drag',
  endDrag: 'pet-desktop:end-drag',
  moveTo: 'pet-desktop:move-to',
  hide: 'pet-desktop:hide',
  openDshWeb: 'pet-desktop:open-dsh-web',
  getPetState: 'pet-desktop:get-pet-state',
  petStateChanged: 'pet-desktop:pet-state-changed',
  getPixelModels: 'pet-desktop:get-pixel-models',
  selectPixelModel: 'pet-desktop:select-pixel-model',
  importPixelModel: 'pet-desktop:import-pixel-model',
  renamePixelModel: 'pet-desktop:rename-pixel-model',
  interact: 'pet-desktop:interact',
} as const

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MoveTarget {
  x: number
  y: number
}

export interface DesktopState {
  bounds: WindowBounds
  drawerOpen: boolean
  locked: boolean
  visible: boolean
  alwaysOnTop: boolean
  webDshUrl: string
  pixelModelId: string
  pixelModelNames: Record<string, string>
}

export interface DesktopWindowSettings {
  visible: boolean
  alwaysOnTop: boolean
  locked: boolean
}

export interface DesktopCompanionSettings extends DesktopWindowSettings {
  enabled: boolean
}

export type PixelModelSource = 'builtin' | 'local' | 'imported'

export interface PixelModelSummary {
  id: string
  displayName: string
  description: string
  source: PixelModelSource
  spriteVersionNumber: 1 | 2
  spritesheetUrl?: string
}

export type PixelModelImportResult =
  | { status: 'cancelled' }
  | { status: 'imported', model: PixelModelSummary }
  | { status: 'error', message: string }

export type PetAnimation =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export type PetInteraction = 'pet' | 'feed'

export type PetExpression =
  | 'neutral'
  | 'curious'
  | 'focused'
  | 'happy'
  | 'worried'
  | 'questioning'

export type PetMotion =
  | 'idle'
  | 'look-around'
  | 'thinking'
  | 'working'
  | 'cheer'
  | 'confused'
  | 'wave'

export interface PetIntent {
  id: string
  createdAt: number
  priority: number
  ttlMs: number
  expression: PetExpression
  motion: PetMotion
  speech?: string
  sourceTaskIds: string[]
  interruptible: boolean
}

export interface PetSnapshot {
  animation: PetAnimation
  bubble?: string
  phase: string
  sessionActive: boolean
  companion?: DesktopCompanionSettings
  intent?: PetIntent
  affinity: {
    points: number
    rank: string
    pets: number
    feeds: number
    turns: number
    petCooldown: boolean
    feedCooldown: boolean
  }
  treats: {
    stocked: number
    max: number
  }
}

export interface PetBridgeState {
  connection: 'connecting' | 'ready' | 'unavailable'
  snapshot: PetSnapshot | null
}

export interface PetInteractionResult {
  reaction: string
  accepted: boolean
}

export interface DragResult {
  state: DesktopState
  moved: boolean
}

export interface DesktopApi {
  getState(): Promise<DesktopState>
  setDrawerOpen(open: boolean): Promise<DesktopState>
  setLocked(locked: boolean): Promise<DesktopState>
  setWebDshUrl(url: string): Promise<DesktopState>
  beginDrag(): Promise<DesktopState>
  endDrag(): Promise<DragResult>
  moveTo(target: MoveTarget): Promise<DesktopState>
  hide(): Promise<void>
  openDshWeb(): Promise<void>
  getPetState(): Promise<PetBridgeState>
  getPixelModels(): Promise<PixelModelSummary[]>
  selectPixelModel(modelId: string): Promise<DesktopState>
  importPixelModel(): Promise<PixelModelImportResult>
  renamePixelModel(name: string): Promise<DesktopState>
  interact(kind: PetInteraction): Promise<PetInteractionResult>
  onStateChanged(listener: (state: DesktopState) => void): () => void
  onPetStateChanged(listener: (state: PetBridgeState) => void): () => void
}
