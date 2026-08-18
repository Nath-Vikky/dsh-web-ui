import { existsSync, readFileSync, type Dirent } from 'node:fs'
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import extractZip from '@electron-internal/extract-zip'
import { downloadArtifact } from '@electron/get'

import {
  ELECTRON_RUNTIME_VERSION,
  electronRuntimeArtifact,
} from './electron-runtime-manifest.ts'

export type ElectronRuntimeMirror = 'official' | 'npmmirror' | 'custom'
export type ElectronRuntimePhase =
  | 'not-installed'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'failed'
  | 'unsupported'

export interface ElectronRuntimeMirrorSelection {
  source: ElectronRuntimeMirror
  customMirror?: string
}

export interface ElectronRuntimeProgress {
  transferred: number
  total: number | null
  percent: number
}

export interface ElectronRuntimeView {
  version: string
  platform: NodeJS.Platform
  arch: string
  phase: ElectronRuntimePhase
  installed: boolean
  managed: boolean
  source: ElectronRuntimeMirror
  customMirror?: string
  progress?: ElectronRuntimeProgress
  error?: string
}

export interface ElectronRuntimeDownloadRequest {
  version: string
  platform: string
  arch: string
  filename: string
  checksum: string
  cacheRoot: string
  mirrorUrl: string
  signal: AbortSignal
  onProgress(progress: ElectronRuntimeProgress): void
}

export interface ElectronRuntimeManagerOptions {
  root: string
  platform?: NodeJS.Platform
  arch?: string
  fallbackExecutable?: string
  downloadArtifact?: (request: ElectronRuntimeDownloadRequest) => Promise<string>
  extractArchive?: (archive: string, destination: string) => Promise<void>
}

interface RuntimePreferences {
  schemaVersion: 1
  source: ElectronRuntimeMirror
  customMirror?: string
}

interface RuntimeInstallLock {
  token: string
}

type RuntimeListener = (state: ElectronRuntimeView) => void

const OFFICIAL_MIRROR = 'https://github.com/electron/electron/releases/download/'
const NPMMIRROR = 'https://npmmirror.com/mirrors/electron/'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]'
}

