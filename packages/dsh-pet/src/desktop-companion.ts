import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface DesktopCompanionTarget {
  appRoot: string
  entryPath: string
  executablePath: string
}

/** Resolve the desktop runtime shipped inside this plugin package. */
export function desktopCompanionTarget(moduleUrl: string): DesktopCompanionTarget | undefined {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  const packageRoot = resolve(moduleDirectory, '..')
  const appRoot = join(packageRoot, 'desktop')
  const entryPath = join(appRoot, 'out', 'main', 'index.js')
  let executablePath: unknown
  try {
    executablePath = createRequire(moduleUrl)('electron')
  } catch {
    return undefined
  }
  if (typeof executablePath !== 'string'
    || !existsSync(executablePath)
    || !existsSync(join(appRoot, 'package.json'))
    || !existsSync(entryPath)) return undefined
  return { appRoot, entryPath, executablePath }
}

/** Launch the packaged Electron app and bind its lifetime to this Host process. */
export function launchDesktopCompanion(moduleUrl: string, parentPid = process.pid): () => void {
  if (process.env.VITEST !== undefined
    || process.env.NODE_ENV === 'test'
    || process.env.DSH_PET_DISABLE_DESKTOP === '1') return () => undefined
  const target = desktopCompanionTarget(moduleUrl)
  if (target === undefined) {
    console.warn('dsh-pet: 桌面伴侣不可用；请确认插件已构建，并在 DSH profile 中授权 @linxin666/dsh-pet 安装 Electron')
    return () => undefined
  }

  let child: ChildProcess | undefined
  let disposed = false
  try {
    child = spawn(target.executablePath, [target.appRoot, `--dsh-parent-pid=${parentPid}`], {
      cwd: target.appRoot,
      env: { ...process.env, DSH_PET_PARENT_PID: String(parentPid) },
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', () => {
      if (!disposed) console.warn('dsh-pet: 桌面伴侣启动失败，请检查 Electron 安装状态')
    })
    child.unref()
  } catch {
    console.warn('dsh-pet: 桌面伴侣启动失败，请检查 Electron 安装状态')
  }

  return () => {
    if (disposed) return
    disposed = true
    try {
      const cleanup = spawn(target.executablePath, [
        target.appRoot,
        `--dsh-parent-pid=${parentPid}`,
        '--dsh-parent-action=remove',
      ], {
        cwd: target.appRoot,
        env: { ...process.env, DSH_PET_PARENT_PID: String(parentPid) },
        stdio: 'ignore',
        windowsHide: true,
      })
      cleanup.unref()
    } catch {
      // The parent liveness watcher remains the final cleanup path.
    }
    child = undefined
  }
}
