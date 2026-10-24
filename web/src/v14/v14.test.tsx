/** 1.4.0 上市公司模式（web）：G2 G5 G11 G12 G13 G14 G16 G17 G18 G19 G20 G21 在 App 里的接线。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetLocalDb } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { saveModels } from '../local/store';
import { resetVfsForTests } from '../v9/vfsBackend';
import { parseHash, toHash } from '../route';
import { registry } from '../v12/store';
import { enableGroup, getGroup, pauseGroup, resumeGroup } from '../v13/store';
import { GroupPage, GROUP_TABS } from '../v13/GroupPage';
import { GovernancePage, GOV_SECS } from './GovernancePage';
import { BriefCard } from './BriefCard';
import {
  getListed, updateListed, enableListed, disableListed, finishOnboarding, conveneBoard, decideMotion, simulateMonth, simulateRemediation, runMonthlyReview, runInternalAudit, noteRemediation, generateReport, editReportFigure,
  holdEarningsCall, startSuccession, rollbackHandover, startTraining, thisWeekLesson, markCardRead, setWeeklyOff, computeBrief, pendingCount, runControls, reportHtml, reportDocx, setMonthBudget, startAgm, agmNext,
  proposeMotion, quarterBestPractice, universityHealth, boardIndependence, addRevenueEntry, importSettlement, revenueView, scanRadar, reviewOpp, proposeOpp, approveOpp, requestRevenueAction,
} from './store';
import { findSecrets, unzip, privacyLeaks, defaultBoard } from '@content-agent/shared';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); registry.resume(); localStorage.removeItem('ca.govDemo'); });
async function mockModel() { await saveModels({ providers: [{ id: 'mock', label: '模拟', protocol: 'openai', baseURL: 'mock://local', apiKey: '', model: 'mock-omni' }], defaultProvider: 'mock', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } } as never); }
async function ready() { await mockModel(); await enableGroup('长鱼集团'); await enableListed(); await finishOnboarding(); }

describe('G20 上市公司模式默认关闭，可启用、可退回；诚实声明', () => {
  it('默认关闭；没开集团模式不能启用；启用 → 3 屏引导 → 治理分区；退回只关开关、数据保留', async () => {
    expect((await getListed()).enabled).toBe(false);
    await expect(enableListed()).rejects.toThrow(/集团模式/);
    await mockModel(); await enableGroup('长鱼集团');
    render(<GovernancePage go={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('gov-enable'));
    await screen.findByTestId('gov-onb-1');
    fireEvent.click(screen.getByTestId('gov-onb-next')); await screen.findByTestId('gov-onb-2');
    fireEvent.click(screen.getByTestId('gov-onb-next')); await screen.findByTestId('gov-onb-3');
    expect(screen.getByTestId('gov-onboarding').textContent).toMatch(/不是法律实体/);
    fireEvent.click(screen.getByTestId('gov-onb-done'));
    await screen.findByTestId('gov-board');
    expect(screen.getByTestId('gov-honesty').textContent).toMatch(/不涉及真实股权、证券或信息披露义务/);
    await disableListed();
    const s = await getListed(); expect(s.enabled).toBe(false); expect(s.board.directors.length).toBeGreaterThan(0);
    expect(findSecrets(JSON.stringify(s), { strict: true })).toHaveLength(0);
  });
});

describe('G19 治理分区界面', () => {
  it('“统领”新增“治理”分区；9 个子页（含第十九部分“经营收入”）都能打开，每页顶部一句大白话 + 1 分钟看懂；术语可点开；路由带 sec', async () => {
    expect(GROUP_TABS.map(([k]) => k)).toContain('gov');
    expect(GOV_SECS).toHaveLength(9);
    expect(parseHash('group?tab=gov&sec=oversight')).toEqual({ space: 'group', sub: '', id: null, query: { tab: 'gov', sec: 'oversight' } });
    expect(toHash(parseHash('group?tab=gov&sec=nope'))).toBe('group?tab=gov');
    await ready();
    render(<GroupPage tab="gov" go={vi.fn()} />);
    await screen.findByTestId('gov-board', {}, { timeout: 4000 });
    for (const [k] of GOV_SECS) { fireEvent.click(screen.getByTestId(`tab-${k}`)); await screen.findByTestId(`gov-${k}`); expect(screen.getByTestId(`gov-plain-${k}`)).toBeTruthy(); }
    fireEvent.click(screen.getByTestId('gov-minute-academy'));
    await screen.findByTestId('gov-minute-body');
    fireEvent.click(screen.getByTestId('tab-oversight'));
    fireEvent.click((await screen.findAllByTestId('term-internal_audit'))[0]!);
    expect((await screen.findByTestId('term-pop')).textContent).toMatch(/抽查/);
  });
});

describe('G2 / G21 董事会在 App 里：独立董事反对 + 董事长拍板留痕；硬边界议案被拒；全部暂停生效', () => {
  it('首次董事会：战略 + 预算两项议案；独立董事对预算投反对票写理由；董事长批准 → 留痕；批准战略 → 拆成 OKR', async () => {
    await ready();
    const ids = await conveneBoard();
    expect(ids).toHaveLength(2);
    let s = await getListed();
    const budget = s.motions.find((m) => m.matter === 'budget')!; const strategy = s.motions.find((m) => m.matter === 'strategy')!;
    expect(budget.votes.every((v) => v.choice === 'oppose' && v.reason.length >= 8)).toBe(true);
    expect(strategy.votes.every((v) => v.choice === 'agree')).toBe(true);
    const r = await decideMotion(budget.id, true);
    expect(r.notice).toMatch(/用来提醒，不阻拦/);
    await decideMotion(strategy.id, true);
    s = await getListed();
    expect(s.budget?.approvedBy).toBe('board'); expect(s.monthBudgetYuan).toBeGreaterThan(0);
    expect(s.strategies.at(-1)!.status).toBe('approved');
    expect((await getGroup()).okrs.some((o) => o.id.startsWith('okr-s'))).toBe(true);
    expect(s.boardMeetings[0]!.no).toMatch(/董事会〔\d{4}〕001号/);
    const bad = await proposeMotion({ title: '每天自动点赞 100 次', matter: 'strategy', conclusion: '提升互动', background: '' });
    expect(bad.status).toBe('refused');
    await pauseGroup();
    await expect(conveneBoard()).rejects.toThrow(/暂停/);
    await resumeGroup();
    expect((await boardIndependence()).every((d) => d.text.length > 0)).toBe(true);
  });
  it('年度大会四步；治理成本上限', async () => {
    await ready();
    await startAgm();
    for (let i = 0; i < 4; i++) await agmNext('');
    expect((await getListed()).agms.at(-1)!.status).toBe('closed');
    await setMonthBudget(1);
    await updateListed((s) => ({ ...s, govLedger: [{ kind: 'call', yuan: 0.2, at: new Date().toISOString(), ref: 'x' }] }));
    await generateReport('quarter');
    const id = (await getListed()).reports.at(-1)!.id;
    await expect(holdEarningsCall(id)).rejects.toThrow(/暂停到下月|超过上限/);
  });
});

describe('G5 / G7 / G8 / G11 / G12 / G13 一个月的模拟数据：经营分析、内审、季报、发布会', () => {
  it('模拟数据只在演示模式；预算偏差预警；内审发现越权 + 无出处 → 整改 → 下期关闭；季报可追溯、手改被阻止；发布会产生待办', async () => {
    await ready();
    await conveneBoard();
    for (const m of (await getListed()).motions) await decideMotion(m.id, true);
    await expect(simulateMonth()).rejects.toThrow(/演示/);
    localStorage.setItem('ca.govDemo', '1');
    expect(await simulateMonth()).toMatch(/1 个越权/);
    await runMonthlyReview();
    let s = await getListed();
    const rv = s.reviews.at(-1)!;
    expect(rv.sim).toBe(true); expect(rv.budgetAlerts.length).toBeGreaterThan(0);
    expect(rv.rows.some((r) => r.actual === '无数据')).toBe(true);
    await runInternalAudit();
    s = await getListed();
    const a1 = s.audits.at(-1)!;
    expect(a1.findings.map((f) => f.check)).toEqual(expect.arrayContaining(['doa_bypass', 'data_source']));
    expect(s.deliveries.filter((d) => d.ref === a1.id).map((d) => `${d.to}:${d.kind}`)).toEqual(['chairman:to', 'audit_committee:to', 'ceo:cc']);
    for (const f of a1.findings) await noteRemediation(a1.id, f.id, '已整改');
    await simulateRemediation();
    await runInternalAudit();
    const a2 = (await getListed()).audits.at(-1)!;
    expect(a2.carried.filter((f) => f.check === 'doa_bypass' || f.check === 'data_source').every((f) => f.status === 'closed')).toBe(true);
    await runControls();
    await generateReport('quarter');
    s = await getListed();
    const rep = s.reports.at(-1)!;
    expect(rep.status).toBe('final'); expect(rep.chapters).toHaveLength(11); expect(rep.sim).toBe(true);
    expect(rep.figures.find((f) => f.id === 'outputs')!.ref).toMatch(/^drafts:/);
    const html = await reportHtml(rep.id); expect(html).toContain('长鱼茶汤茗'); expect(privacyLeaks(html)).toEqual([]);
    const docx = unzip(await reportDocx(rep.id)); expect(docx.some((e) => e.path === 'word/document.xml')).toBe(true);
    const bad = await editReportFigure(rep.id, 'outputs', 999);
    expect(bad.status).toBe('blocked'); expect(bad.diffs[0]).toMatch(/报告写 999篇/);
    await expect(reportHtml(rep.id)).rejects.toThrow(/一致性/);
    await generateReport('quarter');
    const ok = (await getListed()).reports.at(-1)!;
    await holdEarningsCall(ok.id);
    const c = (await getListed()).calls.at(-1)!;
    expect(c.qa.length).toBe(3); expect(c.qa.every((q) => q.grounded)).toBe(true); expect(c.todos.length).toBeGreaterThanOrEqual(1);
    expect((await getGroup()).flow.some((f) => /业绩发布会纪要/.test(f.title))).toBe(true);
    expect(await computeBrief()).toMatch(/三件好事/);
    expect(await pendingCount()).toBeGreaterThanOrEqual(0);
  });
});

describe('G16 / G17 / G18 接班、集团大学、学堂在 App 里', () => {
  it('影子上岗 10 个任务 → 盲评 → 董事会批准交接 → 回滚；入职培训测验上岗、案例被引用；最佳实践；每周一课与已读', async () => {
    await ready();
    localStorage.setItem('ca.govDemo', '1'); await simulateMonth();
    const sid = await startSuccession();
    let s = await getListed();
    const x = s.successions.find((y) => y.id === sid)!;
    expect(x.runs).toHaveLength(10); expect(x.spent).toBeLessThanOrEqual(0.5); expect(x.status).toBe('reviewed');
    const mo = s.motions.find((m) => m.matter === 'succession')!;
    await decideMotion(mo.id, true);
    expect((await getListed()).successions.find((y) => y.id === sid)!.status).toBe('handed_over');
    await rollbackHandover(sid, '灰度期指标下降');
    expect((await getListed()).successions.find((y) => y.id === sid)!).toMatchObject({ status: 'rolled_back', active: 'incumbent' });
    await startTraining('live-head');
    s = await getListed();
    expect(s.trainings.at(-1)!).toMatchObject({ passed: true, onDuty: true });
    expect(s.cases.some((c) => c.cites.length > 0)).toBe(true);
    expect(await quarterBestPractice()).toBeGreaterThanOrEqual(1);
    expect((await universityHealth()).citationRate).toBeGreaterThan(0);
    const l = await thisWeekLesson();
    expect(l?.text).toBeTruthy();
    await markCardRead(l!.cardId);
    expect((await thisWeekLesson())?.cardId).not.toBe(l!.cardId);
    await setWeeklyOff(true); expect(await thisWeekLesson()).toBeNull();
  });
  it('首页董事长简报卡片：启用后才出现，显示待你拍板数量；独立性弱在董事会页标出', async () => {
    const go = vi.fn();
    const { unmount } = render(<BriefCard go={go} />);
    await new Promise((r) => setTimeout(r, 50)); expect(screen.queryByTestId('open-brief')).toBeNull(); unmount();
    await ready(); await conveneBoard();
    await updateListed((s) => ({ ...s, board: defaultBoard({ ceo: { vendor: 'mimo', model: 'mimo-v2.6-pro' }, available: [{ vendor: 'mimo', model: 'mimo-v2.6-pro' }, { vendor: 'mimo', model: 'mimo-v2.6-flash' }] }) }));
    render(<BriefCard go={go} />);
    await waitFor(() => expect(screen.getByTestId('brief-pending').textContent).toMatch(/2/));
    fireEvent.click(screen.getByTestId('open-brief'));
    expect(go).toHaveBeenCalledWith('group?tab=gov&sec=disclosure');
    render(<GovernancePage go={vi.fn()} />);
    expect((await screen.findAllByTestId('gov-independence-weak')).length).toBe(2);
  });
});

describe('G26 经营收入与全球商机（App 接线）', () => {
  it('损益表无数据 → 录入收入 / 导入结算 → 损益与季报更新；商机卡 ≥3 个带来源；评审 → 提案 → 批准 → 工单；越界请求被拒', async () => {
    await ready();
    expect((await revenueView()).pnl.total.revenue).toBeNull();
    await generateReport('quarter');
    expect((await getListed()).reports.at(-1)!.figures.find((f) => f.id === 'revenue')!.value).toBeNull();
    const g = await getGroup(); const bu = g.org.depts.find((d) => d.kind === 'bu')!.id;
    const q = new Date(); const per = `${q.getFullYear()}-${String(q.getMonth() + 1).padStart(2, '0')}`;
    await addRevenueEntry({ deptId: bu, platform: 'B站', amount: 12, period: per });
    expect((await importSettlement(`期间,平台,金额\n${per},YouTube,8`, 'yt-settlement.csv', bu)).added).toBe(1);
    const v = await revenueView();
    expect(v.pnl.total.revenue).toBe(20); expect(v.pnl.rows.find((r) => r.deptId === bu)!.profit).toBe(20);
    expect(v.evolution.grants).toEqual([]);
    await generateReport('quarter');
    const r = (await getListed()).reports.at(-1)!;
    expect(r.status).toBe('final'); expect(r.figures.find((f) => f.id === 'revenue')!.value).toBe(20);
    expect(await scanRadar()).toBe(5);
    const s = await getListed();
    expect(s.opportunities.filter((c) => c.source).length).toBeGreaterThanOrEqual(3);
    const c = s.opportunities.find((x) => x.source)!;
    await reviewOpp(c.id, true); await proposeOpp(c.id); await approveOpp(c.id, true);
    const done = (await getListed()).opportunities.find((x) => x.id === c.id)!;
    expect(done.status).toBe('ticket'); expect(done.ticket!.steps.some((x) => x.actor === 'user')).toBe(true);
    expect((await getGroup()).flow.some((f) => f.title.startsWith('工单：'))).toBe(true);
    for (const t of ['让 Agent 自动收款', '帮我自动投稿到剧本大赛']) expect((await requestRevenueAction(t)).ok).toBe(false);
    render(<GovernancePage sec="revenue" go={vi.fn()} />);
    expect((await screen.findByTestId('gov-rev-honesty')).textContent).toBe('集团不是法律实体，真实收入归属用户本人，需遵守平台规则与当地税法。');
    expect((await screen.findAllByTestId('gov-opp-estimate'))[0]!.textContent).toMatch(/^估计/);
  });
});
