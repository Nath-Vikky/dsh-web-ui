import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { MoveTarget } from '../shared/desktop-api.ts'
import { DEFAULT_WEB_DSH_URL, normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

export interface DesktopConfig {
  schemaVersion: 5
  visible: boolean
  locked: boolean
  alwaysOnTop: boolean
  webDshUrl: string
  pixelModelId: string
  pixelModelNames: Record<string, string>
  position?: MoveTarget
}

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  schemaVersion: 5,
  visible: true,
  locked: false,
  alwaysOnTop: true,
  webDshUrl: DEFAULT_WEB_DSH_URL,
  pixelModelId: 'builtin:whale',
  pixelModelNames: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
}

export function parseDesktopConfig(value: unknown): DesktopConfig {
  if (!isRecord(value)
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3
      && value.schemaVersion !== 4 && value.schemaVersion !== 5)) {
    return { ...DEFAULT_DESKTOP_CONFIG }
  }
  const position = isRecord(value.position)
    && validCoordinate(value.position.x)
    && validCoordinate(value.position.y)
    ? { x: Math.round(value.position.x), y: Math.round(value.position.y) }
    : undefined

  let webDshUrl = DEFAULT_WEB_DSH_URL
  if (value.schemaVersion === 2 || value.schemaVersion === 3 || value.schemaVersion === 4
    || value.schemaVersion === 5) {
    try {
      webDshUrl = normalizeWebDshUrl(value.webDshUrl)
    } catch {
      // A malformed persisted target falls back to the local default.
    }
  }
  const pixelModelNames: Record<string, string> = {}
  if ((value.schemaVersion === 4 || value.schemaVersion === 5) && isRecord(value.pixelModelNames)) {
    for (const [modelId, rawName] of Object.entries(value.pixelModelNames).slice(0, 128)) {
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      if (/^(?:builtin|local|imported):[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(modelId)
        && name.length >= 1 && name.length <= 20) {
        pixelModelNames[modelId] = name
      }
    }
  }
  return {
    schemaVersion: 5,
    visible: value.schemaVersion === 5 ? value.visible !== false : true,
    locked: value.locked === true,
    alwaysOnTop: value.alwaysOnTop !== false,
    webDshUrl,
    pixelModelId: (value.schemaVersion === 3 || value.schemaVersion === 4 || value.schemaVersion === 5)
      && typeof value.pixelModelId === 'string'
      ? value.pixelModelId
      : DEFAULT_DESKTOP_CONFIG.pixelModelId,
    pixelModelNames,
    ...(position === undefined ? {} : { position }),
  }
}

export class ConfigStore {
  private saveQueue = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<DesktopConfig> {
    try {
      return parseDesktopConfig(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return { ...DEFAULT_DESKTOP_CONFIG }
    }
  }

  save(config: DesktopConfig): Promise<void> {
    const snapshot = parseDesktopConfig(config)
    this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp-${process.pid}`
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.filePath)
    })
    return this.saveQueue
  }
}
