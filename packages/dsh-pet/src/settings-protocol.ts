/**
 * Same-origin settings bridge used only when the official Web settings scope
 * does not expose the third-party `pet` namespace.
 */

/** Route prefix owned by dsh-pet. */
export const PET_SETTINGS_BRIDGE_PREFIX = '/api/pet/settings'

/** Settings fields the desktop companion exposes in the Web settings card. */
export type PetSettingsField = 'enabled' | 'visible' | 'alwaysOnTop' | 'locked'

/** One top-level settings edit. */
export type PetSettingsBridgeOp =
  | { op: 'set'; path: [PetSettingsField]; value: boolean }
  | { op: 'unset'; path: [PetSettingsField] }

/** Host settings descriptor projected onto the browser-safe wire shape. */
export interface PetSettingsBridgeView {
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
  writable: boolean
}

/** Request accepted by the mutate endpoint. */
export interface PetSettingsBridgeMutateRequest {
  ops: PetSettingsBridgeOp[]
  expectedRevision?: number
}

/** Shared bridge result envelope. */
export type PetSettingsBridgeResult =
  | { ok: true; value: PetSettingsBridgeView }
  | { ok: false; code: string; message: string }
