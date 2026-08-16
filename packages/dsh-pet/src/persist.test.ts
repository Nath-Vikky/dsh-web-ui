import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AFFINITY_MAX, emptyAffinity } from './affinity.ts'
import { defaultTreatConfig, emptyTreatLedger } from './treats.ts'
import {
  emptyPersist,
  loadPetPersist,
  savePetPersist,
} from './persist.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-test-'))
}

describe('loadPetPersist', () => {
  it('falls back to defaults when the file is missing', () => {
    const dir = tempDir()
    try {
      expect(loadPetPersist(dir)).toEqual(emptyPersist())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to defaults on corrupt JSON', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), '{ not json', 'utf8')
      expect(loadPetPersist(dir)).toEqual(emptyPersist())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('round-trips a saved persist file', () => {
    const dir = tempDir()
    try {
      const data = {
        affinity: { ...emptyAffinity(), points: 42, pets: 3, feeds: 1, turns: 10 },
        treats: { ...emptyTreatLedger(), treats: 7, lastTreatGrantAt: 1234, turnsAtLastTreatGrant: 9 },
      }
      savePetPersist(data, dir)
      expect(loadPetPersist(dir)).toEqual(data)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clamps economy fields and ignores retired web-display data', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        affinity: { points: 9999, lastPetAt: -5, lastFeedAt: 'x', pets: -1, feeds: 1.5, turns: 0 },
        treats: { treats: 150, lastTreatGrantAt: -1, turnsAtLastTreatGrant: 0 },
        display: { visible: 'yes', size: -10, right: 1e12, bottom: 20 },
      }), 'utf8')
      const loaded = loadPetPersist(dir)
      expect(loaded.affinity.points).toBe(AFFINITY_MAX)
      expect(loaded.affinity.lastPetAt).toBe(0)
      expect(loaded.affinity.lastFeedAt).toBe(0)
      expect(loaded.affinity.pets).toBe(0)
      expect(loaded.affinity.feeds).toBe(1.5) // finite numbers pass through
      expect(loaded.treats.treats).toBe(defaultTreatConfig.maxTreats)
      expect(loaded.treats.lastTreatGrantAt).toBe(0)
      expect(loaded).not.toHaveProperty('display')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
