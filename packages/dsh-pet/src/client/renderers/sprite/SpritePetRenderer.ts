/** DOM-backed spritesheet renderer and the reliable default pet mode. */

import type { PetIntent, PetMotion } from '../../../core/intent.ts'
import type { PetAnimation } from '../../../state.ts'
import {
  detectFrameCounts,
  framePosition,
  FRAME_COLUMNS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  rowOfTrack,
  TRACKS,
  trimTrack,
  type TrackDef,
} from '../../spritesheet.ts'
import type { ModelSource, PetRenderer } from '../PetRenderer.ts'

/** Browser URL of the built-in whale-girl atlas. */
export const PET_SPRITESHEET_URL = '/pet/whale/spritesheet.webp'

/** Browser URL of its authoritative per-row frame-count manifest. */
export const PET_MANIFEST_URL = '/pet/whale/pet.json'

/** Built-in sprite model; always available as the default and fallback. */
export const DEFAULT_SPRITE_MODEL: ModelSource = {
  kind: 'sprite',
  imageUrl: PET_SPRITESHEET_URL,
  manifestUrl: PET_MANIFEST_URL,
}

const motionAnimation: Record<PetMotion, PetAnimation> = {
  idle: 'idle',
  'look-around': 'waiting',
  thinking: 'running',
  working: 'running-right',
  cheer: 'jumping',
  confused: 'failed',
  wave: 'waving',
}

function validFrameCounts(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === 9
    && value.every(count => Number.isInteger(count) && count >= 0 && count <= FRAME_COLUMNS)
}

/** Owns the atlas image, animation clock, DOM paint, and teardown lifecycle. */
export class SpritePetRenderer implements PetRenderer {
  private container: HTMLElement | undefined
  private image: HTMLImageElement | undefined
  private frameCounts: number[] | undefined
  private animation: PetAnimation = 'idle'
  private frameIndex = 0
  private frameElapsed = 0
  private lastFrameAt = 0
  private lastRenderAt = 0
  private renderScale = 1
  private fpsLimit = 30
  private paused = false
  private reducedMotion = false
  private destroyed = false
  private raf: number | undefined
  private loadGeneration = 0
  private cancelLoad: (() => void) | undefined
  private lastIntentId: string | undefined

  constructor(private model: ModelSource = DEFAULT_SPRITE_MODEL) {}

  async mount(container: HTMLElement): Promise<void> {
    if (this.destroyed) throw new Error('sprite renderer already destroyed')
    this.container = container
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    this.applyLayout()
    this.paint()
    this.startLoop()
    await this.loadModel(this.model)
  }

  async loadModel(source: ModelSource): Promise<void> {
    if (source.kind !== 'sprite') throw new Error('sprite renderer requires a sprite model')
    if (this.destroyed) throw new Error('sprite renderer already destroyed')
    this.cancelLoad?.()
    this.model = source
    this.frameCounts = undefined
    // Paint the atlas URL immediately. Image decode and the optional frame
    // manifest only refine animation metadata; they must not leave the
    // built-in fallback transparent while either request is pending.
    if (this.container !== undefined) {
      this.container.style.backgroundImage = `url(${source.imageUrl})`
    }
    const generation = ++this.loadGeneration
    const image = new Image()
    this.image = image

    let settled = false
    const settle = (done: () => void): void => {
      if (settled) return
      settled = true
      image.onload = null
      image.onerror = null
      done()
    }
    let cancelLoad = (): void => undefined
    try {
      await new Promise<void>((resolve, reject) => {
        cancelLoad = () => { settle(resolve) }
        this.cancelLoad = cancelLoad
        image.onload = () => { settle(resolve) }
        image.onerror = () => {
          settle(() => { reject(new Error(`failed to load sprite model: ${source.imageUrl}`)) })
        }
        image.src = source.imageUrl
      })
    } finally {
      if (this.cancelLoad === cancelLoad) this.cancelLoad = undefined
    }
    if (this.destroyed || generation !== this.loadGeneration) return

    this.frameCounts = await this.resolveFrameCounts(image, source.manifestUrl)
    if (this.destroyed || generation !== this.loadGeneration) return
    this.paint()
    this.startLoop()
  }

  applyIntent(intent: PetIntent): void {
    if (this.lastIntentId === intent.id) return
    this.lastIntentId = intent.id
    this.setAnimation(motionAnimation[intent.motion], true)
  }

  /** Compatibility entry for the existing host animation contract. */
  applyAnimation(animation: PetAnimation): void {
    this.setAnimation(animation, false)
  }

