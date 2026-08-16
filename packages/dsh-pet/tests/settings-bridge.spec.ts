import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, vi } from 'vitest'
import { makePetSettingsBridgeRoutes } from '../src/settings-bridge.ts'

class BridgeRequest extends EventEmitter {
  readonly method = 'POST'
  readonly headers: Record<string, string>
  readonly socket: { remoteAddress: string }
  private readonly body: Buffer

  constructor(body: unknown, options: { address?: string; host?: string; origin?: string } = {}) {
    super()
    this.body = Buffer.from(JSON.stringify(body))
    this.socket = { remoteAddress: options.address ?? '127.0.0.1' }
    this.headers = {
      host: options.host ?? '127.0.0.1:3080',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    yield this.body
  }
}

class BridgeResponse {
  status = 0
  body = ''
  writeHead(status: number): this {
    this.status = status
    return this
  }
  end(body?: string): this {
    this.body = body ?? ''
    return this
  }
}

function providerStub() {
  let revision = 4
  let user: Record<string, unknown> | undefined = { visible: false }
  let value: Record<string, unknown> = {
    enabled: true,
    visible: false,
    alwaysOnTop: true,
    locked: false,
  }
  const describeSettings = () => [{
    ns: 'pet',
    schema: {},
    value,
    base: { enabled: true, visible: true, alwaysOnTop: true, locked: false },
    user,
    revision,
  }]
  const mutate = vi.fn(async (_namespace: unknown, ops: Array<{ op: string; path: string[]; value?: unknown }>) => {
    user = { ...(user ?? {}) }
    value = { ...value }
    for (const op of ops) {
      const field = op.path[0]
      if (field === undefined) continue
      if (op.op === 'set') {
        user[field] = op.value
        value[field] = op.value
      } else {
        delete user[field]
        value[field] = field === 'visible' ? true : value[field]
      }
    }
    revision += 1
  })
  const settings = {
    writable: true,
    describe: vi.fn(describeSettings),
    mutate,
  } as unknown as SettingsProvider
  return { settings, mutate }
}

function routeBySuffix(routes: WebRoute[], suffix: string): WebRoute {
  const route = routes.find(candidate => candidate.path.endsWith(suffix))
  if (route === undefined) throw new Error(`missing ${suffix} route`)
  return route
}

async function invoke(route: WebRoute, body: unknown, options?: ConstructorParameters<typeof BridgeRequest>[1]) {
  const request = new BridgeRequest(body, options)
  const response = new BridgeResponse()
  await route.handler(request as unknown as IncomingMessage, response as unknown as ServerResponse)
  return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> }
}

describe('standalone pet settings bridge', () => {
  it('describes only the registered pet namespace over loopback', async () => {
    const { settings } = providerStub()
    const routes = makePetSettingsBridgeRoutes(settings)

    expect(routes.map(route => route.path)).toEqual([
      '/api/pet/settings/describe',
      '/api/pet/settings/mutate',
    ])
    const result = await invoke(routeBySuffix(routes, '/describe'), {})
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      value: {
        revision: 4,
        writable: true,
        value: { enabled: true, visible: false, alwaysOnTop: true, locked: false },
      },
    })
  })

  it('rejects non-loopback and cross-origin callers', async () => {
    const { settings } = providerStub()
    const route = routeBySuffix(makePetSettingsBridgeRoutes(settings), '/describe')

    expect((await invoke(route, {}, { address: '192.168.1.20' })).status).toBe(403)
    expect((await invoke(route, {}, { origin: 'http://example.com' })).status).toBe(403)
  })

  it('validates fields and commits a revision-fenced boolean edit', async () => {
    const { settings, mutate } = providerStub()
    const route = routeBySuffix(makePetSettingsBridgeRoutes(settings), '/mutate')

    const invalid = await invoke(route, { ops: [{ op: 'set', path: ['unknown'], value: true }] })
    expect(invalid.status).toBe(400)
    expect(mutate).not.toHaveBeenCalled()

    const result = await invoke(route, {
      expectedRevision: 4,
      ops: [{ op: 'set', path: ['locked'], value: true }],
    })
    expect(result.status).toBe(200)
    expect(mutate).toHaveBeenCalledWith(expect.anything(), [
      { op: 'set', path: ['locked'], value: true },
    ], 4)
    expect(result.body).toMatchObject({ ok: true, value: { revision: 5, value: { locked: true } } })
  })
})
