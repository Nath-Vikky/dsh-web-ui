import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import { desktopCompanionTarget } from '../src/desktop-companion.ts'

describe('desktop companion launcher', () => {
  it('resolves the desktop runtime from inside the installable plugin package', () => {
    const target = desktopCompanionTarget(new URL('../src/index.ts', import.meta.url).href)
    expect(target?.appRoot).toBe(resolve(import.meta.dirname, '..', 'desktop'))
    expect(target?.entryPath).toBe(resolve(import.meta.dirname, '..', 'desktop', 'out', 'main', 'index.js'))
    expect(target?.executablePath.toLowerCase()).toContain('electron')
  })
})
