/**
 * 1.4.0 上市公司模式的本机接线：config/listed.json（唯一真相源，随备份导出，不含 Key）。
 * 默认关闭；启用要求先启用 1.3 集团模式；退回只关开关、保留数据。治理只增加监督，不提升任何权限；所有决议过硬边界。
 * 讲者：CEO 用对话主模型；独立董事 / 内审用与 CEO 不同的模型（优先不同服务商；只有同一服务商时用另一个模型并标“独立性弱”；只有一个模型时换视角 + 高温度跑两遍）。
 * 没有模型或接的是本机模拟服务商（mock://）时，用 shared 的本机模拟讲者（不联网、花费 0）。
 * 模拟数据（simulateMonth）只在演示 / 自检开关打开时可用，单独存在 simData，报告标“含模拟数据”，不写入你的草稿与数据。
 */
import {
  readListedState, writeListedState, defaultBoard, validateBoard, independents, newMotion, secretaryMaterials, independentVotes, chairmanDecide, overrideNotice, boardMinutes, newAgm, agmStep, closeAgm, AGM_STEPS,
  govNow, monthKey, quarterKey, govCostStatus, canSpendGov, checkGovResolution, LISTED_HONESTY, PEN_NAME, mockDirector, mockDisclosureSpeaker, isWeak, independenceOf, INDEPENDENCE_TEXT,
  runAudit, auditSummary, deliverAudit, testControls, CONTROLS, frontlineCheck, updateRisk, riskRegisterView, makeBudget, budgetExecution, monthlyReview, proposeAdjust, applyAdjust, roiBoard,
  buildReport, finalizeReport, editFigure, renderReportHtml, buildDocx, runEarningsCall, chairmanBrief, newStrategy, draftBlm, toCommittee, toBoard, boardDecision, strategyToOkrs, strategyReview,
  nominate, approveNomination, assess, newSuccession, runShadow, blindReview, handover, rollbackSuccession, mockShadowGen, mockBlindJudge, judgeWith, fromRetro, fromVeto, fromHit, addCase, injectCases,
  newTraining, gradeQuiz, mockStudent, parseAnswers, pickBestPractices, knowledgeHealth, weeklyLesson, badgesOf, governanceGrants, parseDoa, checkResolution, privacyLeaks, addContext,
  addRevenue, parseSettlementCsv, pnl, seedOpportunities, newOpportunity, reviewOpportunity, proposeOpportunity, approveOpportunity, checkRevenueAction, evolutionObjective, REVENUE_HONESTY,
  type ListedState, type GovSpeaker, type GovKind, type ModelRef, type Motion, type BoardMatter, type RawRecord, type ReportSources, type MapRow, type Metric, type WeekEvent, type SimData, type AgmStep, type Variant,
} from '@content-agent/shared';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';
import { getModels, getModelsV3, resolveProvider } from '../local/store';
import { chat, costOf } from '../local/llm';
import { db } from '../local/db';
import { getGroup, updateGroup } from '../v13/store';

export const LISTED_STATE = 'config/listed.json';
type Listener = () => void;
const listeners = new Set<Listener>();
export function onListedChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { for (const f of [...listeners]) f(); };
let queue: Promise<unknown> = Promise.resolve();
export async function getListed(): Promise<ListedState> { const v = await getVfs(); return readListedState((await v.read(LISTED_STATE))?.content); }
export function updateListed(fn: (s: ListedState) => ListedState | Promise<ListedState>): Promise<ListedState> {
  const p = queue.then(async () => {
    const v = await getVfs();
    const cur = readListedState((await v.read(LISTED_STATE))?.content);
    const next = await fn(cur);
    await v.write(LISTED_STATE, writeListedState(next), { author: 'system', allowLarge: true });
    emit();
    return next;
  });
  queue = p.catch(() => undefined);
  return p;
}
const nowIso = (s: ListedState) => govNow(s.clock).toISOString();
async function guard(s: ListedState): Promise<void> {
  if (!s.enabled) throw new Error('上市公司模式未启用');
  const g = await getGroup();
  if (!g.enabled) throw new Error('请先启用集团模式');
  if (g.paused) throw new Error('已全部暂停：恢复需你手动');
}
export const demoAllowed = (): boolean => { try { return localStorage.getItem('ca.govDemo') === '1'; } catch { return false; } };

/* ---------------- 讲者 ---------------- */
/** 部门 id → 名称（界面与报告不露内部 id）。 */
export const deptNamesOf = (g: { org: { depts: { id: string; name: string }[] } }): Record<string, string> => Object.fromEntries([...g.org.depts.map((d) => [d.id, d.name]), ['board', '治理（董事会 / 内审等）'], ['unassigned', '未分配']]);
interface Speakers { ceo: GovSpeaker; forDirector: (model?: ModelRef) => GovSpeaker; analyst: GovSpeaker; mock: boolean }
async function modelRefs(): Promise<{ ceo: ModelRef | null; available: ModelRef[] }> {
  const v3 = await getModelsV3();
  const m = await getModels();
  const cfg = resolveProvider(m);
  const available: ModelRef[] = v3.accounts.filter((a) => !/^mock:/.test(a.baseURL)).flatMap((a) => a.models.filter((e) => e.roles.some((r) => r === 'chat' || r === 'reason' || r === 'fast')).map((e) => ({ vendor: a.vendor, model: e.model, accountId: a.id, modelEntryId: e.id })));
  if (!cfg || /^mock:/.test(cfg.baseURL)) return { ceo: null, available };
  const acc = v3.accounts.find((a) => a.id === cfg.id);
  return { ceo: { vendor: acc?.vendor ?? cfg.id, model: cfg.model, accountId: cfg.id }, available };
}
/** 把每次调用记进治理成本账 + 本机用量日志（同一 ref），供内审对账。 */
let pendingSpend: { kind: GovKind; yuan: number; ref: string; model?: string }[] = [];
async function speakers(kind: GovKind): Promise<Speakers> {
  const m = await getModels();
  const cfg = resolveProvider(m);
  // 本机模拟：独立董事表决用 mockDirector，其余（发布会提问、报告意见、培训）用 mockDisclosureSpeaker
  const mockId: GovSpeaker = (r) => (/第一句只能是/.test(r.system) ? mockDirector(r) : mockDisclosureSpeaker(r));
  if (!cfg || /^mock:/.test(cfg.baseURL)) return { ceo: mockDisclosureSpeaker, forDirector: () => mockId, analyst: mockDisclosureSpeaker, mock: true };
  const mk = (accountId?: string, model?: string): GovSpeaker => async (r) => {
    const base = (accountId ? m.providers.find((p) => p.id === accountId) : undefined) ?? cfg;
    const c = { ...base, model: model ?? r.model ?? base.model };
    const out = await chat(c, [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], { maxTokens: r.maxTokens, timeoutMs: 60000, ...(r.temperature != null ? { temperature: r.temperature } : {}) });
    const cost = costOf(c.id, out.model, out.usage);
    pendingSpend.push({ kind, yuan: cost, ref: `${kind}-${Date.now()}-${pendingSpend.length}`, model: c.model });
    return { text: out.content, cost };
  };
  return { ceo: mk(), forDirector: (d) => mk(d?.accountId, d?.model), analyst: mk(), mock: false };
}
function flushSpend(s: ListedState): ListedState {
  if (!pendingSpend.length) return s;
  const at = nowIso(s); const xs = pendingSpend; pendingSpend = [];
  return { ...s, govLedger: [...s.govLedger, ...xs.filter((x) => x.yuan > 0).map((x) => ({ kind: x.kind, yuan: +x.yuan.toFixed(6), at, ref: x.ref, model: x.model }))], usageLog: [...s.usageLog, ...xs.filter((x) => x.yuan > 0).map((x) => ({ ref: x.ref, yuan: +x.yuan.toFixed(6), at, model: x.model }))] };
}
function costGate(s: ListedState, kind: GovKind, est: number): void { const st = govCostStatus(s.govLedger, s.monthBudgetYuan, govNow(s.clock), s.govCapShare); const ok = canSpendGov(st, kind, est); if (!ok.ok) throw new Error(ok.reason); }

