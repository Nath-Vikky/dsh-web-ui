import { net, protocol, type Session } from 'electron'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PixelModelSummary } from '../shared/desktop-api.ts'
import { BUILTIN_PIXEL_MODEL, PixelModelStore, type PixelModelRecord } from './pixel-model-store.ts'

export const PIXEL_MODEL_SCHEME = 'dsh-pet-pixel'
const PIXEL_MODEL_HOST = 'model'

function modelUrl(record: PixelModelRecord): string {
  return `${PIXEL_MODEL_SCHEME}://${PIXEL_MODEL_HOST}/${encodeURIComponent(record.summary.id)}/spritesheet${extname(record.spritesheetPath).toLowerCase()}`
}

export class PixelModelCatalog {
  private installed = false

  constructor(private readonly store: PixelModelStore) {}

  async list(): Promise<PixelModelSummary[]> {
    const records = await this.store.records()
    return [BUILTIN_PIXEL_MODEL, ...records.map(record => ({ ...record.summary, spritesheetUrl: modelUrl(record) }))]
  }

  async has(modelId: string): Promise<boolean> {
    if (modelId === BUILTIN_PIXEL_MODEL.id) return true
    return await this.store.record(modelId) !== undefined
  }

  async importDirectory(directory: string): Promise<PixelModelSummary> {
    const record = await this.store.importDirectory(directory)
    return { ...record.summary, spritesheetUrl: modelUrl(record) }
  }

  install(session: Session): void {
    if (this.installed) return
    this.installed = true
    session.protocol.handle(PIXEL_MODEL_SCHEME, request => this.handle(request))
  }

  uninstall(session: Session): void {
    if (!this.installed) return
    this.installed = false
    session.protocol.unhandle(PIXEL_MODEL_SCHEME)
  }

  private async handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.protocol !== `${PIXEL_MODEL_SCHEME}:` || url.hostname !== PIXEL_MODEL_HOST) throw new Error('invalid pixel model URL')
      const parts = url.pathname.replace(/^\/+/, '').split('/')
      if (parts.length !== 2 || !/^spritesheet\.(?:webp|png)$/i.test(parts[1] ?? '')) throw new Error('invalid pixel model path')
      const modelId = decodeURIComponent(parts[0] ?? '')
      const record = await this.store.record(modelId)
      if (record === undefined || `spritesheet${extname(record.spritesheetPath).toLowerCase()}` !== parts[1]?.toLowerCase()) {
        throw new Error('unknown pixel model')
      }
      return net.fetch(pathToFileURL(record.spritesheetPath).toString())
    } catch {
      console.warn('local pixel model resource request was rejected')
      return new Response(null, { status: 404 })
    }
  }
}

export function registerPixelModelScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: PIXEL_MODEL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  }])
}
