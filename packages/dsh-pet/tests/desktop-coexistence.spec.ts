import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { loadPetPersist } from '../src/persist.ts'
import { PetService, type PetSettingsSection } from '../src/service.ts'

function section(patch: Partial<PetSettingsSection> = {}): PetSettingsSection {
  return {
    visible: true,
    size: 160,
    right: 24,
    bottom: 20,
    enabled: true,
    desktopEnabled: false,
    desktopVisible: true,
    desktopAlwaysOnTop: true,
    desktopLocked: false,
    desktopScale: 1,
    ...patch,
  }
}

describe('web and desktop pet coexistence', () => {
  it('isolates presentation switches while sharing the Host-owned economy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-coexistence-'))
    try {
      const service = new PetService(new Context(), { persistDir: dir })
      service.applySettingsSection(section({ desktopEnabled: true }))
      expect(await service.state()).toMatchObject({
        display: { visible: true },
        companion: { enabled: true, visible: true },
      })

      await service.interact('pet')
      service.applySettingsSection(section({ visible: false, desktopEnabled: true }))
      expect(await service.state()).toMatchObject({
        display: { visible: false },
        companion: { enabled: true, visible: true },
        affinity: { pets: 1 },
      })

      service.applySettingsSection(section({ visible: true, desktopEnabled: false }))
      expect(await service.state()).toMatchObject({
        display: { visible: true },
        companion: { enabled: false },
        affinity: { pets: 1 },
      })
      expect(loadPetPersist(dir)).toMatchObject({
        affinity: { pets: 1 },
        display: { visible: true },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
