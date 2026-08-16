import { describe, expect, it } from 'vitest'

import { legacyWebSettingOps } from '../src/settings-migration.ts'

describe('desktop pet settings migration', () => {
  it('removes only fields owned by the retired browser pet', () => {
    expect(legacyWebSettingOps({
      enabled: true,
      visible: false,
      alwaysOnTop: false,
      locked: true,
      size: 160,
      right: 24,
      bottom: 20,
      name: '鲸鱼娘',
    })).toEqual([
      { op: 'unset', path: ['size'] },
      { op: 'unset', path: ['right'] },
      { op: 'unset', path: ['bottom'] },
      { op: 'unset', path: ['name'] },
    ])
  })

  it('does nothing for a clean or malformed user section', () => {
    expect(legacyWebSettingOps({ visible: true, locked: false })).toEqual([])
    expect(legacyWebSettingOps(null)).toEqual([])
  })
})
