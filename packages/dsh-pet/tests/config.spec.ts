import { describe, expect, it } from 'vitest'

import { Config } from '../src/index.ts'

describe('Cordis plugin Config schema', () => {
  it('materializes every deployment default from the exported schema', () => {
    expect(Config({})).toMatchObject({
      affinity: {
        turnReward: 1,
        petReward: 1,
        petCooldownMs: 10_000,
        feedReward: 5,
        feedCooldownMs: 30_000,
      },
      state: { celebrateMs: 2_400 },
      treats: { turnsPerTreat: 3, timeTreatMs: 1_800_000, maxTreats: 20 },
      enabled: true,
    })
  })

  it('rejects unsafe economic and timing values before apply runs', () => {
    expect(() => Config({ treats: { turnsPerTreat: 0 } })).toThrow()
    expect(() => Config({ affinity: { petCooldownMs: -1 } })).toThrow()
    expect(() => Config({ state: { celebrateMs: 60_001 } })).toThrow()
  })
})
