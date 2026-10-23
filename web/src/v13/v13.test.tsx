/** 1.3.0 集团模式（web）：F14 F15 F16 F17 F5 F6 F9 F10 在 App 里的接线。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetLocalDb } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { saveModels } from '../local/store';
import { resetVfsForTests, getVfs } from '../v9/vfsBackend';
import { listMessages, createConversation } from '../agent/store';
import { NAV, SIDEBAR_ITEMS, ME_GROUPS } from '../nav';
import { parseHash, toHash } from '../route';
import { registry, getState as getSuper } from '../v12/store';
import { GroupPage, GROUP_TABS } from './GroupPage';
import {
  getGroup, enableGroup, disableGroup, setYearGoal, checkConflicts, runSessionTurns, dissolveSession, createMeeting, meetingIntervene, runMeetingNow, startRace, pickWinner, collabDrafts, decide, proposeDept,
  startGray, grayObserve, grayEvaluate, quarterlyReview, proposeRegulation, rollbackRegulation, handleGroupCommand, pauseGroup, resumeGroup, groupOverview,
} from './store';
import { findSecrets, currentReg } from '@content-agent/shared';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); registry.resume(); });
async function mockModel() { await saveModels({ providers: [{ id: 'mock', label: '模拟', protocol: 'openai', baseURL: 'mock://local', apiKey: '', model: 'mock-omni' }], defaultProvider: 'mock', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } } as never); }

describe('F16 集团模式默认关闭，可启用与退回', () => {
  it('默认关闭；启用写入 company/ 清单与制度；退回 1.2 只关开关、数据保留', async () => {
    expect((await getGroup()).enabled).toBe(false);
    await enableGroup('长鱼集团');
    const v = await getVfs();
    expect((await v.list('company/departments')).length).toBeGreaterThanOrEqual(13);
    expect((await v.list('company/committees')).length).toBe(6);
    expect((await v.list('company/regulations')).length).toBe(11);
    expect((await getGroup()).name).toBe('长鱼集团');
    await disableGroup();
    const s = await getGroup();
    expect(s.enabled).toBe(false);
    expect(s.org.depts.length).toBeGreaterThan(0);
    expect(findSecrets(JSON.stringify(s), { strict: true })).toHaveLength(0);
  });
});

describe('F14 “统领”页 7 个子页', () => {
  it('#group 路由；未启用显示启用卡；启用后 7 个子页都能打开；“我的”不增加入口、侧栏不变', async () => {
    expect(parseHash('group?tab=rooms')).toEqual({ space: 'group', sub: '', id: null, query: { tab: 'rooms' } });
    expect(toHash(parseHash('group?tab=nope'))).toBe('group');
    expect(NAV.some((n) => n.id === 'group')).toBe(true);
    expect(SIDEBAR_ITEMS.map((n) => n.id)).toEqual(['agent', 'command', 'me']);
    expect(ME_GROUPS.flatMap((g) => g.items).length).toBeLessThanOrEqual(12);
    const go = vi.fn();
    render(<GroupPage go={go} />);
    await screen.findByTestId('group-enable-card');
    fireEvent.click(screen.getByTestId('group-enable'));
    await screen.findByTestId('group-org');
    expect(GROUP_TABS).toHaveLength(7);
    for (const [k, id] of [['sessions', 'group-sessions'], ['rooms', 'group-rooms'], ['docs', 'group-docs'], ['okr', 'group-goal'], ['regs', 'group-regs'], ['cockpit', 'group-cockpit'], ['org', 'group-org']] as const) {
      fireEvent.click(screen.getByTestId(`tab-${k}`));
      await screen.findByTestId(id);
    }
    expect(screen.getByTestId('group-honesty').textContent).toMatch(/不是法律实体/);
  });
});

describe('F5 / F6 目标 → 冲突 → 临时会话 → √ 解散 → 工单', () => {
  it('设年度目标拆 OKR；数据中心发现冲突自动拉群；4 条消息达成一致；√ 解散生成小结与工单', async () => {
    await mockModel();
    await enableGroup();
    await setYearGoal({ title: '账号年内到 10 万粉', metric: 'followers', target: 100000, unit: '粉' });
    const s0 = await getGroup();
    expect(s0.okrs.filter((o) => o.level === 'dept').length).toBeGreaterThanOrEqual(8);
    expect(s0.flow.some((f) => f.kind === 'goal')).toBe(true);
    const c = await checkConflicts();
    expect(c.conflicts).toBeGreaterThanOrEqual(1);
    expect(c.sessionId).toBeTruthy();
    const ss = await runSessionTurns(c.sessionId!, 4);
    expect(ss!.messages.filter((m) => m.kind === 'msg')).toHaveLength(4);
    const closed = await dissolveSession(c.sessionId!);
    expect(closed.outcome!.conclusions.join()).toMatch(/黄金档/);
    expect((await getSuper()).tasks.some((t) => t.history[0]?.note === '集团小结 / 纪要待办')).toBe(true);
  });
});

describe('F7 / F8 会议在 App 里：董事长插话、纪要归档、待办转工单', () => {
  it('预约 → 插话 → 开会 → 纪要（编号）入公文 → 上下文流', async () => {
    await mockModel();
    await enableGroup();
    const id = await createMeeting({ roomId: 'strategy', title: 'Q4 主推形式', participants: ['bu-video-head', 'bu-article-head', 'legal-head'] });
    await meetingIntervene(id, 'speak', '预算压到一半');
    const m = await runMeetingNow(id);
    expect(m.status).toBe('closed');
    expect(m.record!.speeches.some((x) => x.phase === 'question')).toBe(true);
    const s = await getGroup();
    expect(s.docs.some((d) => d.type === '纪要' && /集团〔\d{4}〕\d{3}号/.test(d.no))).toBe(true);
    expect(s.flow.some((f) => f.kind === 'meeting')).toBe(true);
    expect(s.ledger.some((e) => e.kind === 'meeting')).toBe(true);
  });
});

describe('F9 / F10 / F11 / F12 / F13 在 App 里', () => {
  it('赛马：3 匹 → 盲评 → 选定 → 落选方案写入 company/assets；协作出稿：否决 + 申诉被拒 + 退回后请示 → 批准；新设部门提案批准生效', async () => {
    await mockModel();
    await enableGroup();
    const rid = await startRace('主推视频切入角度', 3);
    const r = (await getGroup()).races.find((x) => x.id === rid)!;
    expect(r.entries.filter((e) => e.status === 'done')).toHaveLength(3);
    await pickWinner(rid, 'A');
    expect((await (await getVfs()).list('company/assets')).length).toBe(2);
    const cd = await collabDrafts();
    let s = await getGroup();
    expect(s.vetoes.find((v) => v.by === 'legal')!.hardBoundary).toBe(true);
    expect(s.flow.some((f) => /不可申诉/.test(f.body))).toBe(true);
    await decide(cd.askDoc, true);
    s = await getGroup();
    expect(s.docs.find((d) => d.id === cd.askDoc)!.status).toBe('approved');
    const pid = await proposeDept('直播策划组');
    await decide(pid, true);
    expect((await getGroup()).org.depts.some((d) => d.name === '直播策划组')).toBe(true);
  });
  it('灰度：20% 试行，指标下降自动回滚到上一版', async () => {
    await enableGroup();
    const v = await getVfs();
    await v.write('skills/douyin/SKILL.md', '# 抖音写法\n- 前三秒给结论\n', { author: 'user' });
    const before = (await v.read('skills/douyin/SKILL.md'))!.content;
    const gid = await startGray('skills/douyin/SKILL.md');
    await grayObserve(gid, 0.8, false); await grayObserve(gid, 0.6, true);
    const g = await grayEvaluate(gid);
    expect(g.status).toBe('rolled_back');
    expect((await v.read('skills/douyin/SKILL.md'))!.content).toBe(before);
  });
  it('季度复盘、360、政委建议；制度修改 L3（提案 → 批准）与回滚', async () => {
    await enableGroup();
    await quarterlyReview();
    const s = await getGroup();
    expect(s.advice.length).toBeGreaterThan(0);
    expect(s.advice.every((a) => a.binding === false)).toBe(true);
    expect(s.flow.some((f) => f.kind === 'lesson')).toBe(true);
    const pid = await proposeRegulation('budget', '## 第五条 赛马月度上限\n默认 ¥1。');
    await decide(pid, true);
    expect(currentReg((await getGroup()).regs, 'budget')!.version).toBe(2);
    await rollbackRegulation('budget');
    expect(currentReg((await getGroup()).regs, 'budget')!.version).toBe(1);
  });
});

describe('F15 对话指令', () => {
  it('@部门 派单、拉个群、开个评审会、这件事赛马；未启用时不接管', async () => {
    await mockModel();
    const cid = (await createConversation('集团') as unknown as { id: number }).id;
    expect(await handleGroupCommand(cid, '拉个群讨论下周主推')).toBe(false);
    await enableGroup();
    expect(await handleGroupCommand(cid, '@短视频事业部 出三个口播选题')).toBe(true);
    expect(await handleGroupCommand(cid, '拉个群讨论下周主推方向')).toBe(true);
    expect(await handleGroupCommand(cid, '开个评审会：三个选题')).toBe(true);
    expect(await handleGroupCommand(cid, '主推视频切入角度，这件事赛马')).toBe(true);
    const msgs = await listMessages(cid);
    expect(msgs.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n')).toMatch(/交给了「短视频事业部」[\s\S]*已拉群[\s\S]*评审室[\s\S]*赛马/);
    const s = await getGroup();
    expect(s.sessions.length).toBe(1);
    expect(s.meetings.length).toBe(1);
    expect(s.races.length).toBe(1);
  });
});

describe('F17 / F18 全部暂停对集团生效；开会占比', () => {
  it('暂停后会话 / 会议 / 赛马都拒绝；恢复需手动；驾驶舱占比', async () => {
    await mockModel();
    await enableGroup();
    const r = await pauseGroup();
    expect(r.ms).toBeLessThan(1000);
    await expect(createMeeting({ roomId: 'review', title: 'x' })).rejects.toThrow(/暂停/);
    await expect(startRace('x', 2)).rejects.toThrow(/暂停/);
    await resumeGroup();
    const id = await createMeeting({ roomId: 'review', title: '稿件评审', participants: ['bu-video-head', 'legal-head'] });
    await runMeetingNow(id);
    const o = await groupOverview();
    expect(o.share.share).toBe(1);
    expect(o.share.alert).toBe(true);
  });
});

describe('F14 驾驶舱与指挥条入口（渲染）', () => {
  it('启用后驾驶舱、指挥条 chip 可见', async () => {
    await enableGroup();
    render(<GroupPage tab="cockpit" go={() => undefined} />);
    await screen.findByTestId('group-cockpit');
    await waitFor(() => expect(screen.getByTestId('kpi-share')).toBeTruthy());
  });
});
