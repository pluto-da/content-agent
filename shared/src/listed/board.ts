/**
 * 1.4.0 股东会与董事会（PROMPT-v1.4 第四部分；refs-v1.4 L1–L3）。
 * 组成：董事长（你）+ 执行董事（CEO 超级 Agent）+ 独立董事 1–3 名（默认 2）+ 董事会秘书（不是董事，负责议程、材料、纪要）。
 * 独立性（AI 版）：独立董事绑定与 CEO 不同的模型（优先不同服务商）；只读原始记录，不读 CEO 写的总结；不参与日常执行。
 *   - 不同服务商 → 独立性强；同一服务商的另一个模型 → “独立性弱”；只有一个模型 → 换视角 + 较高温度跑两遍，“独立性弱”。
 * 议事：例会每季度一次（可临时召开）；董秘出结论先行的会前材料；独立董事对每项议案“同意 / 反对 / 弃权 + 理由”；
 *   董事长拥有最终决定权，否决独立董事意见时记录在案（只提醒、不阻拦）。
 * 专门委员会：战略、审计、提名与薪酬；每个委员会独立董事过半数，审计委员会主席由独立董事担任。1.3 的经管会、HR 委员会继续存在，向董事会报告。
 */
import { checkGovResolution, clip, seq, type GovSpeaker } from './gov.js';

export type DirectorKind = 'chairman' | 'executive' | 'independent' | 'secretary';
export const DIRECTOR_KIND_TEXT: Record<DirectorKind, string> = { chairman: '董事长（你）', executive: '执行董事（CEO）', independent: '独立董事', secretary: '董事会秘书' };
export interface ModelRef { vendor: string; model: string; accountId?: string; modelEntryId?: string }
export type Independence = 'strong' | 'weak_model' | 'weak_single' | 'none';
export const INDEPENDENCE_TEXT: Record<Independence, string> = { strong: '独立性强（不同服务商）', weak_model: '独立性弱（同一服务商的另一个模型）', weak_single: '独立性弱（只有一个模型：换视角 + 较高温度跑两遍）', none: '未接模型（本机模拟发言）' };
export const isWeak = (i: Independence): boolean => i === 'weak_model' || i === 'weak_single';
export interface Director { id: string; name: string; kind: DirectorKind; model?: ModelRef; independence?: Independence; perspective?: string; temperature?: number; runs?: 1 | 2 }
export type CommitteeId = 'strategy' | 'audit' | 'nomcomp';
export const BOARD_COMMITTEE_TEXT: Record<CommitteeId, string> = { strategy: '战略委员会', audit: '审计委员会', nomcomp: '提名与薪酬委员会' };
export interface BoardCommittee { id: CommitteeId; name: string; members: string[]; chair: string; duty: string }
export interface Board { directors: Director[]; committees: BoardCommittee[]; reportsFrom: string[] }

export const PERSPECTIVES = ['风险与合规视角：只看证据，先找可能出错的地方', '用户与受众利益视角：问这件事对董事长和他的受众是否真的有利', '成本与回报视角：问花的钱和换来的结果是否相称'] as const;

/** 从已接入的模型里给独立董事挑模型：优先不同服务商，其次同服务商不同模型；只有一个模型则同模型 + 换视角跑两遍。 */
export function pickIndependentModels(available: ModelRef[], ceo: ModelRef | null, count = 2): { model: ModelRef | undefined; independence: Independence }[] {
  const out: { model: ModelRef | undefined; independence: Independence }[] = [];
  if (!ceo || !available.length) { for (let i = 0; i < count; i++) out.push({ model: undefined, independence: 'none' }); return out; }
  const otherVendor = available.filter((m) => m.vendor !== ceo.vendor);
  const sameVendorOther = available.filter((m) => m.vendor === ceo.vendor && m.model !== ceo.model);
  for (let i = 0; i < count; i++) {
    if (otherVendor.length) out.push({ model: otherVendor[i % otherVendor.length], independence: 'strong' });
    else if (sameVendorOther.length) out.push({ model: sameVendorOther[i % sameVendorOther.length], independence: 'weak_model' });
    else out.push({ model: ceo, independence: 'weak_single' });
  }
  return out;
}
export function independenceOf(d: Pick<Director, 'model'>, ceo: ModelRef | null | undefined): Independence {
  if (!d.model || !ceo) return 'none';
  if (d.model.vendor !== ceo.vendor) return 'strong';
  if (d.model.model !== ceo.model) return 'weak_model';
  return 'weak_single';
}

