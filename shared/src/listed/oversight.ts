/**
 * 1.4.0 监督线（PROMPT-v1.4 第五部分；refs-v1.4 I1 三线模型、I2 COSO 2013）。
 * 第一道：事业部发稿前自检（清单来自制度库）；第二道：法务合规部 + 风控岗（风险登记册，每月更新）；
 * 第三道：审计委员会下的内审 Agent（独立模型）——每月抽查一次（默认 10%，花费上限 ¥0.3），六类检查，
 *   《内审报告》= 发现 → 证据 → 等级 → 整改建议 → 责任部门 → 期限，直送董事长与审计委员会，CEO 只收抄送；整改下期跟踪。
 * 三道防线同时运作，不是先后关卡（IIA：“lines” 不代表顺序）。检查规则化、可复现；模型只用于写报告摘要（可选，受 ¥0.3 上限约束）。
 */
import { clauseExists } from '../group/regulations.js';
import { violatesHardBoundary, parseDoa, doaCheck, type Doa } from '../group/doa.js';
import type { Role } from '../group/org.js';
import { findSecrets } from '../core/redact.js';
import { checkGovResolution, addDays, seq, clip, type GovSpeaker } from './gov.js';

/* ---------------- 第一道：发稿前自检 ---------------- */
export interface SelfCheckItem { id: string; text: string; clause: string; test: (draft: { title: string; body: string; sources?: string[] }) => boolean }
const HYPE = /(史无前例|颠覆|最强|第一|100%|百分之百|绝对|遥遥领先|全网最|吊打)/;
export const SELF_CHECK: SelfCheckItem[] = [
  { id: 'no-hype', text: '标题与正文不夸大（无“最强 / 第一 / 100%”等绝对化用语）', clause: 'quality#2', test: (d) => !HYPE.test(`${d.title}${d.body}`) },
  { id: 'data-source', text: '出现的数字写明出处或标“推测”', clause: 'quality#3', test: (d) => !/\d+(\.\d+)?\s*(%|％|万|倍|元)/.test(d.body) || /(来源|出处|据|推测|录入数据)/.test(d.body) || !!d.sources?.length },
  { id: 'hard-boundary', text: '不含自动发布 / 自动互动 / 刷量等硬边界动作', clause: 'charter#2', test: (d) => !violatesHardBoundary(`${d.title}\n${d.body}`) },
  { id: 'no-secret', text: '不含 Key、手机号等隐私', clause: 'information#1', test: (d) => !findSecrets(`${d.title}\n${d.body}`).length && !/(?<!\d)1[3-9]\d{9}(?!\d)/.test(d.body) },
  { id: 'user-publish', text: '发布由你本人点击（草稿只进待发布）', clause: 'charter#2', test: (d) => !/(已自动发布|已代你发布)/.test(d.body) },
];
export function frontlineCheck(draft: { title: string; body: string; sources?: string[] }): { pass: boolean; items: { id: string; text: string; ok: boolean; clause: string }[] } {
  const items = SELF_CHECK.map((c) => ({ id: c.id, text: c.text, ok: c.test(draft), clause: c.clause }));
  return { pass: items.every((i) => i.ok), items };
}

