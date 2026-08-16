import { describe, expect, it } from 'vitest'

import {
  managedParentAction,
  managedParentActionFromData,
  managedParentFromData,
  managedParentPid,
} from './managed-parent.ts'

describe('managed desktop parent argument', () => {
  it('accepts a distinct positive Harness process id', () => {
    expect(managedParentPid(['electron', '--dsh-parent-pid=4200'], 100)).toBe(4200)
  })

  it('rejects malformed, unsafe and self-referential ids', () => {
    expect(managedParentPid(['--dsh-parent-pid=abc'], 100)).toBeUndefined()
    expect(managedParentPid(['--dsh-parent-pid=-1'], 100)).toBeUndefined()
    expect(managedParentPid(['--dsh-parent-pid=100'], 100)).toBeUndefined()
  })

  it('validates Electron single-instance metadata as untrusted input', () => {
    expect(managedParentFromData({ dshParentPid: 4200 }, 100)).toBe(4200)
    expect(managedParentFromData({ dshParentPid: '4200' }, 100)).toBeUndefined()
    expect(managedParentFromData(null, 100)).toBeUndefined()
  })

  it('accepts only the explicit remove lifecycle action', () => {
    expect(managedParentAction(['--dsh-parent-action=remove'])).toBe('remove')
    expect(managedParentAction(['--dsh-parent-action=unknown'])).toBe('add')
    expect(managedParentActionFromData({ dshParentAction: 'remove' })).toBe('remove')
    expect(managedParentActionFromData({ dshParentAction: 'unknown' })).toBe('add')
  })
})
