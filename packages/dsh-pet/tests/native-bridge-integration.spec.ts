import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { PetClient } from '../desktop/src/main/pet-client.ts'
import { createPetNativeToken } from '../src/adapters/web/native-auth.ts'
import { makePetRoutes } from '../src/routes.ts'
import { PetService } from '../src/service.ts'

class TestSettings extends Service {
  readonly writes: Array<{ namespace: string; patch: object }> = []

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  async update(namespace: string, patch: object): Promise<void> {
    this.writes.push({ namespace, patch })
  }
}

describe('standalone native bridge integration', () => {
  const cleanup: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose()
  })

  it('connects the standalone client with the per-boot token over real loopback HTTP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-native-integration-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const ctx = new Context()
    const settings = new TestSettings(ctx)
    const service = new PetService(ctx, { persistDir: dir })
    const nativeToken = createPetNativeToken()
    const routes = makePetRoutes({ service, nativeToken })
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const route = routes.find(candidate => candidate.path === pathname)
      if (route === undefined) {
        response.writeHead(404).end()
        return
      }
      void route.handler(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test server address')
    const client = new PetClient(fetch, `http://127.0.0.1:${String(address.port)}`, nativeToken)

    await expect(client.refresh()).resolves.toMatchObject({
      connection: 'ready',
      snapshot: { animation: 'idle' },
    })
    await expect(client.interact('pet')).resolves.toMatchObject({ accepted: true })
    expect((await service.state()).affinity.pets).toBe(1)
    await expect(client.setCompanionSettings({ locked: true, scale: 1.25 })).resolves.toMatchObject({
      enabled: false,
      locked: true,
      scale: 1.25,
    })
    expect(settings.writes.at(-1)).toEqual({
      namespace: 'pet',
      patch: {
        desktopEnabled: false,
        desktopVisible: true,
        desktopAlwaysOnTop: true,
        desktopLocked: true,
        desktopScale: 1.25,
      },
    })
    expect((await service.state()).display.visible).toBe(true)
  })
})