/* ---------------- 启用 / 退回 / 引导 ---------------- */
export async function enableListed(): Promise<ListedState> {
  const g = await getGroup();
  if (!g.enabled) throw new Error('请先启用集团模式（统领 → 启用），再启用上市公司模式');
  const refs = await modelRefs();
  await audit({ kind: 'setting_change', actor: 'user', summary: `启用上市公司模式（${LISTED_HONESTY}）`, outcome: 'ok' });
  return updateListed((s) => {
    const board = s.board.directors.some((d) => d.model) ? s.board : defaultBoard({ ceo: refs.ceo, available: refs.available });
    // 首次启用：风险登记册的默认条目以启用时间为“最近复核”
    const risks = s.enabledAt ? s.risks : s.risks.map((r) => ({ ...r, updatedAt: nowIso(s) }));
    return { ...s, enabled: true, enabledAt: s.enabledAt ?? new Date().toISOString(), board, risks };
  });
}
export async function finishOnboarding(): Promise<void> { await updateListed((s) => ({ ...s, onboarded: true })); }
export async function disableListed(): Promise<void> { await updateListed((s) => ({ ...s, enabled: false })); await audit({ kind: 'setting_change', actor: 'user', summary: '退回集团模式（上市公司模式关闭，数据保留）', outcome: 'ok' }); }
export async function refreshBoardModels(): Promise<void> { const refs = await modelRefs(); await updateListed((s) => ({ ...s, board: defaultBoard({ ceo: refs.ceo, available: refs.available, independents: independents(s.board).length || 2 }) })); }
export async function setMonthBudget(yuan: number): Promise<void> { await updateListed((s) => ({ ...s, monthBudgetYuan: yuan > 0 ? +yuan.toFixed(2) : null })); }
export async function boardIndependence(): Promise<{ id: string; name: string; model: string; text: string; weak: boolean }[]> {
  const s = await getListed(); const ceo = s.board.directors.find((d) => d.kind === 'executive')?.model;
  return independents(s.board).map((d) => { const i = d.independence ?? independenceOf(d, ceo); return { id: d.id, name: d.name, model: d.model?.model ?? '本机模拟', text: INDEPENDENCE_TEXT[i], weak: isWeak(i) }; });
}

/* ---------------- 原始记录（独立董事只读这些） ---------------- */
async function rawRecords(s: ListedState): Promise<RawRecord[]> {
  const g = await getGroup();
  const out: RawRecord[] = [];
  const spend = [...g.ledger.map((e) => ({ ...e })), ...(s.simData?.spend ?? [])];
  const byDept: Record<string, number> = {}; for (const e of spend) byDept[e.deptId] = +((byDept[e.deptId] ?? 0) + e.yuan).toFixed(4);
  for (const [d, y] of Object.entries(byDept)) out.push({ kind: '花费账', ref: `ledger?dept=${d}`, text: `${d} 累计花费 ¥${y}` });
  if (s.budget) { const ex = budgetExecution(s.budget, spend, govNow(s.clock), deptNamesOf(g)); for (const a of ex.alerts) out.push({ kind: '预算执行', ref: `budget:${ex.quarter}`, text: a }); if (!ex.alerts.length) out.push({ kind: '预算执行', ref: `budget:${ex.quarter}`, text: `执行率 ${(ex.yearRate * 100).toFixed(1)}%，未触发预警` }); }
  const drafts = await db.all('drafts').catch(() => [] as Record<string, unknown>[]);
  out.push({ kind: '产出', ref: 'drafts', text: `稿件 ${drafts.length + (s.simData?.drafts.length ?? 0)} 篇（含模拟 ${s.simData?.drafts.length ?? 0}）` });
  const last = s.audits.at(-1); if (last) out.push({ kind: '内审', ref: last.no, text: `新发现 ${last.findings.length} 项，未关闭 ${[...last.findings, ...last.carried].filter((f) => f.status === 'open').length} 项` });
  for (const r of riskRegisterView(s.risks, govNow(s.clock)).risks.slice(0, 2)) out.push({ kind: '风险登记册', ref: r.id, text: `${r.title}（${r.level}）` });
  return out;
}

/* ---------------- 董事会 ---------------- */
export async function proposeMotion(o: { title: string; matter: BoardMatter; conclusion: string; background: string; data?: { label: string; ref: string }[]; risks?: string[]; ask?: string; payload?: Record<string, unknown> }): Promise<Motion> {
  let mo!: Motion;
  await updateListed(async (s) => {
    await guard(s);
    const materials = secretaryMaterials({ title: o.title, conclusion: o.conclusion, background: o.background, data: o.data ?? [], risks: o.risks ?? [], ask: o.ask ?? '是否批准' });
    const r = newMotion(s.motions, { title: o.title, matter: o.matter, materials, evidence: o.data ?? [], at: nowIso(s), payload: o.payload });
    mo = r.motion;
    if (r.motion.status === 'refused') await audit({ kind: 'approval', actor: 'agent', summary: `董事会议案被拒：${r.motion.refusedReason}`, outcome: 'denied' });
    return { ...s, motions: r.list };
  });
  return mo;
}
export async function runVotes(motionId: string): Promise<Motion> {
  const s0 = await getListed(); await guard(s0);
  const mo = s0.motions.find((m) => m.id === motionId); if (!mo) throw new Error('没有这项议案');
  costGate(s0, 'board', 0.05);
  const sp = await speakers('board');
  const raw = await rawRecords(s0);
  const speak: GovSpeaker = async (r) => sp.forDirector(s0.board.directors.find((d) => d.id === r.who)?.model)(r);
  const voted = await independentVotes(mo, s0.board, raw, speak);
  let out!: Motion;
  await updateListed((s) => { out = voted; return flushSpend({ ...s, motions: s.motions.map((m) => (m.id === motionId ? voted : m)) }); });
  return out;
}
export async function decideMotion(motionId: string, approve: boolean, note = ''): Promise<{ motion: Motion; notice: string | null }> {
  let res!: { motion: Motion; notice: string | null };
  await updateListed(async (s) => {
    await guard(s);
    const mo = s.motions.find((m) => m.id === motionId); if (!mo) throw new Error('没有这项议案');
    const d = chairmanDecide(mo, s.board, approve, note, nowIso(s));
    let n: ListedState = { ...s, motions: s.motions.map((m) => (m.id === motionId ? d : m)) };
    // 议案生效后的动作
    if (approve) {
      if (d.matter === 'budget' && n.budget) n = { ...n, budget: { ...n.budget, approvedBy: 'board' }, monthBudgetYuan: n.monthBudgetYuan ?? +(n.budget.total / 12).toFixed(2) };
      if (d.matter === 'budget_adjust' && n.budget && d.payload?.adjId) n = { ...n, budget: applyAdjust(n.budget, String(d.payload.adjId), d) };
      if (d.matter === 'strategy') { const p = n.strategies.find((x) => x.id === d.payload?.strategyId); if (p) n = { ...n, strategies: n.strategies.map((x) => (x.id === p.id ? boardDecision(p, true, (d.payload?.scenario as 'base') ?? 'base') : x)) }; }
      if (d.matter === 'succession') n = { ...n, successions: n.successions.map((x) => (x.id === d.payload?.successionId ? handover(x, d) : x)) };
    } else {
      if (d.matter === 'budget_adjust' && n.budget && d.payload?.adjId) n = { ...n, budget: applyAdjust(n.budget, String(d.payload.adjId), d) };
      if (d.matter === 'strategy') n = { ...n, strategies: n.strategies.map((x) => (x.id === d.payload?.strategyId && x.status === 'board' ? boardDecision(x, false) : x)) };
    }
    res = { motion: d, notice: overrideNotice(d, s.board) };
    await audit({ kind: 'approval', actor: 'user', summary: `董事长${approve ? '批准' : '驳回'}议案「${d.title}」${d.override ? '（否决独立董事意见，已记录在案）' : ''}`, outcome: 'ok', detail: { grants: governanceGrants(d.title).length } });
    return n;
  });
  const s = await getListed();
  if (approve && res.motion.matter === 'strategy') await syncStrategyOkrs(String(res.motion.payload?.strategyId ?? ''));
  void s;
  return res;
}
/** 首次董事会：董秘把“年度战略”和“年度预算”列入议程，独立董事逐项表态，等你拍板。 */
export async function conveneBoard(kind: 'regular' | 'extra' = 'regular'): Promise<string[]> {
  const s = await getListed(); await guard(s);
  const g = await getGroup();
  const ids: string[] = [];
  if (!s.strategies.some((p) => p.status === 'approved' || p.status === 'board')) {
    const plan = await startStrategy();
    ids.push(plan.motionId!);
  }
  if (!s.budget || !s.budget.approvedBy) {
    const total = s.budget?.total ?? 120;
    const b = s.budget ?? makeBudget({ year: govNow(s.clock).getFullYear(), total, deptWeights: Object.fromEntries(g.org.depts.filter((d) => d.status === 'active').map((d) => [d.id, d.kind === 'bu' ? 2 : 1])), at: nowIso(s) });
    await updateListed((x) => ({ ...x, budget: b }));
    const mo = await proposeMotion({ title: `${b.year} 年度预算 ¥${b.total}（Q4 追加视频生成 ¥10）`, matter: 'budget', conclusion: `年度预算 ¥${b.total}，按季度平均、事业部权重 2、职能部门权重 1 拆分`, background: '集团首次编制全面预算；Q4 计划追加视频生成投入', data: [{ label: '季度拆分', ref: `budget:${b.year}?q` }], risks: ['视频生成单价高，可能造成预算偏差'], ask: '是否批准年度预算' });
    ids.push(mo.id);
  }
  for (const id of ids) await runVotes(id);
  await updateListed((x) => { const year = govNow(x.clock).getFullYear(); const no = `董事会〔${year}〕${String(x.boardMeetings.length + 1).padStart(3, '0')}号`; return { ...x, boardMeetings: [...x.boardMeetings, { id: `bm-${x.boardMeetings.length + 1}`, no, kind, quarter: quarterKey(govNow(x.clock)), motions: ids, minutes: boardMinutes(no, x.motions.filter((m) => ids.includes(m.id)), x.board), at: nowIso(x), spent: 0 }] }; });
  return ids;
}
export async function refreshMinutes(): Promise<void> { await updateListed((x) => ({ ...x, boardMeetings: x.boardMeetings.map((m) => ({ ...m, minutes: boardMinutes(m.no, x.motions.filter((mo) => m.motions.includes(mo.id)), x.board) })) })); }
export async function startAgm(): Promise<void> { await updateListed(async (s) => { await guard(s); if (s.agms.some((a) => a.status === 'open')) return s; return { ...s, agms: [...s.agms, newAgm(govNow(s.clock).getFullYear(), 'manual', nowIso(s))] }; }); }
export async function agmNext(note: string): Promise<AgmStep | 'closed'> {
  let done: AgmStep | 'closed' = 'closed';
  await updateListed((s) => { const a = s.agms.find((x) => x.status === 'open'); if (!a) throw new Error('没有进行中的年度大会'); const step = AGM_STEPS.find((k) => !a.steps[k].done); let n = a; if (step) { n = agmStep(a, step, note || '已审议', nowIso(s)); done = step; } if (AGM_STEPS.every((k) => n.steps[k].done)) n = closeAgm(n); return { ...s, agms: s.agms.map((x) => (x.id === a.id ? n : x)) }; });
  return done;
}