/* ---------------- 第二道：风险登记册 ---------------- */
export interface Risk { id: string; title: string; likelihood: 1 | 2 | 3 | 4 | 5; impact: 1 | 2 | 3 | 4 | 5; response: string; owner: string; updatedAt: string; status: 'open' | 'watch' | 'closed' }
export const riskScore = (r: Pick<Risk, 'likelihood' | 'impact'>): number => r.likelihood * r.impact;
export const riskLevel = (r: Pick<Risk, 'likelihood' | 'impact'>): 'high' | 'medium' | 'low' => (riskScore(r) >= 15 ? 'high' : riskScore(r) >= 8 ? 'medium' : 'low');
export function defaultRisks(at = new Date().toISOString()): Risk[] {
  const r = (id: string, title: string, l: Risk['likelihood'], i: Risk['impact'], response: string, owner: string): Risk => ({ id, title, likelihood: l, impact: i, response, owner, updatedAt: at, status: 'open' });
  return [
    r('platform-rule', '平台规则变化导致内容限流或下架', 3, 4, '法务合规部每周核对平台公开规则；发稿前自检', '法务合规部'),
    r('overspend', '模型花费超预算', 3, 3, '预算执行率每日更新，偏差 >20% 预警，超支走请示', '财务部'),
    r('fabrication', '内容里出现无出处或编造的数据', 2, 5, '自检“数据有出处”；内审抽查编造数据', '质量委员会'),
    r('model-degrade', '换模型后质量下降', 2, 4, '接班人计划：影子上岗 + 盲评，不达标不交接、可回滚', '提名与薪酬委员会'),
    r('privacy', '报告或导出里泄露 Key / 隐私', 1, 5, '导出前密钥扫描；报告去隐私、用笔名', '法务合规部'),
    r('hard-boundary', '有人提议自动发布 / 自动互动 / 刷量', 2, 5, '引擎直接拒绝并审计；硬边界否决不可申诉', '法务合规部'),
  ];
}
/** 每月更新：超过 31 天未更新的风险标“待复核”；给出按分数排序的视图。 */
export function riskRegisterView(list: Risk[], now: Date): { risks: (Risk & { score: number; level: string; stale: boolean })[]; stale: number } {
  const risks = list.map((r) => ({ ...r, score: riskScore(r), level: riskLevel(r), stale: now.getTime() - new Date(r.updatedAt).getTime() > 31 * 86400000 })).sort((a, b) => b.score - a.score);
  return { risks, stale: risks.filter((r) => r.stale && r.status !== 'closed').length };
}
export function updateRisk(list: Risk[], id: string, patch: Partial<Omit<Risk, 'id'>>, at = new Date().toISOString()): Risk[] {
  if (patch.response && !checkGovResolution(patch.response).ok) throw new Error('应对措施触碰硬边界');
  return list.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: at } : r));
}

