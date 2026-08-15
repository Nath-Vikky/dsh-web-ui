import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
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

  end(chunk?: string | Buffer): this {
    if (chunk !== undefined) this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.finish()
    return this
  }
}

interface ServiceStub {
  state: ReturnType<typeof vi.fn>
  interact: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
  setConfig: ReturnType<typeof vi.fn>
  setName: ReturnType<typeof vi.fn>
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
  display: { visible: true, size: 160, right: 24, bottom: 20 },
  name: '鲸鱼娘',
  treats: { stocked: 0, max: 20 },
}

function serviceStub(): ServiceStub {
  return {
    state: vi.fn().mockResolvedValue(stateView),
    interact: vi.fn().mockResolvedValue({ reaction: '好呀', delta: 1, affinity: stateView.affinity }),
    setVisible: vi.fn().mockResolvedValue({ ok: true, display: stateView.display }),
    setConfig: vi.fn().mockResolvedValue({ ok: true, display: stateView.display }),
    setName: vi.fn().mockResolvedValue({ ok: true, name: stateView.name }),
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
    const routes = makePetRoutes({
      service: service as unknown as PetService,
      packageRoot: fileURLToPath(new URL('../', import.meta.url)),
    })

    expect(routes.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: 'exact', path: '/api/pet/state' },
      { kind: 'exact', path: '/api/pet/interact' },
      { kind: 'exact', path: '/api/pet/set-visible' },
      { kind: 'exact', path: '/api/pet/set-config' },
      { kind: 'exact', path: '/api/pet/set-name' },
      { kind: 'exact', path: '/pet/whale/spritesheet.webp' },
      { kind: 'exact', path: '/pet/whale/pet.json' },
    ])
  })

  it('returns the service state as same-origin JSON', async () => {
    const service = serviceStub()
    const routes = makePetRoutes({
      service: service as unknown as PetService,
      packageRoot: fileURLToPath(new URL('../', import.meta.url)),
    })

    const res = await invoke(routeByPath(routes, '/api/pet/state'), 'GET')

    expect(res.status).toBe(200)
    expect(res.headers).toEqual({ 'content-type': 'application/json; charset=utf-8' })
    expect(JSON.parse(res.body.toString('utf8'))).toEqual(stateView)
    expect(service.state).toHaveBeenCalledOnce()
  })

  it('validates interactions and filters display patches before forwarding', async () => {
    const service = serviceStub()
    const routes = makePetRoutes({
      service: service as unknown as PetService,
      packageRoot: fileURLToPath(new URL('../', import.meta.url)),
    })

    const interaction = await invoke(routeByPath(routes, '/api/pet/interact'), 'POST', { kind: 'pet' })
    expect(interaction.status).toBe(200)
    expect(service.interact).toHaveBeenCalledWith('pet')

    const invalid = await invoke(routeByPath(routes, '/api/pet/interact'), 'POST', { kind: 'play' })
    expect(invalid.status).toBe(400)
    expect(JSON.parse(invalid.body.toString('utf8'))).toEqual({ ok: false, error: 'invalid-kind' })

    const config = await invoke(routeByPath(routes, '/api/pet/set-config'), 'POST', {
      size: 180,
      right: 'invalid',
      bottom: 32,
      visible: false,
      ignored: true,
    })
    expect(config.status).toBe(200)
    expect(service.setConfig).toHaveBeenCalledWith({ size: 180, bottom: 32, visible: false })
  })

  it('serves the sprite assets for GET and metadata-only HEAD requests', async () => {
    const service = serviceStub()
    const routes = makePetRoutes({
      service: service as unknown as PetService,
      packageRoot: fileURLToPath(new URL('../', import.meta.url)),
    })
    const route = routeByPath(routes, '/pet/whale/pet.json')

    const get = await invoke(route, 'GET')
    expect(get.status).toBe(200)
    expect(get.headers['content-type']).toBe('application/json')
    expect(get.body.byteLength).toBeGreaterThan(0)

    const head = await invoke(route, 'HEAD')
    expect(head.status).toBe(200)
    expect(head.headers['content-length']).toBe(String(get.body.byteLength))
    expect(head.body.byteLength).toBe(0)
  })
})
