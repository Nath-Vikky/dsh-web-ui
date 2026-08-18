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

/** Resolve a workspace Electron dependency for source-development only. */
export function developmentElectronExecutable(moduleUrl: string): string | undefined {
  let executablePath: unknown
  try {
    executablePath = createRequire(moduleUrl)('electron')
  } catch {
    return undefined
  }
  return typeof executablePath === 'string' && existsSync(executablePath) ? executablePath : undefined
}

/** Build the private child environment without inheriting stale connection credentials. */
export function desktopCompanionEnvironment(
  parentPid: number,
  origin: string | undefined,
  nativeToken: string | undefined,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    DSH_PET_PARENT_PID: String(parentPid),
  }
  if (origin === undefined) delete environment.DSH_PET_ORIGIN
  else environment.DSH_PET_ORIGIN = origin
  if (nativeToken === undefined) delete environment.DSH_PET_NATIVE_TOKEN
  else environment.DSH_PET_NATIVE_TOKEN = nativeToken
  return environment
}

/** Resolve the built desktop application against one explicitly selected Electron executable. */
export function desktopCompanionTarget(
  moduleUrl: string,
  runtimeExecutable = developmentElectronExecutable(moduleUrl),
): DesktopCompanionTarget | undefined {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  const packageRoot = resolve(moduleDirectory, '..')
  const appRoot = join(packageRoot, 'desktop')
  const entryPath = join(appRoot, 'out', 'main', 'index.js')
  if (runtimeExecutable === undefined
    || !existsSync(runtimeExecutable)
    || !existsSync(join(appRoot, 'package.json'))
    || !existsSync(entryPath)) return undefined
  return { appRoot, entryPath, executablePath: runtimeExecutable }
}

/** Launch the packaged Electron app and bind its lifetime to this Host process. */
export function launchDesktopCompanion(
  moduleUrl: string,
  parentPid = process.pid,
  origin?: string,
  nativeToken?: string,
  runtimeExecutable?: string,
): () => void {
  if (process.env.VITEST !== undefined
    || process.env.NODE_ENV === 'test'
    || process.env.DSH_PET_DISABLE_DESKTOP === '1') return () => undefined
  const target = desktopCompanionTarget(moduleUrl, runtimeExecutable)
  if (target === undefined) {
    console.warn('dsh-pet: 桌面伴侣不可用；请确认插件已构建，并在宠物设置中安装桌面运行环境')
    return () => undefined
  }

  let child: ChildProcess | undefined
  let disposed = false
  const childEnvironment = desktopCompanionEnvironment(parentPid, origin, nativeToken)
  try {
    const originArguments = origin === undefined ? [] : [`--dsh-origin=${origin}`]
    child = spawn(target.executablePath, [target.appRoot, `--dsh-parent-pid=${parentPid}`, ...originArguments], {
      cwd: target.appRoot,
      env: childEnvironment,
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
        ...(origin === undefined ? [] : [`--dsh-origin=${origin}`]),
      ], {
        cwd: target.appRoot,
        env: childEnvironment,
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