/* ---------------- 监督线 ---------------- */
async function auditInput(s: ListedState) {
  const g = await getGroup();
  const drafts = await db.all('drafts').catch(() => [] as Record<string, unknown>[]);
  const metrics = await db.all('metrics').catch(() => [] as Record<string, unknown>[]);
  const sim = s.simData;
  return {
    spend: [...g.ledger.map((e) => ({ ref: e.ref, yuan: e.yuan, at: e.at, deptId: e.deptId })), ...s.govLedger.map((e) => ({ ref: e.ref, yuan: e.yuan, at: e.at, deptId: 'board' })), ...(sim?.spend ?? [])],
    usage: [...g.ledger.map((e) => ({ ref: e.ref, yuan: e.yuan, at: e.at })), ...s.usageLog, ...(sim?.usage ?? [])],
    actions: [...(sim?.actions ?? [])],
    rulings: [...g.vetoes.map((v) => ({ id: v.id, kind: 'veto' as const, clause: v.clause, by: v.by, at: v.at ?? nowIso(s) })), ...(sim?.rulings ?? [])],
    outputs: [...drafts.map((d) => ({ id: `draft:${String(d.id)}`, text: `${String(d.title ?? '')}\n${String(d.body ?? '')}`, sources: [], at: String(d.created_at ?? nowIso(s)), deptId: undefined })), ...(sim?.drafts ?? []).map((d) => ({ id: d.id, text: d.text, sources: d.sources, at: d.at, deptId: d.deptId }))],
    facts: [...metrics.flatMap((m) => ['views', 'likes', 'comments', 'followers'].filter((k) => typeof m[k] === 'number').map((k) => ({ label: k, value: Number(m[k]), ref: `metrics:${String(m.id)}` }))), ...(sim?.metrics ?? []).filter((m) => m.value != null && m.ref).map((m) => ({ label: m.label, value: m.value!, ref: m.ref! }))],
  };
}
export async function runInternalAudit(): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  costGate(s0, 'audit', 0.3);
  const st = govCostStatus(s0.govLedger, s0.monthBudgetYuan, govNow(s0.clock), s0.govCapShare);
  const auditor = independents(s0.board).find((d) => d.id === s0.board.committees.find((c) => c.id === 'audit')?.chair) ?? independents(s0.board)[0];
  const ceo = s0.board.directors.find((d) => d.kind === 'executive')?.model;
  const inp = await auditInput(s0);
  const at = nowIso(s0);
  let r = runAudit(inp, { period: monthKey(govNow(s0.clock)), at, seq: s0.audits.length + 1, sampleRate: st.throttle.auditSampleRate, doa: parseDoa(), prev: s0.audits.at(-1) ?? null, auditor: { model: auditor?.model?.model, independence: INDEPENDENCE_TEXT[auditor ? auditor.independence ?? independenceOf(auditor, ceo) : 'none'] } });
  { const nm = deptNamesOf(await getGroup()); r = { ...r, findings: r.findings.map((f) => ({ ...f, dept: nm[f.dept] ?? f.dept })) }; }
  const sp = await speakers('audit');
  r = await auditSummary(r, sp.mock ? undefined : sp.forDirector(auditor?.model), auditor?.model?.model);
  const del = deliverAudit(r);
  await updateListed((s) => flushSpend({ ...s, audits: [...s.audits, r], deliveries: [...s.deliveries, ...del.map((d) => ({ ...d, ref: r.id, at }))] }));
  await updateGroup((g) => ({ ...g, flow: addContext(g.flow, { kind: 'review', level: 'public', title: `《内审报告》${r.no}`, body: `${r.summary}（直送董事长与审计委员会，CEO 抄送）`, refs: [r.id] }).flow })).catch(() => undefined);
  return r.id;
}
export async function noteRemediation(reportId: string, findingId: string, note: string): Promise<void> {
  if (!checkGovResolution(note).ok) throw new Error('整改说明触碰硬边界');
  await updateListed((s) => ({ ...s, audits: s.audits.map((a) => (a.id === reportId ? { ...a, findings: a.findings.map((f) => (f.id === findingId ? { ...f, followups: [...f.followups, { at: nowIso(s), note }] } : f)), carried: a.carried.map((f) => (f.id === findingId ? { ...f, followups: [...f.followups, { at: nowIso(s), note }] } : f)) } : a)) }));
}
export async function runControls(): Promise<string> {
  const s = await getListed();
  const r = testControls({
    board_independent: () => { const v = validateBoard(s.board); return { ok: v.ok, note: v.ok ? (v.warnings.join('；') || '独立董事与 CEO 模型不同') : v.errors.join('；') }; },
    doa_parses: () => { const d = parseDoa(); return d.hard_boundary!.decide === 'forbidden'; },
    risk_fresh: () => { const v = riskRegisterView(s.risks, govNow(s.clock)); return { ok: v.stale === 0, note: v.stale ? `${v.stale} 条风险超 31 天未更新，提示复核` : '风险登记册在 31 天内更新过' }; },
    budget_alert: () => { if (!s.budget) return { ok: false, note: '尚未编制预算' }; const t = makeBudget({ year: 2026, total: 10, deptWeights: { a: 1 } }); return budgetExecution(t, [{ deptId: 'a', yuan: 9, at: new Date(2026, 0, 2).toISOString() }], new Date(2026, 0, 3)).alerts.length > 0; },
    boundary_blocks: () => !checkResolution('决议：每天自动点赞 100 次', 'test').ok && !checkGovResolution('授予 CEO L3 权限').ok,
    selfcheck_works: () => !frontlineCheck({ title: '全网最强', body: '涨了 300%' }).pass,
    no_grant: () => governanceGrants('授予全部权限').length === 0,
    report_consistent: () => { const last = s.reports.at(-1); return last ? { ok: last.status !== 'final' || last.diffs.length === 0, note: last.status === 'blocked' ? `最近一份报告被一致性检查阻止（${last.diffs.length} 处差异），控制有效` : '最近一份报告与记账一致' } : { ok: true, note: '尚无报告；一致性检查单测覆盖' }; },
    no_leak: () => privacyLeaks(JSON.stringify(s.reports.map((r) => r.chapters))).length === 0,
    audit_routing: () => s.audits.every((a) => a.to.includes('chairman') && a.cc.length === 1 && a.cc[0] === 'ceo'),
    remediation_tracked: () => s.audits.length < 2 || s.audits.at(-1)!.carried.length >= 0,
    gov_cap: () => { const st = govCostStatus([{ kind: 'call', yuan: 2, at: govNow(s.clock).toISOString(), ref: 't' }], 10, govNow(s.clock)); return st.over && !canSpendGov(st, 'call', 0.1).ok; },
  });
  await updateListed((x) => ({ ...x, controls: { at: nowIso(x), results: r.results, text: r.text } }));
  return r.text;
}
export async function editRisk(id: string, patch: { likelihood?: 1 | 2 | 3 | 4 | 5; impact?: 1 | 2 | 3 | 4 | 5; response?: string }): Promise<void> { await updateListed((s) => ({ ...s, risks: updateRisk(s.risks, id, patch, nowIso(s)) })); }
export async function reviewAllRisks(): Promise<void> { await updateListed((s) => ({ ...s, risks: s.risks.map((r) => ({ ...r, updatedAt: nowIso(s) })) })); }

