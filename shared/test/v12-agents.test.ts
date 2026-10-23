import { describe, it, expect } from 'vitest';
import { AGENT_TEMPLATES, fromTemplate, draftAgentFromSentence, parseAgentMd, serializeAgentMd, validateAgent, exportAgentZip, importAgentZip, checkHandoff, coerceHandoffOutput, Orchestrator, RunRegistry, moveTask, canMove, BOARD_COLUMNS, updateStats, statsView, idleHint, agentChangeRisk, parseMention, teamSummary, checkName, isAgentPath, agentPath, HIERARCHY, type HandoffInput, type SubAgentDef, type BoardTask } from '../src/index.js';

const input = (goal = '把母稿适配到小红书'): HandoffInput => ({ goal, context_refs: ['draft:1'], constraints: ['母稿不改'], budget: 0.5, deadline: null, output_schema: { type: 'object' } });
const good = (summary = '完成') => JSON.stringify({ summary, artifacts: ['draft:2'], cost: 0.01, evidence: ['技能 xiaohongshu v3'], open_questions: [], failures: [] });

describe('E7 子 Agent 增删改与模板', () => {
  it('8 个内置模板全部合法，权限都不含 L3', () => {
    expect(AGENT_TEMPLATES).toHaveLength(8);
    expect(AGENT_TEMPLATES.map((t) => t.name)).toEqual(['选题研究员', '平台适配编辑', '视觉与配音制作', '合规审核员', '数据复盘分析师', '收益分析师', '评论回复草稿员', '素材管理员']);
    for (const t of AGENT_TEMPLATES) { expect(validateAgent(t)).toEqual([]); expect(t.permissions).not.toContain('L3'); }
    expect(fromTemplate('compliance-reviewer').permissions).toEqual(['L0']);
  });
  it('AGENT.md 往返；只认 agents/<id>/AGENT.md（旧平铺角色说明不是子 Agent）', () => {
    const d = fromTemplate('platform-adapter', { budget: { monthYuan: 5, perRunYuan: 0.5 }, memory: 'private', platforms: ['xiaohongshu', 'bilibili'] });
    const back = parseAgentMd(serializeAgentMd(d));
    expect(back).toEqual({ ...d, body: d.body.trim() });
    expect(isAgentPath(agentPath(d.id))).toBe(true);
    expect(isAgentPath('agents/writer.md')).toBe(false);
    expect(checkName(agentPath(d.id))).toBeNull();
  });
  it('校验：L3 / 越级 / 对外写入工具 / 放宽边界 / 密钥 / 说明 >500 字 全部拒绝', () => {
    const base = fromTemplate('topic-researcher');
    expect(validateAgent({ ...base, permissions: ['L0', 'L3'] }).join()).toMatch(/越界/);
    expect(validateAgent({ ...base, permissions: ['L2'] }, { parent: ['L0', 'L1'] }).join()).toMatch(/越界/);
    expect(validateAgent({ ...base, tools: ['douyin_like'] }).join()).toMatch(/硬边界/);
    expect(validateAgent({ ...base, body: '本 Agent 允许自动评论' }).join()).toMatch(/放宽/);
    expect(validateAgent({ ...base, body: '帮我自动点赞关注' }).join()).toMatch(/硬边界/);
    expect(validateAgent({ ...base, body: 'key: sk-abcdefghijklmnopqrstuvwxyz123456' }).join()).toMatch(/密钥/);
    expect(validateAgent({ ...base, description: '长'.repeat(501) }).join()).toMatch(/500/);
    expect(validateAgent({ ...base, id: 'super' }).join()).toMatch(/保留/);
  });
  it('一句话起草：createdBy=super、权限 ≤L2、不撞已有 id', () => {
    const d = draftAgentFromSentence('帮我建一个专门做 B 站视频封面和配音的，叫封面小助手', ['visual-voice-2']);
    expect(d.createdBy).toBe('super'); expect(d.template).toBe('visual-voice'); expect(d.id).toBe('visual-voice-3'); expect(d.name).toBe('封面小助手');
    expect(validateAgent(d)).toEqual([]);
  });
  it('导入导出 .agent.zip：往返；导入时 Key 扫描、权限上限收窄、硬边界', () => {
    const d = fromTemplate('reply-drafter');
    const z = exportAgentZip(d, [{ path: 'reply-tone/SKILL.md', content: '---\nname: reply-tone\n---\n口语' }]);
    const im = importAgentZip(z, { parent: ['L0', 'L1', 'L2', 'L3'] });
    expect(im.ok).toBe(true); expect(im.def?.id).toBe('reply-drafter'); expect(im.skills[0]?.path).toBe('skills/reply-tone/SKILL.md');
    const over = importAgentZip(exportAgentZip({ ...d, permissions: ['L0', 'L1', 'L2'] }), { parent: ['L0', 'L1'] });
    expect(over.def?.permissions).toEqual(['L0', 'L1']); expect(over.narrowed).toEqual(['L2']);
    const bad = importAgentZip(exportAgentZip({ ...d, tools: ['auto_follow'] }));
    expect(bad.ok).toBe(false);
    expect(() => exportAgentZip({ ...d, body: 'sk-abcdefghijklmnopqrstuvwxyz123456' })).toThrow(/密钥/);
    expect(importAgentZip(new Uint8Array([1, 2, 3])).ok).toBe(false);
    expect(importAgentZip(z, { existing: ['reply-drafter'] }).errors.join()).toMatch(/同名/);
  });
});

