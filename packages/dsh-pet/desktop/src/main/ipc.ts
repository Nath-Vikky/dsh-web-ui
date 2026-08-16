import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'

import { DESKTOP_CHANNELS } from '../shared/desktop-api.ts'
import {
  parseMoveTarget,
  parsePetInteraction,
  parsePixelModelId,
  parsePetName,
  parseWebDshUrl,
  requireBoolean,
} from './ipc-validation.ts'
import type { PetClient } from './pet-client.ts'
import type { PixelModelCatalog } from './pixel-model-catalog.ts'
import type { WindowManager } from './window-manager.ts'

function requirePetRenderer(event: IpcMainInvokeEvent, windows: WindowManager): void {
  if (!windows.ownsWebContents(event.sender.id)) throw new Error('untrusted renderer')
}

export function installDesktopIpc(windows: WindowManager, pet: PetClient, models: PixelModelCatalog): () => void {
  ipcMain.handle(DESKTOP_CHANNELS.getState, event => {
    requirePetRenderer(event, windows)
    return windows.state()
  })
  ipcMain.handle(DESKTOP_CHANNELS.setDrawerOpen, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setDrawerOpen(requireBoolean(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.setLocked, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setLocked(requireBoolean(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.setWebDshUrl, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    const origin = parseWebDshUrl(value)
    pet.setOrigin(origin)
    return windows.setWebDshUrl(origin)
  })
  ipcMain.handle(DESKTOP_CHANNELS.beginDrag, event => {
    requirePetRenderer(event, windows)
    return windows.beginDrag()
  })
  ipcMain.handle(DESKTOP_CHANNELS.endDrag, event => {
    requirePetRenderer(event, windows)
    return windows.endDrag()
  })
  ipcMain.handle(DESKTOP_CHANNELS.moveTo, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.moveTo(parseMoveTarget(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.hide, event => {
    requirePetRenderer(event, windows)
    windows.hide()
  })
  ipcMain.handle(DESKTOP_CHANNELS.openDshWeb, async event => {
    requirePetRenderer(event, windows)
    await shell.openExternal(`${pet.originUrl()}/`)
  })
  ipcMain.handle(DESKTOP_CHANNELS.getPetState, event => {
    requirePetRenderer(event, windows)
    return pet.state()
  })
  ipcMain.handle(DESKTOP_CHANNELS.getPixelModels, event => {
    requirePetRenderer(event, windows)
    return models.list()
  })
  ipcMain.handle(DESKTOP_CHANNELS.selectPixelModel, async (event, value: unknown) => {
    requirePetRenderer(event, windows)
    const modelId = parsePixelModelId(value)
    if (!await models.has(modelId)) throw new TypeError('unknown pixel model id')
    return windows.setPixelModel(modelId)
  })
  ipcMain.handle(DESKTOP_CHANNELS.importPixelModel, async event => {
    requirePetRenderer(event, windows)
    const selection = await dialog.showOpenDialog({
      title: '导入 PetDex 模型文件夹',
      buttonLabel: '导入模型',
      properties: ['openDirectory'],
    })
    if (selection.canceled || selection.filePaths[0] === undefined) return { status: 'cancelled' }
    try {
      return { status: 'imported', model: await models.importDirectory(selection.filePaths[0]) }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const safePrefixes = [
        'pet.json 中的',
        'pet.json 缺少',
        'displayName',
        'description',
        'spritesheetPath',
        'spriteVersionNumber',
        '精灵图',
        '不支持该 WebP',
        '无法为',
      ]
      const message = safePrefixes.some(prefix => detail.startsWith(prefix))
        ? detail
        : '无法读取该 PetDex 模型，请确认文件夹中包含有效的 pet.json 和精灵图'
      return { status: 'error', message }
    }
  })
  ipcMain.handle(DESKTOP_CHANNELS.renamePixelModel, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.renamePixelModel(parsePetName(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.interact, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return pet.interact(parsePetInteraction(value))
  })
  const unsubscribePet = pet.subscribe((state) => {
    if (state.snapshot?.companion !== undefined) {
      if (!state.snapshot.companion.enabled) app.quit()
      else windows.applyCompanionSettings({
        visible: state.snapshot.companion.visible,
        alwaysOnTop: state.snapshot.companion.alwaysOnTop,
        locked: state.snapshot.companion.locked,
      })
    }
    windows.sendPetState(state)
  })

  return () => {
    unsubscribePet()
    for (const channel of Object.values(DESKTOP_CHANNELS)) {
      if (channel !== DESKTOP_CHANNELS.stateChanged
        && channel !== DESKTOP_CHANNELS.petStateChanged) {
        ipcMain.removeHandler(channel)
      }
    }
  }
}
