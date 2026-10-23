import { describe, it, expect } from 'vitest';
import { authorize, permLevelOf, excessPermissions, narrow, checkAgentBudget, newApproval, resolveApproval, pendingCount, RunRegistry, goalProgress, weeklyReviewDraft, readSuperState, writeSuperState, addAgentSpend, agentSpentMonth, emptySuperState, APPROVAL_KINDS, DEFAULT_FILES, assemblePrefix, type Goal } from '../src/index.js';

describe('E1 超级 Agent 身份', () => {
  it('super/SUPER.md 随新安装提供且被加载，AGENTS.md 默认正文不含指挥职责（核心文件只以修订建议存在）', () => {
    expect(DEFAULT_FILES['super/SUPER.md']).toMatch(/指挥职责/);
    expect(DEFAULT_FILES['AGENTS.md']).not.toMatch(/super\/SUPER\.md/);
    const pre = assemblePrefix({ ...DEFAULT_FILES, 'skills/SKILLS.md': '' }, { team: '- 选题研究员' });
    expect(pre.parts.map((p) => p.path)).toContain('super/SUPER.md');
    expect(pre.text).toMatch(/交给了谁、花了多少、结果在哪/);
    expect(pre.parts.find((p) => p.path === 'agents/')?.content).toMatch(/选题研究员/);
  });
});

describe('E2 权限分级', () => {
  it('工具标级：原级别 + kind 推出 L3，对外写入名为禁止级', () => {
    expect(permLevelOf({ name: 'draft_list', level: 'L0' })).toBe('L0');
    expect(permLevelOf({ name: 'file_write', level: 'L2', kind: 'system_file' })).toBe('L3');
    expect(permLevelOf({ name: 'douyin_like', level: 'L1' })).toBe('forbidden');
    expect(permLevelOf({ name: 'publish_check', level: 'L0' })).toBe('L0');
  });
  it('越权被拒并写审计：未授权级别、白名单外工具、L3、禁止级、暂停中', () => {
    const g = { agentId: 'topic-researcher', permissions: ['L0', 'L1'] as const, tools: ['hot_fetch', 'image_gen'] };
    const grant = { ...g, permissions: [...g.permissions] };
    const ok = authorize(grant, { name: 'hot_fetch', level: 'L0' });
    expect(ok.allow).toBe(true); expect(ok.audit.outcome).toBe('ok'); expect(ok.audit.detail?.agentId).toBe('topic-researcher');
    const l2 = authorize(grant, { name: 'image_gen', level: 'L2' });
    expect(l2.allow).toBe(false); expect(l2.needsApproval).toBe(true); expect(l2.audit.outcome).toBe('denied');
    expect(authorize(grant, { name: 'tts', level: 'L1' }).reason).toMatch(/白名单/);
    const l3 = authorize({ ...grant, tools: '*' }, { name: 'agent_create', level: 'L3' });
    expect(l3.allow).toBe(false); expect(l3.needsApproval).toBe(true); expect(l3.audit.kind).toBe('approval');
    const f = authorize({ ...grant, tools: '*', permissions: ['L0', 'L1', 'L2', 'L3'] }, { name: 'auto_like', level: 'forbidden' });
    expect(f.allow).toBe(false); expect(f.needsApproval).toBe(false);
    expect(authorize(grant, { name: 'hot_fetch', level: 'L0' }, { paused: true }).allow).toBe(false);
  });
  it('子级权限是父级子集，子 Agent 不含 L3', () => {
    expect(excessPermissions(['L0', 'L1'], ['L0', 'L1', 'L2', 'L3'])).toEqual([]);
    expect(excessPermissions(['L0', 'L3'], ['L0', 'L1', 'L2', 'L3'])).toEqual(['L3']);
    expect(excessPermissions(['L2'], ['L0', 'L1'])).toEqual(['L2']);
    expect(narrow(['L0', 'L1', 'L2', 'L3'], ['L0', 'L2', 'L3'])).toEqual(['L0', 'L2']);
  });
});

describe('E3 按 Agent 预算', () => {
  it('超级 Agent 不设子额度；子 Agent 默认 ¥3/月，超额度 → 暂停进审批，不挪用', () => {
    expect(checkAgentBudget('super', null, 100, 1).ok).toBe(true);
    const b = { monthYuan: 3, perRunYuan: 1 };
    expect(checkAgentBudget('a', b, 2.5, 0.4).ok).toBe(true);
    const over = checkAgentBudget('a', b, 2.9, 0.2);
    expect(over.ok).toBe(false); if (!over.ok) { expect(over.reason).toBe('agent_month'); expect(over.pause).toBe(true); }
    const run = checkAgentBudget('a', b, 0, 1.5); expect(!run.ok && run.reason).toBe('per_run');
    const glob = checkAgentBudget('a', b, 0, 0.5, { monthBudgetYuan: 30, spentMonth: 29.8 }); expect(!glob.ok && glob.reason).toBe('global_month');
  });
  it('按自然月累计（Asia/Shanghai）', () => {
    const t = Date.parse('2026-10-24T00:00:00Z');
    let s = addAgentSpend(emptySuperState(), 'a', 0.5, t); s = addAgentSpend(s, 'a', 0.25, t);
    expect(agentSpentMonth(s, 'a', t)).toBeCloseTo(0.75);
    expect(agentSpentMonth(s, 'a', Date.parse('2026-11-02T00:00:00Z'))).toBe(0);
  });
});