/* ---------------- 第三道：内审 ---------------- */
export const AUDIT_CHECKS = ['spend_vs_usage', 'doa_bypass', 'veto_clause', 'hard_boundary', 'data_source', 'fabrication'] as const;
export type AuditCheck = typeof AUDIT_CHECKS[number];
export const AUDIT_CHECK_TEXT: Record<AuditCheck, string> = { spend_vs_usage: '花费账与服务商用量一致（只核对本地记账）', doa_bypass: 'DOA 有没有被越权或绕过', veto_clause: '退回和否决有没有引用条款', hard_boundary: '硬边界有没有触碰', data_source: '数据有没有出处', fabrication: '有没有编造数据' };
export interface AuditInput {
  /** 本地花费账（集团 ledger + 治理 ledger） */ spend: { ref: string; yuan: number; at: string; deptId?: string }[];
  /** 本地服务商用量日志（每次调用的 costOf 记录） */ usage: { ref: string; yuan: number; at: string }[];
  /** 已执行的受控动作（DOA 判定之后实际发生的事） */ actions: { id: string; matter: string; role: Role; actorId: string; amountYuan?: number; summary: string; approvedBy?: 'chairman' | 'ceo' | null; at: string; deptId?: string }[];
  /** 退回与否决 */ rulings: { id: string; kind: 'return' | 'veto'; clause: string; by: string; at: string }[];
  /** 产出（草稿 / 报告段落），带声明的数据出处 */ outputs: { id: string; text: string; sources: string[]; at: string; deptId?: string }[];
  /** 可验证的事实（录入数据、记账）：用于判断“编造” */ facts: { label: string; value: number; ref: string }[];
}
export type FindingLevel = 'high' | 'medium' | 'low';
export const FINDING_LEVEL_TEXT: Record<FindingLevel, string> = { high: '高', medium: '中', low: '低' };
export interface Finding { id: string; check: AuditCheck; title: string; evidence: string[]; level: FindingLevel; suggestion: string; dept: string; due: string; status: 'open' | 'closed'; closedAt?: string; followups: { at: string; note: string }[]; key: string }
export interface AuditReport {
  id: string; no: string; period: string; sampleRate: number; total: number; sampled: number; checks: Record<AuditCheck, { sampled: number; findings: number }>;
  findings: Finding[]; carried: Finding[]; summary: string; costYuan: number; capYuan: number; to: ('chairman' | 'audit_committee')[]; cc: 'ceo'[]; at: string; auditor: { model?: string; independence: string };
}
export const AUDIT_DEFAULTS = { sampleRate: 0.1, capYuan: 0.3, dueDays: 14 } as const;
/** 确定性抽样（同一种子同一结果）；每类至少抽 1 条，样本里一定包含已知高风险条目（金额最大 / 被拒过的）。 */
export function sampleOf<T extends { id?: string; ref?: string }>(xs: T[], rate: number, seed: string): T[] {
  if (!xs.length) return [];
  const n = Math.max(1, Math.ceil(xs.length * rate));
  const h = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  return [...xs].sort((a, b) => h(seed + (a.id ?? a.ref ?? '')) - h(seed + (b.id ?? b.ref ?? ''))).slice(0, n);
}
const DATA = /\d+(\.\d+)?\s*(%|％|万|千|倍|个百分点|元|播放|粉|赞)/;
const SOURCED = /(来源|出处|据|数据来自|录入数据|导入数据|推测|ledger|https?:\/\/)/i;
/** 运行六类检查。抽样：退回 / 否决、动作、产出按比例抽；花费对账与硬边界全量（规则便宜、风险高）。 */
export function runAudit(inp: AuditInput, o: { period: string; at: string; seq: number; sampleRate?: number; doa?: Doa; dueDays?: number; prev?: AuditReport | null; auditor?: { model?: string; independence: string } }): AuditReport {
  const rate = o.sampleRate ?? AUDIT_DEFAULTS.sampleRate; const doa = o.doa ?? parseDoa();
  const due = addDays(new Date(o.at), o.dueDays ?? AUDIT_DEFAULTS.dueDays).toISOString().slice(0, 10);
  const F: Finding[] = [];
  const add = (check: AuditCheck, key: string, title: string, evidence: string[], level: FindingLevel, suggestion: string, dept: string) => F.push({ id: `f-${o.seq}-${F.length + 1}`, check, key, title, evidence, level, suggestion, dept, due, status: 'open', followups: [] });
  const checks = Object.fromEntries(AUDIT_CHECKS.map((c) => [c, { sampled: 0, findings: 0 }])) as AuditReport['checks'];
  // 1 花费账 vs 用量（全量，按 ref 对账，容差 ¥0.0005）
  const byRef = (xs: { ref: string; yuan: number }[]) => xs.reduce<Record<string, number>>((m, x) => { m[x.ref] = +((m[x.ref] ?? 0) + x.yuan).toFixed(6); return m; }, {});
  const sp = byRef(inp.spend), us = byRef(inp.usage);
  const refs = [...new Set([...Object.keys(sp), ...Object.keys(us)])]; checks.spend_vs_usage.sampled = refs.length;
  for (const r of refs) { const a = sp[r] ?? 0, b = us[r] ?? 0; if (Math.abs(a - b) > 0.0005) add('spend_vs_usage', `spend:${r}`, `花费账与用量不一致：${r}`, [`记账 ¥${a.toFixed(4)}`, `用量日志 ¥${b.toFixed(4)}`], Math.abs(a - b) >= 0.1 ? 'high' : 'medium', '财务部按调用日志补记或冲正，并写明原因', '财务部'); }
  // 2 DOA 越权 / 绕过（抽样 + 全部金额 ≥ ¥1 的动作）
  const big = inp.actions.filter((x) => (x.amountYuan ?? 0) >= 1);
  const acts = [...new Map([...sampleOf(inp.actions, rate, `${o.period}a`), ...big].map((x) => [x.id, x])).values()]; checks.doa_bypass.sampled = acts.length;
  for (const a of acts) {
    const v = doaCheck(doa, { matter: a.matter as never, actor: { role: a.role, id: a.actorId, deptId: a.deptId }, amountYuan: a.amountYuan, summary: a.summary });
    if (!v.allow && v.route === 'forbidden') add('doa_bypass', `doa:${a.id}`, `执行了 DOA 禁止的事项：${a.summary}`, [`动作 ${a.id}（${a.at.slice(0, 10)}）`, `DOA：${v.reason}`], 'high', '立即停止并回滚；法务合规部复核拦截为何失效', a.deptId ?? '法务合规部');
    else if (!v.allow && !(v.route === 'chairman' ? a.approvedBy === 'chairman' : a.approvedBy)) add('doa_bypass', `doa:${a.id}`, `越权：${a.summary}（需${v.route === 'chairman' ? '董事长' : 'CEO / 委员会'}批准，未见批准记录）`, [`动作 ${a.id}，执行者 ${a.actorId}（${a.role}），金额 ${a.amountYuan ?? 0} 元`, `DOA ${v.clause}：${v.reason}`], 'high', '补走请示或撤销该动作；发起部门在下期前说明原因', a.deptId ?? '经营管理委员会');
  }
  // 3 退回 / 否决有没有引用有效条款
  const rs = sampleOf(inp.rulings, Math.max(rate, 0.5), `${o.period}r`); checks.veto_clause.sampled = rs.length;
  for (const r of rs) if (!clauseExists(r.clause)) add('veto_clause', `clause:${r.id}`, `${r.kind === 'veto' ? '否决' : '退回'}没有引用有效条款：${r.id}`, [`引用“${r.clause || '空'}”在制度库中不存在`, `作出者 ${r.by}`], 'medium', '作出方补引有效条款；无条款依据的退回作废', r.by);
  // 4 硬边界（全量扫描动作与产出）
  const texts = [...inp.actions.map((a) => ({ id: a.id, text: a.summary, dept: a.deptId })), ...inp.outputs.map((x) => ({ id: x.id, text: x.text, dept: x.deptId }))]; checks.hard_boundary.sampled = texts.length;
  for (const t of texts) { const hit = violatesHardBoundary(t.text); if (hit) add('hard_boundary', `hb:${t.id}`, `触碰硬边界：${hit}`, [`${t.id}：${clip(t.text, 60)}`], 'high', '删除相关内容；硬边界不可申诉', t.dept ?? '法务合规部'); }
  // 5 数据出处（抽样产出）
  const outs = [...new Map([...sampleOf(inp.outputs, rate, `${o.period}o`), ...inp.outputs.filter((x) => DATA.test(x.text) && !x.sources.length && !SOURCED.test(x.text)).slice(0, 3)].map((x) => [x.id, x])).values()]; checks.data_source.sampled = outs.length;
  for (const x of outs) if (DATA.test(x.text) && !x.sources.length && !SOURCED.test(x.text)) add('data_source', `src:${x.id}`, `数据无出处：${clip(x.text.match(/[^。；\n]*\d[^。；\n]*/)?.[0] ?? x.text, 40)}`, [`产出 ${x.id}（${x.at.slice(0, 10)}）`, '未写来源，也未标“推测”'], 'medium', '补出处或标“推测”；质量委员会抽查同部门近 5 篇', x.deptId ?? '质量委员会');
  // 6 编造：带“据录入数据 / 据记账”的数字须能在 facts 里找到
  checks.fabrication.sampled = outs.length;
  for (const x of outs) for (const m of x.text.matchAll(/据(录入数据|记账|导入数据)[^\d]{0,12}(\d+(?:\.\d+)?)/g)) { const v = Number(m[2]); if (!inp.facts.some((f) => Math.abs(f.value - v) < 1e-6)) add('fabrication', `fab:${x.id}:${v}`, `声称“据${m[1]}”的数字 ${v} 在本机记录里找不到`, [`产出 ${x.id}`, `可验证事实 ${inp.facts.length} 条，均无 ${v}`], 'high', '撤回该数字；作者写明来源或改为“无数据”', x.deptId ?? '质量委员会'); }
  for (const f of F) checks[f.check].findings++;
  // 整改跟踪：上期未关闭的发现，本期复查同一 key 是否仍存在
  const carried: Finding[] = (o.prev?.findings ?? []).concat(o.prev?.carried ?? []).filter((f) => f.status === 'open').map((f) => {
    const still = F.some((n) => n.key === f.key);
    return still ? { ...f, followups: [...f.followups, { at: o.at, note: '复查：问题仍在，已逾期跟踪' }] } : { ...f, status: 'closed' as const, closedAt: o.at, followups: [...f.followups, { at: o.at, note: '复查：本期抽查未再出现，关闭' }] };
  });
  const findings = F.filter((n) => !carried.some((c) => c.key === n.key && c.status === 'open'));
  const total = inp.actions.length + inp.rulings.length + inp.outputs.length + refs.length;
  const sampled = AUDIT_CHECKS.reduce((a, c) => a + checks[c].sampled, 0);
  const year = new Date(o.at).getFullYear();
  return { id: `audit-${o.period}-${o.seq}`, no: seq('内审', o.seq, year), period: o.period, sampleRate: rate, total, sampled, checks, findings, carried, summary: '', costYuan: 0, capYuan: AUDIT_DEFAULTS.capYuan, to: ['chairman', 'audit_committee'], cc: ['ceo'], at: o.at, auditor: o.auditor ?? { independence: 'none' } };
}
/** 报告摘要：有模型时由内审 Agent（独立模型）写，受 ¥0.3 上限；否则规则生成。 */
export async function auditSummary(r: AuditReport, speak?: GovSpeaker, model?: string): Promise<AuditReport> {
  const rule = `本期抽查 ${r.sampled} 项（抽样 ${Math.round(r.sampleRate * 100)}%），新发现 ${r.findings.length} 项（高 ${r.findings.filter((f) => f.level === 'high').length}），上期跟踪 ${r.carried.length} 项、本期关闭 ${r.carried.filter((f) => f.status === 'closed').length} 项。`;
  if (!speak) return { ...r, summary: rule };
  const user = `${rule}\n发现：\n${r.findings.map((f, i) => `${i + 1}. [${FINDING_LEVEL_TEXT[f.level]}] ${f.title}；证据：${f.evidence.join('；')}；建议：${f.suggestion}`).join('\n') || '无'}`;
  const out = await speak({ who: 'internal-audit', role: 'auditor', tier: 'cheap', model, maxTokens: 260, system: '你是 AI 虚拟集团审计委员会下的内审 Agent，独立于 CEO。用 ≤150 字写本期内审结论：结论先行，只依据给出的发现与证据，不新增事实，不建议任何自动发布 / 自动互动 / 提升权限。', user });
  const cost = Math.min(out.cost, r.capYuan);
  return { ...r, summary: out.cost > r.capYuan ? rule : clip(out.text.trim(), 240), costYuan: +cost.toFixed(6) };
}
/** 报告投递：直送董事长与审计委员会；CEO 只收抄送（看得到，不能改、不能拦）。 */
export function deliverAudit(r: AuditReport): { to: string; kind: 'to' | 'cc'; title: string }[] {
  return [...r.to.map((t) => ({ to: t, kind: 'to' as const, title: `《内审报告》${r.no}` })), ...r.cc.map((t) => ({ to: t, kind: 'cc' as const, title: `（抄送）《内审报告》${r.no}` }))];
}
export const canEditAudit = (role: 'chairman' | 'audit_committee' | 'ceo'): boolean => role !== 'ceo';
export function closeFinding(r: AuditReport, id: string, note: string, at = new Date().toISOString()): AuditReport {
  const upd = (f: Finding) => (f.id === id ? { ...f, followups: [...f.followups, { at, note }] } : f);
  return { ...r, findings: r.findings.map(upd), carried: r.carried.map(upd) };
}