function orch(execute: (a: SubAgentDef, i: HandoffInput, c: { attempt: number; signal: AbortSignal; depth: number; runId: string }) => Promise<unknown>, extra: Partial<ConstructorParameters<typeof Orchestrator>[0]> = {}) {
  const tasks: BoardTask[] = []; const spend: Record<string, number> = {};
  const registry = new RunRegistry();
  const o = new Orchestrator({ registry, concurrency: 3, execute, spentMonth: (id) => spend[id] ?? 0, onTask: (t) => tasks.push(t), onSpend: (id, y) => { spend[id] = (spend[id] ?? 0) + y; }, ...extra });
  return { o, tasks, registry, spend };
}
const SUP = { agentId: 'super', depth: HIERARCHY.super, runId: 'root' };

describe('E8 深度、并发、交接契约、退回一次', () => {
  it('深度：超级 Agent → 子 Agent（2）→ 一次性子任务（3）；再派拒绝；子 Agent 不能交给常驻子 Agent', async () => {
    const { o } = orch(async () => good());
    const a = fromTemplate('platform-adapter');
    const r = await o.delegate(a, input(), SUP);
    expect(r.ok && r.task.depth).toBe(2);
    expect((await o.delegate(a, input(), { agentId: 'platform-adapter', depth: 2 })).ok).toBe(false);
    expect((await o.subtask({ agentId: a.id, depth: 2, runId: 'x' }, async () => 1)).ok).toBe(true);
    const deep = await o.subtask({ agentId: a.id, depth: 3, runId: 'x' }, async () => 1);
    expect(deep.ok).toBe(false); if (!deep.ok) expect(deep.reason).toBe('depth');
    expect((await o.delegate(a, input(), { agentId: 'super', depth: 3 })).ok).toBe(false);
  });
  it('并发上限生效（设为 2 时同时最多 2 个）', async () => {
    let cur = 0, peak = 0;
    const { o } = orch(async () => { cur++; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 20)); cur--; return good(); }, { concurrency: 2 });
    const a = fromTemplate('topic-researcher');
    const rs = await Promise.all(Array.from({ length: 6 }, () => o.delegate(a, input(), SUP)));
    expect(rs.every((r) => r.ok)).toBe(true); expect(peak).toBe(2);
  });
  it('交接契约 Schema：输入缺字段拒绝；输出 summary >300 字退回一次；仍不合格 → 失败', async () => {
    expect(checkHandoff('input', { goal: 'x' }).length).toBeGreaterThan(0);
    expect(checkHandoff('input', input())).toEqual([]);
    expect(checkHandoff('output', JSON.parse(good()))).toEqual([]);
    expect(checkHandoff('output', { ...JSON.parse(good()), summary: '字'.repeat(301) }).join()).toMatch(/300/);
    expect(coerceHandoffOutput('```json\n' + good() + '\n```')?.summary).toBe('完成');
    const seen: string[] = [];
    const { o } = orch(async (_a, _i, c) => { seen.push(String(c.attempt)); return c.attempt === 1 ? good('字'.repeat(301)) : good(); });
    const r = await o.delegate(fromTemplate('platform-adapter'), input(), SUP);
    expect(r.ok).toBe(true); expect(r.ok && r.returned).toBe(true); expect(seen).toEqual(['1', '2']);
    const { o: o2 } = orch(async () => 'no json');
    const r2 = await o2.delegate(fromTemplate('platform-adapter'), input(), SUP);
    expect(r2.ok).toBe(false); if (!r2.ok) { expect(r2.reason).toBe('schema'); expect(r2.task?.state).toBe('failed'); }
    expect((await o2.delegate(fromTemplate('platform-adapter'), { goal: '' } as HandoffInput, SUP)).ok).toBe(false);
  });
  it('验收不合格退回一次并附意见；第二次仍不合格 → 待你批准', async () => {
    const fb: (string | undefined)[] = [];
    const { o } = orch(async (_a, _i, c) => { fb.push((c as unknown as { feedback?: string }).feedback); return good(); }, { review: () => ({ ok: false, feedback: '标题太长' }) });
    const r = await o.delegate(fromTemplate('platform-adapter'), input(), SUP);
    expect(fb).toEqual([undefined, '标题太长']);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.task?.state).toBe('awaiting_user');
  });
  it('超额度：暂停并给出审批事项，不执行', async () => {
    let ran = false;
    const { o } = orch(async () => { ran = true; return good(); }, { spentMonth: () => 2.99, estimate: () => 0.2 });
    const r = await o.delegate(fromTemplate('visual-voice'), input(), SUP);
    expect(ran).toBe(false); expect(r.ok).toBe(false); if (!r.ok) { expect(r.reason).toBe('budget'); expect(r.approval?.kind).toBe('spend'); }
  });
  it('父级取消 → 子级级联取消；全部暂停后拒绝新任务', async () => {
    const { o, registry } = orch(async (_a, _i, c) => new Promise((_r, rej) => c.signal.addEventListener('abort', () => rej(new Error('cancelled')))));
    registry.register({ runId: 'root', agentId: 'super', kind: 'run' });
    const p = o.delegate(fromTemplate('topic-researcher'), input(), SUP);
    await new Promise((r) => setTimeout(r, 5));
    registry.cancel('root');
    const r = await p; expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toBe('cancelled');
    registry.pauseAll();
    const r2 = await o.delegate(fromTemplate('topic-researcher'), input(), SUP); expect(!r2.ok && r2.reason).toBe('paused');
  });
});