export function defaultBoard(o: { ceo?: ModelRef | null; available?: ModelRef[]; independents?: number } = {}): Board {
  const n = Math.min(3, Math.max(1, o.independents ?? 2));
  const picks = pickIndependentModels(o.available ?? [], o.ceo ?? null, n);
  const ids: Director[] = picks.map((p, i) => ({ id: `id-${i + 1}`, name: `独立董事 ${String.fromCharCode(65 + i)}`, kind: 'independent', model: p.model, independence: p.independence, perspective: PERSPECTIVES[i % PERSPECTIVES.length], temperature: p.independence === 'weak_single' ? 0.9 : 0.4, runs: p.independence === 'weak_single' ? 2 : 1 }));
  const directors: Director[] = [{ id: 'chairman', name: '董事长', kind: 'chairman' }, { id: 'ceo', name: 'CEO', kind: 'executive', model: o.ceo ?? undefined }, ...ids, { id: 'secretary', name: '董事会秘书', kind: 'secretary' }];
  const idIds = ids.map((d) => d.id);
  const committees: BoardCommittee[] = [
    { id: 'strategy', name: BOARD_COMMITTEE_TEXT.strategy, members: ['chairman', ...idIds], chair: 'chairman', duty: '审议年度战略与战略复盘，对重大投入提出建议' },
    { id: 'audit', name: BOARD_COMMITTEE_TEXT.audit, members: [...idIds], chair: idIds[0] ?? 'chairman', duty: '行使监督职权：听取内审、审核报告数字、监督内控与整改（参照《公司法》第一百二十一条，审计委员会代行监事会职权）' },
    { id: 'nomcomp', name: BOARD_COMMITTEE_TEXT.nomcomp, members: ['chairman', ...idIds], chair: idIds[idIds.length - 1] ?? 'chairman', duty: '提名 Agent 与负责人、分配预算配额与模型档位、制定公开的激励规则' },
  ];
  // 独立董事只有 1 名时：委员会若含董事长则独立董事不过半，改为由该独立董事一人组成并任主席（董事长列席，不计入委员）。
  if (idIds.length === 1) for (const c of committees) { c.members = [idIds[0]!]; c.chair = idIds[0]!; }
  return { directors, committees, reportsFrom: ['经营管理委员会', '人力资源委员会'] };
}

export const voting = (b: Board): Director[] => b.directors.filter((d) => d.kind !== 'secretary');
export const independents = (b: Board): Director[] => b.directors.filter((d) => d.kind === 'independent');
/** 规则检查：独立董事 1–3 名且占董事 ≥ 1/3；每个委员会独立董事过半数；审计委员会主席为独立董事；独立董事模型 ≠ CEO 模型（或标“独立性弱”）。 */
export function validateBoard(b: Board): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  const ids = independents(b); const v = voting(b);
  if (ids.length < 1 || ids.length > 3) errors.push(`独立董事须为 1–3 名（现在 ${ids.length} 名）`);
  if (ids.length * 3 < v.length) errors.push(`独立董事须占董事会成员三分之一以上（${ids.length}/${v.length}）`);
  const isId = (id: string) => ids.some((d) => d.id === id);
  for (const c of b.committees) {
    const n = c.members.filter(isId).length;
    if (n * 2 <= c.members.length) errors.push(`${c.name}独立董事未过半数（${n}/${c.members.length}）`);
    if (c.id === 'audit' && !isId(c.chair)) errors.push('审计委员会主席须由独立董事担任');
  }
  const ceo = b.directors.find((d) => d.kind === 'executive')?.model;
  for (const d of ids) {
    const ind = independenceOf(d, ceo);
    if (ceo && d.model && d.model.vendor === ceo.vendor && d.model.model === ceo.model && d.runs !== 2) errors.push(`${d.name}与 CEO 同一模型，必须换视角 + 较高温度跑两遍`);
    if (isWeak(ind)) warnings.push(`${d.name}：${INDEPENDENCE_TEXT[ind]}`);
  }
  return { ok: !errors.length, errors, warnings };
}