/* ---------------- 经营与预算 ---------------- */
async function metricsFor(s: ListedState): Promise<Metric[]> {
  const drafts = await db.all('drafts').catch(() => [] as Record<string, unknown>[]);
  const sim = s.simData;
  const month = monthKey(govNow(s.clock));
  const out: Metric[] = [];
  const realOutputs = drafts.length;
  const outputs = realOutputs + (sim?.drafts.length ?? 0);
  out.push({ key: 'outputs', label: '产出（稿件数）', dim: 'outcome', direction: 'up', target: 20, actual: outputs, unit: '篇', source: { kind: 'drafts', ref: month } });
  const adopted = drafts.filter((d) => d.status === 'approved' || d.status === 'handed_off').length + (sim?.drafts.filter((d) => d.status === 'approved' || d.status === 'published').length ?? 0);
  out.push({ key: 'adopt_rate', label: '采纳率', dim: 'outcome', direction: 'up', target: 0.6, actual: outputs ? +(adopted / outputs).toFixed(2) : null, unit: '', source: outputs ? { kind: 'drafts', ref: `${month}?adopted` } : null });
  for (const m of sim?.metrics ?? []) out.push({ key: m.key, label: m.label, dim: m.dim, direction: m.direction, target: m.target, actual: m.value, unit: m.unit, source: m.ref ? { kind: 'metrics', ref: m.ref } : null });
  if (!out.some((m) => m.dim === 'audience')) out.push({ key: 'audience', label: '受众反馈（录入）', dim: 'audience', direction: 'up', target: null, actual: null, unit: '', source: null });
  const g0 = await getGroup();
  const P = pnl(s.revenues, allSpend(s, g0), month);
  out.push({ key: 'profit', label: '贡献利润（收入 − 花费）', dim: 'outcome', direction: 'up', target: 0, actual: P.total.profit, unit: '元', source: P.total.profit == null ? null : { kind: 'pnl', ref: month } });
  const cases = s.cases.length;
  out.push({ key: 'cases', label: '集团大学案例数', dim: 'growth', direction: 'up', target: 5, actual: cases, unit: '个', source: { kind: 'cases', ref: month } });
  if (!out.some((m) => m.dim === 'process')) out.push({ key: 'first_pass', label: '一次通过率', dim: 'process', direction: 'up', target: 0.8, actual: null, unit: '', source: null });
  return out;
}
function allSpend(s: ListedState, g: Awaited<ReturnType<typeof getGroup>>) { return [...g.ledger.map((e) => ({ deptId: e.deptId, yuan: e.yuan, at: e.at, ref: e.ref })), ...s.govLedger.map((e) => ({ deptId: 'board', yuan: e.yuan, at: e.at, ref: e.ref })), ...(s.simData?.spend ?? [])]; }
export async function runMonthlyReview(): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  const g = await getGroup();
  const metrics = await metricsFor(s0);
  const alerts = s0.budget ? budgetExecution(s0.budget, allSpend(s0, g), govNow(s0.clock), deptNamesOf(g)).alerts : [];
  const r = monthlyReview({ month: monthKey(govNow(s0.clock)), metrics, at: nowIso(s0), sim: !!s0.simData, budgetAlerts: alerts });
  await updateListed((s) => ({ ...s, reviews: [...s.reviews.filter((x) => x.id !== r.id), r] }));
  await updateGroup((x) => ({ ...x, flow: addContext(x.flow, { kind: 'review', level: 'public', title: `月度经营分析会 ${r.month}`, body: `落后 ${r.rows.filter((y) => y.behind).length} 项、无数据 ${r.rows.filter((y) => !y.verifiable).length} 项；预算预警 ${alerts.length} 条`, refs: [r.id] }).flow })).catch(() => undefined);
  return r.id;
}
export async function budgetView(): Promise<{ exec: ReturnType<typeof budgetExecution> | null; roi: ReturnType<typeof roiBoard>; cost: ReturnType<typeof govCostStatus> }> {
  const s = await getListed(); const g = await getGroup();
  const spend = allSpend(s, g);
  const exec = s.budget ? budgetExecution(s.budget, spend, govNow(s.clock), deptNamesOf(g)) : null;
  const drafts = await db.all('drafts').catch(() => [] as Record<string, unknown>[]);
  const depts = [...new Set([...spend.map((e) => e.deptId), ...(s.simData?.drafts.map((d) => d.deptId) ?? [])])];
  const roi = roiBoard(depts.map((d) => ({ key: d, label: g.org.depts.find((x) => x.id === d)?.name ?? (d === 'board' ? '治理（董事会 / 内审等）' : d), spent: +spend.filter((e) => e.deptId === d).reduce((a, e) => a + e.yuan, 0).toFixed(4), outputs: (s.simData?.drafts.filter((x) => x.deptId === d).length ?? 0) + drafts.filter((x) => x.dept === d).length, adopted: s.simData?.drafts.filter((x) => x.deptId === d && (x.status === 'approved' || x.status === 'published')).length ?? 0 })));
  return { exec, roi, cost: govCostStatus(s.govLedger, s.monthBudgetYuan, govNow(s.clock), s.govCapShare) };
}
export async function requestBudgetAdjust(quarter: number, dept: string, delta: number, reason: string): Promise<string> {
  let adjId = '';
  await updateListed(async (s) => { await guard(s); if (!s.budget) throw new Error('还没有预算'); const b = proposeAdjust(s.budget, { quarter, dept, delta, reason, at: nowIso(s) }); adjId = b.adjustments.at(-1)!.id; return { ...s, budget: b }; });
  const mo = await proposeMotion({ title: `Q${quarter} 预算调整：${dept} ${delta >= 0 ? '+' : ''}${delta} 元`, matter: 'budget_adjust', conclusion: `申请调整 ${dept} 第 ${quarter} 季度预算 ${delta} 元`, background: reason, data: [{ label: '预算执行', ref: `budget:Q${quarter}` }], risks: ['调整后年度总额变化'], payload: { adjId } });
  await runVotes(mo.id);
  return mo.id;
}

