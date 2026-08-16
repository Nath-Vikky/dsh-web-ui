import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Stable settings handle whose backing transport can follow an optional
 * compatibility service without rebuilding every consumer of the namespace.
 */
export class AdaptiveSettingsScope<T> implements SettingsScope<T> {
  private readonly listeners = new Set<() => void>()
  private unsubscribeSource: () => void
  private disposed = false

  constructor(private source: SettingsScope<T>) {
    this.unsubscribeSource = source.subscribe(this.publish)
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.source.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(field: string, value: unknown): Promise<void> {
    return this.source.set(field, value)
  }

  unset(field: string): Promise<void> {
    return this.source.unset(field)
  }

  /** Switch transport and publish its current snapshot to every consumer. */
  replace(source: SettingsScope<T>): void {
    if (this.source === source) return
    this.unsubscribeSource()
    this.source = source
    this.unsubscribeSource = this.disposed
      ? () => undefined
      : source.subscribe(this.publish)
    if (!this.disposed) this.publish()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeSource()
    this.unsubscribeSource = () => undefined
    this.listeners.clear()
  }

  private readonly publish = (): void => {
    for (const listener of this.listeners) listener()
  }
}
