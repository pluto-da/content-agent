/** 运行上限（config/limits.json，6.5 / 6.6 / 8.14）。读取时做兼容：缺字段用默认，越界夹紧（可调高不可把安全阈值调低到危险值）。 */
export interface Limits {
  version: number;
  run: { maxToolCalls: number; maxPlanSteps: number; maxReplans: number; maxRunMinutes: number; planningTimeoutSec: number };
  tool: { defaultTimeoutSec: number; imageTimeoutSec: number; videoSubmitTimeoutSec: number; videoTotalMinutes: number; retry: { max: number; baseMs: number; jitter: number } };
  concurrency: { toolsPerStep: number; mediaPerStep: number; runsGlobal: number };
  subtask: { maxDepth: number; maxSteps: number };
  budget: { perCallConfirmYuan: number; perDayConfirmYuan: number };
  selfcheck: { judge: 'auto' | 'on' | 'off'; maxRewrite: number; numberProvenance: boolean };
  evolution: { minSampleMedium: number; minSampleHigh: number; degradeAfter: number; rejectCooldownDays: number; monetizationRecheckDays: number };
}
export const DEFAULT_LIMITS: Limits = {
  version: 1,
  run: { maxToolCalls: 16, maxPlanSteps: 12, maxReplans: 2, maxRunMinutes: 10, planningTimeoutSec: 60 },
  tool: { defaultTimeoutSec: 60, imageTimeoutSec: 120, videoSubmitTimeoutSec: 30, videoTotalMinutes: 15, retry: { max: 2, baseMs: 1000, jitter: 0.2 } },
  concurrency: { toolsPerStep: 3, mediaPerStep: 2, runsGlobal: 2 },
  subtask: { maxDepth: 1, maxSteps: 6 },
  budget: { perCallConfirmYuan: 1, perDayConfirmYuan: 10 },
  selfcheck: { judge: 'auto', maxRewrite: 1, numberProvenance: true },
  evolution: { minSampleMedium: 5, minSampleHigh: 10, degradeAfter: 3, rejectCooldownDays: 30, monetizationRecheckDays: 30 },
};
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
export function readLimits(raw: unknown): Limits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any;
  const d = DEFAULT_LIMITS;
  return {
    version: typeof r.version === 'number' ? r.version : 1,
    run: { maxToolCalls: clamp(r.run?.maxToolCalls, 8, 24, d.run.maxToolCalls), maxPlanSteps: clamp(r.run?.maxPlanSteps, 1, 12, 12), maxReplans: clamp(r.run?.maxReplans, 0, 2, 2), maxRunMinutes: clamp(r.run?.maxRunMinutes, 1, 30, 10), planningTimeoutSec: clamp(r.run?.planningTimeoutSec, 10, 120, 60) },
    tool: { defaultTimeoutSec: clamp(r.tool?.defaultTimeoutSec, 5, 300, 60), imageTimeoutSec: clamp(r.tool?.imageTimeoutSec, 10, 600, 120), videoSubmitTimeoutSec: clamp(r.tool?.videoSubmitTimeoutSec, 5, 120, 30), videoTotalMinutes: clamp(r.tool?.videoTotalMinutes, 1, 60, 15), retry: { max: clamp(r.tool?.retry?.max, 0, 2, 2), baseMs: clamp(r.tool?.retry?.baseMs, 100, 10000, 1000), jitter: clamp(r.tool?.retry?.jitter, 0, 0.5, 0.2) } },
    concurrency: { toolsPerStep: clamp(r.concurrency?.toolsPerStep, 1, 3, 3), mediaPerStep: clamp(r.concurrency?.mediaPerStep, 1, 2, 2), runsGlobal: clamp(r.concurrency?.runsGlobal, 1, 2, 2) },
    subtask: { maxDepth: 1, maxSteps: clamp(r.subtask?.maxSteps, 1, 6, 6) },
    // 花钱阈值：用户可改（ADR / 用户决定的默认 ¥1 / ¥10），0 表示每次都问
    budget: { perCallConfirmYuan: clamp(r.budget?.perCallConfirmYuan, 0, 1000, 1), perDayConfirmYuan: clamp(r.budget?.perDayConfirmYuan, 0, 10000, 10) },
    selfcheck: { judge: ['auto', 'on', 'off'].includes(r.selfcheck?.judge) ? r.selfcheck.judge : 'auto', maxRewrite: clamp(r.selfcheck?.maxRewrite, 0, 2, 1), numberProvenance: r.selfcheck?.numberProvenance !== false },
    // 进化门槛：可调高，不可低于 3（8.14）
    evolution: { minSampleMedium: clamp(r.evolution?.minSampleMedium, 3, 100, 5), minSampleHigh: clamp(r.evolution?.minSampleHigh, 3, 1000, 10), degradeAfter: clamp(r.evolution?.degradeAfter, 1, 20, 3), rejectCooldownDays: clamp(r.evolution?.rejectCooldownDays, 1, 365, 30), monetizationRecheckDays: clamp(r.evolution?.monetizationRecheckDays, 1, 365, 30) },
  };
}
