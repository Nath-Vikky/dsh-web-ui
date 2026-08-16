const PARENT_ARGUMENT = '--dsh-parent-pid='
const PARENT_ACTION_ARGUMENT = '--dsh-parent-action='

export type ManagedParentAction = 'add' | 'remove'

export function managedParentPid(arguments_: readonly string[], ownPid = process.pid): number | undefined {
  for (const argument of arguments_) {
    if (!argument.startsWith(PARENT_ARGUMENT)) continue
    const value = Number(argument.slice(PARENT_ARGUMENT.length))
    if (Number.isSafeInteger(value) && value > 0 && value <= 0x7fff_ffff && value !== ownPid) return value
  }
  return undefined
}

export function managedParentFromData(value: unknown, ownPid = process.pid): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const pid = Reflect.get(value, 'dshParentPid')
  return typeof pid === 'number'
    ? managedParentPid([`${PARENT_ARGUMENT}${pid}`], ownPid)
    : undefined
}

export function managedParentAction(arguments_: readonly string[]): ManagedParentAction {
  return arguments_.includes(`${PARENT_ACTION_ARGUMENT}remove`) ? 'remove' : 'add'
}

export function managedParentActionFromData(value: unknown): ManagedParentAction {
  if (typeof value !== 'object' || value === null) return 'add'
  return Reflect.get(value, 'dshParentAction') === 'remove' ? 'remove' : 'add'
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}