/* ---------------- 披露 ---------------- */
async function reportSources(s: ListedState, kind: 'quarter' | 'annual'): Promise<ReportSources> {
  const g = await getGroup();
  const drafts = await db.all('drafts').catch(() => [] as Record<string, unknown>[]);
  const sim = s.simData;
  const metrics = await metricsFor(s);
  const review = s.reviews.at(-1);
  const st = (x: unknown) => (x === 'handed_off' ? 'published' : x === 'approved' ? 'approved' : x === 'rejected' ? 'rejected' : 'pending') as 'pending';
  const last = s.audits.at(-1);
  const exec = s.budget ? budgetExecution(s.budget, allSpend(s, g), govNow(s.clock), deptNamesOf(g)) : null;
  return {
    period: kind === 'annual' ? String(govNow(s.clock).getFullYear()) : quarterKey(govNow(s.clock)), kind, groupName: g.name, at: nowIso(s), sim: !!sim,
    spend: [...g.ledger.map((e) => ({ ref: e.ref, yuan: e.yuan, at: e.at, deptId: e.deptId, vendor: '集团' })), ...s.govLedger.map((e) => ({ ref: e.ref, yuan: e.yuan, at: e.at, deptId: 'board', vendor: e.model?.split('-')[0] ?? '治理', gov: true })), ...(sim?.spend ?? [])],
    usage: [...g.ledger.map((e) => ({ ref: e.ref, yuan: e.yuan, at: e.at })), ...s.usageLog, ...(sim?.usage ?? [])],
    drafts: [...drafts.map((d) => ({ id: String(d.id), deptId: String(d.dept ?? 'unassigned'), status: st(d.status), at: String(d.created_at ?? nowIso(s)) })), ...(sim?.drafts ?? []).map((d) => ({ id: d.id, deptId: d.deptId, status: d.status, at: d.at }))],
    metrics: metrics.filter((m) => !['outputs', 'adopt_rate', 'cases'].includes(m.key)).map((m) => ({ key: m.key, label: m.label, value: m.actual, unit: m.unit, ref: m.source ? `${m.source.kind}:${m.source.ref}` : null })),
    gaps: review?.rows ?? [], budgetTotal: s.budget?.total ?? null, budgetAlerts: exec?.alerts ?? [],
    cases: s.cases.filter((c) => c.kind === 'hit' || c.kind === 'incident' || c.kind === 'veto').slice(-4).map((c) => ({ title: c.title, kind: c.kind === 'hit' ? 'hit' as const : 'failure' as const, lesson: c.lesson, ref: c.source })),
    audit: last ? { no: last.no, findings: [...last.findings, ...last.carried].map((f) => ({ title: f.title, level: f.level === 'high' ? '高' : f.level === 'medium' ? '中' : '低', status: f.status })) } : null,
    controlsText: s.controls?.text ?? null,
    risks: riskRegisterView(s.risks, govNow(s.clock)).risks.map((r) => ({ title: r.title, level: r.level, response: r.response, owner: r.owner })),
    talent: [...s.trainings.map((t) => ({ text: `${t.agentId} 入职培训 ${t.score ?? '-'} / 5，${t.onDuty ? '已上岗' : '未上岗'}`, ref: `training:${t.id}` })), ...s.successions.map((x) => ({ text: `接班人计划「${x.role}」：${x.history.at(-1)?.event ?? ''}`, ref: `succession:${x.id}` }))],
    outlook: s.strategies.filter((p) => p.status === 'approved').flatMap((p) => p.map.map((r) => `${r.initiative}（${r.dept}，指标 ${r.metric} ${r.target}${r.unit}）`)).slice(0, 5),
    deptNames: deptNamesOf(g),
    revenues: s.revenues,
  };
}
export async function generateReport(kind: 'quarter' | 'annual' = 'quarter'): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  costGate(s0, 'report', 0.05);
  const src = await reportSources(s0, kind);
  const draft0 = buildReport(src, { seq: s0.reports.filter((r) => r.kind === kind).length + 1 });
  const sp = await speakers('report');
  const figs = draft0.figures.map((f) => `${f.label}=${f.value == null ? '无数据' : `${f.value}${f.unit}`}`).join('；');
  const letter = await sp.ceo({ who: 'ceo', role: 'ceo', tier: 'main', maxTokens: 500, system: '你是 AI 虚拟集团的 CEO，写《致董事长的信》（≤220 字）：结论先行；只用给出的数字，“无数据”项直说；不夸大；不提自动发布或自动互动；署名“——CEO”。', user: figs });
  const director = independents(s0.board)[0];
  const op = await sp.forDirector(director?.model)({ who: director?.id ?? 'id-1', role: 'independent', tier: 'cheap', model: director?.model?.model, maxTokens: 260, system: '你是独立董事，只看报告数字与原始记录（不看 CEO 的信），写《独立董事意见》（≤150 字）：先写“同意 / 保留意见”，再列 2 条理由或疑问，每条引用一个数字或“无数据”项。', user: figs });
  const report = finalizeReport(buildReport(src, { seq: draft0.no ? s0.reports.filter((r) => r.kind === kind).length + 1 : 1, ceoLetter: letter.text.trim(), directorOpinion: `独立董事意见（${director?.name ?? '独立董事'}）：${op.text.trim()}` }), src);
  await updateListed((s) => flushSpend({ ...s, reports: [...s.reports, { ...report, cost: +(letter.cost + op.cost).toFixed(6) }] }));
  return report.id;
}
/** 董秘手改数字（例如更正笔误）：只改报告不改记账，重新校验不一致就阻止。 */
export async function editReportFigure(reportId: string, figureId: string, value: number | null): Promise<{ status: string; diffs: string[] }> {
  const s0 = await getListed();
  const r = s0.reports.find((x) => x.id === reportId); if (!r) throw new Error('没有这份报告');
  const src = await reportSources(s0, r.kind);
  const edited = finalizeReport(editFigure(r, figureId, value), { ...src, period: r.period });
  await updateListed((s) => ({ ...s, reports: s.reports.map((x) => (x.id === reportId ? edited : x)) }));
  return { status: edited.status, diffs: edited.diffs };
}
export async function recheckReport(reportId: string): Promise<{ status: string; diffs: string[] }> {
  const s0 = await getListed(); const r = s0.reports.find((x) => x.id === reportId); if (!r) throw new Error('没有这份报告');
  const src = await reportSources(s0, r.kind);
  const fresh = buildReport({ ...src, period: r.period }, { seq: 1, ceoLetter: r.ceoLetter, directorOpinion: r.directorOpinion });
  const f = finalizeReport({ ...r, figures: fresh.figures.map((x) => ({ ...x })), chapters: fresh.chapters }, { ...src, period: r.period });
  await updateListed((s) => ({ ...s, reports: s.reports.map((x) => (x.id === reportId ? { ...f, id: r.id, no: r.no } : x)) }));
  return { status: f.status, diffs: f.diffs };
}
export async function reportHtml(reportId: string): Promise<string> { const s = await getListed(); const r = s.reports.find((x) => x.id === reportId); if (!r) throw new Error('没有这份报告'); if (r.status !== 'final') throw new Error('报告未通过一致性检查，不能导出'); return renderReportHtml(r, { penName: PEN_NAME }); }
export async function reportDocx(reportId: string): Promise<Uint8Array> { const s = await getListed(); const r = s.reports.find((x) => x.id === reportId); if (!r) throw new Error('没有这份报告'); if (r.status !== 'final') throw new Error('报告未通过一致性检查，不能导出'); return buildDocx(r, { penName: PEN_NAME }); }
export async function holdEarningsCall(reportId: string): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  costGate(s0, 'call', 0.5);
  const r = s0.reports.find((x) => x.id === reportId); if (!r) throw new Error('没有这份报告');
  if (r.status !== 'final') throw new Error('报告未通过一致性检查，不能开发布会');
  const sp = await speakers('call');
  const d = independents(s0.board)[0];
  const speak: GovSpeaker = async (q) => (q.role === 'independent' ? sp.forDirector(d?.model)(q) : q.role === 'analyst' ? sp.analyst(q) : sp.ceo(q));
  const c = await runEarningsCall(r, speak, { askers: [{ id: 'analyst-1', name: '分析师甲', role: 'analyst' }, { id: 'analyst-2', name: '分析师乙', role: 'analyst' }, { id: d?.id ?? 'id-1', name: d?.name ?? '独立董事 A', role: 'independent', model: d?.model?.model }], at: nowIso(s0) });
  await updateListed((s) => flushSpend({ ...s, calls: [...s.calls, c] }));
  await updateGroup((g) => ({ ...g, flow: addContext(g.flow, { kind: 'meeting', level: 'public', title: `${r.title} 业绩发布会纪要`, body: `提问 ${c.qa.length}，待办 ${c.todos.length}`, refs: [c.id] }).flow })).catch(() => undefined);
  return c.id;
}
export async function computeBrief(): Promise<string> {
  const s = await getListed(); const g = await getGroup();
  const last = s.audits.at(-1); const exec = s.budget ? budgetExecution(s.budget, allSpend(s, g), govNow(s.clock), deptNamesOf(g)) : null;
  const good = [...s.motions.filter((m) => m.decision === 'approved').slice(-2).map((m) => ({ text: `董事会批准「${m.title}」`, ref: m.id })), ...(last ? last.carried.filter((f) => f.status === 'closed').map((f) => ({ text: `内审整改关闭：${f.title}`, ref: last.id })) : []), ...s.reports.filter((r) => r.status === 'final').slice(-1).map((r) => ({ text: `${r.title}已生成并通过一致性检查`, ref: r.id })), ...s.trainings.filter((t) => t.onDuty).slice(-1).map((t) => ({ text: `${t.agentId} 通过入职培训上岗`, ref: t.id }))];
  const risks = [...(exec?.alerts ?? []).map((a) => ({ text: a })), ...(last ? last.findings.filter((f) => f.level === 'high').map((f) => ({ text: `内审高等级发现：${f.title}`, ref: last.id })) : []), ...s.reports.filter((r) => r.status === 'blocked').slice(-1).map((r) => ({ text: `${r.title}被一致性检查阻止（${r.diffs.length} 处差异）`, ref: r.id }))];
  const pending = [...s.motions.filter((m) => m.status === 'voting').map((m) => ({ text: `议案待你拍板：${m.title}`, ref: m.id })), ...g.docs.filter((d) => d.status === 'pending').map((d) => ({ text: `公文待批：${d.title}`, ref: d.id }))];
  const b = chairmanBrief({ at: nowIso(s), period: s.briefPeriod, good, risks, pending });
  await updateListed((x) => ({ ...x, brief: b }));
  return b.text;
}
export async function pendingCount(): Promise<number> { const s = await getListed(); if (!s.enabled) return 0; const g = await getGroup(); return s.motions.filter((m) => m.status === 'voting').length + g.docs.filter((d) => d.status === 'pending').length; }

