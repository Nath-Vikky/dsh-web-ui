/**
 * dsh-pet browser half — exposes only the desktop companion settings card.
 * The pet itself runs in Electron; no floating pet, summon button, sprite
 * renderer, or state transport is mounted into the DSH web page.
 * @module @linxin666/dsh-pet/client
 */

import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AdaptiveSettingsScope } from './adaptive-settings-scope.ts'
import { loopbackSettingsFetch, StandalonePetSettingsScope } from './fallback-settings-scope.ts'
import { PetSettingsCard, PetSettingsCardController, type PetSettings } from './PetSettingsCard.tsx'
import { NS, en, zh } from './locales.ts'

/** Settings namespace the pet settings card edits (the Host plugin registers it). */
const PET_SETTINGS_NS = 'pet'

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Re-exported for consumers that type against the injected face. */
export type { PetSettingsCardFace, PetSettingsCardState } from './PetSettingsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
    /**
     * Standalone fallback seat rendered directly by the built-in plugin
     * settings section when the Web UI plugin group is not installed.
     */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the group card supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}


/**
 * Client plugin body: register dictionaries and seat the desktop companion
 * settings card in the Web UI plugin group or the built-in plugin list for
 * standalone installs.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pet: dictionaries')

  const settingsSpec = { namespace: PET_SETTINGS_NS }
  const officialSettingsScope = ctx.settingsScope.bind<PetSettings>(settingsSpec)
  const standaloneSettingsScope = new StandalonePetSettingsScope(officialSettingsScope, loopbackSettingsFetch())
  const settingsScope = new AdaptiveSettingsScope(standaloneSettingsScope)
  ctx.effect(() => () => {
    settingsScope.dispose()
    standaloneSettingsScope.dispose()
  }, 'pet: adaptive settings scope')
  ctx.inject(['webUiSettings'], (settingsCtx) => {
    const compatibilityBinder = settingsCtx.get('webUiSettings')
    if (compatibilityBinder === undefined) return
    const compatibilityScope = compatibilityBinder.bind<PetSettings>(settingsSpec)
    settingsCtx.effect(() => {
      settingsScope.replace(compatibilityScope)
      return () => { settingsScope.replace(standaloneSettingsScope) }
    }, 'pet: compatibility settings scope')
  })
  // Plugin configuration card: one staged form over the `pet` settings
  // namespace. Keep a top-level fallback while the aggregate child slot is
  // absent, then move the same controller into that group if it appears later.
  // This follows declaration lifetime instead of assuming plugin boot order.
  const petSettings = new PetSettingsCardController(settingsScope)
  let topLevelAvailable = false
  let topLevelRegistration: (() => void) | undefined
  let groupedRegistration: (() => void) | undefined
  const clearTopLevel = (): void => {
    topLevelRegistration?.()
    topLevelRegistration = undefined
  }
  const registerTopLevel = (): void => {
    if (!topLevelAvailable || groupedRegistration !== undefined || topLevelRegistration !== undefined) return
    topLevelRegistration = ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'pet-settings',
      order: 140,
      locale: NS,
      inject: () => petSettings.inject(),
    }, PetSettingsCard)
  }
  ctx.slots.inject('web-ui.plugin.item', () => {
    clearTopLevel()
    groupedRegistration = ctx.slots.register({
      name: 'web-ui.plugin.item',
      id: 'pet-settings',
      order: 140,
      locale: NS,
      inject: () => petSettings.inject(),
    }, PetSettingsCard)
    return () => {
      groupedRegistration?.()
      groupedRegistration = undefined
      registerTopLevel()
    }
  })
  ctx.slots.inject('settings.plugin.item', () => {
    topLevelAvailable = true
    registerTopLevel()
    return () => {
      topLevelAvailable = false
      clearTopLevel()
    }
  })
}
