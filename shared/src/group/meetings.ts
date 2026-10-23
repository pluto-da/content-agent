/**
 * 1.3.0 会议室（第八部分）与公文（第五部分 4）。
 * 7 个常设会议室（可改名、增删）；预约与例会（App 打开时执行）、会前文档（字节式“先读文档再发言”）、白板、主持、纪要（编号 / 参会 / 要点 / 决议 / 待办）、
 * 董事长旁听与介入（发言最高优先、改议题、叫停、直接裁决）、回放（按轮次的质询关系图）。
 */
import { findSecrets, redact } from '../core/redact.js';
import { runDiscussion, replayGraph, type DiscussionRecord, type Party, type Speaker, type Resolution } from './discussion.js';

export interface Room { id: string; name: string; purpose: string; procedure: string[]; host: 'ceo' | 'dept_head' | 'chair'; maxRounds: number; timeLimitMin: number | null; budgetYuan: number; criticism: boolean }
export const ROOMS: Room[] = [
  { id: 'strategy', name: '战略室', purpose: '经管会例会、年度 / 季度规划', procedure: ['文档先行', '汇报', '质询', '决议'], host: 'ceo', maxRounds: 3, timeLimitMin: null, budgetYuan: 0.5, criticism: true },
  { id: 'review', name: '评审室', purpose: '方案、稿件、选题评审', procedure: ['独立评审', '质询', '结论'], host: 'chair', maxRounds: 3, timeLimitMin: null, budgetYuan: 0.5, criticism: true },
  { id: 'war', name: '作战室', purpose: '热点或突发事件快速响应', procedure: ['限时 15 分钟', '3 轮', 'CEO 主持'], host: 'ceo', maxRounds: 3, timeLimitMin: 15, budgetYuan: 0.3, criticism: true },
  { id: 'redblue', name: '红蓝对抗室', purpose: '重大决策（新开平台、改定位）', procedure: ['红军方案', '蓝军攻击', '修正', '裁决'], host: 'ceo', maxRounds: 3, timeLimitMin: null, budgetYuan: 0.5, criticism: true },
  { id: 'race-review', name: '赛马评审室', purpose: '赛马方案对比', procedure: ['盲评打分', '数据对比', '宣布胜者'], host: 'chair', maxRounds: 1, timeLimitMin: null, budgetYuan: 0.3, criticism: true },
  { id: 'retro', name: '复盘室', purpose: '项目、周期复盘', procedure: ['目标回顾', '结果对比', '原因分析', '经验沉淀'], host: 'chair', maxRounds: 2, timeLimitMin: null, budgetYuan: 0.3, criticism: true },
  { id: 'brainstorm', name: '头脑风暴室', purpose: '选题与创意发散', procedure: ['发散不批评', '聚类', '投票'], host: 'dept_head', maxRounds: 1, timeLimitMin: null, budgetYuan: 0.3, criticism: false },
];
export const roomById = (id: string): Room | undefined => ROOMS.find((r) => r.id === id);

export interface Whiteboard { claims: string[]; evidence: string[]; consensus: string[]; disagreements: string[] }
export interface Minutes { no: string; title: string; room: string; participants: string[]; points: string[]; resolution: string; todos: { title: string; owner: string; due: string }[]; at: string }
export interface Intervention { kind: 'speak' | 'agenda' | 'stop' | 'rule'; text: string; at: string }
export type MeetingStatus = 'scheduled' | 'running' | 'closed' | 'stopped';
export interface Meeting {
  id: string; roomId: string; title: string; agenda: string; host: string; participants: string[]; scheduledAt: string | null; recurring: string | null; status: MeetingStatus;
  preDoc: string; whiteboard: Whiteboard; record: DiscussionRecord | null; minutes: Minutes | null; interventions: Intervention[]; observers: string[]; spent: number; deptId: string; fromSession?: string; createdAt: string;
}

