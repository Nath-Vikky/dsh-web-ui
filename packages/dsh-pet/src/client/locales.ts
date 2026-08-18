/**
 * dsh-pet locale dictionaries (zh/en).
 * @module @linxin666/dsh-pet/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'pet'

/** Chinese copy. */
export const zh = {
  'pet.feed': '喂食',
  'pet.hide': '隐藏',
  'pet.rename': '改名',
  'pet.confirm': '确定',
  'pet.namePlaceholder': '输入新名字',
  'pet.summon': '召唤{name}',
  'pet.rank': '亲密度 {rank}',
  'pet.points': '{points} 点',
  'pet.treats': '小鱼干 ×{n}',
  'pet.state.loading': '宠物正在赶来…',
  'pet.state.error': '宠物迷路了（连接失败）',
  'pet.openSessionHint': '点击跳转到对应会话',
  // 一级设置页（settings.section 席位）。
  'settings.title': '宠物',
  'settings.description': '选择宠物，并分别控制网页与桌面端显示。',
  'settings.pet': '宠物',
  'settings.petHint': '选择显示哪只宠物；每只宠物独立命名，可在宠物悬浮面板改名。',
  'settings.enabled': '启用宠物',
  'settings.enabledHint': '关闭后隐藏宠物并停止轮询，可在设置里重新启用。',
  'settings.visible': '显示网页宠物',
  'settings.visibleHint': '只控制浏览器里的浮动宠物，可从聊天输入区重新召唤。',
  'settings.desktopEnabled': '启用桌面宠物',
  'settings.desktopEnabledHint': '首次启用会先确认并下载桌面运行环境；以后随当前 DSH Host 启动或关闭。',
  'settings.runtimeReady': '桌面运行环境 {version} 已就绪',
  'settings.runtimeMissing': '尚未安装桌面运行环境',
  'settings.runtimeUnsupported': '当前系统或架构暂不支持桌面运行环境',
  'settings.runtimeInstallAction': '安装桌面运行环境',
  'settings.runtimeDialogTitle': '安装桌面宠物运行环境',
  'settings.runtimeDialogDescription': '需要额外下载 Electron {version}。下载成功并通过 SHA-256 校验后，桌面宠物才会启用。',
  'settings.runtimeSource': '下载源',
  'settings.runtimeSourceOfficial': 'Electron 官方源（GitHub）',
  'settings.runtimeSourceNpmmirror': 'npmmirror 国内镜像',
  'settings.runtimeSourceCustom': '自定义镜像',
  'settings.runtimeCustomMirror': '自定义镜像地址',
  'settings.runtimeDownloading': '正在下载',
  'settings.runtimeInstalling': '正在解压并校验',
  'settings.runtimeInstallingHint': '此阶段取决于磁盘和安全软件速度，可能需要几分钟；刷新后会自动接续当前安装。',
  'settings.runtimeSecurity': '无论选择哪个镜像，插件都会使用内置的 Electron 官方 SHA-256 哈希；下载文件不匹配时不会安装。',
  'settings.runtimeCancel': '取消',
  'settings.runtimeCancelDownload': '取消下载',
  'settings.runtimeDownloadAction': '下载并启用',
  'settings.runtimeRetry': '更换下载源并重试',
  'settings.runtimeErrorBusy': '另一个 DSH 进程正在安装运行环境，请稍后重试。',
  'settings.runtimeErrorChecksum': '文件校验失败，已拒绝安装。请切换下载源后重试。',
  'settings.runtimeErrorMirror': '镜像地址无效，请输入完整的 HTTPS 地址。',
  'settings.runtimeErrorInsecureMirror': '远程镜像必须使用 HTTPS；仅本机回环地址允许 HTTP。',
  'settings.runtimeErrorDownload': '下载失败，请检查网络、代理或切换下载源后重试。',
  'settings.runtimeErrorInstall': '运行环境安装失败，请确认 DSH 数据目录可写后重试。',
  'settings.runtimeErrorEnable': '运行环境已安装，但桌面宠物开关保存失败，请重试。',
  'settings.size': '大小（px）',
  'settings.sizeHint': '精灵单元高度，范围 32–512。',
  'settings.right': '距右侧（px）',
  'settings.rightHint': '距视口右边缘的水平内缩距离。',
  'settings.bottom': '距底部（px）',
  'settings.bottomHint': '距视口底边的垂直内缩距离。',
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
  'pet.feed': 'Feed',
  'pet.hide': 'Hide',
  'pet.rename': 'Rename',
  'pet.confirm': 'OK',
  'pet.namePlaceholder': 'Enter a new name',
  'pet.summon': 'Summon {name}',
  'pet.rank': 'Affinity {rank}',
  'pet.points': '{points} pts',
  'pet.treats': 'Treats ×{n}',
  'pet.state.loading': 'The pet is on its way…',
  'pet.state.error': 'The pet is lost (connection failed)',
  'pet.openSessionHint': 'Click to jump to this session',
  // First-level settings section (the `settings.section` seat).
  'settings.title': 'Pet',
  'settings.description': 'Pick a pet and control its web and desktop presentations independently.',
  'settings.pet': 'Pet',
  'settings.petHint': 'Choose which pet shows. Names are stored per pet; rename from the pet hover panel.',
  'settings.enabled': 'Enable the pet',
  'settings.enabledHint': 'When off, the pet hides and polling stops; re-enable it here.',
  'settings.visible': 'Show the web pet',
  'settings.visibleHint': 'Controls only the floating browser pet; summon it again from the input row.',
  'settings.desktopEnabled': 'Enable the desktop pet',
  'settings.desktopEnabledHint': 'The first enable asks before downloading the desktop runtime; later it starts and stops with this DSH Host.',
  'settings.runtimeReady': 'Desktop runtime {version} is ready',
  'settings.runtimeMissing': 'Desktop runtime is not installed',
  'settings.runtimeUnsupported': 'The desktop runtime does not support this system or architecture yet',
  'settings.runtimeInstallAction': 'Install desktop runtime',
  'settings.runtimeDialogTitle': 'Install the desktop pet runtime',
  'settings.runtimeDialogDescription': 'Electron {version} must be downloaded separately. The desktop pet is enabled only after the download passes SHA-256 verification.',
  'settings.runtimeSource': 'Download source',
  'settings.runtimeSourceOfficial': 'Official Electron source (GitHub)',
  'settings.runtimeSourceNpmmirror': 'npmmirror mirror',
  'settings.runtimeSourceCustom': 'Custom mirror',
  'settings.runtimeCustomMirror': 'Custom mirror URL',
  'settings.runtimeDownloading': 'Downloading',
  'settings.runtimeInstalling': 'Extracting and verifying',
  'settings.runtimeInstallingHint': 'This can take a few minutes depending on disk and security software speed. Refreshing reconnects to the current install.',
  'settings.runtimeSecurity': 'Every mirror is checked against the bundled official SHA-256 hash. A mismatched file is never installed.',
  'settings.runtimeCancel': 'Cancel',
  'settings.runtimeCancelDownload': 'Cancel download',
  'settings.runtimeDownloadAction': 'Download and enable',
  'settings.runtimeRetry': 'Change source and retry',
  'settings.runtimeErrorBusy': 'Another DSH process is installing the runtime. Try again shortly.',
  'settings.runtimeErrorChecksum': 'File verification failed and installation was rejected. Change the source and retry.',
  'settings.runtimeErrorMirror': 'The mirror URL is invalid. Enter a complete HTTPS URL.',
  'settings.runtimeErrorInsecureMirror': 'Remote mirrors must use HTTPS; HTTP is accepted only for a local loopback address.',
  'settings.runtimeErrorDownload': 'Download failed. Check the network or proxy, or change the source and retry.',
  'settings.runtimeErrorInstall': 'Runtime installation failed. Check that the DSH data directory is writable and retry.',
  'settings.runtimeErrorEnable': 'The runtime is installed, but saving the desktop-pet switch failed. Please retry.',
  'settings.size': 'Size (px)',
  'settings.sizeHint': 'Sprite cell height, 32\u2013512.',
  'settings.right': 'Right inset (px)',
  'settings.rightHint': 'Horizontal inset from the viewport right edge.',
  'settings.bottom': 'Bottom inset (px)',
  'settings.bottomHint': 'Vertical inset from the viewport bottom edge.',
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

/**
 * Active dictionary, picked by the document language at call time. The pet
 * mounts as a global floating surface (not a session-scoped slot), so it has
 * no framework locale seat and resolves its copy the same tiny way the
 * task-board's DOM-injected surface does.
 */
export function dictionary(): Record<PetKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/**
 * Translate a key with optional `{name}` template params. Mirrors the slot
 * `Translate` contract `(key, params?) => string` so it can be handed to the
 * same components that used to receive the framework-injected `t` seat. The
 * key is typed loosely (`string`) so the function is assignable to the slot's
 * `TranslateNS<'pet'>` (whose key domain also spans the shared common
 * vocabulary); a missing key degrades to the key itself rather than throwing.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  let text: string = (dictionary() as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-pet UI copy. */
    pet: PetKey
  }
}
