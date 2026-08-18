import { describe, expect, it } from 'vitest'

import type { PetSnapshot } from '../shared/desktop-api.ts'
import { desktopStatusStack } from './status-bubbles.ts'

const snapshot: PetSnapshot = {
  animation: 'waiting',
  bubble: '正在思考',
  phase: 'thinking',
  sessionActive: true,
  affinity: {
    points: 0, rank: '初见', pets: 0, feeds: 0, turns: 0,
    petCooldown: false, feedCooldown: false,
  },
  treats: { stocked: 0, max: 20 },
}

describe('desktop status bubbles', () => {
  it('shows the compatibility status while a task is active', () => {
    expect(desktopStatusStack(snapshot)).toEqual({
      bubbles: [{ id: 'status', text: '正在思考', kind: 'status' }],
      additionalSessionCount: 0,
    })
  })

  it('collapses concurrent sessions behind the display session', () => {
    const sessions = Array.from({ length: 3 }, (_, index) => ({
      sessionId: `session-${String(index)}`,
      animation: 'running' as const,
      bubble: `任务 ${String(index)}`,
      phase: 'tool',
    }))
    expect(desktopStatusStack({ ...snapshot, sessions })).toEqual({
      bubbles: [{ id: 'session-0', text: '任务 0', kind: 'status' }],
      additionalSessionCount: 2,
    })

    expect(desktopStatusStack({ ...snapshot, sessions }, undefined, true)).toEqual({
      bubbles: [
        { id: 'session-0', text: '任务 0', kind: 'status' },
        { id: 'session-1', text: '任务 1', kind: 'status' },
        { id: 'session-2', text: '任务 2', kind: 'status' },
      ],
      additionalSessionCount: 2,
    })
  })

  it('lets the pet whisper take over the display session bubble', () => {
    const whispering: PetSnapshot = {
      ...snapshot,
      sessions: [
        { sessionId: 'session-1', animation: 'running', bubble: '正在调用工具', phase: 'tool' },
        { sessionId: 'session-2', animation: 'waiting', bubble: '正在等待回复', phase: 'waiting' },
      ],
      whisper: '测试全绿，悄悄开心一下',
    }
    expect(desktopStatusStack(whispering)).toEqual({
      bubbles: [{
        id: 'whisper:测试全绿，悄悄开心一下',
        text: '测试全绿，悄悄开心一下',
        kind: 'whisper',
      }],
      additionalSessionCount: 1,
    })
    expect(desktopStatusStack(whispering, undefined, true)).toEqual({
      bubbles: [
        {
          id: 'whisper:测试全绿，悄悄开心一下',
          text: '测试全绿，悄悄开心一下',
          kind: 'whisper',
        },
        { id: 'session-2', text: '正在等待回复', kind: 'status' },
      ],
      additionalSessionCount: 1,
    })
  })

  it('lets the whisper replace the compatibility status', () => {
    expect(desktopStatusStack({ ...snapshot, whisper: '再想一小会儿' })).toEqual({
      bubbles: [{ id: 'whisper:再想一小会儿', text: '再想一小会儿', kind: 'whisper' }],
      additionalSessionCount: 0,
    })
  })

  it('temporarily gives interaction feedback priority', () => {
    expect(desktopStatusStack(
      { ...snapshot, whisper: '这句暂时让摸摸反馈盖住' },
      { text: '摸摸成功', kind: 'pet' },
    )).toEqual({
      bubbles: [{ id: 'feedback', text: '摸摸成功', kind: 'pet' }],
      additionalSessionCount: 0,
    })
  })
})
