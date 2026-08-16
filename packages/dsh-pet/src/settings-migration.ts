import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'

const LEGACY_WEB_SETTING_KEYS = ['size', 'right', 'bottom', 'name'] as const

/** Remove fields that only configured the retired in-page pet. */
export function legacyWebSettingOps(user: unknown): SettingsPathOp[] {
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return []
  return LEGACY_WEB_SETTING_KEYS
    .filter(key => Object.hasOwn(user, key))
    .map(key => ({ op: 'unset', path: [key] }))
}
