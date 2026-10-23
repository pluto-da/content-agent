/**
 * 1.3.0 赛马与灰度（第十部分；腾讯公开案例与 2026 年各家收口的报道，见 refs-v1.3 T1/T2/T4）。
 * 融合规则：默认复用共享能力中心；只有“高价值 + 方向不确定”的任务才开赛马；最多 3 匹、专项预算（单次与月度上限）、
 * 赛马评审室盲评 → 有历史数据时参考数据中心预测 → 董事长选定（或授权 CEO）→ 落选方案归档进素材中心可复用；驾驶舱统计胜出方案后续效果。
 * 灰度：新技能、新提示词、制度中的低风险部分先在一个事业部或 20% 的任务上试行，观察一周期；指标不降再全量，下降自动回滚。
 */
import { findSecrets } from '../core/redact.js';

export interface Horse { id: string; agentId: string; model?: string; skill?: string }
export interface RaceEntry { horseId: string; alias: string; proposal: string; cost: number; status: 'done' | 'over_budget' | 'failed' }
export type RaceStatus = 'running' | 'reviewing' | 'decided' | 'cancelled';
export interface Race {
  id: string; topic: string; deptId: string; horses: Horse[]; budgetYuan: number; status: RaceStatus; entries: RaceEntry[];
  scores: Record<string, number[]>; prediction: Record<string, number> | null; winner: string | null; decidedBy: 'chairman' | 'ceo' | null; archived: string[]; spent: number; createdAt: string;
}
export interface RaceBudget { perRaceYuan: number; monthYuan: number }
export const DEFAULT_RACE_BUDGET: RaceBudget = { perRaceYuan: 0.6, monthYuan: 3 };
export const MAX_HORSES = 3;