function normalizeCustomMirror(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('runtime-mirror-required')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new TypeError('runtime-mirror-invalid')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError('runtime-mirror-invalid')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHostname(url.hostname))) {
    throw new TypeError('runtime-mirror-insecure')
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

/** Validate one user-selected mirror without trusting it for artifact integrity. */
export function normalizeElectronRuntimeMirror(value: unknown): ElectronRuntimeMirrorSelection {
  if (!isRecord(value)) throw new TypeError('runtime-mirror-invalid')
  if (value.source === 'official' || value.source === 'npmmirror') return { source: value.source }
  if (value.source !== 'custom') throw new TypeError('runtime-mirror-invalid')
  return { source: 'custom', customMirror: normalizeCustomMirror(value.customMirror) }
}

function mirrorBase(selection: ElectronRuntimeMirrorSelection): string {
  if (selection.source === 'official') return OFFICIAL_MIRROR
  if (selection.source === 'npmmirror') return NPMMIRROR
  return selection.customMirror!
}

export function electronRuntimeArchiveUrl(
  selection: ElectronRuntimeMirrorSelection,
  filename: string,
): string {
  return `${mirrorBase(selection)}v${ELECTRON_RUNTIME_VERSION}/${filename}`
}

function executableRelativePath(platform: NodeJS.Platform): string | undefined {
  if (platform === 'win32') return 'electron.exe'
  if (platform === 'linux') return 'electron'
  if (platform === 'darwin') return join('Electron.app', 'Contents', 'MacOS', 'Electron')
  return undefined
}

function errorCode(error: unknown, stage: ElectronRuntimePhase): string {
  if ((error instanceof DOMException || error instanceof Error) && error.name === 'AbortError') {
    return 'runtime-install-cancelled'
  }
  if (error instanceof Error) {
    if (error.message === 'runtime-install-busy') return error.message
    if (/checksum|sha-?256|digest/i.test(error.message)) return 'runtime-checksum-failed'
  }
  return stage === 'downloading' ? 'runtime-download-failed' : 'runtime-install-failed'
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function safeChild(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function defaultDownload(request: ElectronRuntimeDownloadRequest): Promise<string> {
  return downloadArtifact({
    version: request.version,
    artifactName: 'electron',
    platform: request.platform,
    arch: request.arch,
    cacheRoot: request.cacheRoot,
    checksums: { [request.filename]: request.checksum },
    mirrorOptions: {
      resolveAssetURL: async () => request.mirrorUrl,
    },
    downloadOptions: {
      signal: request.signal,
      quiet: true,
      getProgressCallback: async (progress: ElectronRuntimeProgress) => {
        request.onProgress(progress)
      },
    },
  })
}

async function defaultExtract(archive: string, destination: string): Promise<void> {
  // Electron uses this native extractor for Node 24.16+; the legacy
  // extract-zip/yauzl stream can leave its extraction promise unsettled.
  await extractZip(archive, { dir: destination })
}

/** Owns a checksum-pinned Electron runtime under DSH_HOME and never mutates the plugin package. */
export class ElectronRuntimeManager {
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly fallbackExecutable: string | undefined
  private readonly downloadArtifact: (request: ElectronRuntimeDownloadRequest) => Promise<string>
  private readonly extractArchive: (archive: string, destination: string) => Promise<void>
  private readonly listeners = new Set<RuntimeListener>()
  private preferences: RuntimePreferences
  private current: ElectronRuntimeView
  private abortController: AbortController | undefined
  private installPromise: Promise<void> | undefined

  constructor(private readonly options: ElectronRuntimeManagerOptions) {
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.fallbackExecutable = options.fallbackExecutable
    this.downloadArtifact = options.downloadArtifact ?? defaultDownload
    this.extractArchive = options.extractArchive ?? defaultExtract
    this.preferences = this.readPreferences()
    this.current = this.initialState()
  }

  state(): ElectronRuntimeView {
    if (this.installPromise === undefined) this.refreshAvailability()
    return structuredClone(this.current)
  }

  executablePath(): string | undefined {
    const managed = this.managedExecutable()
    if (managed !== undefined) return managed
    return this.fallbackExecutable !== undefined && existsSync(this.fallbackExecutable)
      ? this.fallbackExecutable
      : undefined
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => { this.listeners.delete(listener) }
  }

  startInstall(selectionValue: unknown): ElectronRuntimeView {
    const selection = normalizeElectronRuntimeMirror(selectionValue)
    if (electronRuntimeArtifact(this.platform, this.arch) === undefined) {
      this.publish({ ...this.baseState(selection), phase: 'unsupported', installed: false, managed: false })
      return this.state()
    }
    if (this.executablePath() !== undefined) {
      this.preferences = { schemaVersion: 1, ...selection }
      this.refreshAvailability()
      return this.state()
    }
    if (this.installPromise !== undefined) return this.state()
    this.preferences = { schemaVersion: 1, ...selection }
    const controller = new AbortController()
    this.abortController = controller
    this.publish({
      ...this.baseState(selection),
      phase: 'downloading',
      installed: false,
      managed: false,
      progress: { transferred: 0, total: null, percent: 0 },
    })
    const task = this.performInstall(selection, controller.signal)
    this.installPromise = task
    void task.finally(() => {
      if (this.installPromise === task) this.installPromise = undefined
      if (this.abortController === controller) this.abortController = undefined
    })
    return this.state()
  }

  cancelInstall(): ElectronRuntimeView {
    this.abortController?.abort()
    return this.state()
  }

  async settled(): Promise<void> {
    await this.installPromise
  }

  dispose(): void {
    this.abortController?.abort()
    this.listeners.clear()
  }

  private initialState(): ElectronRuntimeView {
    const selection = this.selection()
    if (electronRuntimeArtifact(this.platform, this.arch) === undefined) {
      return { ...this.baseState(selection), phase: 'unsupported', installed: false, managed: false }
    }
    const managed = this.managedExecutable() !== undefined
    const installed = managed || (this.fallbackExecutable !== undefined && existsSync(this.fallbackExecutable))
    return { ...this.baseState(selection), phase: installed ? 'ready' : 'not-installed', installed, managed }
  }

  private refreshAvailability(): void {
    const selection = this.selection()
    const managed = this.managedExecutable() !== undefined
    const installed = managed || (this.fallbackExecutable !== undefined && existsSync(this.fallbackExecutable))
    const unsupported = electronRuntimeArtifact(this.platform, this.arch) === undefined
    const phase = unsupported
      ? 'unsupported'
      : installed
        ? 'ready'
        : this.current.phase === 'failed' ? 'failed' : 'not-installed'
    const next: ElectronRuntimeView = {
      ...this.baseState(selection),
      phase,
      installed,
      managed,
      ...(phase === 'failed' && this.current.error !== undefined ? { error: this.current.error } : {}),
    }
    if (JSON.stringify(next) !== JSON.stringify(this.current)) this.publish(next)
  }

  private async performInstall(selection: ElectronRuntimeMirrorSelection, signal: AbortSignal): Promise<void> {
    let stage: ElectronRuntimePhase = 'downloading'
    let lock: RuntimeInstallLock | undefined
    let partial: string | undefined
    try {
      await mkdir(this.options.root, { recursive: true })
      await this.persistPreferences()
      lock = await this.acquireInstallLock()
      await this.cleanupOrphanedInstalls()
      const artifact = electronRuntimeArtifact(this.platform, this.arch)
      if (artifact === undefined) throw new Error('runtime-unsupported')
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const archive = await this.downloadArtifact({
        version: ELECTRON_RUNTIME_VERSION,
        platform: artifact.platform,
        arch: artifact.arch,
        filename: artifact.filename,
        checksum: artifact.checksum,
        cacheRoot: join(this.options.root, 'downloads'),
        mirrorUrl: electronRuntimeArchiveUrl(selection, artifact.filename),
        signal,
        onProgress: (progress) => {
          if (signal.aborted) return
          this.publish({ ...this.current, phase: 'downloading', progress: { ...progress } })
        },
      })
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      stage = 'installing'
      this.publish({
        ...this.baseState(selection),
        phase: 'installing',
        installed: false,
        managed: false,
      })
      const destination = this.installDirectory()
      partial = `${destination}.partial-${randomUUID()}`
      await mkdir(partial, { recursive: true })
      await this.extractArchive(archive, partial)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      await this.verifyExtracted(partial)
      await mkdir(dirname(destination), { recursive: true })
      if (existsSync(destination)) {
        if (!safeChild(this.options.root, destination)) throw new Error('unsafe-runtime-destination')
        await rm(destination, { recursive: true, force: true })
      }
      await rename(partial, destination)
      partial = undefined
      this.publish({ ...this.baseState(selection), phase: 'ready', installed: true, managed: true })
    } catch (error) {
      const code = errorCode(error, stage)
      if (code === 'runtime-install-cancelled') {
        this.publish({ ...this.baseState(selection), phase: 'not-installed', installed: false, managed: false })
      } else {
        this.publish({ ...this.baseState(selection), phase: 'failed', installed: false, managed: false, error: code })
      }
    } finally {
      if (partial !== undefined && safeChild(this.options.root, partial)) {
        await rm(partial, { recursive: true, force: true }).catch(() => undefined)
      }
      if (lock !== undefined) {
        await this.releaseInstallLock(lock)
      }
    }
  }

  private async verifyExtracted(directory: string): Promise<void> {
    const relativeExecutable = executableRelativePath(this.platform)
    if (relativeExecutable === undefined) throw new Error('runtime-unsupported')
    const executable = join(directory, relativeExecutable)
    const version = (await readFile(join(directory, 'version'), 'utf8')).trim().replace(/^v/, '')
    if (version !== ELECTRON_RUNTIME_VERSION || !existsSync(executable)) {
      throw new Error('runtime-verification-failed')
    }
    if (this.platform !== 'win32') await chmod(executable, 0o755)
  }

  private managedExecutable(): string | undefined {
    const relativeExecutable = executableRelativePath(this.platform)
    if (relativeExecutable === undefined) return undefined
    const directory = this.installDirectory()
    const executable = join(directory, relativeExecutable)
    try {
      const version = readFileSync(join(directory, 'version'), 'utf8').trim().replace(/^v/, '')
      return version === ELECTRON_RUNTIME_VERSION && existsSync(executable) ? executable : undefined
    } catch {
      return undefined
    }
  }

  private installDirectory(): string {
    return join(this.options.root, 'runtime', `v${ELECTRON_RUNTIME_VERSION}`, `${this.platform}-${this.arch}`)
  }

  private lockFile(): string {
    return join(this.options.root, 'install.lock')
  }

  private async cleanupOrphanedInstalls(): Promise<void> {
    const destination = this.installDirectory()
    const parent = dirname(destination)
    const prefix = `${basename(destination)}.partial-`
    let entries: Dirent[]
    try {
      entries = await readdir(parent, { withFileTypes: true })
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix)) continue
      const orphan = join(parent, entry.name)
      if (!safeChild(this.options.root, orphan)) continue
      await rm(orphan, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async acquireInstallLock(): Promise<RuntimeInstallLock> {
    const file = this.lockFile()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomUUID()
      try {
        // Passing a path to writeFile keeps the wx create atomic while Node
        // owns and closes the descriptor before this method returns. Holding a
        // FileHandle for the whole download made interrupted installs depend
        // on garbage collection and is an error in Node 24+.
        await writeFile(file, JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          token,
        }), { encoding: 'utf8', flag: 'wx' })
        return { token }
      } catch (error) {
        if (!isRecord(error) || error.code !== 'EEXIST') throw error
        let stale = true
        try {
          const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
          stale = !isRecord(raw) || typeof raw.pid !== 'number' || !processAlive(raw.pid)
        } catch {
          stale = true
        }
        if (!stale) throw new Error('runtime-install-busy')
        await rm(file, { force: true })
      }
    }
    throw new Error('runtime-install-busy')
  }

  private async releaseInstallLock(lock: RuntimeInstallLock): Promise<void> {
    const file = this.lockFile()
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
      if (!isRecord(raw) || raw.token !== lock.token) return
      await rm(file, { force: true })
    } catch {
      // A missing/replaced lock belongs to recovery or another Host process.
    }
  }

  private preferenceFile(): string {
    return join(this.options.root, 'settings.json')
  }

  private readPreferences(): RuntimePreferences {
    try {
      const value = JSON.parse(readFileSync(this.preferenceFile(), 'utf8')) as unknown
      const normalized = normalizeElectronRuntimeMirror(value)
      return { schemaVersion: 1, ...normalized }
    } catch {
      return { schemaVersion: 1, source: 'official' }
    }
  }

  private async persistPreferences(): Promise<void> {
    const file = this.preferenceFile()
    await mkdir(dirname(file), { recursive: true })
    const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(this.preferences, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }

  private selection(): ElectronRuntimeMirrorSelection {
    return this.preferences.source === 'custom'
      ? { source: 'custom', customMirror: this.preferences.customMirror }
      : { source: this.preferences.source }
  }

  private baseState(selection: ElectronRuntimeMirrorSelection): Omit<ElectronRuntimeView, 'phase' | 'installed' | 'managed'> {
    return {
      version: ELECTRON_RUNTIME_VERSION,
      platform: this.platform,
      arch: this.arch,
      source: selection.source,
      ...(selection.customMirror === undefined ? {} : { customMirror: selection.customMirror }),
    }
  }

  private publish(next: ElectronRuntimeView): void {
    this.current = next
    const snapshot = structuredClone(next)
    for (const listener of this.listeners) listener(snapshot)
  }
}
