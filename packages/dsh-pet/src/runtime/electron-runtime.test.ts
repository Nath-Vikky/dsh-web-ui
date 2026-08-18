import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ElectronRuntimeManager,
  electronRuntimeArchiveUrl,
  normalizeElectronRuntimeMirror,
  type ElectronRuntimeDownloadRequest,
} from './electron-runtime.ts'
import { ELECTRON_RUNTIME_VERSION } from './electron-runtime-manifest.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-electron-'))
  roots.push(root)
  return root
}

async function fakeWindowsRuntime(destination: string): Promise<void> {
  await writeFile(join(destination, 'version'), `${ELECTRON_RUNTIME_VERSION}\n`, 'utf8')
  await writeFile(join(destination, 'electron.exe'), 'fixture', 'utf8')
}

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('ElectronRuntimeManager', () => {
  it('installs from npmmirror while retaining the pinned official checksum', async () => {
    const root = await temporaryRoot()
    let request: ElectronRuntimeDownloadRequest | undefined
    const downloadArtifact = vi.fn(async (next: ElectronRuntimeDownloadRequest) => {
      request = next
      next.onProgress({ transferred: 60, total: 100, percent: 0.6 })
      return join(root, 'fixture.zip')
    })
    const manager = new ElectronRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact,
      extractArchive: async (_archive, destination) => { await fakeWindowsRuntime(destination) },
    })

    expect(manager.state()).toMatchObject({ phase: 'not-installed', installed: false })
    manager.startInstall({ source: 'npmmirror' })
    await manager.settled()

    expect(downloadArtifact).toHaveBeenCalledOnce()
    expect(request).toMatchObject({
      version: ELECTRON_RUNTIME_VERSION,
      platform: 'win32',
      arch: 'x64',
      filename: `electron-v${ELECTRON_RUNTIME_VERSION}-win32-x64.zip`,
      mirrorUrl: `https://npmmirror.com/mirrors/electron/v${ELECTRON_RUNTIME_VERSION}/electron-v${ELECTRON_RUNTIME_VERSION}-win32-x64.zip`,
    })
    expect(request?.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(manager.state()).toMatchObject({ phase: 'ready', installed: true, managed: true, source: 'npmmirror' })
    expect(manager.executablePath()).toMatch(/electron\.exe$/)
    expect(existsSync(manager.executablePath()!)).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toMatchObject({ source: 'npmmirror' })
  })

  it('cleans a cancelled partial install and returns to not installed', async () => {
    const root = await temporaryRoot()
    const manager = new ElectronRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        }, { once: true })
      }),
      extractArchive: async () => undefined,
    })

    manager.startInstall({ source: 'official' })
    manager.cancelInstall()
    await manager.settled()

    expect(manager.state()).toMatchObject({ phase: 'not-installed', installed: false })
    expect(existsSync(join(root, 'install.lock'))).toBe(false)
  })

  it('reports verification failures and never exposes an invalid executable', async () => {
    const root = await temporaryRoot()
    const manager = new ElectronRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: async () => join(root, 'fixture.zip'),
      extractArchive: async (_archive, destination) => {
        await writeFile(join(destination, 'version'), `${ELECTRON_RUNTIME_VERSION}\n`, 'utf8')
      },
    })

    manager.startInstall({ source: 'official' })
    await manager.settled()

    expect(manager.state()).toMatchObject({ phase: 'failed', installed: false, error: 'runtime-install-failed' })
    expect(manager.executablePath()).toBeUndefined()
  })

  it('does not remove another live process installation lock', async () => {
    const root = await temporaryRoot()
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'install.lock'), JSON.stringify({ pid: process.pid }), 'utf8')
    const manager = new ElectronRuntimeManager({ root, platform: 'win32', arch: 'x64' })

    manager.startInstall({ source: 'official' })
    await manager.settled()

    expect(manager.state()).toMatchObject({ phase: 'failed', error: 'runtime-install-busy' })
    expect(existsSync(join(root, 'install.lock'))).toBe(true)
  })

  it('closes the atomic lock write and never removes a replacement lock', async () => {
    const root = await temporaryRoot()
    let finishDownload: ((archive: string) => void) | undefined
    const manager = new ElectronRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: () => new Promise(resolve => { finishDownload = resolve }),
      extractArchive: async (_archive, destination) => { await fakeWindowsRuntime(destination) },
    })

    manager.startInstall({ source: 'official' })
    await vi.waitFor(() => { expect(finishDownload).toBeTypeOf('function') })
    const lockFile = join(root, 'install.lock')
    const owned = JSON.parse(await readFile(lockFile, 'utf8')) as { token?: string }
    expect(owned.token).toMatch(/^[0-9a-f-]{36}$/)

    await rm(lockFile, { force: true })
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, token: 'replacement' }), 'utf8')
    finishDownload!(join(root, 'fixture.zip'))
    await manager.settled()

    expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: 'replacement' })
  })

  it('uses a source-development executable without copying it into DSH_HOME', async () => {
    const root = await temporaryRoot()
    const fallbackExecutable = join(root, 'workspace-electron.exe')
    await writeFile(fallbackExecutable, 'fixture', 'utf8')
    const manager = new ElectronRuntimeManager({ root, platform: 'win32', arch: 'x64', fallbackExecutable })

    expect(manager.state()).toMatchObject({ phase: 'ready', installed: true, managed: false })
    expect(manager.executablePath()).toBe(fallbackExecutable)
  })

  it('marks unsupported targets without starting a download', async () => {
    const root = await temporaryRoot()
    const downloadArtifact = vi.fn()
    const manager = new ElectronRuntimeManager({ root, platform: 'freebsd', arch: 'x64', downloadArtifact })

    manager.startInstall({ source: 'official' })

    expect(manager.state()).toMatchObject({ phase: 'unsupported', installed: false })
    expect(downloadArtifact).not.toHaveBeenCalled()
  })
})

