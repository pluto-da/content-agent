/**
 * 1.3.0 临时会话（第七部分；小米王川公开描述的“用 @ 集结，用 √ 解散”，见 refs-v1.3 X5）。
 * 低成本、即用即走：六种情形自动拉群 → 推荐 ≤5 个成员并附上下文 → 自由讨论（每条要有论点或证据）
 * → 目标达成打 √ / 达到上限 / TTL 到期自动解散 → 小结（结论、待办转工单、未决事项升级或转会议室）。
 * 会话不赋予任何新权限：成员动作仍按各自权限与 DOA 判定（见 doa.ts）。
 */
import { findSecrets, redact } from '../core/redact.js';
import { terms } from './context.js';
import type { Org } from './org.js';

export const SESSION_TRIGGERS = ['multi_dept', 'ticket_rejected', 'review_returned', 'okr_conflict', 'beyond_capability', 'chairman_request'] as const;
export type SessionTrigger = typeof SESSION_TRIGGERS[number];
export const TRIGGER_TEXT: Record<SessionTrigger, string> = { multi_dept: '需要两个以上部门的视角', ticket_rejected: '工单被拒绝或超时', review_returned: '审核退回', okr_conflict: '上下文流中发现 OKR 冲突', beyond_capability: '超出本部门能力（向上申请拉群）', chairman_request: '董事长说“拉个群”' };
export interface SessionLimits { maxMembers: number; maxTurns: number; budgetYuan: number; ttlMs: number; maxAlive: number }
export const SESSION_DEFAULTS: SessionLimits = { maxMembers: 5, maxTurns: 10, budgetYuan: 0.2, ttlMs: 30 * 60 * 1000, maxAlive: 5 };

export interface SessionMsg { from: string; text: string; evidence: string[]; cost: number; at: string; kind: 'msg' | 'chairman' | 'system' }
export interface SessionOutcome { conclusions: string[]; todos: { title: string; owner: string }[]; open: string[]; next: 'none' | 'escalate' | 'meeting' }
export type SessionStatus = 'queued' | 'open' | 'dissolved';
export type CloseReason = 'goal' | 'turns' | 'budget' | 'ttl' | 'chairman' | 'escalated';
export interface TempSession {
  id: string; topic: string; goal: string; initiator: string; members: string[]; context_refs: string[]; budget: number; ttl: number; max_turns: number;
  status: SessionStatus; outcome: SessionOutcome | null; trigger: SessionTrigger; messages: SessionMsg[]; spent: number; createdAt: number; openedAt: number | null; closedAt: number | null; closeReason: CloseReason | null;
}

/** 按议题推荐成员（≤5）：部门名称 / 职责 / 平台与议题的词重合度。 */
export function recommendMembers(topic: string, org: Org, initiator: string, max = SESSION_DEFAULTS.maxMembers): string[] {
  const q = terms(topic);
  const scored = org.depts.filter((d) => d.status === 'active' && d.kind !== 'pending').map((d) => {
    const t = terms(`${d.name} ${d.duties.join(' ')} ${d.platforms.join(' ')}`);
    let s = 0; for (const w of q) if (t.has(w)) s++;
    if (/冲突|对齐|KR|OKR/i.test(topic) && d.id === 'data-center') s += 2;
    if (/合规|违规|广告法|边界|标识/.test(topic) && d.id === 'legal') s += 2;
    if (/花|预算|费用|成本/.test(topic) && d.id === 'finance') s += 2;
    return { id: d.head, s };
  }).filter((x) => x.s > 0 && x.id !== initiator).sort((a, b) => b.s - a.s).map((x) => x.id);
  return [initiator, ...scored].slice(0, max);
}

