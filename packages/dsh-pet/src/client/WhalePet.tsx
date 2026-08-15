/**
 * Whale-girl companion component — the browser half's centerpiece. Renders a
 * fixed-position floating sprite (React portal onto document.body), plays
 * the spritesheet track matching the host animation snapshot, and exposes
 * the interaction surface: click to pet, hover panel with feed/hide, drag to
 * reposition (persisted via setConfig).
 * @module @linxin666/dsh-pet/client/WhalePet
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStateView } from '../service.ts'
import type { PetFeedback } from './pet-store.ts'
import { FRAME_HEIGHT } from './spritesheet.ts'
import { SpritePetRenderer } from './renderers/sprite/SpritePetRenderer.ts'
import { NS } from './locales.ts'
import styles from './pet.module.css'

export { PET_SPRITESHEET_URL, PET_MANIFEST_URL } from './renderers/sprite/SpritePetRenderer.ts'

/** Props injected by the slot registration (store actions + locale). */
export interface WhalePetProps {
  /** Latest host snapshot; null while loading. */
  snapshot: PetStateView | null
  /** Display configuration (persisted by the host). */
  display: PetDisplayConfig
  /** Active reaction bubble, if any. */
  feedback: PetFeedback | null
  /** Pet the whale girl (click). */
  onPet: () => void
  /** Feed the whale girl (panel button). */
  onFeed: () => void
  /** Hide the whale girl (panel button). */
  onHide: () => void
  /** Persist a drag position. */
  onDragEnd: (right: number, bottom: number) => void
  /** Rename the pet (persisted by the host). */
  onRename: (name: string) => void
  /** Clear the reaction bubble (after its CSS animation). */
  onFeedbackDone: () => void
  /** Locale translate seat (namespace-bound). */
  t: TranslateNS<typeof NS>
}

/** Clamp a drag offset inside the viewport with a margin. */
function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

/**
 * The floating pet. React owns the interaction surface while the selected
 * renderer owns model loading, animation timing, painting, and teardown.
 */