describe('E4 审批收件箱', () => {
  it('6 类事项；批准、拒绝、修改后批准；已处理不可重复处理', () => {
    expect(APPROVAL_KINDS).toHaveLength(6);
    let list = APPROVAL_KINDS.map((k, i) => newApproval({ kind: k, from: i ? 'super' : 'topic-researcher', why: '原因', impact: '影响', estCost: k === 'spend' ? 0.8 : null, preview: `预览 ${k}`, id: `x${i}` }));
    expect(pendingCount(list)).toBe(6);
    list = resolveApproval(list, 'x0', { type: 'approve' }).list;
    list = resolveApproval(list, 'x1', { type: 'reject', note: '不需要' }).list;
    const e = resolveApproval(list, 'x2', { type: 'edit', preview: '改过的清单' }); list = e.list;
    expect(e.item?.status).toBe('approved'); expect(e.item?.edited).toBe(true); expect(e.item?.preview).toBe('改过的清单');
    expect(resolveApproval(list, 'x0', { type: 'reject' }).changed).toBe(false);
    expect(pendingCount(list)).toBe(3);
  });
  it('预览含疑似密钥 → 拒绝创建', () => {
    expect(() => newApproval({ kind: 'external_tool', from: 'super', why: '', impact: '', estCost: null, preview: 'key sk-abcdefghijklmnopqrstuvwxyz123456' })).toThrow(/密钥/);
  });
});

describe('E5 全部暂停', () => {
  it('≤1 秒取消全部运行（含排队、定时、外部工具），之后拒绝新运行，恢复需手动', async () => {
    const reg = new RunRegistry();
    const runs = Array.from({ length: 50 }, (_, i) => reg.register({ runId: `r${i}`, agentId: i % 2 ? 'a' : 'super', kind: (['run', 'queued', 'workflow', 'mcp'] as const)[i % 4]! }));
    const t0 = Date.now();
    const r = reg.pauseAll();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.cancelled).toHaveLength(50);
    expect(runs.every((x) => x.ctl.signal.aborted)).toBe(true);
    expect(() => reg.register({ runId: 'n', agentId: 'super', kind: 'run' })).toThrow(/全部暂停/);
    reg.resume();
    expect(reg.register({ runId: 'n', agentId: 'super', kind: 'run' }).ctl.signal.aborted).toBe(false);
  });
  it('单项暂停与父级级联取消', () => {
    const reg = new RunRegistry();
    reg.register({ runId: 'p', agentId: 'super', kind: 'run' });
    const c = reg.register({ runId: 'c', agentId: 'a', parent: 'p', kind: 'run' });
    const g = reg.register({ runId: 'g', agentId: 'a', parent: 'c', kind: 'run' });
    const other = reg.register({ runId: 'o', agentId: 'b', kind: 'run' });
    expect(reg.cancel('p').sort()).toEqual(['c', 'g', 'p']);
    expect(c.ctl.signal.aborted && g.ctl.signal.aborted).toBe(true);
    expect(other.ctl.signal.aborted).toBe(false);
    expect(reg.cancelAgent('b')).toEqual(['o']);
  });
});

describe('E6 目标与进度', () => {
  const g: Goal = { id: 'g1', title: '本月小红书涨粉 500', metric: 'followers', platform: 'xiaohongshu', target: 500, unit: '粉', from: '2026-10-01', to: '2026-10-31', createdAt: '2026-10-01' };
  it('没有数据写“待录入”，不推算', () => {
    const p = goalProgress(g, []);
    expect(p.value).toBeNull(); expect(p.text).toBe('待录入');
    expect(weeklyReviewDraft([g], [])).toMatch(/待录入/);
  });
  it('只用录入或导入的数据点', () => {
    const pts = [{ metric: 'followers' as const, platform: 'xiaohongshu', value: 1000, at: '2026-10-02', source: 'manual' as const }, { metric: 'followers' as const, platform: 'xiaohongshu', value: 1120, at: '2026-10-20', source: 'import' as const }, { metric: 'followers' as const, platform: 'xiaohongshu', value: 9999, at: '2026-10-21', source: 'guess' as unknown as 'manual' }];
    const p = goalProgress(g, pts);
    expect(p.value).toBe(120); expect(p.percent).toBe(24); expect(p.points).toBe(2);
  });
});

describe('控制平面状态', () => {
  it('读写 config/super.json：缺字段补默认、并发夹紧 1–5、含密钥拒绝写入', () => {
    expect(readSuperState(null).concurrency).toBe(3);
    expect(readSuperState('{"concurrency":9}').concurrency).toBe(5);
    expect(readSuperState('not json').approvals).toEqual([]);
    const s = emptySuperState();
    expect(readSuperState(writeSuperState(s))).toEqual(s);
    expect(() => writeSuperState({ ...s, goals: [{ title: 'sk-abcdefghijklmnopqrstuvwxyz123456' } as unknown as Goal] })).toThrow(/密钥/);
  });
});