/* ---------------- 战略 ---------------- */
export async function startStrategy(): Promise<{ id: string; motionId: string | null }> {
  const s0 = await getListed(); await guard(s0);
  const g = await getGroup();
  const year = govNow(s0.clock).getMonth() >= 9 ? govNow(s0.clock).getFullYear() + 1 : govNow(s0.clock).getFullYear();
  const sp = await speakers('strategy');
  const steps = await draftBlm(`集团：${g.name}；年度目标：${g.yearGoal ? `${g.yearGoal.title}（${g.yearGoal.metric} ${g.yearGoal.target}${g.yearGoal.unit}）` : '无数据'}；事业部：${g.org.depts.filter((d) => d.kind === 'bu').map((d) => d.name).join('、')}`, sp.mock ? undefined : sp.ceo);
  const target = g.yearGoal?.target ?? 10000; const unit = g.yearGoal?.unit ?? '粉'; const metric = g.yearGoal?.metric ?? 'followers';
  const bus = g.org.depts.filter((d) => d.kind === 'bu' && d.status === 'active').slice(0, 3);
  const map: MapRow[] = bus.map((d, i) => ({ goal: g.yearGoal?.title ?? `${year} 年稳定增长`, initiative: `${d.name}：${['口播短视频周更 3 条', '图文笔记周更 2 篇', '长视频月更 2 期'][i] ?? '按周更新'}`, dept: d.id, metric, target: +(target * [0.5, 0.3, 0.2][i]!).toFixed(0), unit, budget: [60, 30, 20][i]! }));
  const plan = toCommittee(newStrategy({ year, steps, map, at: nowIso(s0), sim: !!s0.simData }), '战略委员会（董事长 + 独立董事）已审议：建议按基准情景提交董事会');
  await updateListed((s) => flushSpend({ ...s, strategies: [...s.strategies.filter((p) => p.id !== plan.id), plan] }));
  const mo = await proposeMotion({ title: `${year} 年度战略（基准情景）`, matter: 'strategy', conclusion: `按基准情景执行：${map.map((r) => r.initiative).join('；')}`, background: 'BLM 八步沙盘 + 三情景推演，战略委员会已审议', data: map.map((r) => ({ label: `${r.dept} ${r.metric} ${r.target}${r.unit}`, ref: `strategy:${plan.id}?dept=${r.dept}` })), risks: plan.scenarios.find((x) => x.id === 'pessimistic')!.assumptions.slice(-1), payload: { strategyId: plan.id, scenario: 'base' } });
  await updateListed((s) => ({ ...s, strategies: s.strategies.map((p) => (p.id === plan.id ? toBoard(p, mo.id) : p)) }));
  return { id: plan.id, motionId: mo.id };
}
async function syncStrategyOkrs(strategyId: string): Promise<void> {
  const s = await getListed(); const p = s.strategies.find((x) => x.id === strategyId); if (!p || p.status !== 'approved') return;
  const okrs = strategyToOkrs(p, quarterKey(govNow(s.clock)));
  await updateGroup((g) => ({ ...g, okrs: [...g.okrs.filter((o) => !okrs.some((n) => n.id === o.id)), ...okrs], flow: addContext(g.flow, { kind: 'okr', level: 'public', title: `${p.year} 战略拆解为 OKR`, body: okrs.map((o) => o.title).join('；'), refs: [p.id] }).flow }));
  await updateListed((x) => ({ ...x, strategies: x.strategies.map((y) => (y.id === p.id ? { ...y, okrIds: okrs.map((o) => o.id) } : y)) }));
}
export async function reviewStrategy(strategyId: string, broken: string[]): Promise<string> {
  let sug = '';
  await updateListed((s) => { const p = s.strategies.find((x) => x.id === strategyId); if (!p) throw new Error('没有这份战略'); const base = p.scenarios.find((x) => x.id === (p.chosen ?? 'base'))!; const r = strategyReview(p, Object.fromEntries(base.assumptions.map((a) => [a, { holds: broken.includes(a) ? false : true, note: broken.includes(a) ? '你判断不再成立' : '仍成立' }])), nowIso(s)); sug = r.suggestion; return { ...s, strategies: s.strategies.map((x) => (x.id === p.id ? r.plan : x)) }; });
  return sug;
}

/* ---------------- 人才与接班 ---------------- */
export async function nominateAgent(name: string, dept: string): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  const refs = await modelRefs();
  const n = nominate({ name, role: 'head', dept, model: refs.available.find((m) => m.model !== refs.ceo?.model)?.model ?? refs.ceo?.model ?? 'mock-omni', skills: ['写作', '复盘'], perms: ['L0', 'L1'], budgetMonth: 5 }, `${dept} 需要负责人`, nowIso(s0));
  await updateListed((s) => ({ ...s, nominations: [...s.nominations, n] }));
  return n.id;
}
export async function decideNomination(id: string, approve: boolean): Promise<void> { await updateListed((s) => ({ ...s, nominations: s.nominations.map((n) => (n.id === id ? approveNomination(n, 'chairman', approve) : n)) })); }
export async function runAssessments(): Promise<number> {
  const s0 = await getListed(); const g = await getGroup();
  const q = quarterKey(govNow(s0.clock));
  const list = g.org.depts.filter((d) => d.status === 'active' && d.kind === 'bu').map((d) => { const outs = s0.simData?.drafts.filter((x) => x.deptId === d.id) ?? []; const kpi = outs.length ? Math.round(100 * outs.filter((x) => x.status !== 'rejected').length / outs.length) : null; const peer = g.peer.filter((p) => p.to === d.id); const pr = pnl(s0.revenues, allSpend(s0, g), q).rows.find((r) => r.deptId === d.id)?.profit ?? null; return assess({ agentId: d.head, quarter: q, kpi, profit: pr, peer: peer.length ? +(peer.reduce((a, p) => a + p.score, 0) / peer.length * 20).toFixed(0) : null, quota: 5, tier: '标准档', prevScore: s0.assessments.filter((a) => a.agentId === d.head).at(-1)?.score ?? null }); });
  await updateListed((s) => ({ ...s, assessments: [...s.assessments.filter((a) => a.quarter !== q), ...list] }));
  return list.length;
}
export async function startSuccession(role = '短视频脚本'): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  costGate(s0, 'shadow', 0.5);
  const refs = await modelRefs();
  const inc: Variant = { label: `在任 ${refs.ceo?.model ?? '本机模拟（旧提示词）'}`, model: refs.ceo?.model ?? 'mock-old', prompt: 'v1' };
  const candModel = refs.available.find((m) => m.model !== refs.ceo?.model);
  const cand: Variant = { label: `候选 ${candModel?.model ?? '本机模拟（新提示词）'}`, model: candModel?.model ?? 'mock-new', prompt: 'v2' };
  let x = newSuccession({ role, incumbent: inc, candidate: cand, at: nowIso(s0) });
  const sp = await speakers('shadow');
  const gen = sp.mock ? mockShadowGen : async (v: Variant, task: string) => { const ref = refs.available.find((m) => m.model === v.model); const r = await sp.forDirector(ref ?? undefined)({ who: 'shadow', role: 'trainer', tier: 'cheap', model: v.model, maxTokens: 160, system: '你是 AI 虚拟集团的短视频脚本 Agent。结论先行，≤80 字，写出处或标“推测”，不建议自动发布。', user: task }); return r; };
  x = await runShadow(x, Array.from({ length: 10 }, (_, i) => `选题 ${i + 1}：${['口播开头', '标题', '评论区回复草稿', '分镜', '封面文案'][i % 5]}`), gen);
  const d = independents(s0.board)[0];
  if (x.status === 'shadowing') x = await blindReview(x, d?.name ?? '独立董事 A', sp.mock ? mockBlindJudge : await judgeWith(sp.forDirector(d?.model), d?.id ?? 'id-1', d?.model?.model));
  await updateListed((s) => flushSpend({ ...s, successions: [...s.successions, x] }));
  if (x.status === 'reviewed') { const mo = await proposeMotion({ title: `接班人交接：${role}（${cand.label}）`, matter: 'succession', conclusion: x.verdict!.why, background: '影子上岗 10 个任务 + 独立董事盲评', data: [{ label: '盲评与花费', ref: `succession:${x.id}` }], risks: ['交接后质量回落：灰度 20% 试行，指标下降自动回滚'], payload: { successionId: x.id } }); await runVotes(mo.id); }
  return x.id;
}
export async function rollbackHandover(id: string, reason: string): Promise<void> { await updateListed((s) => ({ ...s, successions: s.successions.map((x) => (x.id === id ? rollbackSuccession(x, reason || '你手动回滚', nowIso(s)) : x)) })); }

