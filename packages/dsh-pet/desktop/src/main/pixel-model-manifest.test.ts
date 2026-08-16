import { describe, expect, it } from 'vitest'

import { parsePixelModelManifest, pixelImageDimensions } from './pixel-model-manifest.ts'

function losslessWebpHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8L', 12, 'ascii')
  buffer[20] = 0x2f
  buffer.writeUInt32LE((((height - 1) << 14) | (width - 1)) >>> 0, 21)
  return buffer
}

describe('PetDex pixel model manifest', () => {
  it('accepts the minimal PetDex package fields', () => {
    expect(parsePixelModelManifest({
      id: 'hachiware',
      displayName: '小八',
      description: 'A small companion.',
      spritesheetPath: 'spritesheet.webp',
    })).toEqual({
      id: 'hachiware',
      displayName: '小八',
      description: 'A small companion.',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 1,
    })
  })

  it('rejects paths escaping the package root', () => {
    expect(() => parsePixelModelManifest({
      id: 'unsafe',
      displayName: 'Unsafe',
      spritesheetPath: '../outside.webp',
    })).toThrow('spritesheetPath')
  })

  it('reads PetDex v1 and v2 lossless WebP dimensions', () => {
    expect(pixelImageDimensions(losslessWebpHeader(1536, 1872))).toEqual({ width: 1536, height: 1872 })
    expect(pixelImageDimensions(losslessWebpHeader(1536, 2288))).toEqual({ width: 1536, height: 2288 })
  })
})