export function WhalePet(props: WhalePetProps): ReactPortal {
  const { snapshot, display, feedback } = props
  const spriteRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<SpritePetRenderer | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number } | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const spriteScale = display.size / FRAME_HEIGHT
  const animation = snapshot?.animation ?? 'idle'

  // The current sprite renderer is the default/fallback implementation. It
  // owns its browser resources behind the same boundary a future Live2D
  // renderer will implement, so swapping engines cannot disturb interactions.
  useEffect(() => {
    const container = spriteRef.current
    if (container === null) return
    const renderer = new SpritePetRenderer()
    rendererRef.current = renderer
    renderer.setRenderScale(spriteScale)
    renderer.setFpsLimit(animation === 'idle' ? 15 : 30)
    renderer.applyAnimation(animation)
    renderer.setPaused(document.visibilityState !== 'visible')
    const onVisibility = (): void => {
      renderer.setPaused(document.visibilityState !== 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    void renderer.mount(container).catch(() => {
      // The interaction surface remains mounted if the built-in asset cannot load.
    })
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      renderer.destroy()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    renderer?.setFpsLimit(animation === 'idle' ? 15 : 30)
    renderer?.applyAnimation(animation)
  }, [animation])

  useEffect(() => {
    rendererRef.current?.setRenderScale(spriteScale)
  }, [spriteScale])

  // Auto-clear the feedback bubble after its CSS animation. The callback
  // rides a ref so incoming host snapshots never reset the timer: depending
  // on the callback prop would otherwise starve the timeout.
  const feedbackDoneRef = useRef(props.onFeedbackDone)
  feedbackDoneRef.current = props.onFeedbackDone
  useEffect(() => {
    if (feedback === null) return
    const timer = window.setTimeout(() => feedbackDoneRef.current(), 2600)
    return () => window.clearTimeout(timer)
  }, [feedback])

  // Dragging: pointer events on the sprite; position is right/bottom based.
  // `draggedRef` records whether the pointer actually moved, so the browser's
  // trailing click (fired after pointerup) does not pet the whale.
  const draggedRef = useRef(false)
  const clearHideTimer = (): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const current = dragPos ?? { right: display.right, bottom: display.bottom }
    dragRef.current = { startX: e.clientX, startY: e.clientY, ...current }
    draggedRef.current = false
    setHovered(false)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true
    const right = clampOffset(drag.right - dx, window.innerWidth - 40)
    const bottom = clampOffset(drag.bottom - dy, window.innerHeight - 40)
    setDragPos({ right, bottom })
  }
  const onPointerUp = (): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    if (dragPos !== null) props.onDragEnd(dragPos.right, dragPos.bottom)
  }

  const pos = dragPos ?? { right: display.right, bottom: display.bottom }
  const statusBubble = feedback === null && !hovered ? snapshot?.bubble : undefined

  const float = (
    <div
      ref={floatRef}
      className={styles.float}
      style={{ right: pos.right, bottom: pos.bottom, zIndex: 2147483000 }}
      onPointerEnter={() => {
        clearHideTimer()
        setHovered(true)
      }}
      onPointerLeave={(e) => {
        // The panel and bubble render OUTSIDE the container's box (absolute,
        // above the sprite), so moving onto them fires pointerleave on the
        // container. Treat a target still inside the container's DOM (the
        // overflowed panel) as "still hovering"; otherwise give the pointer a
        // short grace period to reach the panel across the gap above it. The
        // bridge (`.panel::after`) keeps the pointer inside the hit area, and
        // the grace period covers a slow mouse crossing the remaining sliver.
        const next = e.relatedTarget
        if (next instanceof Node && floatRef.current?.contains(next)) return
        clearHideTimer()
        hideTimerRef.current = window.setTimeout(() => setHovered(false), 300)
      }}
    >
      <div
        ref={spriteRef}
        className={styles.sprite}
        style={{
          cursor: dragRef.current === null ? 'grab' : 'grabbing',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => {
          // A pointer sequence that moved (dragged) still fires a trailing
          // click; skip the pet when that happened.
          if (draggedRef.current) return
          props.onPet()
        }}
        role="button"
        aria-label="whale girl"
      />
      {feedback !== null && (
        <div key={feedback.at} className={`${styles.bubble} ${feedback.kind === 'feed' ? styles.bubbleFeed : styles.bubblePet}`}>
          {feedback.text}
        </div>
      )}
      {statusBubble !== undefined && (
        <div className={`${styles.bubble} ${styles.bubbleStatus}`} role="status" aria-live="polite">
          {statusBubble}
        </div>
      )}
      {hovered && dragRef.current === null && (
        <div
          className={styles.panel}
          onPointerEnter={() => {
            // Reaching the panel (or its bridge) must cancel any hide timer
            // the container's pointerleave may have armed while the pointer
            // crossed the sliver between the sprite and the panel.
            clearHideTimer()
          }}
        >
          {renaming ? (
            <div className={styles.renameRow}>
              <input
                className={styles.nameInput}
                value={nameDraft}
                maxLength={20}
                placeholder={props.t('pet.namePlaceholder')}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  // While an IME composition is active (e.g. selecting a
                  // Chinese candidate), Enter/Escape keydowns belong to the
                  // input method: ignore them so candidate selection can
                  // neither submit the draft nor close the rename box.
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') {
                    const trimmed = nameDraft.trim()
                    if (trimmed !== '') {
                      props.onRename(trimmed)
                      setRenaming(false)
                    }
                  } else if (e.key === 'Escape') {
                    setRenaming(false)
                  }
                }}
              />
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  const trimmed = nameDraft.trim()
                  if (trimmed !== '') {
                    props.onRename(trimmed)
                    setRenaming(false)
                  }
                }}
              >
                {props.t('pet.confirm')}
              </button>
            </div>
          ) : (
            <>
              <div className={styles.rankRow}>
                <span className={styles.nameCell}>{snapshot?.name ?? '鲸鱼娘'}</span>
                <span>{props.t('pet.rank', { rank: snapshot?.affinity.rank ?? '?' })}</span>
              </div>
              <div className={styles.rankRow}>
                <span>{props.t('pet.treats', { n: snapshot?.treats.stocked ?? 0 })}</span>
                <span>{props.t('pet.points', { points: snapshot?.affinity.points ?? 0 })}</span>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.action} onClick={props.onFeed}>
                  {props.t('pet.feed')}
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    setNameDraft(snapshot?.name ?? '')
                    setRenaming(true)
                  }}
                >
                  {props.t('pet.rename')}
                </button>
                <button type="button" className={styles.action} onClick={props.onHide}>
                  {props.t('pet.hide')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  return createPortal(float, document.body)
}
