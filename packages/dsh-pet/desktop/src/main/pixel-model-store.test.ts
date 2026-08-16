import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_PIXEL_MODEL, PixelModelStore, resolvePixelModelSelection } from './pixel-model-store.ts'

function losslessWebpHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8L', 12, 'ascii')
  buffer[20] = 0x2f
  buffer.writeUInt32LE((((height - 1) << 14) | (width - 1)) >>> 0, 21)
  return buffer
}

async function writePet(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'pet.json'), JSON.stringify({
    id: 'boba',
    displayName: 'Boba',
    description: 'A test pet.',
    spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  await writeFile(join(directory, 'spritesheet.webp'), losslessWebpHeader(1536, 1872))
}

describe('pixel model store', () => {
  it('keeps an available selection and falls back when the model disappears', () => {
    const models = [BUILTIN_PIXEL_MODEL, { id: 'local:lian' }]
    expect(resolvePixelModelSelection('local:lian', models)).toBe('local:lian')
    expect(resolvePixelModelSelection('local:removed', models)).toBe(BUILTIN_PIXEL_MODEL.id)
  })

  it('imports only a normalized PetDex manifest and spritesheet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pixel-model-'))
    const source = join(root, 'source')
    const imported = join(root, 'imported')
    await writePet(source)
    await writeFile(join(source, 'untrusted.txt'), 'not copied', 'utf8')
    const store = new PixelModelStore(join(root, 'local'), imported)

    const first = await store.importDirectory(source)
    const second = await store.importDirectory(source)

    expect(first.summary.id).toBe('imported:boba')
    expect(second.summary.id).toBe('imported:boba-2')
    expect(JSON.parse(await readFile(join(imported, 'boba', 'pet.json'), 'utf8'))).toEqual({
      id: 'boba',
      displayName: 'Boba',
      description: 'A test pet.',
      spritesheetPath: 'spritesheet.webp',
    })
    await expect(readFile(join(imported, 'boba', 'untrusted.txt'))).rejects.toThrow()
  })
})
