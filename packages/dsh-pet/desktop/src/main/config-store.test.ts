import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConfigStore, DEFAULT_DESKTOP_CONFIG, parseDesktopConfig } from './config-store.ts'

describe('desktop config parser', () => {
  it('accepts a valid versioned snapshot', () => {
    expect(parseDesktopConfig({
      schemaVersion: 5,
      visible: false,
      locked: true,
      alwaysOnTop: false,
      webDshUrl: 'http://localhost:4080/',
      pixelModelId: 'local:lian',
      pixelModelNames: { 'local:lian': '小狮子' },
      position: { x: -420.4, y: 81.6 },
    })).toEqual({
      schemaVersion: 5,
      visible: false,
      locked: true,
      alwaysOnTop: false,
      webDshUrl: 'http://localhost:4080',
      pixelModelId: 'local:lian',
      pixelModelNames: { 'local:lian': '小狮子' },
      position: { x: -420, y: 82 },
    })
  })

  it('migrates version 1 snapshots to the default Web DSH origin', () => {
    expect(parseDesktopConfig({
      schemaVersion: 1,
      locked: true,
      alwaysOnTop: true,
    })).toEqual({ ...DEFAULT_DESKTOP_CONFIG, locked: true })
  })

  it('migrates version 2 snapshots to the built-in pixel model', () => {
    expect(parseDesktopConfig({
      schemaVersion: 2,
      locked: false,
      alwaysOnTop: true,
      webDshUrl: 'http://localhost:3080',
    })).toEqual({ ...DEFAULT_DESKTOP_CONFIG, webDshUrl: 'http://localhost:3080' })
  })

  it('migrates version 3 model selection without inventing custom names', () => {
    expect(parseDesktopConfig({
      schemaVersion: 3,
      locked: false,
      alwaysOnTop: true,
      webDshUrl: 'http://localhost:3080',
      pixelModelId: 'local:lian',
    })).toEqual({
      ...DEFAULT_DESKTOP_CONFIG,
      webDshUrl: 'http://localhost:3080',
      pixelModelId: 'local:lian',
    })
  })

  it('migrates version 4 snapshots with a visible desktop window', () => {
    expect(parseDesktopConfig({
      schemaVersion: 4,
      locked: true,
      alwaysOnTop: false,
      webDshUrl: 'http://localhost:3080',
      pixelModelId: 'local:lian',
      pixelModelNames: { 'local:lian': '小狮子' },
    })).toEqual({
      ...DEFAULT_DESKTOP_CONFIG,
      locked: true,
      alwaysOnTop: false,
      webDshUrl: 'http://localhost:3080',
      pixelModelId: 'local:lian',
      pixelModelNames: { 'local:lian': '小狮子' },
    })
  })

  it('drops malformed fields instead of trusting persisted JSON', () => {
    expect(parseDesktopConfig({
      schemaVersion: 5,
      locked: 'yes',
      alwaysOnTop: 'yes',
      webDshUrl: 'file:///invalid',
      pixelModelId: 42,
      pixelModelNames: { '../unsafe': 'Bad', 'local:lian': ' '.repeat(4) },
      position: { x: 'secret', y: Number.NaN },
    })).toEqual(DEFAULT_DESKTOP_CONFIG)
  })

  it('falls back for an unknown schema version', () => {
    expect(parseDesktopConfig({ schemaVersion: 6, locked: true })).toEqual(DEFAULT_DESKTOP_CONFIG)
  })

  it('serializes repeated atomic saves on Windows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-pet-config-'))
    const filePath = join(directory, 'config.json')
    const store = new ConfigStore(filePath)
    await store.save({ ...DEFAULT_DESKTOP_CONFIG, locked: true })
    await store.save({
      schemaVersion: 5,
      visible: false,
      locked: false,
      alwaysOnTop: true,
      webDshUrl: 'http://localhost:4080',
      pixelModelId: 'imported:boba',
      pixelModelNames: { 'imported:boba': '波霸' },
      position: { x: 42, y: -9 },
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      schemaVersion: 5,
      visible: false,
      locked: false,
      alwaysOnTop: true,
      webDshUrl: 'http://localhost:4080',
      pixelModelId: 'imported:boba',
      pixelModelNames: { 'imported:boba': '波霸' },
      position: { x: 42, y: -9 },
    })
    await expect(store.load()).resolves.toEqual({
      schemaVersion: 5,
      visible: false,
      locked: false,
      alwaysOnTop: true,
      webDshUrl: 'http://localhost:4080',
      pixelModelId: 'imported:boba',
      pixelModelNames: { 'imported:boba': '波霸' },
      position: { x: 42, y: -9 },
    })
  })
})