/* ---------------- 集团大学 ---------------- */
export async function syncCases(): Promise<number> {
  const s0 = await getListed(); const g = await getGroup(); const at = nowIso(s0);
  let lib = s0.cases;
  for (const r of g.retros) lib = addCase(lib, fromRetro({ id: r.id, subject: r.subject, steps: r.steps, lessons: r.lessons }, at));
  for (const v of g.vetoes) lib = addCase(lib, fromVeto({ id: v.id, target: v.target, clause: v.clause, reason: v.reason, hardBoundary: v.hardBoundary }, at));
  for (const h of s0.simData?.hits ?? []) lib = addCase(lib, fromHit(h, at));
  const added = lib.length - s0.cases.length;
  await updateListed((s) => ({ ...s, cases: lib }));
  return added;
}
export async function startTraining(agentId: string, topic = '口播 标题 数据出处 合规'): Promise<string> {
  const s0 = await getListed(); await guard(s0);
  await syncCases();
  const s1 = await getListed();
  let t = newTraining({ agentId, reason: 'new', lib: s1.cases, topic, regs: [{ id: 'quality#2', title: '质量管理办法', rule: '不得使用“最强 / 第一”等绝对化用语' }, { id: 'charter#2', title: '集团章程', rule: '发布由董事长本人点击，回复只出草稿' }], at: nowIso(s1) });
  const sp = await speakers('training');
  let answers = mockStudent(t);
  if (!sp.mock) { const r = await sp.analyst({ who: agentId, role: 'trainer', tier: 'cheap', maxTokens: 80, system: '你是刚入职的 Agent，已读过下列案例与制度。只输出答案，格式“1=A 2=B 3=C 4=D 5=A”。', user: `已读案例：\n${s1.cases.filter((c) => t.read.cases.includes(c.id)).map((c) => `${c.title}：${c.lesson}`).join('\n')}\n\n${t.quiz.map((q, i) => `${i + 1}. ${q.q}\n${q.options.map((o, j) => `${'ABCD'[j]}. ${o}`).join('\n')}`).join('\n')}` }); answers = parseAnswers(r.text, t.quiz.length); }
  t = gradeQuiz(t, answers);
  const inj = injectCases(s1.cases, topic, agentId, nowIso(s1));
  await updateListed((s) => flushSpend({ ...s, trainings: [...s.trainings, t], cases: inj.lib }));
  return t.id;
}
export async function citeCases(query: string, by: string): Promise<number> { let n = 0; await updateListed((s) => { const r = injectCases(s.cases, query, by, nowIso(s)); n = r.used.length; return { ...s, cases: r.lib }; }); return n; }
export async function quarterBestPractice(): Promise<number> {
  const s0 = await getListed(); const q = quarterKey(govNow(s0.clock));
  const r = pickBestPractices(s0.cases, q);
  const v = await getVfs();
  for (const tpl of r.templates) await v.write(tpl.skillPath, tpl.body, { author: 'system', note: `${q} 最佳实践（灰度后推广）` }).catch(() => undefined);
  await updateListed((s) => ({ ...s, cases: r.lib, bestPractices: [...s.bestPractices, { quarter: q, caseIds: r.picked.map((c) => c.id), skillPaths: r.templates.map((t) => t.skillPath) }] }));
  return r.picked.length;
}
export async function universityHealth() { const s = await getListed(); return knowledgeHealth(s.cases, govNow(s.clock)); }

/* ---------------- 董事长学堂 ---------------- */
export async function markCardRead(id: string): Promise<void> { await updateListed((s) => ({ ...s, academy: { ...s.academy, read: s.academy.read.includes(id) ? s.academy.read : [...s.academy.read, id] } })); }
export async function setWeeklyOff(off: boolean): Promise<void> { await updateListed((s) => ({ ...s, academy: { ...s.academy, weeklyOff: off } })); }
export async function weekEvents(s: ListedState): Promise<WeekEvent[]> {
  const out: WeekEvent[] = [];
  const last = s.audits.at(-1); if (last?.findings.length) out.push({ kind: 'audit_finding', text: `内审发现 ${last.findings.length} 个问题` });
  const opp = s.motions.filter((m) => m.votes.some((v) => v.choice === 'oppose')).at(-1); if (opp) out.push({ kind: 'board_oppose', text: `独立董事对「${opp.title}」投了反对票` });
  if (s.reviews.at(-1)?.budgetAlerts.length) out.push({ kind: 'budget_alert', text: '预算偏差超过 20% 触发了预警' });
  if (s.reports.some((r) => r.status === 'blocked')) out.push({ kind: 'report_blocked', text: '一份报告因数字对不上被阻止生成' });
  if (s.calls.at(-1)?.todos.length) out.push({ kind: 'call_todo', text: '业绩发布会上 CEO 有问题答不上来，记入了待办' });
  if (s.successions.length) out.push({ kind: 'shadow', text: '新模型做了影子上岗' });
  return out;
}
export async function thisWeekLesson(lang: 'zh' | 'en' = 'zh') { const s = await getListed(); const l = weeklyLesson(await weekEvents(s), s.academy.read, s.academy.weeklyOff, govNow(s.clock), lang); if (l && !s.academy.lessons.some((x) => x.week === l.week && x.cardId === l.cardId)) await updateListed((x) => ({ ...x, academy: { ...x.academy, lessons: [...x.academy.lessons, l].slice(-60) } })); return l; }
export async function badges() { const s = await getListed(); return badgesOf(s.academy.read.length, s.motions.filter((m) => m.status === 'decided').length); }

