/** Minimal deterministic narration layer; richer cooldown rules arrive later. */

import type { PetAggregateSnapshot, PetTaskSnapshot } from './protocol.ts'

function phaseFallback(task: PetTaskSnapshot): string | undefined {
  switch (task.phase) {
    case 'waiting': return '正在等待响应'
    case 'thinking': return '正在思考'
    case 'tool': return task.tool === undefined ? '正在使用工具' : `正在使用 ${task.tool.name}`
    case 'review': return '正在整理回复'
    case 'waiting_input': return '正在等你确认'
    case 'done': return '完成啦'
    case 'failed': return '任务遇到问题了'
    case 'idle': return undefined
  }
}

/** Resolve the primary task's safe line without inventing progress. */
export function narrateActivity(snapshot: PetAggregateSnapshot): string | undefined {
  const primary = snapshot.tasks.find(task => task.taskId === snapshot.primaryTaskId)
  if (primary === undefined) return undefined
  return primary.narration ?? primary.statusLine ?? phaseFallback(primary)
}