/** 会前文档（背景、问题、选项、数据）；Key 不进入。 */
export function preDocument(o: { title: string; background: string; question: string; options: string[]; data: string[] }): string {
  const t = `# 会前文档：${o.title}\n\n## 背景\n${o.background}\n\n## 问题\n${o.question}\n\n## 选项\n${o.options.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n## 数据\n${o.data.length ? o.data.map((x) => `- ${x}`).join('\n') : '- 待录入（没有数据就写待录入，不编造）'}\n`;
  return findSecrets(t).length ? redact(t) : t;
}
export function newMeeting(o: { roomId: string; title: string; agenda: string; participants: string[]; host?: string; scheduledAt?: string | null; recurring?: string | null; preDoc?: string; deptId?: string; fromSession?: string; id?: string; at?: string }): Meeting {
  const room = roomById(o.roomId); if (!room) throw new Error(`没有会议室 ${o.roomId}`);
  return { id: o.id ?? `mt-${Date.now().toString(36)}`, roomId: room.id, title: redact(o.title).slice(0, 80), agenda: redact(o.agenda).slice(0, 1000), host: o.host ?? (room.host === 'ceo' ? 'ceo' : o.participants[0] ?? 'ceo'), participants: [...new Set(o.participants)].slice(0, 8), scheduledAt: o.scheduledAt ?? null, recurring: o.recurring ?? null, status: 'scheduled', preDoc: o.preDoc ?? preDocument({ title: o.title, background: o.agenda, question: o.title, options: [], data: [] }), whiteboard: { claims: [], evidence: [], consensus: [], disagreements: [] }, record: null, minutes: null, interventions: [], observers: ['chairman'], spent: 0, deptId: o.deptId ?? 'staff', fromSession: o.fromSession, createdAt: o.at ?? new Date().toISOString() };
}
/** 例会：weekly:<0-6>@HH:MM（App 打开时执行到期场次）。 */
export function parseRecurring(s: string): { dow: number; hh: number; mm: number } | null { const m = /^weekly:([0-6])@(\d{2}):(\d{2})$/.exec(s); return m ? { dow: +m[1]!, hh: +m[2]!, mm: +m[3]! } : null; }
export function dueMeetings(list: Meeting[], now: Date, lastRun: Record<string, string> = {}): Meeting[] {
  return list.filter((m) => {
    if (m.status === 'running') return false;
    if (m.recurring) { const r = parseRecurring(m.recurring); if (!r) return false; const slot = new Date(now); slot.setHours(r.hh, r.mm, 0, 0); return now.getDay() === r.dow && now >= slot && (!lastRun[m.id] || new Date(lastRun[m.id]!) < slot); }
    return m.status === 'scheduled' && !!m.scheduledAt && new Date(m.scheduledAt) <= now;
  });
}
/** 董事长介入：发言（最高优先，下一轮所有人可见）、改议题、叫停、直接裁决。 */
export function intervene(m: Meeting, kind: Intervention['kind'], text: string, at = new Date().toISOString()): Meeting {
  const next: Meeting = { ...m, interventions: [...m.interventions, { kind, text: redact(text).slice(0, 300), at }] };
  if (kind === 'agenda') next.agenda = redact(text).slice(0, 1000);
  if (kind === 'stop' && m.status !== 'closed') next.status = 'stopped';
  return next;
}
export function partiesFor(m: Meeting, names: Record<string, string>): Party[] {
  const ps = m.participants.map((id) => ({ id, name: names[id] ?? id }));
  if (m.roomId === 'redblue') { const out = ps.map((p, i) => (i === ps.length - 1 ? { ...p, blue: true, view: '蓝军：专门攻击方案漏洞' } : p)); return out; }
  if (!ps.some((p) => p.id.startsWith('legal'))) return ps;
  return ps.map((p) => (p.id.startsWith('legal') ? { ...p, blue: true } : p));
}
let seqBase = 0;
export function docNo(year: number, seq: number): string { return `集团〔${year}〕${String(seq).padStart(3, '0')}号`; }
/** 开会：按会议室规程跑讨论协议，汇入白板，出纪要。董事长的“裁决”直接成为决议。 */
export async function runMeeting(m: Meeting, speak: Speaker, o: { names?: Record<string, string>; seq?: number; year?: number; decide?: (s: import('./discussion.js').Synthesis) => Resolution } = {}): Promise<Meeting> {
  const room = roomById(m.roomId)!;
  if (m.status === 'stopped') return m;
  const rulings = m.interventions.filter((i) => i.kind === 'rule');
  const parties = partiesFor(m, o.names ?? {});
  const notes = () => ({ notes: m.interventions.filter((i) => i.kind === 'speak').map((i) => i.text), stop: m.interventions.some((i) => i.kind === 'stop') });
  const rec = await runDiscussion({ topic: m.title, doc: `${m.preDoc}\n\n议题：${m.agenda}`, parties, maxRounds: room.maxRounds, budgetYuan: room.budgetYuan, criticism: room.criticism, chairman: notes, decide: rulings.length ? () => ({ kind: 'chairman', text: rulings.at(-1)!.text, vetoes: [] }) : o.decide ? (s) => o.decide!(s) : undefined }, speak);
  const wb: Whiteboard = {
    claims: rec.speeches.filter((s) => s.phase === 'independent' || s.phase === 'revise').map((s) => `${o.names?.[s.from] ?? s.from}：${s.text.slice(0, 80)}`),
    evidence: rec.speeches.filter((s) => /来源|数据|录入|导入/.test(s.text) && !s.flags.includes('speculative')).map((s) => s.text.slice(0, 80)).slice(0, 8),
    consensus: rec.synthesis?.consensus ?? [], disagreements: rec.synthesis?.disagreements ?? [],
  };
  const year = o.year ?? new Date().getFullYear();
  const minutes: Minutes = { no: docNo(year, o.seq ?? ++seqBase), title: `${room.name}纪要：${m.title}`, room: room.name, participants: m.participants, points: [...wb.consensus, ...wb.disagreements.map((x) => `分歧：${x}`)].slice(0, 8), resolution: rec.resolution?.rejected ?? rec.resolution?.text ?? '无决议（升级）', todos: rec.todos, at: new Date().toISOString() };
  return { ...m, status: 'closed', record: rec, whiteboard: wb, minutes, spent: rec.spent };
}
export function meetingReplay(m: Meeting) { return m.record ? replayGraph(m.record) : []; }

