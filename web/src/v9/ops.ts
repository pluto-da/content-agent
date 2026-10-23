/**
 * 可观测与审计（企业级）：每次模型调用写 usage_log（角色、服务商、模型、延迟、成本、缓存命中、错误类型）；
 * 审计 audit：工具调用、审批、花费、系统文件修改（含 diff 摘要）。全部打码后入库，可筛选、可导出（CSV / JSONL），永不含 Key。
 */
import { makeAudit, filterAudit, auditToCsv, auditToJsonl, redact, type AuditEvent as AuditEntry, type AuditFilter, type UsageRecord, HealthTracker } from '@content-agent/shared';
import { db } from '../local/db';
import { addUsage } from '../local/store';

export const health = new HealthTracker();
export async function recordUsage(r: UsageRecord): Promise<void> {
  await db.insert('usage_log', { ...r, at: r.at } as unknown as Record<string, unknown>);
  if (r.ok) await addUsage(r.cost ?? 0, { input: r.usage.input ?? 0, output: r.usage.output ?? 0 });
  health.record(`${r.vendor}:${r.model}`, r.ok);
  const all = await db.all('usage_log');
  if (all.length > 5000) for (const x of all.slice(0, all.length - 5000)) await db.del('usage_log', x.id);
}
export async function audit(e: Parameters<typeof makeAudit>[0]): Promise<void> {
  await db.insert('audit', makeAudit({ ...e, summary: redact(e.summary) }) as unknown as Record<string, unknown>);
  const all = await db.all('audit');
  if (all.length > 10000) for (const x of all.slice(0, all.length - 10000)) await db.del('audit', x.id);
}
export async function listAudit(f: AuditFilter = {}): Promise<AuditEntry[]> { return filterAudit((await db.all('audit')) as unknown as AuditEntry[], f).sort((a, b) => b.at.localeCompare(a.at)); }
export { auditToCsv, auditToJsonl };

export interface ModelStat { key: string; role: string; vendor: string; model: string; calls: number; errors: number; errorRate: number; p50: number; p95: number; cost: number; cacheHits: number; cacheRate: number; lastError?: string; lastAt?: string; healthy: boolean }
/** 运行状态：最近 N 天按“服务商:模型”聚合。 */
export async function modelStats(days = 7, now = Date.now()): Promise<{ stats: ModelStat[]; totals: { calls: number; cost: number; errorRate: number; cacheRate: number } }> {
  const since = new Date(now - days * 864e5).toISOString();
  const rows = ((await db.all('usage_log')) as unknown as UsageRecord[]).filter((r) => r.at >= since);
  const groups = new Map<string, UsageRecord[]>();
  for (const r of rows) { const k = `${r.role}|${r.vendor}|${r.model}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
  const stats = [...groups].map(([k, rs]) => {
    const [role, vendor, model] = k.split('|') as [string, string, string];
    const errors = rs.filter((r) => !r.ok).length, hits = rs.filter((r) => r.fromCache).length;
    const ms = rs.filter((r) => r.ok && !r.fromCache).map((r) => r.ms);
    const lastErr = [...rs].reverse().find((r) => !r.ok);
    return { key: k, role, vendor, model, calls: rs.length, errors, errorRate: rs.length ? errors / rs.length : 0, p50: q(ms, 0.5), p95: q(ms, 0.95), cost: rs.reduce((s, r) => s + (r.cost ?? 0), 0), cacheHits: hits, cacheRate: rs.length ? hits / rs.length : 0, lastError: lastErr?.errorKind, lastAt: rs.at(-1)?.at, healthy: health.healthy(`${vendor}:${model}`) };
  }).sort((a, b) => b.calls - a.calls);
  const calls = rows.length, errs = rows.filter((r) => !r.ok).length, hits = rows.filter((r) => r.fromCache).length;
  return { stats, totals: { calls, cost: rows.reduce((s, r) => s + (r.cost ?? 0), 0), errorRate: calls ? errs / calls : 0, cacheRate: calls ? hits / calls : 0 } };
}
