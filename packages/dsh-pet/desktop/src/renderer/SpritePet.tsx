import { useEffect, useRef } from 'react'

import type { PixelModelSummary } from '../shared/desktop-api.ts'
import spriteUrl from './assets/spritesheet.webp'
import {
  FRAME_COLUMNS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  frameStateAtElapsed,
  SPRITE_SCALE,
  spriteSheetRows,
  TRACKS,
  type SpriteAnimation,
} from './sprite-animation.ts'

interface SpritePetProps {
  animation: SpriteAnimation
  model?: PixelModelSummary
}

export function SpritePet({ animation, model }: SpritePetProps) {
  const spriteRef = useRef<HTMLDivElement>(null)
  const activeSpriteUrl = model?.spritesheetUrl ?? spriteUrl
  const spriteVersion = model?.spriteVersionNumber ?? 1

  useEffect(() => {
    const element = spriteRef.current
    if (element === null) return
    const track = TRACKS[animation]
    const startedAt = performance.now()
    let frameTimer: number | undefined

    const paint = (): void => {
      frameTimer = undefined
      if (document.hidden) return
      const state = frameStateAtElapsed(track, performance.now() - startedAt)
      element.style.backgroundPosition = `${-state.frame * FRAME_WIDTH * SPRITE_SCALE}px ${-track.row * FRAME_HEIGHT * SPRITE_SCALE}px`
      frameTimer = window.setTimeout(paint, state.nextInMs)
    }
    const onVisibilityChange = (): void => {
      if (frameTimer !== undefined) window.clearTimeout(frameTimer)
      frameTimer = undefined
      if (!document.hidden) paint()
    }

    element.style.backgroundImage = `url(${activeSpriteUrl})`
    element.style.backgroundSize = `${FRAME_WIDTH * FRAME_COLUMNS * SPRITE_SCALE}px ${FRAME_HEIGHT * spriteSheetRows(spriteVersion) * SPRITE_SCALE}px`
    element.style.backgroundPosition = `0 ${-track.row * FRAME_HEIGHT * SPRITE_SCALE}px`
    document.addEventListener('visibilitychange', onVisibilityChange)
    paint()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (frameTimer !== undefined) window.clearTimeout(frameTimer)
    }
  }, [animation, activeSpriteUrl, spriteVersion])

  return (
    <div
      ref={spriteRef}
      className="sprite"
      data-model-id={model?.id ?? 'builtin:whale'}
      data-sprite-version={spriteVersion}
      aria-hidden="true"
    />
  )
}
