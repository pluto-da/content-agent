/**
 * 规划与执行器（6.4 / 6.5）：任务图 JSON（Schema 校验，步数 ≤12，依赖无环、只引用存在的步骤）；
 * 执行器按拓扑序调度：同一层无依赖的并行（并发上限 3，媒体类 2），前序失败的步骤标 skipped，结果按 step id 回填；参数里 "$ref:<stepId>.<path>" 引用前序结果。
 */
import { validate, type JsonSchema } from '../schema.js';

export interface PlanStep { id: string; title: string; tool?: string; subtask?: string; reply?: boolean; args?: Record<string, unknown>; dependsOn: string[]; role?: string; costEstimate?: number }
export interface Plan { scope: string; steps: PlanStep[] }
export const PLAN_SCHEMA: JsonSchema = {
  type: 'object', required: ['scope', 'steps'],
  properties: { scope: { type: 'string', minLength: 2, maxLength: 120 }, steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', required: ['id', 'title', 'dependsOn'], properties: { id: { type: 'string', minLength: 1 }, title: { type: 'string' }, tool: { type: 'string' }, subtask: { type: 'string' }, reply: { type: 'boolean' }, args: { type: 'object' }, dependsOn: { type: 'array', items: { type: 'string' } } } } } },
};
export function validatePlan(p: unknown, knownTools: string[], maxSteps = 12): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  const errs = validate(PLAN_SCHEMA, p).map((e) => e.message);
  if (errs.length) return { ok: false, errors: errs };
  const plan = p as Plan;
  if (plan.steps.length > maxSteps) return { ok: false, errors: [`步数 ${plan.steps.length} 超过上限 ${maxSteps}`] };
  const ids = new Set<string>();
  for (const s of plan.steps) {
    if (ids.has(s.id)) errs.push(`步骤 id 重复：${s.id}`);
    ids.add(s.id);
    if (!s.tool && !s.subtask && !s.reply) errs.push(`步骤 ${s.id} 没有 tool / subtask / reply`);
    if (s.tool && !knownTools.includes(s.tool)) errs.push(`步骤 ${s.id} 的工具不存在：${s.tool}`);
  }
  for (const s of plan.steps) for (const d of s.dependsOn) if (!ids.has(d)) errs.push(`步骤 ${s.id} 依赖了不存在的步骤 ${d}`);
  if (!errs.length && hasCycle(plan)) errs.push('步骤依赖有环');
  return errs.length ? { ok: false, errors: errs } : { ok: true, plan };
}
function hasCycle(p: Plan): boolean {
  const state = new Map<string, number>();
  const by = new Map(p.steps.map((s) => [s.id, s]));
  const dfs = (id: string): boolean => { const st = state.get(id); if (st === 1) return true; if (st === 2) return false; state.set(id, 1); for (const d of by.get(id)?.dependsOn ?? []) if (dfs(d)) return true; state.set(id, 2); return false; };
  return p.steps.some((s) => dfs(s.id));
}
/** 是否需要先说范围：≥3 步或预计 ≥30 秒或有费用。 */
export function shouldAnnounce(p: Plan, estSeconds = 0, estCost = 0): boolean { return p.steps.filter((s) => !s.reply).length >= 3 || estSeconds >= 30 || estCost > 0; }

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface StepResult { id: string; status: StepStatus; output?: unknown; error?: string }
/** 解析 $ref:<stepId>.<path> 引用。 */
export function resolveRefs(args: unknown, results: Map<string, StepResult>): unknown {
  if (typeof args === 'string') {
    const m = /^\$ref:([\w-]+)(?:\.(.+))?$/.exec(args);
    if (!m) return args;
    let v: any = results.get(m[1]!)?.output;
    for (const k of (m[2] ?? '').split('.').filter(Boolean)) v = v?.[/^\d+$/.test(k) ? Number(k) : k];
    return v;
  }
  if (Array.isArray(args)) return args.map((a) => resolveRefs(a, results));
  if (args && typeof args === 'object') return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, resolveRefs(v, results)]));
  return args;
}
/**
 * 执行任务图：runStep 由调用方提供（内部走 ToolRunner：校验 / 审批 / 幂等 / 超时 / 重试）。
 * isMedia(step) 决定是否计入媒体并发上限。返回每步结果（含 skipped）。
 */
export async function executePlan(plan: Plan, runStep: (s: PlanStep, args: Record<string, unknown>) => Promise<{ ok: boolean; output?: unknown; error?: string }>, o: { concurrency?: number; mediaConcurrency?: number; isMedia?(s: PlanStep): boolean; already?: Map<string, StepResult>; signal?: AbortSignal; onStep?(r: StepResult): void } = {}): Promise<Map<string, StepResult>> {
  const results = new Map<string, StepResult>(o.already ?? []);
  const conc = o.concurrency ?? 3, mconc = o.mediaConcurrency ?? 2;
  const pending = plan.steps.filter((s) => !s.reply && !(results.get(s.id)?.status === 'done'));
  while (pending.length) {
    if (o.signal?.aborted) break;
    // 依赖失败 / 被跳过 → skipped
    for (const s of [...pending]) {
      if (s.dependsOn.some((d) => ['failed', 'skipped'].includes(results.get(d)?.status ?? ''))) {
        const r: StepResult = { id: s.id, status: 'skipped', error: '前序步骤失败，未执行' };
        results.set(s.id, r); o.onStep?.(r); pending.splice(pending.indexOf(s), 1);
      }
    }
    const ready = pending.filter((s) => s.dependsOn.every((d) => results.get(d)?.status === 'done' || plan.steps.find((x) => x.id === d)?.reply));
    if (!ready.length) break;
    const batch: PlanStep[] = []; let media = 0;
    for (const s of ready) {
      const isM = o.isMedia?.(s) ?? false;
      if (batch.length >= conc) break;
      if (isM && media >= mconc) continue;
      batch.push(s); if (isM) media++;
    }
    await Promise.all(batch.map(async (s) => {
      pending.splice(pending.indexOf(s), 1);
      results.set(s.id, { id: s.id, status: 'running' });
      const args = (resolveRefs(s.args ?? {}, results) ?? {}) as Record<string, unknown>;
      const r: { ok: boolean; output?: unknown; error?: string } = await runStep(s, args).catch((e) => { if ((e as { stop?: boolean })?.stop) throw e; return { ok: false, error: String((e as Error)?.message ?? e) }; });
      const res: StepResult = r.ok ? { id: s.id, status: 'done', output: r.output } : { id: s.id, status: 'failed', error: r.error };
      results.set(s.id, res); o.onStep?.(res);
    }));
  }
  return results;
}