export function canStartRace(o: { highValue: boolean; uncertain: boolean; horses: number; monthSpent: number; budget?: RaceBudget; requestYuan: number }): { ok: boolean; reason: string } {
  const b = o.budget ?? DEFAULT_RACE_BUDGET;
  if (!o.highValue || !o.uncertain) return { ok: false, reason: '默认复用共享能力中心：只有高价值且方向不确定的任务才开赛马' };
  if (o.horses < 2 || o.horses > MAX_HORSES) return { ok: false, reason: `赛马 2–${MAX_HORSES} 匹` };
  if (o.requestYuan > b.perRaceYuan) return { ok: false, reason: `单次赛马预算上限 ¥${b.perRaceYuan}` };
  if (o.monthSpent + o.requestYuan > b.monthYuan) return { ok: false, reason: `赛马月度专项预算 ¥${b.monthYuan} 将超出（已用 ¥${o.monthSpent.toFixed(3)}）` };
  return { ok: true, reason: '可以开赛马' };
}
export function newRace(o: { topic: string; deptId: string; horses: Horse[]; budgetYuan: number; id?: string; at?: string }): Race {
  if (o.horses.length < 2 || o.horses.length > MAX_HORSES) throw new Error(`赛马 2–${MAX_HORSES} 匹`);
  return { id: o.id ?? `race-${Date.now().toString(36)}`, topic: o.topic.slice(0, 100), deptId: o.deptId, horses: o.horses, budgetYuan: o.budgetYuan, status: 'running', entries: [], scores: {}, prediction: null, winner: null, decidedBy: null, archived: [], spent: 0, createdAt: o.at ?? new Date().toISOString() };
}
/** 并行出方案；专项预算用尽后的马直接停（不再调用模型）。盲评用 A/B/C 代号，顺序按种子打乱。 */
export async function runRace(r: Race, gen: (h: Horse, topic: string) => Promise<{ text: string; cost: number }>, seed = 7): Promise<Race> {
  const aliases = ['A', 'B', 'C'];
  const order = r.horses.map((h, i) => ({ h, k: (i * 7919 + seed * 104729) % 97 })).sort((a, b) => a.k - b.k).map((x) => x.h);
  const perHorse = r.budgetYuan / r.horses.length;
  let spent = 0; const entries: RaceEntry[] = [];
  const results = await Promise.all(order.map(async (h) => { try { return { h, o: await gen(h, r.topic) }; } catch { return { h, o: null }; } }));
  results.forEach(({ h, o }, i) => {
    if (!o) { entries.push({ horseId: h.id, alias: aliases[i]!, proposal: '', cost: 0, status: 'failed' }); return; }
    const over = spent + o.cost > r.budgetYuan || o.cost > perHorse * 1.5;
    const text = findSecrets(o.text).length ? '[含疑似 Key，已拒收]' : o.text.slice(0, 1200);
    entries.push({ horseId: h.id, alias: aliases[i]!, proposal: over ? '' : text, cost: over ? Math.min(o.cost, perHorse) : o.cost, status: over ? 'over_budget' : 'done' });
    spent += over ? Math.min(o.cost, perHorse) : o.cost;
  });
  return { ...r, entries, spent: +spent.toFixed(6), status: 'reviewing' };
}
/** 盲评卡片：只露代号与方案，不露 Agent / 模型。 */
export function blindCards(r: Race): { alias: string; proposal: string }[] { return r.entries.filter((e) => e.status === 'done').map((e) => ({ alias: e.alias, proposal: e.proposal })); }
export function scoreBlind(r: Race, reviewer: string, scores: Record<string, number>): Race {
  const next = { ...r.scores };
  for (const [alias, s] of Object.entries(scores)) { if (!r.entries.some((e) => e.alias === alias && e.status === 'done')) continue; next[alias] = [...(next[alias] ?? []), Math.max(0, Math.min(10, s))]; }
  return { ...r, scores: next };
}
export const avg = (xs: number[]): number => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : 0);
export function leaderboard(r: Race): { alias: string; score: number; predicted: number | null }[] {
  return r.entries.filter((e) => e.status === 'done').map((e) => ({ alias: e.alias, score: avg(r.scores[e.alias] ?? []), predicted: r.prediction?.[e.alias] ?? null })).sort((a, b) => b.score - a.score);
}
/** 数据中心预测：只在有历史数据时给出（按方案关键词与历史表现粗配），否则 null。 */
export function predictFromHistory(r: Race, history: { keyword: string; metric: number }[]): Record<string, number> | null {
  if (!history.length) return null;
  const out: Record<string, number> = {};
  for (const e of r.entries.filter((x) => x.status === 'done')) { const hits = history.filter((h) => e.proposal.includes(h.keyword)); out[e.alias] = hits.length ? avg(hits.map((h) => h.metric)) : 0; }
  return out;
}
/** 董事长选定（或授权 CEO 选定）；落选方案归档进素材中心。 */
export function decideRace(r: Race, alias: string, by: 'chairman' | 'ceo', ceoAuthorized = false): Race {
  if (by === 'ceo' && !ceoAuthorized) throw new Error('赛马胜者由董事长选定；CEO 需事先获得授权');
  const win = r.entries.find((e) => e.alias === alias && e.status === 'done');
  if (!win) throw new Error(`没有可选的方案 ${alias}`);
  return { ...r, winner: win.horseId, decidedBy: by, status: 'decided', archived: r.entries.filter((e) => e.horseId !== win.horseId && e.status === 'done').map((e) => e.horseId) };
}
/** 落选方案入素材库（素材中心可复用）。 */
export function archivedAssets(r: Race): { title: string; body: string; tags: string[] }[] {
  return r.entries.filter((e) => r.archived.includes(e.horseId)).map((e) => ({ title: `赛马落选方案 ${e.alias}：${r.topic}`, body: e.proposal, tags: ['赛马', '落选', r.deptId] }));
}
/** 赛马效果：胜出方案后续效果（你录入的数据）对比基线；样本不足写待录入。 */
export function raceEffect(rs: Race[], outcomes: { raceId: string; metric: number }[], baseline: number | null): { races: number; withData: number; avgLift: number | null; verdict: string } {
  const decided = rs.filter((r) => r.status === 'decided');
  const data = outcomes.filter((o) => decided.some((r) => r.id === o.raceId));
  if (!data.length || baseline == null || baseline <= 0) return { races: decided.length, withData: data.length, avgLift: null, verdict: '待录入（胜出方案的后续效果需要你录入数据）' };
  const lift = +(avg(data.map((d) => d.metric)) / baseline - 1).toFixed(3);
  return { races: decided.length, withData: data.length, avgLift: lift, verdict: data.length < 3 ? `样本 ${data.length} 个，结论不稳` : lift > 0.05 ? '赛马胜出方案好于基线，值得继续' : '赛马没有明显好于基线，建议收口、改为复用' };
}

