import { app, powerMonitor, session } from 'electron'
import { dirname, join, resolve } from 'node:path'

import { ConfigStore } from './config-store.ts'
import { PetModelCatalog } from '../../../src/models/catalog.ts'
import { petModelRoot } from '../../../src/models/store.ts'
import { codexPetsDir } from '../../../src/registry.ts'
import { installDesktopIpc } from './ipc.ts'
import {
  managedParentAction,
  managedParentActionFromData,
  managedParentFromData,
  managedParentNativeToken,
  managedParentNativeTokenFromData,
  managedParentOrigin,
  managedParentOriginFromData,
  managedParentPid,
  processIsAlive,
  type ManagedParentAction,
} from './managed-parent.ts'
import { PetClient } from './pet-client.ts'
import { installDesktopRecoveryEvents } from './lifecycle-recovery.ts'
import { PetModelProtocol, registerPetModelScheme } from './model-protocol.ts'
import { TrayController } from './tray.ts'
import { WindowManager } from './window-manager.ts'

let windows: WindowManager | undefined
let tray: TrayController | undefined
let pet: PetClient | undefined
let removeIpc: (() => void) | undefined
let models: PetModelProtocol | undefined
let parentTimer: NodeJS.Timeout | undefined
let removeRecoveryEvents: (() => void) | undefined
interface ManagedConnection {
  origin?: string
  nativeToken?: string
}
const managedParents = new Map<number, ManagedConnection>()
let activeManagedOrigin: string | undefined
let activeManagedNativeToken: string | undefined

registerPetModelScheme()

function applyManagedConnection(connection: ManagedConnection): void {
  const { origin, nativeToken } = connection
  if (origin === activeManagedOrigin && nativeToken === activeManagedNativeToken) return
  activeManagedOrigin = origin
  activeManagedNativeToken = nativeToken
  if (origin !== undefined) {
    pet?.setConnection(origin, nativeToken)
    windows?.setWebDshUrl(origin)
  } else {
    pet?.setNativeToken(nativeToken)
  }
}

function latestManagedConnection(): ManagedConnection {
  return [...managedParents.values()].at(-1) ?? {}
}

function addManagedParent(
  pid: number | undefined,
  origin: string | undefined,
  nativeToken: string | undefined,
): void {
  const connection: ManagedConnection = {
    ...(origin === undefined ? {} : { origin }),
    ...(nativeToken === undefined ? {} : { nativeToken }),
  }
  if (pid === undefined) {
    applyManagedConnection(connection)
    return
  }
  managedParents.delete(pid)
  managedParents.set(pid, connection)
  applyManagedConnection(connection)
  if (parentTimer !== undefined) return
  parentTimer = setInterval(() => {
    let changed = false
    for (const candidate of managedParents.keys()) {
      if (processIsAlive(candidate)) continue
      managedParents.delete(candidate)
      changed = true
    }
    if (managedParents.size === 0) app.quit()
    else if (changed) applyManagedConnection(latestManagedConnection())
  }, 750)
  parentTimer.unref?.()
}

function updateManagedParent(
  pid: number | undefined,
  action: ManagedParentAction,
  origin: string | undefined,
  nativeToken: string | undefined,
): void {
  if (pid === undefined) return
  if (action === 'add') {
    addManagedParent(pid, origin, nativeToken)
    return
  }
  managedParents.delete(pid)
  if (managedParents.size === 0) app.quit()
  else applyManagedConnection(latestManagedConnection())
}

function parentFromArguments(arguments_: readonly string[]): number | undefined {
  return managedParentPid(arguments_)
}

const environmentParent = process.env.DSH_PET_PARENT_PID
const environmentOrigin = process.env.DSH_PET_ORIGIN
const environmentNativeToken = managedParentNativeToken(process.env.DSH_PET_NATIVE_TOKEN)
const initialParentPid = parentFromArguments([
  ...process.argv,
  ...(environmentParent === undefined ? [] : [`--dsh-parent-pid=${environmentParent}`]),
])
const initialOrigin = managedParentOrigin([
  ...process.argv,
  ...(environmentOrigin === undefined ? [] : [`--dsh-origin=${environmentOrigin}`]),
])
const initialParentAction = managedParentAction(process.argv)
activeManagedOrigin = initialOrigin
activeManagedNativeToken = environmentNativeToken