describe('Electron runtime mirror policy', () => {
  it('normalizes trusted remote and local development mirror bases', () => {
    expect(normalizeElectronRuntimeMirror({ source: 'custom', customMirror: 'https://mirror.example/electron' }))
      .toEqual({ source: 'custom', customMirror: 'https://mirror.example/electron/' })
    expect(normalizeElectronRuntimeMirror({ source: 'custom', customMirror: 'http://127.0.0.1:8080/electron' }))
      .toEqual({ source: 'custom', customMirror: 'http://127.0.0.1:8080/electron/' })
  })

  it('rejects insecure remote mirrors and URLs carrying credentials', () => {
    expect(() => normalizeElectronRuntimeMirror({ source: 'custom', customMirror: 'http://mirror.example/electron' }))
      .toThrow('runtime-mirror-insecure')
    expect(() => normalizeElectronRuntimeMirror({ source: 'custom', customMirror: 'https://user:secret@mirror.example/' }))
      .toThrow('runtime-mirror-invalid')
  })

  it('builds the versioned official artifact URL', () => {
    expect(electronRuntimeArchiveUrl(
      { source: 'official' },
      `electron-v${ELECTRON_RUNTIME_VERSION}-linux-x64.zip`,
    )).toBe(
      `https://github.com/electron/electron/releases/download/v${ELECTRON_RUNTIME_VERSION}/electron-v${ELECTRON_RUNTIME_VERSION}-linux-x64.zip`,
    )
  })
})

describe('published runtime dependency policy', () => {
  it('keeps Electron opt-in for users while pinning the source-development version', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.electron).toBeUndefined()
    expect(packageJson.optionalDependencies?.electron).toBeUndefined()
    expect(packageJson.devDependencies?.electron).toBe(`^${ELECTRON_RUNTIME_VERSION}`)
  })
})
