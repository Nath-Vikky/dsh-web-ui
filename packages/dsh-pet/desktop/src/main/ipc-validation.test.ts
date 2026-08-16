import { describe, expect, it } from 'vitest'

import {
  parseMoveTarget,
  parsePetInteraction,
  parsePixelModelId,
  parsePetName,
  parseWebDshUrl,
  requireBoolean,
} from './ipc-validation.ts'

describe('desktop IPC validation', () => {
  it('normalizes finite move targets', () => {
    expect(parseMoveTarget({ x: 42.8, y: -7.2 })).toEqual({ x: 43, y: -7 })
  })

  it('rejects untrusted move payloads', () => {
    expect(() => parseMoveTarget({ x: Number.NaN, y: 2 })).toThrow('invalid move target')
    expect(() => parseMoveTarget({ x: 2, y: 2_000_000 })).toThrow('invalid move target')
  })

  it('does not coerce boolean payloads', () => {
    expect(requireBoolean(false)).toBe(false)
    expect(() => requireBoolean('false')).toThrow('expected a boolean IPC payload')
  })

  it('accepts only known pet interactions', () => {
    expect(parsePetInteraction('pet')).toBe('pet')
    expect(parsePetInteraction('feed')).toBe('feed')
    expect(() => parsePetInteraction('delete')).toThrow('invalid pet interaction')
  })

  it('trims and bounds pet names', () => {
    expect(parsePetName('  小鲸  ')).toBe('小鲸')
    expect(() => parsePetName('   ')).toThrow('invalid pet name')
    expect(() => parsePetName('a'.repeat(21))).toThrow('invalid pet name')
  })

  it('accepts only scoped pixel model ids', () => {
    expect(parsePixelModelId('local:lian')).toBe('local:lian')
    expect(parsePixelModelId('imported:boba-2')).toBe('imported:boba-2')
    expect(() => parsePixelModelId('../model')).toThrow('invalid pixel model id')
  })

  it('accepts only local Web DSH origins', () => {
    expect(parseWebDshUrl('http://localhost:3080/')).toBe('http://localhost:3080')
    expect(() => parseWebDshUrl('https://example.com')).toThrow('invalid Web DSH URL')
  })
})