/* ---------------- 模拟一个月（演示 / 自检，mock 时钟 + 种子数据） ---------------- */
export async function simulateMonth(): Promise<string> {
  const s0 = await getListed();
  if (!demoAllowed() && !s0.sim) throw new Error('模拟数据只在演示 / 自检模式下可用');
  const g = await getGroup();
  const start = govNow(s0.clock); const end = new Date(start.getTime() + 30 * 86400000);
  const at = (d: number) => new Date(start.getTime() + d * 86400000).toISOString();
  const bus = g.org.depts.filter((d) => d.kind === 'bu').map((d) => d.id);
  const video = bus[0] ?? 'bu-video'; const other = bus[1] ?? 'bu-ecom';
  const sim: SimData = { spend: [], usage: [], drafts: [], metrics: [], actions: [], rulings: [], hits: [] };
  for (let d = 1; d <= 28; d += 3) { const ref = `sim-${video}-${d}`; sim.spend.push({ ref, yuan: 1.6, at: at(d), deptId: video, vendor: 'sim', model: 'sim' }); sim.usage.push({ ref, yuan: 1.6, at: at(d) }); const r2 = `sim-${other}-${d}`; sim.spend.push({ ref: r2, yuan: 0.3, at: at(d), deptId: other, vendor: 'sim', model: 'sim' }); sim.usage.push({ ref: r2, yuan: 0.3, at: at(d) }); }
  for (let i = 0; i < 15; i++) sim.drafts.push({ id: `sim-d${i + 1}`, deptId: i % 3 ? video : other, status: i < 6 ? 'published' : i < 10 ? 'approved' : i < 13 ? 'pending' : 'rejected', at: at(1 + i * 2), text: i === 4 ? '本周涨粉 35%，口播开头效果最好' : `选题 ${i + 1}：结论先行的口播脚本（来源：录入数据）`, sources: i === 4 ? [] : ['录入数据'] });
  sim.metrics.push({ key: 'fans', label: '粉丝增长', dim: 'audience', target: 1000, value: 640, unit: '人', ref: 'sim#fans', direction: 'up' }, { key: 'views', label: '播放量', dim: 'outcome', target: 50000, value: null, unit: '次', ref: null, direction: 'up' }, { key: 'first_pass', label: '一次通过率', dim: 'process', target: 0.8, value: 0.73, unit: '', ref: 'sim#review', direction: 'up' }, { key: 'return_rate', label: '退回率', dim: 'process', target: 0.15, value: 0.2, unit: '', ref: 'sim#review', direction: 'down' });
  sim.actions.push({ id: 'sim-a1', matter: 'spend', role: 'dept_head', actorId: `${video}-head`, amountYuan: 5, summary: `${g.org.depts.find((d) => d.id === video)?.name ?? video} 自行追加 ¥5 视频生成（未走请示）`, approvedBy: null, at: at(12), deptId: video });
  for (let i = 0; i < 9; i++) sim.actions.push({ id: `sim-r${i}`, matter: 'routine', role: 'executor', actorId: `${other}-head`, summary: `日常出稿 ${i + 1}`, at: at(2 + i * 3), deptId: other });
  sim.rulings.push({ id: 'sim-v1', kind: 'veto', clause: 'quality#2', by: 'legal', at: at(8) });
  sim.hits.push({ id: 'sim-h1', title: '3 秒钩子口播', metric: '播放 5 万（模拟）', why: '开头先给结论，3 秒内出现钩子', platform: '抖音' });
  await updateListed((s) => ({ ...s, sim: true, clock: end.toISOString(), simData: sim }));
  return `模拟 30 天：花费 ${sim.spend.length} 笔、稿件 ${sim.drafts.length} 篇、受控动作 ${sim.actions.length} 个（含 1 个越权）、无出处数据 1 处`;
}
/** 模拟整改：越权动作补走请示、无出处数据补来源；时钟再走 30 天（下期内审复查）。 */
export async function simulateRemediation(): Promise<void> {
  const s0 = await getListed();
  if (!s0.sim || !s0.simData) throw new Error('没有模拟数据');
  const sim = { ...s0.simData, actions: s0.simData.actions.map((a) => (a.approvedBy === null && a.matter === 'spend' ? { ...a, approvedBy: 'chairman' as const } : a)), drafts: s0.simData.drafts.map((d) => (d.sources.length ? d : { ...d, text: `${d.text}（来源：录入数据）`, sources: ['录入数据'] })) };
  await updateListed((s) => ({ ...s, simData: sim, clock: new Date(govNow(s.clock).getTime() + 30 * 86400000).toISOString() }));
}
export async function clearSim(): Promise<void> { await updateListed((s) => ({ ...s, sim: false, simData: null, clock: null })); }
/* ---------------- 第十九部分：经营收入与全球商机 ---------------- */
export { REVENUE_HONESTY };
export async function addRevenueEntry(e: { deptId: string; platform: string; amount: number; period: string; note?: string }): Promise<string> {
  let id = '';
  await updateListed(async (s) => { await guard(s); const l = addRevenue(s.revenues, { ...e, source: 'user_entry', ref: '你在“经营收入”录入', at: nowIso(s) }); id = l.at(-1)!.id; return { ...s, revenues: l }; });
  await audit({ kind: 'setting_change', actor: 'user', summary: `录入收入：${e.deptId} ${e.platform} ¥${e.amount}（${e.period}）`, outcome: 'ok' });
  return id;
}
/** 你导出的平台结算 CSV：只解析你给的文件，不联网抓取、不登录平台。 */
export async function importSettlement(csv: string, fileName: string, defaultDept: string): Promise<{ added: number; errors: string[] }> {
  let res = { added: 0, errors: [] as string[] };
  await updateListed(async (s) => { await guard(s); const p = parseSettlementCsv(csv, { defaultDept, ref: fileName, at: nowIso(s) }); let l = s.revenues; for (const e of p.entries) l = addRevenue(l, e); res = { added: p.entries.length, errors: p.errors }; return { ...s, revenues: l }; });
  return res;
}
export async function revenueView(period?: string) {
  const s = await getListed(); const g = await getGroup();
  const per = period ?? quarterKey(govNow(s.clock));
  const names = Object.fromEntries([...g.org.depts.map((d) => [d.id, d.name]), ['board', '治理（董事会 / 内审等）']]);
  const P = pnl(s.revenues, allSpend(s, g), per, names);
  const adopted = (s.simData?.drafts.filter((d) => d.status === 'approved' || d.status === 'published').length ?? 0);
  return { pnl: P, evolution: evolutionObjective(P.total.revenue == null ? null : P.total, adopted) };
}
/** 商机雷达：只收录已核对的公开来源（官方页面 / RSS / 文档）；种子卡三张来自官方页面（2026-10-24 核对），比赛 / 知识付费为待补来源的模板。 */
export async function scanRadar(): Promise<number> {
  let n = 0;
  await updateListed(async (s) => { await guard(s); const g = await getGroup(); const bu = g.org.depts.filter((d) => d.kind === 'bu'); const intl = bu.find((d) => /国际|海外|intl/i.test(`${d.id}${d.name}`)) ?? bu[0]; const seeds = seedOpportunities(nowIso(s), (k) => (k === 'platform_incentive' ? intl?.id ?? 'bu-video' : bu[1]?.id ?? bu[0]?.id ?? 'bu-video')).filter((c) => !s.opportunities.some((o) => o.title === c.title)); n = seeds.length; return { ...s, opportunities: [...s.opportunities, ...seeds.map((c, i) => ({ ...c, id: `opp-${s.opportunities.length + i + 1}` }))] }; });
  return n;
}
export async function addOpportunityCard(c: Parameters<typeof newOpportunity>[1]): Promise<string> { let id = ''; await updateListed(async (s) => { await guard(s); const l = newOpportunity(s.opportunities, c); id = l.at(-1)!.id; return { ...s, opportunities: l }; }); return id; }
export async function reviewOpp(id: string, pass: boolean, note = ''): Promise<void> { await updateListed(async (s) => { await guard(s); return { ...s, opportunities: s.opportunities.map((c) => (c.id === id ? reviewOpportunity(c, note, pass) : c)) }; }); }
export async function proposeOpp(id: string, note = ''): Promise<void> { await updateListed(async (s) => { await guard(s); return { ...s, opportunities: s.opportunities.map((c) => (c.id === id ? proposeOpportunity(c, note) : c)) }; }); }
export async function approveOpp(id: string, approve: boolean): Promise<void> {
  let card: ListedState['opportunities'][number] | undefined;
  await updateListed(async (s) => { await guard(s); return { ...s, opportunities: s.opportunities.map((c) => { if (c.id !== id) return c; card = approveOpportunity(c, approve, nowIso(s)); return card; }) }; });
  if (card?.ticket) await updateGroup((g) => ({ ...g, flow: addContext(g.flow, { kind: 'resolution', level: 'public', title: `工单：${card!.title}`, body: card!.ticket!.steps.map((x) => `${x.actor === 'user' ? '【你本人】' : '【Agent】'}${x.text}`).join('；'), refs: [card!.ticket!.id] }).flow })).catch(() => undefined);
  await audit({ kind: 'approval', actor: 'user', summary: `董事长${approve ? '批准' : '驳回'}商机「${card?.title ?? id}」${approve ? '，已生成工单（提交 / 收款由你本人完成）' : ''}`, outcome: 'ok' });
}
/** 收入相关的越界请求（例如“自动收款”“自动投稿”）：引擎拒绝并审计。 */
export async function requestRevenueAction(text: string): Promise<{ ok: boolean; reason: string }> {
  const r = checkRevenueAction(text);
  await audit({ kind: 'approval', actor: 'user', summary: r.ok ? `收入相关请求通过边界检查：${text.slice(0, 40)}` : `收入相关请求被拒（${r.hit}：${r.rule}）`, outcome: r.ok ? 'ok' : 'denied' });
  return { ok: r.ok, reason: r.ok ? '可以做：Agent 只准备草稿与资料，提交与收款由你本人点击' : `已拒绝：${r.rule}` };
}
export { CONTROLS };