  private setAnimation(animation: PetAnimation, restart: boolean): void {
    if (!restart && this.animation === animation) return
    this.animation = animation
    this.frameIndex = 0
    this.frameElapsed = 0
    this.lastFrameAt = 0
    this.paint()
    this.startLoop()
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    if (paused) this.stopLoop()
    else this.startLoop()
  }

  setFpsLimit(fps: number): void {
    if (!Number.isFinite(fps)) return
    this.fpsLimit = Math.max(1, Math.min(60, Math.round(fps)))
  }

  setRenderScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return
    this.renderScale = scale
    this.applyLayout()
    this.paint()
  }

  resize(width: number, height: number): void {
    if (this.container === undefined) return
    if (Number.isFinite(width) && width > 0) this.container.style.width = `${Math.round(width)}px`
    if (Number.isFinite(height) && height > 0) this.container.style.height = `${Math.round(height)}px`
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.loadGeneration += 1
    this.cancelLoad?.()
    this.cancelLoad = undefined
    this.stopLoop()
    if (this.image !== undefined) {
      this.image.onload = null
      this.image.onerror = null
      this.image = undefined
    }
    if (this.container !== undefined) {
      this.container.style.removeProperty('background-image')
      this.container.style.removeProperty('background-size')
      this.container.style.removeProperty('background-position')
      this.container.style.removeProperty('background-repeat')
      this.container.style.removeProperty('width')
      this.container.style.removeProperty('height')
      this.container = undefined
    }
  }

  private async resolveFrameCounts(image: HTMLImageElement, manifestUrl?: string): Promise<number[]> {
    if (manifestUrl !== undefined) {
      try {
        const response = await fetch(manifestUrl)
        if (response.ok) {
          const manifest = await response.json() as { frames?: unknown }
          if (validFrameCounts(manifest.frames)) return manifest.frames
        }
      } catch {
        // Fall through to local alpha detection for old or unavailable manifests.
      }
    }
    try {
      return detectFrameCounts(image)
    } catch {
      return Array.from({ length: 9 }, () => FRAME_COLUMNS)
    }
  }

  private track(): TrackDef {
    const track = TRACKS[this.animation]
    if (this.frameCounts === undefined) return track
    const row = rowOfTrack(this.animation)
    return trimTrack(track, this.frameCounts[row] ?? track.frames.length)
  }

  private applyLayout(): void {
    if (this.container === undefined) return
    this.container.style.width = `${Math.round(FRAME_WIDTH * this.renderScale)}px`
    this.container.style.height = `${Math.round(FRAME_HEIGHT * this.renderScale)}px`
    this.container.style.backgroundSize = `${FRAME_WIDTH * FRAME_COLUMNS * this.renderScale}px ${FRAME_HEIGHT * 9 * this.renderScale}px`
    this.container.style.backgroundRepeat = 'no-repeat'
  }

  private paint(): void {
    if (this.container === undefined) return
    const track = this.track()
    const safeIndex = Math.min(this.frameIndex, track.frames.length - 1)
    const column = track.frames[safeIndex] ?? 0
    const position = framePosition(rowOfTrack(this.animation), column, this.renderScale)
    this.container.style.backgroundPosition = `${position.x}px ${position.y}px`
  }

  private startLoop(): void {
    if (this.destroyed || this.paused || this.reducedMotion || this.raf !== undefined) return
    if (typeof requestAnimationFrame === 'undefined') return
    this.lastFrameAt = 0
    this.lastRenderAt = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  private stopLoop(): void {
    if (this.raf === undefined) return
    cancelAnimationFrame(this.raf)
    this.raf = undefined
  }

  private readonly tick = (timestamp: number): void => {
    this.raf = undefined
    if (this.destroyed || this.paused || this.reducedMotion) return
    const renderInterval = 1000 / this.fpsLimit
    if (this.lastRenderAt !== 0 && timestamp - this.lastRenderAt < renderInterval) {
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    const delta = this.lastFrameAt === 0 ? 0 : timestamp - this.lastFrameAt
    this.lastFrameAt = timestamp
    this.lastRenderAt = timestamp
    const track = this.track()
    const lastIndex = track.frames.length - 1
    this.frameElapsed += delta
    let duration = track.durations[this.frameIndex] ?? 1
    while (this.frameElapsed >= duration && this.frameIndex < lastIndex) {
      this.frameElapsed -= duration
      this.frameIndex += 1
      duration = track.durations[this.frameIndex] ?? 1
    }
    if (this.frameElapsed >= duration) {
      if (track.loop) {
        this.frameElapsed %= duration
        this.frameIndex = 0
      } else {
        this.frameIndex = lastIndex
        this.frameElapsed = duration
        this.paint()
        return
      }
    }
    this.paint()
    this.raf = requestAnimationFrame(this.tick)
  }
}