/* ---------------- 内控矩阵（COSO 五要素） ---------------- */
export const COSO = ['控制环境', '风险评估', '控制活动', '信息与沟通', '监督'] as const;
export type CosoComponent = typeof COSO[number];
export interface Control { id: string; component: CosoComponent; objective: string; activity: string; owner: string; evidence: string; test: string }
export const CONTROLS: Control[] = [
  { id: 'C01', component: '控制环境', objective: '董事会独立于经营层', activity: '独立董事绑定与 CEO 不同的模型，单模型标“独立性弱”', owner: '提名与薪酬委员会', evidence: 'config/listed.json board.directors', test: 'board_independent' },
  { id: 'C02', component: '控制环境', objective: '权责清楚', activity: 'DOA 五类控制事项可解析且硬边界为“禁止”', owner: '法务合规部', evidence: 'company/regulations/02-doa.md', test: 'doa_parses' },
  { id: 'C03', component: '风险评估', objective: '风险被识别与跟踪', activity: '风险登记册每月更新，超 31 天未更新提示复核', owner: '风控岗', evidence: '风险登记册', test: 'risk_fresh' },
  { id: 'C04', component: '风险评估', objective: '预算偏差被发现', activity: '预算执行率每日更新，偏差 >20% 预警', owner: '财务部', evidence: '预算执行表', test: 'budget_alert' },
  { id: 'C05', component: '控制活动', objective: '硬边界不可越过', activity: '自动发布 / 自动互动 / 刷量类决议被引擎拒绝', owner: '法务合规部', evidence: '审计日志 approval denied', test: 'boundary_blocks' },
  { id: 'C06', component: '控制活动', objective: '发稿前自检', activity: '第一道防线自检清单 5 项', owner: '各事业部', evidence: '自检记录', test: 'selfcheck_works' },
  { id: 'C07', component: '控制活动', objective: '治理不提权', activity: '任何治理决议授予的权限为空', owner: '董事会秘书', evidence: 'governanceGrants', test: 'no_grant' },
  { id: 'C08', component: '信息与沟通', objective: '报告数字可信', activity: '报告数字与记账一致，否则阻止生成', owner: '董事会秘书', evidence: '一致性检查结果', test: 'report_consistent' },
  { id: 'C09', component: '信息与沟通', objective: '不泄露隐私', activity: '报告、案例、学堂内容去 Key / 生日；公开导出用笔名', owner: '法务合规部', evidence: '导出前扫描', test: 'no_leak' },
  { id: 'C10', component: '监督', objective: '独立内审', activity: '内审每月抽查，报告直送董事长与审计委员会，CEO 只抄送', owner: '审计委员会', evidence: '内审报告', test: 'audit_routing' },
  { id: 'C11', component: '监督', objective: '整改闭环', activity: '上期发现下期复查，未关闭标逾期', owner: '审计委员会', evidence: '内审报告 carried', test: 'remediation_tracked' },
  { id: 'C12', component: '监督', objective: '治理花费受控', activity: '治理成本单独记账，默认上限月预算 15%', owner: '财务部', evidence: '治理成本账', test: 'gov_cap' },
];
export type ControlTests = Record<string, () => boolean | { ok: boolean; note: string }>;
export interface ControlResult { id: string; component: CosoComponent; ok: boolean; note: string }
export function testControls(tests: ControlTests): { results: ControlResult[]; byComponent: Record<CosoComponent, { pass: number; total: number }>; pass: number; total: number; text: string } {
  const results = CONTROLS.map((c) => { let r: boolean | { ok: boolean; note: string }; try { r = tests[c.test] ? tests[c.test]!() : { ok: false, note: '未实现测试' }; } catch (e) { r = { ok: false, note: String((e as Error).message) }; } const ok = typeof r === 'boolean' ? r : r.ok; return { id: c.id, component: c.component, ok, note: typeof r === 'boolean' ? (ok ? '通过' : '未通过') : r.note }; });
  const byComponent = Object.fromEntries(COSO.map((k) => [k, { pass: results.filter((r) => r.component === k && r.ok).length, total: results.filter((r) => r.component === k).length }])) as Record<CosoComponent, { pass: number; total: number }>;
  const pass = results.filter((r) => r.ok).length;
  return { results, byComponent, pass, total: results.length, text: `内控自动测试 ${pass}/${results.length} 通过（${COSO.map((k) => `${k} ${byComponent[k].pass}/${byComponent[k].total}`).join('；')}）。说明：只测本机可验证的控制，不构成内控有效的法律意见。` };
}
