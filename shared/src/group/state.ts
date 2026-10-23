/**
 * 1.3.0 集团状态（config/group.json，唯一真相源）与对话指令解析。
 * 集团模式默认关闭；启用后写入 company/ 清单与制度；随时可退回 1.2 体验（关闭开关，数据保留）。
 * 每个机制都可开关、可度量、可淘汰（行业反思，见 refs-v1.3 R1）。
 */
import { defaultOrg, type Org } from './org.js';
import type { ContextItem, Objective, AlignRequest, OkrCycle } from './context.js';
import type { TempSession } from './sessions.js';
import type { Meeting, GroupDoc } from './meetings.js';
import type { Race, GrayRelease } from './race.js';
import type { Veto, Escalation, Retro, SpendEntry, PeerScore, CommissarAdvice } from './corp.js';
import type { RegHistory } from './regulations.js';

export const MECHANISMS = ['sessions', 'meetings', 'race', 'gray', 'okr', 'commissar', 'review360', 'retro'] as const;
export type Mechanism = typeof MECHANISMS[number];
export const MECHANISM_TEXT: Record<Mechanism, string> = { sessions: '临时会话', meetings: '会议室', race: '赛马', gray: '灰度', okr: 'OKR 公开', commissar: '政委', review360: '360 评议', retro: '复盘' };
export interface GroupState {
  version: 1; enabled: boolean; enabledAt: string | null; name: string; org: Org; yearGoal: { title: string; metric: string; target: number; unit: string } | null; okrCycle: OkrCycle;
  mechanisms: Record<Mechanism, boolean>; flow: ContextItem[]; okrs: Objective[]; aligns: AlignRequest[]; sessions: TempSession[]; meetings: Meeting[]; docs: GroupDoc[];
  races: Race[]; grays: GrayRelease[]; vetoes: Veto[]; escalations: Escalation[]; retros: Retro[]; peer: PeerScore[]; advice: CommissarAdvice[]; ledger: SpendEntry[]; regs: RegHistory;
  ceoAuthorizedForRace: boolean; contextUse: { usedContextRefs: number }[]; paused: boolean; meetingRuns: Record<string, string>;
}
export function emptyGroupState(): GroupState {
  return { version: 1, enabled: false, enabledAt: null, name: '我的集团', org: defaultOrg(), yearGoal: null, okrCycle: 'quarter', mechanisms: Object.fromEntries(MECHANISMS.map((m) => [m, true])) as Record<Mechanism, boolean>, flow: [], okrs: [], aligns: [], sessions: [], meetings: [], docs: [], races: [], grays: [], vetoes: [], escalations: [], retros: [], peer: [], advice: [], ledger: [], regs: {}, ceoAuthorizedForRace: false, contextUse: [], paused: false, meetingRuns: {} };
}
export function readGroupState(raw: string | null | undefined): GroupState {
  const base = emptyGroupState();
  if (!raw) return base;
  try { const j = JSON.parse(raw) as Partial<GroupState>; return { ...base, ...j, org: j.org ?? base.org, mechanisms: { ...base.mechanisms, ...(j.mechanisms ?? {}) } }; } catch { return base; }
}
export function writeGroupState(s: GroupState): string {
  return JSON.stringify({ ...s, flow: s.flow.slice(-500), sessions: s.sessions.slice(-100), meetings: s.meetings.slice(-100), docs: s.docs.slice(-300), races: s.races.slice(-50), ledger: s.ledger.slice(-2000), contextUse: s.contextUse.slice(-500) });
}

/* ---------------- 对话指令 ---------------- */
export type GroupCommand =
  | { kind: 'mention_dept'; id: string; name: string; rest: string } | { kind: 'mention_committee'; id: string; name: string; rest: string }
  | { kind: 'pull'; topic: string; names: string[] } | { kind: 'meeting'; roomId: string; topic: string } | { kind: 'race'; topic: string };
const ROOM_WORDS: [RegExp, string][] = [[/评审/, 'review'], [/战略|经管|例会|规划/, 'strategy'], [/作战|热点|突发/, 'war'], [/红蓝|对抗/, 'redblue'], [/复盘/, 'retro'], [/头脑风暴|脑暴|创意/, 'brainstorm'], [/赛马评审/, 'race-review']];
export function parseGroupCommand(text: string, org: Org): GroupCommand | null {
  const t = text.trim();
  const at = /^@(\S+)\s*(.*)$/s.exec(t);
  if (at) {
    const name = at[1]!;
    const c = org.committees.find((x) => x.name === name || x.id === name || (name.length >= 2 && x.name.startsWith(name)));
    if (c && /委员会|经管会|人资|质量|技术|采购|设计/.test(name)) return { kind: 'mention_committee', id: c.id, name: c.name, rest: at[2]!.trim() };
    const d = org.depts.find((x) => x.name === name || x.id === name || (name.length >= 2 && x.name.startsWith(name)));
    if (d) return { kind: 'mention_dept', id: d.id, name: d.name, rest: at[2]!.trim() };
    if (c) return { kind: 'mention_committee', id: c.id, name: c.name, rest: at[2]!.trim() };
    return null;
  }
  const pull = /^(?:帮我)?拉(?:个|一个)?群(?:讨论|聊聊|商量)?\s*[:：]?\s*(.+)$/.exec(t) ?? /^叫上\s*(.+?)\s*(?:一起)?(?:商量|讨论)(?:一下)?\s*[:：]?\s*(.*)$/.exec(t);
  if (pull) return t.startsWith('叫上') ? { kind: 'pull', topic: (pull[2] || pull[1]!).trim(), names: pull[1]!.split(/[、和与及,，\s]+/).filter(Boolean) } : { kind: 'pull', topic: pull[1]!.trim(), names: [] };
  const mt = /^(?:开|召开|组织)(?:个|一个|一场)?(.{0,8}?)会\s*[:：]?\s*(.*)$/.exec(t);
  if (mt) { const room = ROOM_WORDS.find(([r]) => r.test(mt[1]!))?.[1] ?? 'review'; return { kind: 'meeting', roomId: room, topic: mt[2]!.trim() || mt[1]!.trim() || '临时评审' }; }
  const race = /^(?:(.+?)[，,]?\s*)?(?:这件事|这个)?赛马\s*[:：]?\s*(.*)$/.exec(t);
  if (race && /赛马/.test(t)) return { kind: 'race', topic: (race[2] || race[1] || '').replace(/这件事|这个/g, '').trim() || '待定方向' };
  return null;
}
