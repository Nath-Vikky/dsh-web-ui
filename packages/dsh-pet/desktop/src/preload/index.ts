import { contextBridge, ipcRenderer } from 'electron'

import {
  DESKTOP_CHANNELS,
  type DesktopApi,
  type DesktopState,
  type MoveTarget,
  type PetBridgeState,
  type PetInteraction,
} from '../shared/desktop-api.ts'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getState),
  setDrawerOpen: (open: boolean) => ipcRenderer.invoke(DESKTOP_CHANNELS.setDrawerOpen, open),
  setLocked: (locked: boolean) => ipcRenderer.invoke(DESKTOP_CHANNELS.setLocked, locked),
  setWebDshUrl: (url: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.setWebDshUrl, url),
  beginDrag: () => ipcRenderer.invoke(DESKTOP_CHANNELS.beginDrag),
  endDrag: () => ipcRenderer.invoke(DESKTOP_CHANNELS.endDrag),
  moveTo: (target: MoveTarget) => ipcRenderer.invoke(DESKTOP_CHANNELS.moveTo, target),
  hide: () => ipcRenderer.invoke(DESKTOP_CHANNELS.hide),
  openDshWeb: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openDshWeb),
  getPetState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getPetState),
  getPixelModels: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getPixelModels),
  selectPixelModel: (modelId: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.selectPixelModel, modelId),
  importPixelModel: () => ipcRenderer.invoke(DESKTOP_CHANNELS.importPixelModel),
  renamePixelModel: (name: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.renamePixelModel, name),
  interact: (kind: PetInteraction) => ipcRenderer.invoke(DESKTOP_CHANNELS.interact, kind),
  onStateChanged(listener: (state: DesktopState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState): void => listener(state)
    ipcRenderer.on(DESKTOP_CHANNELS.stateChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.stateChanged, handler)
  },
  onPetStateChanged(listener: (state: PetBridgeState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: PetBridgeState): void => listener(state)
    ipcRenderer.on(DESKTOP_CHANNELS.petStateChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.petStateChanged, handler)
  },
}

contextBridge.exposeInMainWorld('petDesktop', api)
