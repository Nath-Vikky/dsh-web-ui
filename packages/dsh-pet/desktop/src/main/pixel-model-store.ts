import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type { PixelModelSource, PixelModelSummary } from '../shared/desktop-api.ts'
import { readPixelModelPackage, type PixelModelPackage } from './pixel-model-manifest.ts'

export const BUILTIN_PIXEL_MODEL: PixelModelSummary = {
  id: 'builtin:whale',
  displayName: '鲸鱼娘',
  description: 'DSH Pet 内置像素模型',
  source: 'builtin',
  spriteVersionNumber: 1,
}

export function resolvePixelModelSelection(
  selectedModelId: string,
  availableModels: readonly Pick<PixelModelSummary, 'id'>[],
): string {
  return availableModels.some(model => model.id === selectedModelId)
    ? selectedModelId
    : BUILTIN_PIXEL_MODEL.id
}

export interface PixelModelRecord {
  summary: PixelModelSummary
  spritesheetPath: string
}

export class PixelModelStore {
  constructor(
    private readonly localRoot: string,
    private readonly importedRoot: string,
  ) {}

  async records(): Promise<PixelModelRecord[]> {
    const local = await this.readRoot(this.localRoot, 'local')
    const imported = await this.readRoot(this.importedRoot, 'imported')
    return [...local, ...imported]
  }

  async record(modelId: string): Promise<PixelModelRecord | undefined> {
    return (await this.records()).find(record => record.summary.id === modelId)
  }

  async importDirectory(sourceDirectory: string): Promise<PixelModelRecord> {
    const source = await readPixelModelPackage(sourceDirectory)
    await mkdir(this.importedRoot, { recursive: true })
    const id = await this.availableImportedId(source.manifest.id)
    const destination = join(this.importedRoot, id)
    const temporary = join(this.importedRoot, `.${id}.import-${process.pid}-${Date.now()}`)
    const extension = extname(source.spritesheetPath).toLowerCase()
    const spritesheetName = `spritesheet${extension}`
    const manifest = {
      id,
      displayName: source.manifest.displayName,
      description: source.manifest.description,
      spritesheetPath: spritesheetName,
      ...(source.manifest.spriteVersionNumber === 2 ? { spriteVersionNumber: 2 } : {}),
    }
    try {
      await mkdir(temporary)
      await copyFile(source.spritesheetPath, join(temporary, spritesheetName))
      await writeFile(join(temporary, 'pet.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      throw error
    }
    return this.toRecord(await readPixelModelPackage(destination), 'imported')
  }

  private async readRoot(root: string, source: Exclude<PixelModelSource, 'builtin'>): Promise<PixelModelRecord[]> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }
    const records = await Promise.all(entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async entry => {
        try {
          return this.toRecord(await readPixelModelPackage(join(root, entry.name)), source)
        } catch {
          return undefined
        }
      }))
    const unique = new Map<string, PixelModelRecord>()
    for (const record of records) {
      if (record !== undefined && !unique.has(record.summary.id)) unique.set(record.summary.id, record)
    }
    return [...unique.values()].sort((left, right) => left.summary.displayName.localeCompare(right.summary.displayName))
  }

  private toRecord(model: PixelModelPackage, source: Exclude<PixelModelSource, 'builtin'>): PixelModelRecord {
    return {
      summary: {
        id: `${source}:${model.manifest.id}`,
        displayName: model.manifest.displayName,
        description: model.manifest.description,
        source,
        spriteVersionNumber: model.manifest.spriteVersionNumber,
      },
      spritesheetPath: model.spritesheetPath,
    }
  }

  private async availableImportedId(base: string): Promise<string> {
    let existing = new Set<string>()
    try {
      existing = new Set((await readdir(this.importedRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name))
    } catch {
      // The import root is created immediately before this check.
    }
    if (!existing.has(base)) return base
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}-${suffix}`
      if (!existing.has(candidate)) return candidate
    }
    throw new Error(`无法为 ${basename(base)} 分配本地模型 id`)
  }
}
