import { app, session } from 'electron'
import { dirname, join } from 'node:path'

import { ConfigStore } from './config-store.ts'
import { installDesktopIpc } from './ipc.ts'
import {
  managedParentAction,
  managedParentActionFromData,
  managedParentFromData,
  managedParentPid,
  processIsAlive,
  type ManagedParentAction,
} from './managed-parent.ts'
import { PetClient } from './pet-client.ts'
import { PixelModelCatalog, registerPixelModelScheme } from './pixel-model-catalog.ts'
import { PixelModelStore, resolvePixelModelSelection } from './pixel-model-store.ts'
import { TrayController } from './tray.ts'
import { WindowManager } from './window-manager.ts'

let windows: WindowManager | undefined
let tray: TrayController | undefined
let pet: PetClient | undefined
let removeIpc: (() => void) | undefined
let models: PixelModelCatalog | undefined
let parentTimer: NodeJS.Timeout | undefined
const managedParents = new Set<number>()

registerPixelModelScheme()

function addManagedParentPid(pid: number | undefined): void {
  if (pid === undefined) return
  managedParents.add(pid)
  if (parentTimer !== undefined) return
  parentTimer = setInterval(() => {
    for (const candidate of managedParents) {
      if (!processIsAlive(candidate)) managedParents.delete(candidate)
    }
    if (managedParents.size === 0) app.quit()
  }, 750)
  parentTimer.unref?.()
}

function updateManagedParent(pid: number | undefined, action: ManagedParentAction): void {
  if (pid === undefined) return
  if (action === 'add') {
    addManagedParentPid(pid)
    return
  }
  managedParents.delete(pid)
  if (managedParents.size === 0) app.quit()
}

function parentFromArguments(arguments_: readonly string[]): number | undefined {
  return managedParentPid(arguments_)
}

const environmentParent = process.env.DSH_PET_PARENT_PID
const initialParentPid = parentFromArguments([
  ...process.argv,
  ...(environmentParent === undefined ? [] : [`--dsh-parent-pid=${environmentParent}`]),
])
const initialParentAction = managedParentAction(process.argv)

const hasSingleInstanceLock = app.requestSingleInstanceLock(
  initialParentPid === undefined
    ? {}
    : { dshParentPid: initialParentPid, dshParentAction: initialParentAction },
)
const shouldStart = hasSingleInstanceLock && initialParentAction === 'add'
if (!shouldStart) app.quit()
else addManagedParentPid(initialParentPid)

app.on('second-instance', (_event, commandLine, _workingDirectory, additionalData) => {
  const action = managedParentActionFromData(additionalData) === 'remove'
    ? 'remove'
    : managedParentAction(commandLine)
  updateManagedParent(managedParentFromData(additionalData) ?? parentFromArguments(commandLine), action)
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
    const localModelRoot = app.isPackaged
      ? join(dirname(app.getPath('exe')), 'pixelmodel')
      : join(process.cwd(), 'pixelmodel')
    models = new PixelModelCatalog(new PixelModelStore(
      localModelRoot,
      join(app.getPath('userData'), 'pixel-models'),
    ))
    models.install(session.defaultSession)
    const selectedModelId = resolvePixelModelSelection(config.pixelModelId, await models.list())
    if (selectedModelId !== config.pixelModelId) {
      config = { ...config, pixelModelId: selectedModelId }
      await configStore.save(config)
    }
    const petClient = new PetClient(fetch, config.webDshUrl)
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
  })
}