/* ---------------- 议案与表决 ---------------- */
export const BOARD_MATTERS = ['strategy', 'budget', 'budget_adjust', 'org_change', 'charter_doa', 'evolution_high', 'succession', 'audit_report', 'agm'] as const;
export type BoardMatter = typeof BOARD_MATTERS[number];
export const BOARD_MATTER_TEXT: Record<BoardMatter, string> = { strategy: '批准战略', budget: '年度预算', budget_adjust: '季度预算调整', org_change: '组织大调整', charter_doa: '章程与 DOA 修改', evolution_high: '高风险进化提案', succession: '接班人交接', audit_report: '听取内审报告', agm: '提交年度大会' };
export type VoteChoice = 'agree' | 'oppose' | 'abstain';
export const VOTE_TEXT: Record<VoteChoice, string> = { agree: '同意', oppose: '反对', abstain: '弃权' };
export interface Vote { directorId: string; choice: VoteChoice; reason: string; model?: string; runs: number; cost: number }
export interface Motion {
  id: string; no: string; title: string; matter: BoardMatter; proposer: string; materials: string; evidence: { label: string; ref: string }[];
  votes: Vote[]; decision: 'approved' | 'rejected' | null; override: { against: string[]; note: string; at: string } | null; status: 'draft' | 'voting' | 'decided' | 'refused'; refusedReason?: string; at: string; decidedAt?: string; payload?: Record<string, unknown>;
}
export const MIN_REASON = 8;
/** 董秘会前材料：结论先行 → 背景 → 数据（每条带出处）→ 风险 → 请董事会决定的事。 */
export function secretaryMaterials(o: { title: string; conclusion: string; background: string; data: { label: string; ref: string }[]; risks: string[]; ask: string }): string {
  return [`【结论】${o.conclusion}`, `【背景】${o.background}`, `【数据】${o.data.length ? o.data.map((d) => `${d.label}（出处：${d.ref}）`).join('；') : '无数据'}`, `【风险】${o.risks.join('；') || '未列出'}`, `【请董事会决定】${o.ask}`].join('\n');
}
export function newMotion(list: Motion[], m: { title: string; matter: BoardMatter; proposer?: string; materials: string; evidence?: { label: string; ref: string }[]; year?: number; at?: string; payload?: Record<string, unknown> }): { list: Motion[]; motion: Motion } {
  const at = m.at ?? new Date().toISOString();
  const year = m.year ?? new Date(at).getFullYear();
  const check = checkGovResolution(`${m.title}\n${m.materials}`, m.proposer ?? 'ceo');
  const motion: Motion = { id: `motion-${list.length + 1}-${at.replace(/\D/g, '').slice(0, 12)}`, no: seq('董事会议案', list.filter((x) => x.no.includes(`〔${year}〕`)).length + 1, year), title: m.title, matter: m.matter, proposer: m.proposer ?? 'ceo', materials: m.materials, evidence: m.evidence ?? [], votes: [], decision: null, override: null, status: check.ok ? 'voting' : 'refused', refusedReason: check.ok ? undefined : `触碰硬边界（${check.hit}：${check.rule}），引擎拒绝列入议程`, at, payload: m.payload };
  return { list: [...list, motion], motion };
}
/** 解析独立董事表态：第一句须是“同意 / 反对 / 弃权”，其后是理由。 */
export function parseVote(text: string): { choice: VoteChoice | null; reason: string } {
  const t = text.trim().replace(/^[【[(（]?(表决|意见|投票)[】\])）]?[:：]?\s*/, '');
  const m = /^(同意|赞成|反对|不同意|弃权)[。.，,：:；;\s]*/.exec(t);
  if (!m) return { choice: null, reason: t };
  const choice: VoteChoice = /反对|不同意/.test(m[1]!) ? 'oppose' : /弃权/.test(m[1]!) ? 'abstain' : 'agree';
  return { choice, reason: t.slice(m[0].length).replace(/^(理由|原因)[:：]\s*/, '').trim() };
}
export function castVote(mo: Motion, v: Omit<Vote, 'runs' | 'cost'> & { runs?: number; cost?: number }, b: Board): Motion {
  if (mo.status !== 'voting') throw new Error('议案不在表决中');
  const d = b.directors.find((x) => x.id === v.directorId);
  if (!d || d.kind === 'secretary') throw new Error('董事会秘书不参与表决');
  if (d.kind === 'independent' && v.reason.trim().length < MIN_REASON) throw new Error(`${d.name}必须写明理由（≥${MIN_REASON} 字）`);
  return { ...mo, votes: [...mo.votes.filter((x) => x.directorId !== v.directorId), { runs: 1, cost: 0, ...v }] };
}
/** 董事长拍板。独立董事全部表态之后才能拍板；否决独立董事意见（批准了他们反对的、或驳回了他们一致同意的）时记录在案，只提醒不阻拦。 */
export function chairmanDecide(mo: Motion, b: Board, approve: boolean, note = '', at = new Date().toISOString()): Motion {
  if (mo.status !== 'voting') throw new Error('议案不在表决中');
  const ids = independents(b);
  const missing = ids.filter((d) => !mo.votes.some((v) => v.directorId === d.id));
  if (missing.length) throw new Error(`还有独立董事未表态：${missing.map((d) => d.name).join('、')}`);
  const idVotes = mo.votes.filter((v) => ids.some((d) => d.id === v.directorId));
  const against = approve ? idVotes.filter((v) => v.choice === 'oppose').map((v) => v.directorId) : (idVotes.length && idVotes.every((v) => v.choice === 'agree') ? idVotes.map((v) => v.directorId) : []);
  const override = against.length ? { against, note: note || (approve ? '董事长批准了独立董事反对的议案' : '董事长驳回了独立董事一致同意的议案'), at } : null;
  return { ...mo, decision: approve ? 'approved' : 'rejected', override, status: 'decided', decidedAt: at };
}
export const overrideNotice = (mo: Motion, b: Board): string | null => (mo.override ? `已记录：${mo.override.note}（${mo.override.against.map((id) => b.directors.find((d) => d.id === id)?.name ?? id).join('、')}的意见见表决记录）。这条记录用来提醒，不阻拦你的决定。` : null);

