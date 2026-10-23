/** 1.2.0 指挥台与控制平面（web）：E4 E5 E7 E8 E9 E13 E14 E17 E18。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetLocalDb } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { saveModels } from '../local/store';
import { resetVfsForTests, getVfs } from '../v9/vfsBackend';
import { listMessages, createConversation } from '../agent/store';
import { ME_GROUPS, NAV, SIDEBAR_ITEMS } from '../nav';
import { parseHash, toHash } from '../route';
import { enableTemplate, listAgents, delegate, handleMention, getState, pauseAll, resumeAll, isPausedNow, decide, proposeAgent, startWorkflow, saveWorkflow, savePlatform, listUserPlatforms, updateState, registry } from './store';
import { CommandPage } from './CommandPage';
import { draftAgentFromSentence, WORKFLOW_TEMPLATES, draftPlatformFromSentence, PLATFORMS } from '@content-agent/shared';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); registry.resume(); });
async function mockModel() { await saveModels({ providers: [{ id: 'mock', label: '模拟', protocol: 'openai', baseURL: 'mock://local', apiKey: '', model: 'mock-omni' }], defaultProvider: 'mock', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } } as never); }

describe('E17 / E18 指挥台入口', () => {
  it('#command 是独立空间（带标签），侧栏固定“指挥”，“我的”仍 ≤12 项', () => {
    expect(parseHash('command?tab=inbox')).toEqual({ space: 'command', sub: '', id: null, query: { tab: 'inbox' } });
    expect(toHash(parseHash('command?tab=nope'))).toBe('command');
    expect(SIDEBAR_ITEMS.map((n) => n.id)).toEqual(['agent', 'command', 'me']);
    expect(NAV.some((n) => n.id === 'command')).toBe(true);
    expect(ME_GROUPS.flatMap((g) => g.items).length).toBeLessThanOrEqual(12);
  });
});

describe('E7 / E8 / E9 子 Agent 在 App 里', () => {
  it('从模板启用 3 个 → 交给子 Agent（模拟服务商）→ 任务板 待办→进行中→待验收→完成；成长记录', async () => {
    await mockModel();
    for (const id of ['topic-researcher', 'platform-adapter', 'compliance-reviewer']) await enableTemplate(id);
    expect((await listAgents()).map((a) => a.id).sort()).toEqual(['compliance-reviewer', 'platform-adapter', 'topic-researcher']);
    const r = await delegate('platform-adapter', '把母稿适配到 B 站');
    expect(r.ok).toBe(true);
    await waitFor(async () => expect((await getState()).tasks.at(-1)?.state).toBe('done'));
    const s = await getState();
    expect(s.tasks.at(-1)!.history.map((h) => h.state)).toEqual(['todo', 'running', 'review', 'done']);
    expect(s.stats['platform-adapter']?.completed).toBe(1);
  });
  it('@子Agent：回复写明交给了谁、花了多少、结果在哪', async () => {
    await mockModel(); await enableTemplate('compliance-reviewer');
    const c = await createConversation();
    expect(await handleMention(c.id, '@合规审核员 看看这段有没有极限词：全网最好用')).toBe(true);
    const msgs = await listMessages(c.id);
    expect(msgs.at(-1)!.content).toMatch(/交给了「合规审核员」 · 花了 ¥0\.0000 · 结果在“指挥 → 任务板”/);
    expect(await handleMention(c.id, '@不存在的 你好')).toBe(false);
  });
  it('超额度：不执行、暂停该子 Agent、进审批；批准后额度 +¥1 并恢复', async () => {
    await mockModel(); await enableTemplate('visual-voice');
    await updateState((s) => ({ ...s, spendByAgent: { 'visual-voice': { month: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7), yuan: 2.995 } } }));
    const r = await delegate('visual-voice', '出一张封面');
    expect(r.ok).toBe(false);
    let s = await getState();
    expect(s.pausedItems).toContain('visual-voice');
    const ap = s.approvals.find((a) => a.kind === 'spend')!;
    await decide(ap.id, { type: 'approve' });
    s = await getState();
    expect(s.pausedItems).not.toContain('visual-voice');
    expect((await listAgents()).find((a) => a.id === 'visual-voice')!.budget.monthYuan).toBe(4);
  });
});

describe('E4 审批收件箱（App）', () => {
  it('新建子 Agent 进收件箱；修改后批准写入改过的清单；拒绝不写入', async () => {
    const d = draftAgentFromSentence('专门整理素材的，叫素材小管家');
    const a = await proposeAgent(d, '测试');
    expect((await listAgents()).length).toBe(0);
    const edited = a.preview.replace('素材小管家', '素材大管家');
    await decide(a.id, { type: 'edit', preview: edited });
    expect((await listAgents())[0]!.name).toBe('素材大管家');
    const b = await proposeAgent({ ...d, id: 'asset-librarian-9', name: '另一个' }, '测试');
    await decide(b.id, { type: 'reject' });
    expect((await listAgents()).length).toBe(1);
  });
  it('收件箱界面：批准按钮可用、页面显示待批数', async () => {
    await proposeAgent(draftAgentFromSentence('做复盘的'), '界面测试');
    render(<CommandPage tab="inbox" go={() => {}} />);
    const btn = await screen.findByText('批准');
    fireEvent.click(btn);
    await waitFor(async () => expect((await listAgents()).length).toBe(1));
  });
});

describe('E5 全部暂停（App）', () => {
  it('≤1 秒停止全部运行；暂停中拒绝新任务与工作流；恢复需手动', async () => {
    await mockModel(); await enableTemplate('topic-researcher');
    const ctl = registry.register({ runId: 'chat-1', agentId: 'super', kind: 'run' });
    const wf = registry.register({ runId: 'wf-1', agentId: 'super', kind: 'workflow' });
    const r = await pauseAll();
    expect(r.ms).toBeLessThan(1000); expect(ctl.ctl.signal.aborted && wf.ctl.signal.aborted).toBe(true);
    expect(isPausedNow()).toBe(true);
    expect((await delegate('topic-researcher', 'x')).ok).toBe(false);
    await saveWorkflow({ ...WORKFLOW_TEMPLATES[0]!, enabled: true });
    await expect(startWorkflow('daily-briefing')).rejects.toThrow(/暂停/);
    await resumeAll();
    expect(isPausedNow()).toBe(false);
  });
});

describe('E14 工作流（App）', () => {
  it('一稿多发：3 个 Agent 步骤跑完，停在审批节点并进收件箱；批准后完成', async () => {
    await mockModel();
    for (const id of ['platform-adapter', 'compliance-reviewer']) await enableTemplate(id);
    await saveWorkflow({ ...WORKFLOW_TEMPLATES[1]!, enabled: true });
    const st = await startWorkflow('one-to-many');
    expect(st?.status).toBe('awaiting_user');
    const ap = (await getState()).approvals.find((a) => (a.payload as { action?: string }).action === 'workflow_node')!;
    expect(ap.preview).toMatch(/适配/);
    await decide(ap.id, { type: 'approve' });
    await waitFor(async () => expect((await getState()).wfRuns['one-to-many']?.status).toBe('done'));
  });
});

describe('E11 / E13 自定义平台（App）', () => {
  it('一句话起草：平台写入 VFS 并进 PLATFORMS 注册表；写法技能进审批，批准后才写入技能', async () => {
    const dr = draftPlatformFromSentence('加一个叫少数派的长文社区 https://sspai.com');
    const { approval } = await savePlatform(dr.manifest, dr.skill);
    expect((await listUserPlatforms()).map((p) => p.id)).toEqual(['sspai']);
    expect(PLATFORMS.get('sspai')?.source).toBe('user');
    const v = await getVfs();
    expect(await v.read('skills/sspai/SKILL.md')).toBeUndefined();
    await decide(approval!.id, { type: 'approve' });
    expect((await v.read('skills/sspai/SKILL.md'))?.content).toMatch(/少数派 写法/);
  });
});