/** 董事长在对话中说“拉个群讨论 X / 叫上 X 和 Y 商量一下”。 */
export function parseChairmanPull(text: string, org: Org): { topic: string; members: string[] } | null {
  const t = text.trim();
  const m1 = /^(?:帮我)?拉(?:个|一个)?群(?:讨论|聊聊|商量)?\s*[:：]?\s*(.+)$/.exec(t);
  const m2 = /^叫上\s*(.+?)\s*(?:一起)?(?:商量|讨论|聊)(?:一下)?\s*[:：]?\s*(.*)$/.exec(t);
  if (!m1 && !m2) return null;
  const names = m2 ? m2[1]!.split(/[、和与及,，\s]+/).filter(Boolean) : [];
  const members = names.map((n) => org.depts.find((d) => d.name === n || d.name.includes(n) || n.includes(d.name.replace(/部$|事业部$|中心$/, '')))?.head).filter((x): x is string => !!x);
  const topic = (m1 ? m1[1]! : m2![2] || names.join('、')).trim() || '临时讨论';
  return { topic, members };
}

export function openSession(list: TempSession[], input: { topic: string; goal?: string; initiator: string; members: string[]; trigger: SessionTrigger; context_refs?: string[]; limits?: Partial<SessionLimits>; now?: number; id?: string }): { list: TempSession[]; session: TempSession } {
  const L = { ...SESSION_DEFAULTS, ...input.limits };
  const now = input.now ?? Date.now();
  const alive = list.filter((s) => s.status === 'open').length;
  const members = [...new Set([input.initiator, ...input.members])].slice(0, L.maxMembers);
  const s: TempSession = {
    id: input.id ?? `ts-${now.toString(36)}-${list.length}`, topic: redact(input.topic).slice(0, 120), goal: redact(input.goal ?? `就“${input.topic}”达成一致`).slice(0, 200), initiator: input.initiator, members, context_refs: input.context_refs ?? [],
    budget: L.budgetYuan, ttl: L.ttlMs, max_turns: L.maxTurns, status: alive >= L.maxAlive ? 'queued' : 'open', outcome: null, trigger: input.trigger, messages: [], spent: 0, createdAt: now, openedAt: alive >= L.maxAlive ? null : now, closedAt: null, closeReason: null,
  };
  return { list: [...list, s], session: s };
}
/** 排队中的会话在有空位时开启。 */
export function promoteQueued(list: TempSession[], now = Date.now(), maxAlive = SESSION_DEFAULTS.maxAlive): TempSession[] {
  let alive = list.filter((s) => s.status === 'open').length;
  return list.map((s) => (s.status === 'queued' && alive < maxAlive ? (alive++, { ...s, status: 'open' as const, openedAt: now }) : s));
}