/* ---------------- 灰度 ---------------- */
export type GrayTarget = { kind: 'skill' | 'prompt' | 'regulation_low'; id: string; version: number; prevVersion: number };
export type GrayScope = { deptId: string } | { percent: number };
export type GrayStatus = 'trial' | 'full' | 'rolled_back';
export interface GrayRelease { id: string; target: GrayTarget; scope: GrayScope; metric: string; baseline: number | null; observations: { value: number; inGray: boolean; at: string }[]; status: GrayStatus; cycleDays: number; startedAt: string; endedAt?: string; reason?: string }
export function newGray(o: { target: GrayTarget; scope?: GrayScope; metric: string; baseline?: number | null; cycleDays?: number; id?: string; at?: string }): GrayRelease {
  if (o.target.kind === 'regulation_low' && /charter|doa/.test(o.target.id)) throw new Error('章程与 DOA 属高风险，不走灰度，只走 L3');
  const scope = o.scope ?? { percent: 20 };
  if ('percent' in scope && (scope.percent <= 0 || scope.percent > 50)) throw new Error('灰度比例 1–50%');
  return { id: o.id ?? `gray-${o.target.id}-v${o.target.version}`, target: o.target, scope, metric: o.metric, baseline: o.baseline ?? null, observations: [], status: 'trial', cycleDays: o.cycleDays ?? 7, startedAt: o.at ?? new Date().toISOString() };
}
/** 任务是否落在灰度里：部门范围，或按任务 id 哈希取 20%。 */
export function inGray(g: GrayRelease, task: { id: string; deptId?: string }): boolean {
  if (g.status !== 'trial') return g.status === 'full';
  if ('deptId' in g.scope) return task.deptId === g.scope.deptId;
  let h = 0; for (const ch of task.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 100 < g.scope.percent;
}
export function observe(g: GrayRelease, value: number, isGray: boolean, at = new Date().toISOString()): GrayRelease { return { ...g, observations: [...g.observations, { value, inGray: isGray, at }] }; }
/** 观察一周期后评估：灰度组均值低于对照（或基线）超过 tolerance → 自动回滚（调用 rollback）；否则全量。 */
export async function evaluateGray(g: GrayRelease, now: Date, rollback: (t: GrayTarget) => Promise<void> | void, tolerance = 0.05): Promise<GrayRelease> {
  if (g.status !== 'trial') return g;
  const grayV = g.observations.filter((o) => o.inGray).map((o) => o.value), ctrl = g.observations.filter((o) => !o.inGray).map((o) => o.value);
  const ref = ctrl.length ? avg(ctrl) : g.baseline;
  const cycleDone = now.getTime() - new Date(g.startedAt).getTime() >= g.cycleDays * 86400000;
  if (!grayV.length || ref == null) return g;
  const drop = ref > 0 ? (ref - avg(grayV)) / ref : 0;
  if (drop > tolerance) { await rollback(g.target); return { ...g, status: 'rolled_back', endedAt: now.toISOString(), reason: `指标“${g.metric}”下降 ${(drop * 100).toFixed(1)}%（灰度 ${avg(grayV)} vs 对照 ${ref}），已自动回滚到 v${g.target.prevVersion}` }; }
  if (cycleDone) return { ...g, status: 'full', endedAt: now.toISOString(), reason: `观察 ${g.cycleDays} 天，指标未下降，已全量` };
  return g;
}
