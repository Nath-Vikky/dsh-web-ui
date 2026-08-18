/** @vitest-environment jsdom */

/**
 * The pet settings section contract: the 'settings.section' wrapper mounts the
 * card as a first-level settings page. The card is always open; the plugin
 * master keeps inherited tri-state semantics while desktop launch uses a
 * dedicated binary switch staged into the same save flow.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the card chain needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))
import { PetSettingsSection, PetSettingsCardController, type PetSettingsSectionProps, type PetSettings } from '../src/client/PetSettingsCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** English translate stub (same shape the sibling settings-card tests use). */
const t: PetSettingsSectionProps['t'] = (key) => {
  return (en as Record<string, string>)[key] ?? key
}

/** Minimal in-memory scope backing the card controller. */
class FakeScope implements SettingsScope<PetSettings> {
  value: PetSettings
  base: PetSettings
  user: Partial<PetSettings> = {}
  writable = true
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => {
    (this.user as Record<string, unknown>)[field] = value
    this.reflect()
  })
  unset = vi.fn(async (field: string) => {
    delete (this.user as Record<string, unknown>)[field]
    this.reflect()
  })
  constructor(value: PetSettings) {
    this.value = value
    this.base = value
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot(): SettingsScopeSnapshot<PetSettings> {
    return {
      status: 'ready',
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
    for (const listener of this.listeners) listener()
  }
}

/** Bind the controller's face into the section's prop shape (mirrors the slot renderer). */
function sectionProps(scope: SettingsScope<PetSettings>) {
  const controller = new PetSettingsCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const usePetSettingsCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.petSettingsCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.petSettingsCard.subscribe,
      () => selector(hooks.petSettingsCard.getSnapshot()),
    )
  return { t, usePetSettingsCard, ...actions } as unknown as ComponentProps<typeof PetSettingsSection>
}

describe('PetSettingsSection', () => {
  it('renders the pet settings card open as a first-level settings page', () => {
    render(<PetSettingsSection {...sectionProps(new FakeScope({}))} />)
    const enabled = screen.getByLabelText(/enable the pet/i)
    expect(enabled.id).toBe('settings-pet-enabled')
    const options = Array.from(enabled.querySelectorAll('option')).map(option => option.textContent)
    expect(options).toEqual(['Inherit', 'On', 'Off'])
    const desktop = screen.getByRole('switch', { name: /enable the desktop pet/i })
    expect(desktop.id).toBe('settings-pet-desktop-enabled')
    expect(desktop.getAttribute('aria-checked')).toBe('false')
  })

  it('asks for a mirror and persists desktop enable only after runtime installation succeeds', async () => {
    const runtimeMissing = {
      version: '43.4.0',
      platform: 'win32',
      arch: 'x64',
      phase: 'not-installed',
      installed: false,
      managed: false,
      source: 'official',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/pet/pets') return new Response('[]', { status: 200 })
      if (url === '/api/pet/runtime' && init === undefined) {
        return Response.json(runtimeMissing)
      }
      if (url === '/api/pet/runtime/install') {
        return Response.json({
          ...runtimeMissing,
          phase: 'ready',
          installed: true,
          managed: true,
          source: 'npmmirror',
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const scope = new FakeScope({ desktopEnabled: false })

    render(<PetSettingsSection {...sectionProps(scope)} />)
    await screen.findByText(/desktop runtime is not installed/i)
    fireEvent.click(screen.getByRole('switch', { name: /enable the desktop pet/i }))

    const dialog = await screen.findByRole('dialog', { name: /install the desktop pet runtime/i })
    fireEvent.change(screen.getByLabelText(/download source/i), { target: { value: 'npmmirror' } })
    fireEvent.click(screen.getByRole('button', { name: /download and enable/i }))

    await waitFor(() => {
      expect(scope.set).toHaveBeenCalledWith('desktopEnabled', true)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    const installCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/pet/runtime/install')
    expect(JSON.parse(String(installCall?.[1]?.body))).toEqual({ source: 'npmmirror' })
    expect(dialog).toBeDefined()
  })

  it('shows download progress, supports cancellation, and does not enable early', async () => {
    const runtimeMissing = {
      version: '43.4.0',
      platform: 'win32',
      arch: 'x64',
      phase: 'not-installed',
      installed: false,
      managed: false,
      source: 'official',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/pet/pets') return new Response('[]', { status: 200 })
      if (url === '/api/pet/runtime' && init === undefined) return Response.json(runtimeMissing)
      if (url === '/api/pet/runtime/install') {
        return Response.json({
          ...runtimeMissing,
          phase: 'downloading',
          source: 'official',
          progress: { transferred: 6 * 1024 * 1024, total: 10 * 1024 * 1024, percent: 0.6 },
        })
      }
      if (url === '/api/pet/runtime/cancel') return Response.json(runtimeMissing)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const scope = new FakeScope({ desktopEnabled: false })

    render(<PetSettingsSection {...sectionProps(scope)} />)
    await screen.findByText(/desktop runtime is not installed/i)
    fireEvent.click(screen.getByRole('switch', { name: /enable the desktop pet/i }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /download and enable/i }))

    expect(await screen.findByText('60%')).toBeDefined()
    expect(screen.getByText('6.0 MB / 10.0 MB')).toBeDefined()
    expect(scope.set).not.toHaveBeenCalledWith('desktopEnabled', true)
    fireEvent.click(screen.getByRole('button', { name: /cancel download/i }))

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/pet/runtime/cancel')).toBe(true)
    expect(scope.set).not.toHaveBeenCalledWith('desktopEnabled', true)
  })
})
