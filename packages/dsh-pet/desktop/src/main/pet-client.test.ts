import { describe, expect, it, vi } from 'vitest'

import { parseInteractionResult, parsePetSnapshot, PetClient, PetEventDecoder } from './pet-client.ts'

const snapshot = {
  animation: 'waiting',
  bubble: '等待回复',
  phase: 'waiting',
  sessionActive: true,
  companion: { enabled: true, visible: true, alwaysOnTop: true, locked: false },
  affinity: {
    points: 12,
    rank: '幼鲸',
    pets: 2,
    feeds: 1,
    turns: 9,
    petCooldown: false,
    feedCooldown: true,
  },
  treats: { stocked: 3, max: 20 },
}

const intent = {
  id: '2:task:tool',
  createdAt: 100,
  priority: 30,
  ttlMs: 12_000,
  expression: 'focused',
  motion: 'working',
  speech: '正在运行测试',
  sourceTaskIds: ['task'],
  interruptible: true,
}

describe('desktop pet client', () => {
  it('accepts only the state fields used by the desktop surface', () => {
    expect(parsePetSnapshot(snapshot)).toMatchObject({ animation: 'waiting' })
    expect(parsePetSnapshot({ ...snapshot, intent })).toMatchObject({
      intent: { id: '2:task:tool', motion: 'working' },
    })
    expect(() => parsePetSnapshot({ ...snapshot, animation: 'unknown' })).toThrow('invalid pet snapshot')
    expect(() => parsePetSnapshot({ ...snapshot, intent: { ...intent, motion: 'teleport' } }))
      .toThrow('invalid pet intent')
    expect(() => parsePetSnapshot({ ...snapshot, affinity: { points: Number.NaN } })).toThrow('invalid pet snapshot')
  })

  it('decodes fragmented SSE data records and ignores heartbeats', () => {
    const decoder = new PetEventDecoder()
    expect(decoder.push('data: {"animation":')).toEqual([])
    expect(decoder.push('"idle"}\r\n\r\n: heartbeat\n\n')).toEqual(['{"animation":"idle"}'])
    expect(decoder.push('data: first\ndata: second\n\n')).toEqual(['first\nsecond'])
  })

  it('validates interaction results', () => {
    expect(parseInteractionResult({ reaction: '好呀', delta: 1 }))
      .toEqual({ reaction: '好呀', accepted: true })
    expect(parseInteractionResult({ reaction: '冷却中', delta: 0 }))
      .toEqual({ reaction: '冷却中', accepted: false })
    expect(() => parseInteractionResult({ reaction: 1 })).toThrow('invalid pet interaction result')
  })

  it('uses the fixed loopback API and refreshes after an interaction', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/interact')) {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe('{"kind":"pet"}')
        return new Response(JSON.stringify({ reaction: '摸摸成功', delta: 1, affinity: snapshot.affinity }))
      }
      return new Response(JSON.stringify(snapshot))
    })
    const client = new PetClient(fetchImpl)

    await client.refresh()
    expect(client.state()).toMatchObject({ connection: 'ready', snapshot: { animation: 'waiting' } })
    await expect(client.interact('pet')).resolves.toEqual({ reaction: '摸摸成功', accepted: true })
    expect(fetchImpl.mock.calls.every(([url]) => String(url).startsWith('http://127.0.0.1:3080/api/pet/'))).toBe(true)
  })

  it('writes desktop window changes back to the Host settings bridge', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"locked":true}')
      return new Response(JSON.stringify({
        ok: true,
        companion: { enabled: true, visible: true, alwaysOnTop: true, locked: true },
      }))
    })
    const client = new PetClient(fetchImpl)

    await client.setCompanionSettings({ locked: true })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/api/pet/companion-settings',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the last valid snapshot when Harness is temporarily unavailable', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
      .mockRejectedValueOnce(new Error('offline'))
    const client = new PetClient(fetchImpl)

    await client.refresh()
    await client.refresh()
    expect(client.state()).toMatchObject({ connection: 'unavailable', snapshot: { animation: 'waiting' } })
  })

  it('switches future REST requests to a newly configured local origin', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(snapshot)))
    const client = new PetClient(fetchImpl)
    client.setOrigin('http://localhost:4080/')

    await client.refresh()
    expect(client.originUrl()).toBe('http://localhost:4080')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4080/api/pet/state',
      expect.any(Object),
    )
  })

  it('uses the Web DSH event stream as the primary state source', async () => {
    const streamed = { ...snapshot, intent }
    const encoder = new TextEncoder()
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/events')) {
        await new Promise(resolve => setTimeout(resolve, 10))
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(streamed)}\n\n`))
          },
        }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
      }
      return new Response(JSON.stringify(snapshot))
    })
    const client = new PetClient(fetchImpl)

    client.start()
    await vi.waitFor(() => expect(client.state()).toMatchObject({
      connection: 'ready',
      snapshot: { intent: { motion: 'working' } },
    }))
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/api/pet/events',
      expect.objectContaining({ headers: { accept: 'text/event-stream' } }),
    )
    client.stop()
  })
})