/* ---------------- 独立董事发言：只读原始记录 ---------------- */
export interface RawRecord { kind: string; ref: string; text: string }
/** 给独立董事的输入：议案标题 + 原始记录（花费账、日志、数据）+ 董秘材料中的数据出处；**不含** CEO 写的总结 / 致辞。 */
export function directorPrompt(d: Director, mo: Motion, raw: RawRecord[]): { system: string; user: string; maxTokens: number; temperature: number } {
  const sys = `你是 AI 虚拟集团董事会的${d.name}（独立董事）。你不参与日常执行、不听 CEO 的总结，只看原始记录与数据。视角：${d.perspective ?? PERSPECTIVES[0]}。\n规则：第一句只能是“同意”“反对”或“弃权”之一；随后写理由（≥2 条，每条引用一条原始记录的编号，如 [R2]；没有记录支撑就说“无数据，无法核实”）；≤160 字；不得建议自动发布、自动互动、刷量、多账号、抓取私有数据或提升任何权限。`;
  const lines = raw.slice(0, 12).map((r, i) => `[R${i + 1}] ${r.kind}·${r.ref}：${clip(r.text.replace(/\s+/g, ' '), 140)}`);
  const user = `议案：${mo.title}（${BOARD_MATTER_TEXT[mo.matter]}）\n董秘材料中的数据出处：${mo.evidence.map((e) => `${e.label}=${e.ref}`).join('；') || '无'}\n原始记录：\n${lines.join('\n') || '（没有原始记录）'}`;
  return { system: sys, user, maxTokens: 260, temperature: d.temperature ?? 0.4 };
}
/** 本机模拟的独立董事（不联网）：材料没有附原始记录或含“超支 / 无数据”就反对，否则同意；理由引用记录编号。 */
export const mockDirector: GovSpeaker = async (r) => {
  const noRaw = /没有原始记录/.test(r.user);
  const risky = /(超支|偏差|无数据|未核实|增加预算|追加)/.test(r.user);
  if (noRaw) return { text: '反对。理由：议案没有附任何原始记录，无数据，无法核实收益与花费；请董秘补齐花费账与产出记录后再议。', cost: 0 };
  if (risky) return { text: `反对。理由：[R1] 显示预算执行已有偏差，议案仍要求追加投入；${r.perspective?.includes('成本') ? '花费与产出不相称' : '风险应对没有写负责人与期限'}，建议先整改再批。`, cost: 0 };
  return { text: '同意。理由：[R1][R2] 的记录与议案数字一致；风险已列出负责人，花费在预算内。', cost: 0 };
};
/** 让全部独立董事对一项议案表态（单模型时同模型换视角 + 较高温度跑两遍，两次不一致取更审慎的一票）。 */
export async function independentVotes(mo: Motion, b: Board, raw: RawRecord[], speak: GovSpeaker): Promise<Motion> {
  let m = mo;
  const rank: Record<VoteChoice, number> = { oppose: 2, abstain: 1, agree: 0 };
  for (const d of independents(b)) {
    const runs = d.runs === 2 ? 2 : 1; let best: { choice: VoteChoice; reason: string } | null = null; let cost = 0;
    for (let i = 0; i < runs; i++) {
      const p = directorPrompt(i === 1 ? { ...d, perspective: PERSPECTIVES[(PERSPECTIVES.indexOf(d.perspective as typeof PERSPECTIVES[number]) + 1) % PERSPECTIVES.length] } : d, m, raw);
      const r = await speak({ who: d.id, role: 'independent', system: p.system, user: p.user, tier: 'cheap', model: d.model?.model, temperature: p.temperature, maxTokens: p.maxTokens, perspective: d.perspective });
      cost += r.cost;
      let v = parseVote(r.text);
      if (!v.choice) v = { choice: 'abstain', reason: `未按格式表态，按弃权记录：${clip(r.text, 80)}` };
      if (v.reason.length < MIN_REASON) v = { ...v, reason: `${v.reason}（理由过短，董秘标注待补）`.trim() };
      if (!best || rank[v.choice!] > rank[best.choice]) best = { choice: v.choice!, reason: v.reason };
    }
    m = castVote(m, { directorId: d.id, choice: best!.choice, reason: best!.reason, model: d.model?.model, runs, cost }, b);
  }
  return m;
}

