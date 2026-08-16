import type { MoveTarget, PetInteraction } from '../shared/desktop-api.ts'
import { normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

export function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('expected a boolean IPC payload')
  return value
}

export function parseMoveTarget(value: unknown): MoveTarget {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected a move target')
  const target = value as Partial<MoveTarget>
  if (typeof target.x !== 'number' || !Number.isFinite(target.x)
    || typeof target.y !== 'number' || !Number.isFinite(target.y)
    || Math.abs(target.x) > 1_000_000 || Math.abs(target.y) > 1_000_000) {
    throw new TypeError('invalid move target')
  }
  return { x: Math.round(target.x), y: Math.round(target.y) }
}

export function parsePetInteraction(value: unknown): PetInteraction {
  if (value !== 'pet' && value !== 'feed') throw new TypeError('invalid pet interaction')
  return value
}

export function parsePetName(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('invalid pet name')
  const name = value.trim()
  if (name.length < 1 || name.length > 20) throw new TypeError('invalid pet name')
  return name
}

export function parsePixelModelId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:builtin|local|imported):[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) {
    throw new TypeError('invalid pixel model id')
  }
  return value
}

export function parseWebDshUrl(value: unknown): string {
  return normalizeWebDshUrl(value)
}
