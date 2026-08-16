/** Renderer-neutral pet intent mapped from an aggregate activity snapshot. */

import { narrateActivity } from './narration.ts'
import type { PetAggregateSnapshot, PetTaskPhase } from './protocol.ts'

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

/** A bounded command understood by sprite, Live2D, or another renderer. */
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

interface PhaseIntent {
  expression: PetExpression
  motion: PetMotion
  priority: number
  interruptible: boolean
}

function forPhase(phase: PetTaskPhase): PhaseIntent {
  switch (phase) {
    case 'waiting_input':
      return { expression: 'questioning', motion: 'wave', priority: 70, interruptible: false }
    case 'failed':
      return { expression: 'worried', motion: 'confused', priority: 60, interruptible: false }
    case 'done':
      return { expression: 'happy', motion: 'cheer', priority: 50, interruptible: false }
    case 'tool':
      return { expression: 'focused', motion: 'working', priority: 30, interruptible: true }
    case 'thinking':
      return { expression: 'focused', motion: 'thinking', priority: 20, interruptible: true }
    case 'review':
      return { expression: 'neutral', motion: 'working', priority: 20, interruptible: true }
    case 'waiting':
      return { expression: 'curious', motion: 'look-around', priority: 10, interruptible: true }
    case 'idle':
      return { expression: 'neutral', motion: 'idle', priority: 0, interruptible: true }
  }
}

/** Map only the selected primary task; renderers never consume session events. */
export function mapActivityToIntent(snapshot: PetAggregateSnapshot): PetIntent {
  const primary = snapshot.tasks.find(task => task.taskId === snapshot.primaryTaskId)
  const phase = primary?.phase ?? 'idle'
  const mapped = forPhase(phase)
  const speech = narrateActivity(snapshot)
  return {
    id: `${snapshot.sequence}:${primary?.taskId ?? 'idle'}:${phase}`,
    createdAt: snapshot.emittedAt,
    priority: mapped.priority,
    ttlMs: phase === 'done' || phase === 'failed' ? 8_000 : 12_000,
    expression: mapped.expression,
    motion: mapped.motion,
    ...(speech === undefined ? {} : { speech }),
    sourceTaskIds: primary === undefined ? [] : [primary.taskId],
    interruptible: mapped.interruptible,
  }
}
