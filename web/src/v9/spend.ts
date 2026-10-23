/**
 * 1.0 费用护栏的本机接线（规则在 shared/agent/policy.ts，代码强制）：
 * - 设置：prefs.spend.guard（月度预算、按角色日上限、异常提醒阈值），设置页可改；
 * - 状态：从 usage_log 汇总本月 / 今天按角色已花（Asia/Shanghai 自然日 / 月）；
 * - 每笔花费写一条审计 spend（带 usage 记录 id、角色、服务商、模型、运行 id），审计里可逐笔追溯；
 * - 异常花费只提醒：写审计 + 提醒列表（kv spend.alerts，按 id 去重），不拦截、不自动停。
 */
import { readSpendGuard, summarizeSpend, spendAlerts, DEFAULT_SPEND_GUARD, type SpendGuard, type SpendState, type SpendRecord, type SpendAlert, type SpendSummary } from '@content-agent/shared';
import { db } from '../local/db';
import { getPrefs, setPrefs } from '../local/store';

export async function getGuard(): Promise<SpendGuard> { return readSpendGuard(((await getPrefs()).spend as { guard?: unknown } | undefined)?.guard ?? DEFAULT_SPEND_GUARD); }
export async function saveGuard(g: SpendGuard): Promise<SpendGuard> {
  const p = await getPrefs();
  const clean = readSpendGuard(g);
  await setPrefs({ spend: { ...(p.spend ?? { perCallConfirmYuan: 1, perDayConfirmYuan: 10 }), guard: clean } });
  return clean;
}
async function records(): Promise<SpendRecord[]> { return (await db.all('usage_log')).map((r) => ({ at: String(r.at), role: String(r.role ?? 'chat'), cost: r.cost == null ? null : Number(r.cost), vendor: r.vendor as string | undefined, model: r.model as string | undefined, ok: r.ok as boolean | undefined })); }
export async function spendSummary(now = Date.now()): Promise<SpendSummary> { return summarizeSpend(await records(), now); }
export async function spendState(now = Date.now()): Promise<SpendState> { const s = await spendSummary(now); return { spentMonth: s.spentMonth, spentTodayByRole: s.spentTodayByRole }; }
export async function guardPort(): Promise<{ guard: SpendGuard; state: SpendState }> { return { guard: await getGuard(), state: await spendState() }; }
export async function currentAlerts(now = Date.now()): Promise<SpendAlert[]> { return spendAlerts(await records(), await getGuard(), now); }
/** 已提醒过的（去重用）。 */
export async function seenAlerts(): Promise<SpendAlert[]> { return (await db.getKV<SpendAlert[]>('spend.alerts')) ?? []; }
/** recordUsage 之后调用：新出现的异常写入提醒列表与审计，返回新提醒（只提醒，不改变任何流程）。 */
export async function checkAlerts(writeAudit: (summary: string, a: SpendAlert) => Promise<void>, now = Date.now()): Promise<SpendAlert[]> {
  const seen = await seenAlerts();
  const fresh = (await currentAlerts(now)).filter((a) => !seen.some((s) => s.id === a.id));
  if (!fresh.length) return [];
  await db.setKV('spend.alerts', [...seen, ...fresh].slice(-200));
  for (const a of fresh) await writeAudit(`花费提醒：${a.text}`, a);
  return fresh;
}
