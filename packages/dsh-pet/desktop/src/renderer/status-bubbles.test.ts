import { describe, expect, it } from 'vitest'

import type { PetSnapshot } from '../shared/desktop-api.ts'
import { desktopStatusBubbles } from './status-bubbles.ts'

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
    expect(desktopStatusBubbles(snapshot)).toEqual([
      { id: 'status', text: '正在思考', kind: 'status' },
    ])
  })

  it('shows recent session statuses and summarizes overflow', () => {
    const sessions = Array.from({ length: 5 }, (_, index) => ({
      sessionId: `session-${String(index)}`,
      animation: 'running' as const,
      bubble: `任务 ${String(index)}`,
      phase: 'tool',
    }))
    expect(desktopStatusBubbles({ ...snapshot, sessions })).toEqual([
      { id: 'session-0', text: '任务 0', kind: 'status' },
      { id: 'session-1', text: '任务 1', kind: 'status' },
      { id: 'session-2', text: '任务 2', kind: 'status' },
      { id: 'more', text: '另有 2 个会话进行中', kind: 'status' },
    ])
  })

  it('shows the pet whisper after the active session statuses', () => {
    expect(desktopStatusBubbles({
      ...snapshot,
      sessions: [
        { sessionId: 'session-1', animation: 'running', bubble: '正在调用工具', phase: 'tool' },
      ],
      whisper: '测试全绿，悄悄开心一下',
    })).toEqual([
      { id: 'session-1', text: '正在调用工具', kind: 'status' },
      {
        id: 'whisper:测试全绿，悄悄开心一下',
        text: '测试全绿，悄悄开心一下',
        kind: 'whisper',
      },
    ])
  })

  it('keeps the compatibility status beside a whisper on older session views', () => {
    expect(desktopStatusBubbles({ ...snapshot, whisper: '再想一小会儿' })).toEqual([
      { id: 'status', text: '正在思考', kind: 'status' },
      { id: 'whisper:再想一小会儿', text: '再想一小会儿', kind: 'whisper' },
    ])
  })

  it('temporarily gives interaction feedback priority', () => {
    expect(desktopStatusBubbles(
      { ...snapshot, whisper: '这句暂时让摸摸反馈盖住' },
      { text: '摸摸成功', kind: 'pet' },
    )).toEqual([
      { id: 'feedback', text: '摸摸成功', kind: 'pet' },
    ])
  })
})