/** 每条发言须有论点或证据：太短 / 纯附和 / 纯客套被拒。 */
const FILLER = /^(好的?|收到|同意|赞同|没问题|ok|嗯+|是的|对的?|\+1|👍)[。！!.\s]*$/i;
export function hasArgument(text: string, evidence: string[] = []): boolean {
  const t = text.trim();
  if (evidence.length) return t.length >= 4;
  if (FILLER.test(t) || t.length < 8) return false;
  return /因为|所以|建议|数据|证据|来源|风险|如果|但是|否则|我认为|结论|应该|可以|不能|需要|because|suggest|data|risk|should/i.test(t) || t.length >= 24;
}
/** 语义相似度（字二元组 Jaccard）。 */
export function similarity(a: string, b: string): number {
  const A = terms(a), B = terms(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export const DUP_THRESHOLD = 0.8;

export type PostResult = { ok: true; session: TempSession } | { ok: false; reason: 'not_member' | 'closed' | 'no_argument' | 'duplicate' | 'secret'; text: string; session: TempSession };
export function postMessage(s: TempSession, m: { from: string; text: string; evidence?: string[]; cost?: number; now?: number }): PostResult {
  const now = m.now ?? Date.now();
  const isChair = m.from === 'chairman';
  if (s.status !== 'open') return { ok: false, reason: 'closed', text: '会话已解散或排队中', session: s };
  if (!isChair && !s.members.includes(m.from)) return { ok: false, reason: 'not_member', text: `${m.from} 不在本会话`, session: s };
  if (findSecrets(m.text).length) return { ok: false, reason: 'secret', text: 'Key 与隐私不进入会话', session: s };
  if (!isChair && !hasArgument(m.text, m.evidence)) return { ok: false, reason: 'no_argument', text: '每条发言须有论点或证据', session: s };
  if (!isChair && s.messages.some((x) => x.kind === 'msg' && similarity(x.text, m.text) >= DUP_THRESHOLD)) return { ok: false, reason: 'duplicate', text: '与已有发言重复，已拦截', session: s };
  let next: TempSession = { ...s, messages: [...s.messages, { from: m.from, text: m.text.slice(0, 600), evidence: m.evidence ?? [], cost: m.cost ?? 0, at: new Date(now).toISOString(), kind: isChair ? 'chairman' : 'msg' }], spent: +(s.spent + (m.cost ?? 0)).toFixed(6) };
  const turns = next.messages.filter((x) => x.kind === 'msg').length;
  if (turns >= next.max_turns) next = dissolve(next, 'turns', now);
  else if (next.spent >= next.budget) next = dissolve(next, 'budget', now);
  return { ok: true, session: next };
}
/** TTL 到期自动解散。 */
export function tickSession(s: TempSession, now = Date.now()): TempSession { return s.status === 'open' && s.openedAt != null && now - s.openedAt >= s.ttl ? dissolve(s, 'ttl', now) : s; }
/** √ 解散：发起方或董事长。 */
export function checkOff(s: TempSession, by: string, now = Date.now()): TempSession {
  if (by !== s.initiator && by !== 'chairman') throw new Error('只有发起方或董事长能打 √ 解散');
  return dissolve(s, by === 'chairman' && by !== s.initiator ? 'chairman' : 'goal', now);
}
/** 小结：结论（含“结论 / 一致 / 决定”的发言）、待办（“由 X 负责 / X 来做 / 待办”）、未决（问号或“待定 / 未决”）。 */
export function summarizeSession(s: TempSession): SessionOutcome {
  const msgs = s.messages.filter((m) => m.kind !== 'system');
  const conclusions = msgs.filter((m) => /结论|一致|决定|同意按|就这么定/.test(m.text)).map((m) => m.text.replace(/^.*?(结论|决定)[:：]?\s*/, '').slice(0, 120));
  const todos = msgs.flatMap((m) => [...m.text.matchAll(/(?:待办|TODO)[:：]\s*([^；;。\n]+)/gi)].map((x) => ({ title: x[1]!.trim().slice(0, 80), owner: m.from })));
  const open = msgs.filter((m) => /[?？]|待定|未决|再议/.test(m.text)).map((m) => m.text.slice(0, 120));
  if (!conclusions.length && msgs.length && !open.includes(msgs.at(-1)!.text.slice(0, 120))) conclusions.push(msgs.at(-1)!.text.slice(0, 120));
  return { conclusions, todos, open, next: open.length ? (s.closeReason === 'goal' ? 'escalate' : 'meeting') : 'none' };
}
export function dissolve(s: TempSession, reason: CloseReason, now = Date.now()): TempSession {
  if (s.status === 'dissolved') return s;
  const closed: TempSession = { ...s, status: 'dissolved', closedAt: now, closeReason: reason };
  return { ...closed, outcome: summarizeSession(closed), messages: [...closed.messages, { from: 'system', text: `会话已解散（${({ goal: '目标达成 √', turns: '达到消息上限', budget: '达到费用上限', ttl: 'TTL 到期', chairman: '董事长 √', escalated: '已升级为会议' } as Record<CloseReason, string>)[reason]}）`, evidence: [], cost: 0, at: new Date(now).toISOString(), kind: 'system' }] };
}
/** 升级为正式会议：把小结与未决事项带进评审室议题。 */
export function escalateToMeeting(s: TempSession, now = Date.now()): { session: TempSession; meeting: { roomId: string; title: string; agenda: string; participants: string[]; fromSession: string } } {
  const session = dissolve(s, 'escalated', now);
  return { session, meeting: { roomId: 'review', title: `由临时会话升级：${s.topic}`, agenda: [`目标：${s.goal}`, ...(session.outcome?.open ?? []).map((x) => `未决：${x}`), ...(session.outcome?.conclusions ?? []).map((x) => `已有共识：${x}`)].join('\n'), participants: s.members, fromSession: s.id } };
}
/** 小结待办 → 工单（任务板 todo）。 */
export function todosToTickets(s: TempSession): { title: string; agentId: string; from: string }[] { return (s.outcome?.todos ?? []).map((t) => ({ title: t.title, agentId: t.owner, from: s.id })); }