/* ---------------- 董事会会议与股东会（年度董事长大会） ---------------- */
export interface BoardMeeting { id: string; no: string; kind: 'regular' | 'extra'; quarter: string; motions: string[]; minutes: string; at: string; spent: number }
export const regularDue = (meetings: BoardMeeting[], quarter: string): boolean => !meetings.some((m) => m.kind === 'regular' && m.quarter === quarter);
export function boardMinutes(no: string, motions: Motion[], b: Board): string {
  return [`# ${no} 董事会会议纪要`, `出席：${voting(b).map((d) => d.name).join('、')}；列席：董事会秘书`, ...motions.map((m, i) => `${i + 1}. ${m.title}（${BOARD_MATTER_TEXT[m.matter]}）——${m.status === 'refused' ? `未列入议程：${m.refusedReason}` : `${m.votes.map((v) => `${b.directors.find((d) => d.id === v.directorId)?.name ?? v.directorId}：${VOTE_TEXT[v.choice]}（${clip(v.reason, 60)}）`).join('；')}；董事长：${m.decision === 'approved' ? '批准' : m.decision === 'rejected' ? '驳回' : '未拍板'}${m.override ? `；${m.override.note}（已记录在案）` : ''}`}`)].join('\n');
}
export const AGM_STEPS = ['审议年报', '确定下一年度的使命、愿景和目标', '确定集团预算总额', '批准章程修改'] as const;
export type AgmStep = typeof AGM_STEPS[number];
export interface Agm { id: string; year: number; steps: Record<AgmStep, { done: boolean; note: string; at?: string }>; status: 'open' | 'closed'; trigger: 'annual' | 'manual'; at: string }
export function newAgm(year: number, trigger: Agm['trigger'] = 'annual', at = new Date().toISOString()): Agm {
  return { id: `agm-${year}-${at.replace(/\D/g, '').slice(0, 12)}`, year, steps: Object.fromEntries(AGM_STEPS.map((s) => [s, { done: false, note: '' }])) as Agm['steps'], status: 'open', trigger, at };
}
export function agmStep(a: Agm, step: AgmStep, note: string, at = new Date().toISOString()): Agm {
  if (a.status !== 'open') throw new Error('年度大会已闭会');
  if (step === '批准章程修改' && note && !checkGovResolution(note).ok) throw new Error(`章程修改触碰硬边界：${checkGovResolution(note).hit}`);
  const idx = AGM_STEPS.indexOf(step);
  const prev = AGM_STEPS.slice(0, idx).find((s) => !a.steps[s].done);
  if (prev) throw new Error(`请先完成“${prev}”`);
  return { ...a, steps: { ...a.steps, [step]: { done: true, note, at } } };
}
export function closeAgm(a: Agm): Agm {
  const left = AGM_STEPS.filter((s) => !a.steps[s].done);
  if (left.length) throw new Error(`年度大会还差：${left.join('、')}`);
  return { ...a, status: 'closed' };
}
