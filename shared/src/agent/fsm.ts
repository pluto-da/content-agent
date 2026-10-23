/**
 * 运行状态机（6.3）：唯一合法的状态与转移，表驱动 + 纯函数 transition(state, event) → { state, effects }。
 * 表外转移一律抛 IllegalTransition（界面显示“内部状态异常，已停止，可重试”，不得静默）。
 */
export type RunState = 'idle' | 'planning' | 'running' | 'waiting_user' | 'done' | 'failed' | 'cancelled';
export type RunEventType =
  | 'user_message' | 'plan_ready' | 'answer_ready' | 'need_clarify' | 'step_done' | 'all_steps_done' | 'need_approval'
  | 'approved' | 'answered' | 'rejected' | 'cancel' | 'fatal_error' | 'limit_exceeded' | 'resume' | 'release' | 'offline';
export interface RunEvent { type: RunEventType; pendingId?: string; rejectTo?: 'running' | 'done'; newTopic?: boolean; reason?: string }
export type Effect =
  | 'acquire_lock' | 'create_run' | 'persist' | 'announce_scope' | 'selfcheck' | 'checkpoint' | 'summarize' | 'record_pending' | 'validate_pending'
  | 'void_pending' | 'abort_requests' | 'keep_outputs' | 'failure_message' | 'resume_from_checkpoint' | 'release_lock' | 'drain_queue' | 'tool_result_rejected';
export const TERMINAL: ReadonlySet<RunState> = new Set(['done', 'failed', 'cancelled']);
export const STATE_LABEL: Record<RunState, string> = { idle: '空闲', planning: '正在理解…', running: '执行中', waiting_user: '等你确认', done: '已完成', failed: '没做成', cancelled: '已停止' };

interface Row { from: RunState[]; on: RunEventType; to: RunState | ((e: RunEvent) => RunState); effects: Effect[]; guard?: (e: RunEvent) => string | null }
export const TABLE: Row[] = [
  { from: ['idle'], on: 'user_message', to: 'planning', effects: ['acquire_lock', 'create_run', 'persist'] },
  { from: ['planning'], on: 'plan_ready', to: 'running', effects: ['announce_scope', 'persist'] },
  { from: ['planning'], on: 'answer_ready', to: 'done', effects: ['selfcheck', 'persist'] },
  { from: ['planning'], on: 'need_clarify', to: 'waiting_user', effects: ['record_pending', 'persist'] },
  { from: ['running'], on: 'step_done', to: 'running', effects: ['checkpoint', 'persist'] },
  { from: ['running'], on: 'all_steps_done', to: 'done', effects: ['summarize', 'selfcheck', 'persist'] },
  { from: ['running'], on: 'need_approval', to: 'waiting_user', effects: ['record_pending', 'persist'] },
  { from: ['running'], on: 'need_clarify', to: 'waiting_user', effects: ['record_pending', 'persist'] },
  { from: ['running'], on: 'offline', to: 'waiting_user', effects: ['record_pending', 'persist'] },
  { from: ['waiting_user'], on: 'approved', to: 'running', effects: ['validate_pending', 'persist'], guard: (e) => (e.pendingId ? null : '缺少待办 id') },
  { from: ['waiting_user'], on: 'answered', to: 'running', effects: ['validate_pending', 'persist'], guard: (e) => (e.pendingId ? null : '缺少待办 id') },
  { from: ['waiting_user'], on: 'rejected', to: (e) => e.rejectTo ?? 'running', effects: ['tool_result_rejected', 'persist'] },
  { from: ['waiting_user'], on: 'user_message', to: 'planning', effects: ['void_pending', 'persist'] },
  { from: ['planning', 'running', 'waiting_user'], on: 'cancel', to: 'cancelled', effects: ['abort_requests', 'keep_outputs', 'persist'] },
  { from: ['planning', 'running'], on: 'fatal_error', to: 'failed', effects: ['failure_message', 'persist'] },
  { from: ['planning', 'running'], on: 'limit_exceeded', to: 'failed', effects: ['failure_message', 'persist'] },
  { from: ['failed', 'cancelled'], on: 'resume', to: 'running', effects: ['resume_from_checkpoint', 'persist'] },
  { from: ['done', 'failed', 'cancelled'], on: 'release', to: 'idle', effects: ['release_lock', 'drain_queue'] },
];

export class IllegalTransition extends Error {
  constructor(public from: RunState, public event: RunEventType, why = '表外转移') { super(`非法状态转移：${from} --${event}--> ？（${why}）`); this.name = 'IllegalTransition'; }
}
export function transition(state: RunState, event: RunEvent): { state: RunState; effects: Effect[] } {
  const row = TABLE.find((r) => r.on === event.type && r.from.includes(state));
  if (!row) throw new IllegalTransition(state, event.type);
  const why = row.guard?.(event);
  if (why) throw new IllegalTransition(state, event.type, why);
  return { state: typeof row.to === 'function' ? row.to(event) : row.to, effects: [...row.effects] };
}
export function canTransition(state: RunState, type: RunEventType): boolean { return TABLE.some((r) => r.on === type && r.from.includes(state)); }
/** 所有合法（from, event）对：单测逐条覆盖用。 */
export function legalPairs(): { from: RunState; on: RunEventType }[] { return TABLE.flatMap((r) => r.from.map((from) => ({ from, on: r.on }))); }
export const ALL_STATES: RunState[] = ['idle', 'planning', 'running', 'waiting_user', 'done', 'failed', 'cancelled'];
export const ALL_EVENTS: RunEventType[] = ['user_message', 'plan_ready', 'answer_ready', 'need_clarify', 'step_done', 'all_steps_done', 'need_approval', 'approved', 'answered', 'rejected', 'cancel', 'fatal_error', 'limit_exceeded', 'resume', 'release', 'offline'];

/** 看门狗（6.3）：非终态超过上限 → limit_exceeded。返回超时原因或 null。 */
export function watchdog(state: RunState, enteredAt: number, now: number, runStartedAt: number, waitingMs: number, lim: { planningMs: number; runMs: number }): string | null {
  if (state === 'planning' && now - enteredAt > lim.planningMs) return `理解与规划超过 ${Math.round(lim.planningMs / 1000)} 秒`;
  if ((state === 'running' || state === 'planning') && now - runStartedAt - waitingMs > lim.runMs) return `整轮超过 ${Math.round(lim.runMs / 60000)} 分钟`;
  return null;
}
