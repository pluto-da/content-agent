import type { DB } from '../db.js';
import { percentile, type ModelHub, type ProviderHealth } from '../models/hub.js';

/**
 * 推理效率度量（借“每卡每小时收入”的思路，把每份调用的有效产出量化）：
 *  - 单篇成本 = 生成类调用（改写/草稿/复核的文本 + 配图 + 配音 + 字幕）成本 ÷ 期间新草稿数（按 usage.task 归集，属估算）
 *  - 缓存命中率 = 缓存命中输入 token ÷ 总输入 token（只统计服务商返回了命中字段的文本调用，未返回的不进分母；目标 > 50%）
 *  - 一次通过率 = 文本输出第一次就通过 Schema 校验的草稿占比
 *  - 返工放大系数 = 实际模型调用次数 ÷ 理论最少调用次数（越接近 1 越好）
 *  - p50/p95 延迟、各服务商失败率
 */
export interface EfficiencyMetrics {
  days: number;
  drafts: number;
  costPerDraft: number | null;
  generationCost: number;
  byPlatform: { platform: string; drafts: number; cost: number; costPerDraft: number | null }[];
  cache: { inputTokens: number; cachedTokens: number; hitRate: number | null; reportedCalls: number };
  firstPass: { measured: number; passed: number; rate: number | null };
  amplification: { calls: number; minCalls: number; factor: number | null };
  confidence: { tier: string; n: number }[];
  latency: { calls: number; p50: number; p95: number };
  providers: ProviderHealth[];
}

const GEN = /^(llm|image|tts|asr):(rewrite|draft|verify)(?::([a-z_]+))?:/;

export function efficiencyMetrics(db: DB, hub: ModelHub, days = 30): EfficiencyMetrics {
  const d = Math.max(1, Math.floor(days));
  const since = `-${d} days`;
  const drafts = db.prepare("SELECT platform, first_pass, calls, min_calls, confidence FROM drafts WHERE created_at >= datetime('now', ?)").all(since) as { platform: string; first_pass: number | null; calls: number; min_calls: number; confidence: string | null }[];

  const costRows = db.prepare("SELECT task, SUM(cost) AS cost FROM usage WHERE created_at >= datetime('now', ?) GROUP BY task").all(since) as { task: string; cost: number }[];
  let generationCost = 0;
  const platCost = new Map<string, number>();
  for (const r of costRows) {
    const m = GEN.exec(r.task);
    if (!m) continue;
    generationCost += r.cost;
    const key = m[2] === 'rewrite' && m[3] ? m[3] : '_shared';
    platCost.set(key, (platCost.get(key) ?? 0) + r.cost);
  }
  const platDrafts = new Map<string, number>();
  for (const x of drafts) platDrafts.set(x.platform, (platDrafts.get(x.platform) ?? 0) + 1);
  const shared = platCost.get('_shared') ?? 0; // 草稿/复核任务不分平台，按草稿数均摊
  const byPlatform = [...platDrafts.entries()].map(([platform, n]) => {
    const cost = (platCost.get(platform) ?? 0) + (drafts.length ? (shared * n) / drafts.length : 0);
    return { platform, drafts: n, cost: round(cost), costPerDraft: n ? round(cost / n) : null };
  }).sort((a, b) => b.drafts - a.drafts);

  const cacheRow = db.prepare("SELECT COALESCE(SUM(prompt_tokens),0) AS input, COALESCE(SUM(cached_tokens),0) AS cached, COUNT(*) AS reported FROM usage WHERE task LIKE 'llm:%' AND cached_tokens IS NOT NULL AND ok = 1 AND created_at >= datetime('now', ?)").get(since) as { input: number; cached: number; reported: number | null };

  const measured = drafts.filter((x) => x.first_pass !== null);
  const passed = measured.filter((x) => x.first_pass === 1).length;
  const amp = drafts.filter((x) => x.min_calls > 0);
  const calls = amp.reduce((s, x) => s + x.calls, 0);
  const minCalls = amp.reduce((s, x) => s + x.min_calls, 0);
  const tiers = new Map<string, number>();
  for (const x of drafts) if (x.confidence) tiers.set(x.confidence, (tiers.get(x.confidence) ?? 0) + 1);

  const ms = (db.prepare("SELECT ms FROM usage WHERE ok = 1 AND created_at >= datetime('now', ?) ORDER BY ms").all(since) as { ms: number }[]).map((r) => r.ms);

  return {
    days: d,
    drafts: drafts.length,
    generationCost: round(generationCost),
    costPerDraft: drafts.length ? round(generationCost / drafts.length) : null,
    byPlatform,
    cache: { inputTokens: cacheRow.input, cachedTokens: cacheRow.cached, hitRate: cacheRow.input ? cacheRow.cached / cacheRow.input : null, reportedCalls: cacheRow.reported ?? 0 },
    firstPass: { measured: measured.length, passed, rate: measured.length ? passed / measured.length : null },
    amplification: { calls, minCalls, factor: minCalls ? calls / minCalls : null },
    confidence: ['high', 'medium', 'low'].map((tier) => ({ tier, n: tiers.get(tier) ?? 0 })),
    latency: { calls: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95) },
    providers: hub.health(d * 24 * 60),
  };
}

function round(n: number): number { return Math.round(n * 1e6) / 1e6; }