/* ---------------- 公文 ---------------- */
export const DOC_TYPES = ['请示', '报告', '通知', '纪要', '提案', '决议', '简报'] as const;
export type DocType = typeof DOC_TYPES[number];
export type DocStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'archived';
export interface GroupDoc { id: string; no: string; type: DocType; title: string; body: string; from: string; to: string; status: DocStatus; refs: string[]; at: string; decidedAt?: string; note?: string }
export function newDoc(list: GroupDoc[], d: { type: DocType; title: string; body: string; from: string; to?: string; refs?: string[]; year?: number; at?: string }): { list: GroupDoc[]; doc: GroupDoc } {
  if (findSecrets(`${d.title}\n${d.body}`).length) throw new Error('Key 与隐私永不进入公文');
  const year = d.year ?? new Date().getFullYear();
  const seq = list.filter((x) => x.no.includes(`〔${year}〕`)).length + 1;
  const doc: GroupDoc = { id: `doc-${year}-${seq}`, no: docNo(year, seq), type: d.type, title: d.title.slice(0, 80), body: d.body.slice(0, 4000), from: d.from, to: d.to ?? 'chairman', status: d.type === '请示' || d.type === '提案' ? 'pending' : 'archived', refs: d.refs ?? [], at: d.at ?? new Date().toISOString() };
  return { list: [...list, doc], doc };
}
export function decideDoc(list: GroupDoc[], id: string, by: string, approve: boolean, note?: string, at = new Date().toISOString()): GroupDoc[] {
  return list.map((x) => {
    if (x.id !== id) return x;
    if (x.status !== 'pending') throw new Error('只有待批公文可以批准或驳回');
    if (x.to === 'chairman' && by !== 'chairman') throw new Error('呈董事长的请示只能由董事长批准或驳回');
    return { ...x, status: approve ? 'approved' : 'rejected', decidedAt: at, note };
  });
}
export const findDoc = (list: GroupDoc[], q: string): GroupDoc[] => list.filter((x) => x.no.includes(q) || x.title.includes(q) || x.type === q);
