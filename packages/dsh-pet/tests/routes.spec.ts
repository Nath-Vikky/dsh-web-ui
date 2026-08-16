import { EventEmitter } from 'node:events'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, vi } from 'vitest'
import { makePetRoutes } from '../src/routes.ts'
import type { PetService, PetStateView } from '../src/service.ts'

class TestRequest extends EventEmitter {
  readonly headers: IncomingHttpHeaders = {}
  destroyed = false

  constructor(readonly method: string) {
    super()
  }

  destroy(): this {
    this.destroyed = true
    return this
  }
}

class TestResponse {
  status = 0
  headers: Record<string, string> = {}
  body: Buffer = Buffer.alloc(0)
  private finish!: () => void
  readonly finished = new Promise<void>((resolve) => { this.finish = resolve })

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status
    this.headers = headers
    return this
  }

  write(chunk: string | Buffer): boolean {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.body = Buffer.concat([this.body, next])
    return true
  }

  end(chunk?: string | Buffer): this {
    if (chunk !== undefined) this.write(chunk)
    this.finish()
    return this
  }
}

interface ServiceStub {
  state: ReturnType<typeof vi.fn>
  subscribeState: ReturnType<typeof vi.fn>
  interact: ReturnType<typeof vi.fn>
  setCompanionSettings: ReturnType<typeof vi.fn>
}

const stateView: PetStateView = {
  animation: 'idle',
  phase: 'idle',
  sessionActive: false,
  affinity: {
    points: 0,
    rank: '幼鲸',
    rankEmoji: '*',
    pets: 0,
    feeds: 0,
    turns: 0,
    petCooldown: false,
    feedCooldown: false,
  },
  companion: { enabled: true, visible: true, alwaysOnTop: true, locked: false },
  treats: { stocked: 0, max: 20 },
}

function serviceStub(): ServiceStub {
  return {
    state: vi.fn().mockResolvedValue(stateView),
    subscribeState: vi.fn((listener: (snapshot: PetStateView) => void) => {
      listener(stateView)
      return () => undefined
    }),
    interact: vi.fn().mockResolvedValue({ reaction: '好呀', delta: 1, affinity: stateView.affinity }),
    setCompanionSettings: vi.fn().mockResolvedValue({ ok: true, companion: stateView.companion }),
  }
}

function routeByPath(routes: WebRoute[], path: string): WebRoute {
  const route = routes.find((candidate) => candidate.path === path)
  if (route === undefined) throw new Error(`missing route ${path}`)
  return route
}

async function invoke(route: WebRoute, method: string, body?: unknown): Promise<TestResponse> {
  const req = new TestRequest(method)
  const res = new TestResponse()
  const pending = route.handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
  if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
  req.emit('end')
  await pending
  await res.finished
  return res
}

describe('pet HTTP contract', () => {
  it('keeps the public route inventory stable', () => {
    const service = serviceStub()
    const routes = makePetRoutes({ service: service as unknown as PetService })

    expect(routes.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: 'exact', path: '/api/pet/state' },
      { kind: 'exact', path: '/api/pet/events' },
      { kind: 'exact', path: '/api/pet/interact' },
      { kind: 'exact', path: '/api/pet/companion-settings' },
    ])
  })

  it('streams full snapshots, heartbeats, and releases the listener on close', () => {
    vi.useFakeTimers()
    try {
      const service = serviceStub()
      const unsubscribe = vi.fn()
      service.subscribeState.mockImplementation((listener: (snapshot: PetStateView) => void) => {
        listener(stateView)
        return unsubscribe
      })
      const routes = makePetRoutes({ service: service as unknown as PetService })
      const req = new TestRequest('GET')
      const res = new TestResponse()

      routeByPath(routes, '/api/pet/events').handler(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      )

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
      expect(res.body.toString('utf8')).toContain(`data: ${JSON.stringify(stateView)}\n\n`)
      const beforeHeartbeat = res.body.byteLength
      vi.advanceTimersByTime(15_000)
      expect(res.body.byteLength).toBeGreaterThan(beforeHeartbeat)
      expect(res.body.toString('utf8')).toContain(': heartbeat\n\n')

      req.emit('close')
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retain an SSE subscription when the initial write closes', () => {
    vi.useFakeTimers()
    try {
      const service = serviceStub()
      const unsubscribe = vi.fn()
      service.subscribeState.mockImplementation((listener: (snapshot: PetStateView) => void) => {
        listener(stateView)
        return unsubscribe
      })
      const routes = makePetRoutes({ service: service as unknown as PetService })
      const req = new TestRequest('GET')
      const res = new TestResponse()
      vi.spyOn(res, 'write').mockImplementation(() => { throw new Error('closed') })

      routeByPath(routes, '/api/pet/events').handler(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      )

      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the service state as same-origin JSON', async () => {
    const service = serviceStub()
    const routes = makePetRoutes({ service: service as unknown as PetService })

    const res = await invoke(routeByPath(routes, '/api/pet/state'), 'GET')

    expect(res.status).toBe(200)
    expect(res.headers).toEqual({ 'content-type': 'application/json; charset=utf-8' })
    expect(JSON.parse(res.body.toString('utf8'))).toEqual(stateView)
    expect(service.state).toHaveBeenCalledOnce()
  })

  it('validates interactions and filters desktop companion patches before forwarding', async () => {
    const service = serviceStub()
    const routes = makePetRoutes({ service: service as unknown as PetService })

    const interaction = await invoke(routeByPath(routes, '/api/pet/interact'), 'POST', { kind: 'pet' })
    expect(interaction.status).toBe(200)
    expect(service.interact).toHaveBeenCalledWith('pet')

    const invalid = await invoke(routeByPath(routes, '/api/pet/interact'), 'POST', { kind: 'play' })
    expect(invalid.status).toBe(400)
    expect(JSON.parse(invalid.body.toString('utf8'))).toEqual({ ok: false, error: 'invalid-kind' })

    const config = await invoke(routeByPath(routes, '/api/pet/companion-settings'), 'POST', {
      visible: false,
      alwaysOnTop: true,
      locked: true,
      ignored: true,
    })
    expect(config.status).toBe(200)
    expect(service.setCompanionSettings).toHaveBeenCalledWith({
      visible: false,
      alwaysOnTop: true,
      locked: true,
    })

    const invalidConfig = await invoke(routeByPath(routes, '/api/pet/companion-settings'), 'POST', {
      visible: 'no',
    })
    expect(invalidConfig.status).toBe(400)
  })
})
