import { open, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'

export const PIXEL_FRAME_WIDTH = 192
export const PIXEL_FRAME_HEIGHT = 208
export const PIXEL_FRAME_COLUMNS = 8
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_SPRITESHEET_BYTES = 32 * 1024 * 1024
const PET_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export interface PixelModelManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  spriteVersionNumber: 1 | 2
}

export interface PixelModelPackage {
  directory: string
  manifest: PixelModelManifest
  spritesheetPath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePixelModelManifest(value: unknown): PixelModelManifest {
  if (!isRecord(value) || typeof value.id !== 'string' || !PET_ID_PATTERN.test(value.id)) {
    throw new Error('pet.json 中的 id 无效')
  }
  if (typeof value.displayName !== 'string') throw new Error('pet.json 缺少 displayName')
  const displayName = value.displayName.trim()
  if (displayName.length < 1 || displayName.length > 40) throw new Error('displayName 长度必须为 1 到 40 个字符')
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (description.length > 500) throw new Error('description 不能超过 500 个字符')
  if (typeof value.spritesheetPath !== 'string'
    || value.spritesheetPath !== basename(value.spritesheetPath)
    || !/\.(?:webp|png)$/i.test(value.spritesheetPath)) {
    throw new Error('spritesheetPath 必须指向同目录的 WebP 或 PNG 文件')
  }
  if (value.spriteVersionNumber !== undefined && value.spriteVersionNumber !== 1 && value.spriteVersionNumber !== 2) {
    throw new Error('spriteVersionNumber 仅支持 1 或 2')
  }
  return {
    id: value.id,
    displayName,
    description,
    spritesheetPath: value.spritesheetPath,
    spriteVersionNumber: value.spriteVersionNumber === 2 ? 2 : 1,
  }
}

export function pixelImageDimensions(bytes: Uint8Array): { width: number, height: number } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('精灵图不是有效的 WebP 或 PNG')
  }
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 }
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  throw new Error('不支持该 WebP 编码格式')
}

async function inspectSpritesheet(path: string, version: 1 | 2): Promise<void> {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size < 30 || metadata.size > MAX_SPRITESHEET_BYTES) {
    throw new Error('精灵图大小无效')
  }
  const handle = await open(path, 'r')
  const header = Buffer.alloc(32)
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const dimensions = pixelImageDimensions(header.subarray(0, bytesRead))
    const expectedHeight = PIXEL_FRAME_HEIGHT * (version === 2 ? 11 : 9)
    if (dimensions.width !== PIXEL_FRAME_WIDTH * PIXEL_FRAME_COLUMNS || dimensions.height !== expectedHeight) {
      throw new Error(`精灵图必须为 1536×${expectedHeight}`)
    }
  } finally {
    await handle.close()
  }
}

export async function readPixelModelPackage(path: string): Promise<PixelModelPackage> {
  const directory = await realpath(path)
  const manifestPath = await realpath(join(directory, 'pet.json'))
  const manifestRelation = relative(directory, manifestPath)
  if (manifestRelation.startsWith('..') || isAbsolute(manifestRelation)) throw new Error('pet.json 不能位于模型目录之外')
  const manifestMetadata = await stat(manifestPath)
  if (!manifestMetadata.isFile() || manifestMetadata.size > MAX_MANIFEST_BYTES) throw new Error('pet.json 大小无效')
  const manifest = parsePixelModelManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const spritesheetPath = await realpath(join(directory, manifest.spritesheetPath))
  const spritesheetRelation = relative(directory, spritesheetPath)
  if (spritesheetRelation.startsWith('..') || isAbsolute(spritesheetRelation)) {
    throw new Error('精灵图不能位于模型目录之外')
  }
  const extension = extname(spritesheetPath).toLowerCase()
  if (extension !== '.webp' && extension !== '.png') throw new Error('精灵图格式无效')
  await inspectSpritesheet(spritesheetPath, manifest.spriteVersionNumber)
  return { directory, manifest, spritesheetPath }
}
