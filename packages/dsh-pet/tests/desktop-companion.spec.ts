import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  desktopCompanionEnvironment,
  desktopCompanionTarget,
} from '../src/desktop-companion.ts'

describe('desktop companion launcher', () => {
  it('resolves the desktop runtime from inside the installable plugin package', () => {
    const target = desktopCompanionTarget(new URL('../src/index.ts', import.meta.url).href)
    expect(target?.appRoot).toBe(resolve(import.meta.dirname, '..', 'desktop'))
    expect(target?.entryPath).toBe(resolve(import.meta.dirname, '..', 'desktop', 'out', 'main', 'index.js'))
    expect(target?.executablePath.toLowerCase()).toContain('electron')
  })

  it('passes the native token only through the child environment and clears stale values', () => {
    const token = 's'.repeat(43)
    expect(desktopCompanionEnvironment(4200, 'http://127.0.0.1:3080', token, {
      DSH_PET_ORIGIN: 'http://127.0.0.1:9999',
      DSH_PET_NATIVE_TOKEN: 'stale',
    })).toEqual({
      DSH_PET_PARENT_PID: '4200',
      DSH_PET_ORIGIN: 'http://127.0.0.1:3080',
      DSH_PET_NATIVE_TOKEN: token,
    })
    expect(desktopCompanionEnvironment(4200, undefined, undefined, {
      DSH_PET_ORIGIN: 'http://127.0.0.1:9999',
      DSH_PET_NATIVE_TOKEN: 'stale',
    })).toEqual({ DSH_PET_PARENT_PID: '4200' })
  })
})
