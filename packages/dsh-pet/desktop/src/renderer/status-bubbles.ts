import type { PetInteraction, PetSnapshot } from '../shared/desktop-api.ts'

export const MAX_DESKTOP_STATUS_BUBBLES = 3

export interface DesktopStatusBubble {
  id: string
  text: string
  kind: 'status' | 'whisper' | PetInteraction | 'error'
}

/** Keep active task copy visible without expanding the draggable pet window. */
export function desktopStatusBubbles(
  snapshot: PetSnapshot | null | undefined,
  feedback?: { text: string; kind: PetInteraction | 'error' },
): DesktopStatusBubble[] {
  if (feedback !== undefined) {
    return [{ id: 'feedback', text: feedback.text, kind: feedback.kind }]
  }
  const visible: DesktopStatusBubble[] = []
  const sessions = snapshot?.sessions ?? []
  if (sessions.length > 0) {
    visible.push(...sessions.slice(0, MAX_DESKTOP_STATUS_BUBBLES).map(session => ({
      id: session.sessionId,
      text: session.bubble,
      kind: 'status' as const,
    })))
    if (sessions.length > MAX_DESKTOP_STATUS_BUBBLES) {
      visible.push({
        id: 'more',
        text: `另有 ${String(sessions.length - MAX_DESKTOP_STATUS_BUBBLES)} 个会话进行中`,
        kind: 'status',
      })
    }
  } else if (snapshot?.bubble !== undefined) {
    visible.push({ id: 'status', text: snapshot.bubble, kind: 'status' })
  }
  if (snapshot?.whisper !== undefined) {
    visible.push({ id: `whisper:${snapshot.whisper}`, text: snapshot.whisper, kind: 'whisper' })
  }
  return visible
}
