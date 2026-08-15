/** Renderer boundary shared by the sprite fallback and future Live2D mode. */

import type { PetIntent } from '../../core/intent.ts'

/** A renderer-loadable model source. */
export type ModelSource =
  | { kind: 'sprite'; imageUrl: string; manifestUrl?: string }
  | { kind: 'live2d'; modelUrl: string }

/** Lifecycle contract that keeps React independent from a rendering engine. */
export interface PetRenderer {
  mount(container: HTMLElement): Promise<void>
  loadModel(source: ModelSource): Promise<void>
  applyIntent(intent: PetIntent): void
  setPaused(paused: boolean): void
  setFpsLimit(fps: number): void
  setRenderScale(scale: number): void
  resize(width: number, height: number): void
  destroy(): void
}
