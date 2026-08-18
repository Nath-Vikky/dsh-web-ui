import type { PetInteraction, PetSnapshot } from '../shared/desktop-api.ts'

export interface DesktopStatusBubble {
  id: string
  text: string
  kind: 'status' | 'whisper' | PetInteraction | 'error'
}

export interface DesktopStatusStack {
  bubbles: DesktopStatusBubble[]
  additionalSessionCount: number
}

/** Mirror the Web pet's single-voice bubble rules inside the fixed desktop window. */
export function desktopStatusStack(
  snapshot: PetSnapshot | null | undefined,
  feedback?: { text: string; kind: PetInteraction | 'error' },
  expanded = false,
): DesktopStatusStack {
  if (feedback !== undefined) {
    return {
      bubbles: [{ id: 'feedback', text: feedback.text, kind: feedback.kind }],
      additionalSessionCount: 0,
    }
  }
  const sessions = snapshot?.sessions ?? []
  if (sessions.length > 0) {
    const visibleSessions = expanded ? sessions : sessions.slice(0, 1)
    return {
      bubbles: visibleSessions.map((session, index) => {
        const whisper = index === 0 ? snapshot?.whisper : undefined
        return {
          id: whisper === undefined ? session.sessionId : `whisper:${whisper}`,
          text: whisper ?? session.bubble,
          kind: whisper === undefined ? 'status' : 'whisper',
        }
      }),
      additionalSessionCount: sessions.length - 1,
    }
  }
  if (snapshot?.whisper !== undefined) {
    return {
      bubbles: [{ id: `whisper:${snapshot.whisper}`, text: snapshot.whisper, kind: 'whisper' }],
      additionalSessionCount: 0,
    }
  }
  if (snapshot?.bubble !== undefined) {
    return {
      bubbles: [{ id: 'status', text: snapshot.bubble, kind: 'status' }],
      additionalSessionCount: 0,
    }
  }
  return { bubbles: [], additionalSessionCount: 0 }
}
