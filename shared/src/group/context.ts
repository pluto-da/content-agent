/**
 * 1.3.0 共享上下文流与 OKR 公开（第六部分；字节“Context over Control”与 OKR 公开，见 refs-v1.3 B1/B2）。
 * - 上下文流：董事长目标、经管会决议、部门 OKR 与进度、周报、复盘结论、制度变更、会话 / 会议结论按时间汇成一条流；
 *   私密级记忆不进入，Key 一律拒收；任务执行前按相关性检索注入（有 token 预算）。
 * - OKR：董事长年度目标 → 经管会拆为部门 OKR → 部门拆为 Agent KR；全部公开，任何 Agent 可发起对齐请求。
 */
import { findSecrets } from '../core/redact.js';
import type { Org } from './org.js';

export type InfoLevel = 'public' | 'dept' | 'private';
export type ContextKind = 'goal' | 'resolution' | 'okr' | 'progress' | 'weekly' | 'review' | 'regulation' | 'lesson' | 'session' | 'meeting' | 'race' | 'gray' | 'org';
export interface ContextItem { id: string; at: string; kind: ContextKind; level: InfoLevel; deptId?: string; title: string; body: string; refs: string[] }
export const CONTEXT_MAX = 500;

export function addContext(flow: ContextItem[], item: Omit<ContextItem, 'id' | 'at'> & { id?: string; at?: string }): { flow: ContextItem[]; added: ContextItem | null; reason?: string } {
  if (item.level === 'private') return { flow, added: null, reason: '私密级信息不进入集团上下文流' };
  if (findSecrets(`${item.title}\n${item.body}`, { strict: true }).length) return { flow, added: null, reason: '含疑似 Key，拒收' };
  const added: ContextItem = { ...item, id: item.id ?? `ctx-${Date.now().toString(36)}-${flow.length}`, at: item.at ?? new Date().toISOString(), body: item.body.slice(0, 2000) };
  return { flow: [...flow, added].slice(-CONTEXT_MAX), added };
}

/** 中英混合分词：英文词 + 中文二元组。 */
export function terms(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  const zh = s.replace(/[^\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean);
  for (const seg of zh) { if (seg.length === 1) out.add(seg); for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2)); }
  return out;
}
export const estTokens = (s: string): number => Math.ceil(s.replace(/[\u4e00-\u9fff]/g, 'xx').length / 4);
/** 按相关性检索并在 token 预算内注入；部门级只给本部门，私密级永不出现。 */
export function retrieveContext(flow: ContextItem[], query: string, o: { deptId?: string; tokenBudget?: number; k?: number } = {}): { items: ContextItem[]; tokens: number; text: string } {
  const q = terms(query);
  const budget = o.tokenBudget ?? 600;
  const scored = flow.filter((x) => x.level === 'public' || (x.level === 'dept' && x.deptId === o.deptId)).map((x) => {
    const t = terms(`${x.title} ${x.body}`);
    let hit = 0; for (const w of q) if (t.has(w)) hit++;
    return { x, s: hit / Math.max(1, q.size) + (x.kind === 'goal' || x.kind === 'resolution' ? 0.05 : 0) };
  }).filter((r) => r.s > 0.05).sort((a, b) => b.s - a.s || b.x.at.localeCompare(a.x.at));
  const items: ContextItem[] = []; let tokens = 0;
  for (const { x } of scored.slice(0, o.k ?? 8)) { const line = `- [${x.kind}] ${x.title}：${x.body.slice(0, 160)}`; const n = estTokens(line); if (tokens + n > budget) break; items.push(x); tokens += n; }
  return { items, tokens, text: items.length ? `集团上下文（公开）：\n${items.map((x) => `- [${x.kind}] ${x.title}：${x.body.slice(0, 160)}`).join('\n')}` : '' };
}
/** 上下文命中率：任务实际引用了集团上下文的比例。 */
export function contextHitRate(tasks: { usedContextRefs: number }[]): number | null {
  return tasks.length ? +(tasks.filter((t) => t.usedContextRefs > 0).length / tasks.length).toFixed(3) : null;
}

/* ---------------- OKR ---------------- */
/** KR 标题里给人看的叫法（指标与平台 id 不直接露出）。 */
export const OKR_METRIC_TEXT: Record<string, string> = { followers: '粉丝', views: '播放', likes: '点赞', first_pass_rate: '一次通过率', on_time_rate: '按时交付率' };
export const OKR_PLATFORM_TEXT: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B 站', weixin_channels: '视频号', wechat_mp: '公众号', youtube: 'YouTube', kuaishou: '快手', weibo: '微博', zhihu: '知乎', toutiao: '头条' };
export const okrMetricText = (m: string): string => OKR_METRIC_TEXT[m] ?? m;
export const okrPlatformText = (p: string): string => OKR_PLATFORM_TEXT[p] ?? p;
export type OkrCycle = 'quarter' | 'bimonth';
export interface KeyResult { id: string; title: string; metric: string; platform?: string; direction: 'up' | 'down'; target: number; unit: string; current: number | null; resource?: string }
export interface Objective { id: string; level: 'year' | 'dept' | 'agent'; owner: string; title: string; krs: KeyResult[]; parent?: string; cycle: OkrCycle; period: string; public: true }
export function cycleLabel(c: OkrCycle, at = new Date()): string { const m = at.getMonth(); return c === 'quarter' ? `${at.getFullYear()}Q${Math.floor(m / 3) + 1}` : `${at.getFullYear()}B${Math.floor(m / 2) + 1}`; }