const userDataOverride = process.env.DSH_PET_USER_DATA_DIR?.trim()
if (userDataOverride !== undefined && userDataOverride !== '') {
  app.setPath('userData', resolve(userDataOverride))
}

const hasSingleInstanceLock = app.requestSingleInstanceLock(
  initialParentPid === undefined
    ? {}
    : {
        dshParentPid: initialParentPid,
        dshParentAction: initialParentAction,
        ...(initialOrigin === undefined ? {} : { dshOrigin: initialOrigin }),
        ...(environmentNativeToken === undefined ? {} : { dshNativeToken: environmentNativeToken }),
      },
)
const shouldStart = hasSingleInstanceLock && initialParentAction === 'add'
if (!shouldStart) app.quit()
else addManagedParent(initialParentPid, initialOrigin, environmentNativeToken)

app.on('second-instance', (_event, commandLine, _workingDirectory, additionalData) => {
  const action = managedParentActionFromData(additionalData) === 'remove'
    ? 'remove'
    : managedParentAction(commandLine)
  const origin = managedParentOriginFromData(additionalData) ?? managedParentOrigin(commandLine)
  const nativeToken = managedParentNativeTokenFromData(additionalData)
  updateManagedParent(
    managedParentFromData(additionalData) ?? parentFromArguments(commandLine),
    action,
    origin,
    nativeToken,
  )
  if (action === 'add') windows?.show()
})
app.on('activate', () => windows?.show())
app.on('window-all-closed', () => {
  // The tray owns application lifetime on every platform.
})
app.on('before-quit', () => windows?.setQuitting())
app.on('will-quit', () => {
  if (parentTimer !== undefined) clearInterval(parentTimer)
  parentTimer = undefined
  removeIpc?.()
  removeRecoveryEvents?.()
  if (models !== undefined) models.uninstall(session.defaultSession)
  pet?.stop()
  tray?.destroy()
  windows?.destroy()
})

if (shouldStart) {
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    const configStore = new ConfigStore(join(app.getPath('userData'), 'config.json'))
    let config = await configStore.load()
    if (activeManagedOrigin !== undefined && config.standalone.lastWebOrigin !== activeManagedOrigin) {
      config = { ...config, standalone: { lastWebOrigin: activeManagedOrigin } }
      await configStore.save(config)
    }
    const localModelRoot = app.isPackaged
      ? join(dirname(app.getPath('exe')), 'pixelmodel')
      : join(process.cwd(), 'pixelmodel')
    const modelCatalog = new PetModelCatalog({
      compatibilityLocalRoots: [localModelRoot],
      // One import location for both presentations. The Web registry scans it
      // at Host startup; the desktop catalog also reads it live.
      importedRoot: codexPetsDir(),
    })
    await modelCatalog.migrateLegacyImportedRoot(join(petModelRoot(), 'imported'))
    await modelCatalog.migrateLegacyImportedRoot(join(app.getPath('userData'), 'pixel-models'))
    models = new PetModelProtocol(modelCatalog)
    models.install(session.defaultSession)
    const petClient = new PetClient(
      fetch,
      activeManagedOrigin ?? config.standalone.lastWebOrigin,
      activeManagedNativeToken,
    )
    pet = petClient
    windows = new WindowManager(config, configStore, (patch) => {
      void petClient.setCompanionSettings(patch).catch(() => {
        // Keep the local preference while Harness is restarting; the next
        // successful Host snapshot will reconcile the shared settings.
      })
    })
    windows.create()
    removeIpc = installDesktopIpc(windows, petClient, models)
    petClient.start()
    tray = new TrayController(windows)
    removeRecoveryEvents = installDesktopRecoveryEvents(app, powerMonitor, {
      onResume: () => {
        petClient.reconnect()
        windows?.recoverAfterResume()
      },
      onGpuProcessGone: () => { windows?.recoverRenderer() },
    })
  })
}
