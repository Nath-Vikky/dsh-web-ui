/**
 * dsh-pet locale dictionaries (zh/en).
 * @module @linxin666/dsh-pet/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'pet'

/** Chinese copy. */
export const zh = {
  'settings.title': '宠物',
  'settings.description': '管理随 DSH 运行的桌面宠物。模型和对应名字请在桌宠面板中管理。',
  'settings.enabled': '启动桌面宠物',
  'settings.enabledHint': '随 DeepSeek Harness 启动或关闭桌面宠物进程。',
  'settings.visible': '显示桌面宠物',
  'settings.visibleHint': '隐藏后仍可从系统托盘恢复显示。',
  'settings.alwaysOnTop': '窗口置顶',
  'settings.alwaysOnTopHint': '让桌面宠物保持在普通窗口上方。',
  'settings.locked': '锁定位置',
  'settings.lockedHint': '锁定后禁止拖动桌面宠物。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.notExposed': '当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或为 dsh-host-apiproxy 的 WEB_SETTINGS_NAMESPACES 白名单补充本命名空间后重启。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',
  'settings.invalidNumber': '请输入数字，留空则使用默认值。',
} as const

/** English copy. */
export const en = {
  'settings.title': 'Pet',
  'settings.description': 'Manage the desktop pet that runs with DSH. Choose models and per-model names from the pet panel.',
  'settings.enabled': 'Launch desktop pet',
  'settings.enabledHint': 'Start and stop the desktop pet process with DeepSeek Harness.',
  'settings.visible': 'Show desktop pet',
  'settings.visibleHint': 'When hidden, the pet can still be restored from the system tray.',
  'settings.alwaysOnTop': 'Always on top',
  'settings.alwaysOnTopHint': 'Keep the desktop pet above ordinary windows.',
  'settings.locked': 'Lock position',
  'settings.lockedHint': 'Prevent the desktop pet from being dragged.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset to default',
  'settings.notExposed': 'This DSH version does not expose this plugin\'s settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to dsh-host-apiproxy\'s WEB_SETTINGS_NAMESPACES allowlist and restart.',
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving\u2026',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
} as const

/** Key union for this namespace. */
export type PetKey = keyof typeof zh

/** The settings-card slice of the pet dictionary. */
export type SettingsCardKey = PetKey

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-pet UI copy. */
    pet: PetKey
  }
}