/** 经管会拆解：年度目标 → 每个事业部一个部门 O（按平台给 KR），共享中心与总部各给支撑 KR。只拆结构，数值来自你的目标，进度只用录入数据（current=null 即待录入）。 */
export function decomposeYearGoal(goal: { title: string; metric: string; target: number; unit: string }, org: Org, cycle: OkrCycle = 'quarter', at = new Date()): Objective[] {
  const period = cycleLabel(cycle, at);
  const year: Objective = { id: 'okr-year', level: 'year', owner: 'chairman', title: goal.title, krs: [{ id: 'kr-year-1', title: `${okrMetricText(goal.metric)} 达到 ${goal.target}${goal.unit}`, metric: goal.metric, direction: 'up', target: goal.target, unit: goal.unit, current: null }], cycle, period: String(at.getFullYear()), public: true };
  const bus = org.depts.filter((x) => x.kind === 'bu' && x.status === 'active');
  const share = bus.length ? +(goal.target / bus.length / (cycle === 'quarter' ? 4 : 6)).toFixed(2) : 0;
  const out: Objective[] = [year];
  for (const b of bus) out.push({ id: `okr-${b.id}`, level: 'dept', owner: b.id, parent: year.id, title: `${b.name}：支撑“${goal.title}”`, cycle, period, public: true, krs: [
    { id: `kr-${b.id}-1`, title: `${okrPlatformText(b.platforms[0] ?? '')}${b.platforms[0] ? ' ' : ''}${okrMetricText(goal.metric)} 贡献 ${share}${goal.unit}`, metric: goal.metric, platform: b.platforms[0], direction: 'up', target: share, unit: goal.unit, current: null },
    { id: `kr-${b.id}-2`, title: '发布稿件一次通过率 ≥ 80%', metric: 'first_pass_rate', direction: 'up', target: 80, unit: '%', current: null },
  ] });
  for (const s of org.depts.filter((x) => x.kind === 'shared' || x.kind === 'hq')) out.push({ id: `okr-${s.id}`, level: 'dept', owner: s.id, parent: year.id, title: `${s.name}：为事业部提供${s.duties[0] ?? '支撑'}`, cycle, period, public: true, krs: [{ id: `kr-${s.id}-1`, title: `${s.duties[0] ?? '支撑'}按时交付率 ≥ 90%`, metric: 'on_time_rate', direction: 'up', target: 90, unit: '%', current: null }] });
  return out;
}
export function decomposeDeptOkr(o: Objective, agents: string[]): Objective[] {
  return agents.map((a, i) => ({ id: `${o.id}-${a}`, level: 'agent' as const, owner: a, parent: o.id, title: `${a}：${o.title}`, cycle: o.cycle, period: o.period, public: true as const, krs: o.krs.filter((_, j) => j % Math.max(1, agents.length) === i % Math.max(1, o.krs.length) || agents.length === 1).map((k) => ({ ...k, id: `${k.id}-${a}`, target: +(k.target / (k.unit === '%' ? 1 : agents.length)).toFixed(2) })) }));
}
export interface OkrConflict { a: string; b: string; krA: string; krB: string; why: string }
/** 冲突：同一指标同一平台方向相反，或抢同一独占资源。 */
export function detectOkrConflicts(okrs: Objective[]): OkrConflict[] {
  const krs = okrs.flatMap((o) => o.krs.map((k) => ({ o, k })));
  const out: OkrConflict[] = [];
  for (let i = 0; i < krs.length; i++) for (let j = i + 1; j < krs.length; j++) {
    const x = krs[i]!, y = krs[j]!;
    if (x.o.owner === y.o.owner) continue;
    if (x.k.metric === y.k.metric && (x.k.platform ?? '') === (y.k.platform ?? '') && x.k.direction !== y.k.direction) out.push({ a: x.o.owner, b: y.o.owner, krA: x.k.id, krB: y.k.id, why: `同一指标（${x.k.metric}${x.k.platform ? ` · ${x.k.platform}` : ''}）方向相反` });
    else if (x.k.resource && x.k.resource === y.k.resource) out.push({ a: x.o.owner, b: y.o.owner, krA: x.k.id, krB: y.k.id, why: `争用同一资源（${x.k.resource}）` });
  }
  return out;
}
export interface AlignRequest { id: string; from: string; conflict: OkrConflict; status: 'open' | 'aligned' | 'escalated'; at: string; resolution?: string }
export function alignRequest(from: string, conflict: OkrConflict, at = new Date().toISOString()): AlignRequest { return { id: `align-${conflict.krA}-${conflict.krB}`, from, conflict, status: 'open', at }; }
export function okrProgress(o: Objective): { percent: number | null; text: string } {
  const vals = o.krs.filter((k) => k.current != null && k.target > 0).map((k) => Math.min(1, (k.current as number) / k.target));
  return vals.length ? { percent: Math.round((vals.reduce((a, b) => a + b, 0) / o.krs.length) * 100), text: `${vals.length}/${o.krs.length} 项有数据` } : { percent: null, text: '待录入' };
}
