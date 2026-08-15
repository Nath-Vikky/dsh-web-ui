import { describe, expect, it } from 'vitest'
import { mapActivityToIntent } from '../src/core/intent.ts'
import { narrateActivity } from '../src/core/narration.ts'
import type { PetAggregateSnapshot, PetTaskPhase } from '../src/core/protocol.ts'

function snapshot(phase?: PetTaskPhase): PetAggregateSnapshot {
  if (phase === undefined) {
    return {
      protocolVersion: 1,
      sequence: 0,
      emittedAt: 100,
      tasks: [],
      summary: { active: 0, waiting: 0, failed: 0, completedRecently: 0 },
    }
  }
  return {
    protocolVersion: 1,
    sequence: 4,
    emittedAt: 100,
    primaryTaskId: 'task',
    tasks: [{
      taskId: 'task',
      instanceId: 'instance',
      bootId: 'boot',
      sessionId: 'session',
      phase,
      statusLine: phase === 'tool' ? '正在运行测试' : undefined,
      startedAt: 10,
      phaseStartedAt: 90,
      updatedAt: 90,
    }],
    summary: { active: 1, waiting: 0, failed: 0, completedRecently: 0 },
  }
}

describe('pet intent core', () => {
  it('maps activity into renderer-neutral bounded commands', () => {
    expect(mapActivityToIntent(snapshot('tool'))).toEqual({
      id: '4:task:tool',
      createdAt: 100,
      priority: 30,
      ttlMs: 12_000,
      expression: 'focused',
      motion: 'working',
      speech: '正在运行测试',
      sourceTaskIds: ['task'],
      interruptible: true,
    })
    expect(mapActivityToIntent(snapshot('waiting_input'))).toMatchObject({
      expression: 'questioning',
      motion: 'wave',
      priority: 70,
      interruptible: false,
    })
  })

  it('falls back to idle without inventing task progress', () => {
    expect(narrateActivity(snapshot())).toBeUndefined()
    expect(mapActivityToIntent(snapshot())).toMatchObject({
      id: '0:idle:idle',
      expression: 'neutral',
      motion: 'idle',
      sourceTaskIds: [],
    })
  })
})