describe('E9 任务板状态流转', () => {
  it('待办 → 进行中 → 待验收 → 待你批准 → 完成；非法流转报错', async () => {
    expect(BOARD_COLUMNS).toEqual(['todo', 'running', 'review', 'awaiting_user', 'done', 'failed']);
    const t: BoardTask = { id: 't', title: 'x', agentId: 'a', state: 'todo', depth: 2, returned: 0, cost: 0, createdAt: '', updatedAt: '', history: [] };
    const done = ['running', 'review', 'awaiting_user', 'done'].reduce((x, s) => moveTask(x, s as BoardTask['state']), t);
    expect(done.history.map((h) => h.state)).toEqual(['running', 'review', 'awaiting_user', 'done']);
    expect(() => moveTask(t, 'done')).toThrow(); expect(canMove('done', 'running')).toBe(false);
    const { o, tasks } = orch(async () => good());
    await o.delegate(fromTemplate('topic-researcher'), input(), SUP);
    expect(tasks.map((x) => x.state)).toEqual(['todo', 'running', 'review', 'done']);
  });
});

describe('E10 成长记录与改动分级', () => {
  it('独立成长记录：完成数、退回率、平均花费、采纳率；闲置 30 天只提示', async () => {
    const { o } = orch(async (_a, _i, c) => (c.attempt === 1 ? 'bad' : good()));
    const r = await o.delegate(fromTemplate('topic-researcher'), input(), SUP);
    const s = updateStats(undefined, r, '2026-10-01T00:00:00Z');
    const v = statsView({ ...s, adopted: 1 });
    expect(v.completed).toBe(1); expect(v.returnRate).toBe(1); expect(v.avgCost).toBeCloseTo(0.01); expect(v.adoptionRate).toBe(1);
    expect(idleHint(s, '2026-09-01', Date.parse('2026-10-05'))).toBeNull();
    expect(idleHint(s, '2026-09-01', Date.parse('2026-11-05'))).toMatch(/不会自动删除/);
  });
  it('技能 / 名称改动低风险；职责与权限改动 = L3', () => {
    const a = fromTemplate('data-analyst');
    expect(agentChangeRisk(a, { ...a, skills: ['x'] }).risk).toBe('low');
    expect(agentChangeRisk(a, { ...a, body: a.body + '\n- 新职责' })).toEqual({ risk: 'L3', fields: ['职责'] });
    expect(agentChangeRisk(a, { ...a, permissions: ['L0', 'L1', 'L2'] }).fields).toContain('权限');
  });
});

describe('E17 @子Agent 点名', () => {
  it('@名称 或 @id 交给对应子 Agent；未启用 / 不存在不匹配', () => {
    const team = [fromTemplate('platform-adapter'), { ...fromTemplate('compliance-reviewer'), enabled: false }];
    expect(parseMention('@平台适配编辑 把草稿 #3 适配到 B 站', team)).toEqual({ agentId: 'platform-adapter', name: '平台适配编辑', rest: '把草稿 #3 适配到 B 站' });
    expect(parseMention('@platform-adapter 适配', team)?.agentId).toBe('platform-adapter');
    expect(parseMention('@合规审核员 看看', team)).toBeNull();
    expect(parseMention('@草稿#3 改短', team)).toBeNull();
    expect(teamSummary(team)).toMatch(/平台适配编辑/);
  });
});
