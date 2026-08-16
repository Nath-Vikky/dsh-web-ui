/**
 * Desktop companion settings bound to the `pet` namespace registered by the
 * Host plugin. The browser page only renders this card; the pet runs in its
 * own Electron window.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The pet's settings fields this card edits (the namespace's full schema). */
export interface PetSettings {
  /** Launch the desktop companion with DSH. */
  enabled?: boolean
  /** Whether the desktop window is visible. */
  visible?: boolean
  /** Keep the desktop window above ordinary windows. */
  alwaysOnTop?: boolean
  /** Prevent dragging the desktop window. */
  locked?: boolean
}

/** What the pet settings card renders. */
export interface PetSettingsCardState extends CardShell {
  /** Desktop companion lifecycle switch. */
  enabled: CardFieldState
  /** Desktop window visibility. */
  visible: CardFieldState
  /** Always-on-top preference. */
  alwaysOnTop: CardFieldState
  /** Position-lock preference. */
  locked: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface PetSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as usePetSettingsCard. */
    petSettingsCard: SnapshotStore<PetSettingsCardState>
  }
}

/** Bridges the `pet` scope onto the card's staged form. */
export class PetSettingsCardController {
  private readonly form: CardForm<PetSettings>
  private readonly store: SnapshotStore<PetSettingsCardState>

  /** @param scope - the bound settings scope for the `pet` namespace. */
  constructor(scope: SettingsScope<PetSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('visible'),
      booleanField('alwaysOnTop'),
      booleanField('locked'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): PetSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      visible: this.form.field('visible'),
      alwaysOnTop: this.form.field('alwaysOnTop'),
      locked: this.form.field('locked'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): PetSettingsCardFace {
    return { hooks: { petSettingsCard: this.store }, ...this.form.actions() }
  }

}

/** Props the renderer binds for the pet settings card. */
export type PetSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'pet'>
  & InjectFace<PetSettingsCardFace>

/**
 * Render the pet settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function PetSettingsCard(props: PetSettingsCardProps) {
  const { t } = props
  const state = props.usePetSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-pet-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <BooleanField
        id="settings-pet-visible"
        label={t('settings.visible')}
        hint={t('settings.visibleHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.visible}
        onEdit={(text) => { props.edit('visible', text) }}
        onReset={() => { props.resetField('visible') }}
      />
      <BooleanField
        id="settings-pet-always-on-top"
        label={t('settings.alwaysOnTop')}
        hint={t('settings.alwaysOnTopHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.alwaysOnTop}
        onEdit={(text) => { props.edit('alwaysOnTop', text) }}
        onReset={() => { props.resetField('alwaysOnTop') }}
      />
      <BooleanField
        id="settings-pet-locked"
        label={t('settings.locked')}
        hint={t('settings.lockedHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.locked}
        onEdit={(text) => { props.edit('locked', text) }}
        onReset={() => { props.resetField('locked') }}
      />
    </PluginSettingsCard>
  )
}
