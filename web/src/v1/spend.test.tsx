/** 1.0 费用护栏接线：每笔花费可在审计里追溯到 usage 记录；异常只提醒（去重）；设置页可改并写审计。 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, resetLocalDb } from '../local/db';
import { recordUsage, listAudit } from '../v9/ops';
import { getGuard, saveGuard, spendSummary, seenAlerts, guardPort } from '../v9/spend';
import { SpendGuardSection } from './SpendGuard';
import { DEFAULT_SPEND_GUARD, type UsageRecord } from '@content-agent/shared';

beforeEach(() => { resetLocalDb(); });
afterEach(() => cleanup());
const u = (o: Partial<UsageRecord>): UsageRecord => ({ at: new Date().toISOString(), role: 'chat', vendor: 'mimo', model: 'mimo-v2.6-flash', requestedModel: 'mimo-v2.6-flash', usage: { input: 100, output: 50 }, cost: 0.001, ms: 900, ok: true, ...o });

describe('费用可追溯', () => {
  it('每笔有费用（含单价未知）的成功调用都有一条审计 spend，指向 usage 记录 id，合计一致', async () => {
    await recordUsage(u({ cost: 0.002, runId: 'run-1' }));
    await recordUsage(u({ role: 'image', vendor: 'bailian', model: 'wanx', cost: 0.14, runId: 'run-1', toolCallId: 'image_generate' }));
    await recordUsage(u({ role: 'tts', cost: null }));
    await recordUsage(u({ cost: 0, ok: false, errorKind: 'timeout' }));
    const usage = await db.all('usage_log');
    const spend = (await listAudit({ kinds: ['spend'] })).filter((e) => e.detail && 'usageId' in e.detail);
    expect(spend.length).toBe(3);
    for (const e of spend) expect(usage.some((r) => r.id === e.detail!.usageId)).toBe(true);
    const sumAudit = spend.reduce((s, e) => s + (e.cost ?? 0), 0), sumUsage = usage.reduce((s, r) => s + Number(r.cost ?? 0), 0);
    expect(sumAudit).toBeCloseTo(sumUsage);
    const img = spend.find((e) => e.target === 'image')!;
    expect(img.runId).toBe('run-1'); expect(img.summary).toContain('wanx'); expect(img.detail!.vendor).toBe('bailian');
    expect(spend.find((e) => e.target === 'tts')!.summary).toContain('单价未知');
  });
  it('异常花费只提醒：单笔超线写一条提醒 + 审计，重复不再提醒', async () => {
    await saveGuard({ ...DEFAULT_SPEND_GUARD, monthBudgetYuan: 0, anomaly: { ...DEFAULT_SPEND_GUARD.anomaly, singleCallYuan: 1 } });
    await recordUsage(u({ role: 'video', cost: 1.5 }));
    await recordUsage(u({ cost: 0.001 }));
    const seen = await seenAlerts();
    expect(seen.map((a) => a.kind)).toEqual(['single_call']);
    expect((await listAudit({ kinds: ['spend'] })).filter((e) => e.summary.startsWith('花费提醒')).length).toBe(1);
  });
  it('护栏端口给运行时：本月 / 今天按角色已花', async () => {
    await recordUsage(u({ role: 'image', cost: 0.3 }));
    const p = await guardPort();
    expect(p.guard.monthBudgetYuan).toBe(30); expect(p.state.spentMonth).toBeCloseTo(0.3); expect(p.state.spentTodayByRole.image).toBeCloseTo(0.3);
    expect((await spendSummary()).calls).toBe(1);
  });
});

describe('设置页', () => {
  it('改月度预算与生图日上限 → 保存进设置并写审计', async () => {
    render(<SpendGuardSection />);
    const month = await screen.findByTestId('guard-month');
    fireEvent.change(month, { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('guard-cap-image'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('guard-save'));
    await waitFor(async () => { const g = await getGuard(); expect(g.monthBudgetYuan).toBe(50); expect(g.roleDayCapYuan).toEqual({ image: 2 }); });
    expect((await listAudit({ kinds: ['setting_change'] }))[0]!.summary).toContain('月度预算 ¥50');
  });
  it('非法值不保存并提示', async () => {
    render(<SpendGuardSection />);
    fireEvent.change(await screen.findByTestId('guard-month'), { target: { value: '-3' } });
    fireEvent.click(screen.getByTestId('guard-save'));
    expect(await screen.findByText(/预算 0–100000 元/)).toBeTruthy();
    expect((await getGuard()).monthBudgetYuan).toBe(30);
  });
});
