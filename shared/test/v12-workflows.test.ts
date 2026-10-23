import { describe, it, expect } from 'vitest';
import { WORKFLOW_TEMPLATES, WF_EVENTS, serializeWorkflow, parseWorkflow, validateWorkflow, dueSchedules, scheduleAction, serverRunnable, eventWorkflows, scheduleNeedsApproval, runWorkflow, proposeWorkflow, workflowPath, checkName, AGENT_TEMPLATES, type WorkflowDef, type WfCtx } from '../src/index.js';

const agents = AGENT_TEMPLATES.map((a) => a.id);
const ctx = (o: Partial<WfCtx> & { log?: string[] } = {}): WfCtx => ({ signal: new AbortController().signal, approval: () => 'approved', runAgent: async (a, g) => { o.log?.push(`${a}:${g.split('\n')[0]}`); return { ok: true, output: `${a} 的结果`, cost: 0.01 }; }, ...o });

describe('E14 工作流', () => {
  it('定义：3 个模板合法；YAML（JSON 兼容写法）往返；路径合法；硬边界目标被拒', () => {
    expect(WORKFLOW_TEMPLATES.map((w) => w.name)).toEqual(['每日选题晨报', '一稿多发', '周复盘']);
    for (const w of WORKFLOW_TEMPLATES) { expect(validateWorkflow(w, agents)).toEqual([]); expect(parseWorkflow(serializeWorkflow(w))).toEqual(w); expect(checkName(workflowPath(w.id))).toBeNull(); }
    const bad: WorkflowDef = { ...WORKFLOW_TEMPLATES[1]!, nodes: [{ id: 'x', type: 'agent', agent: 'super', goal: '写完直接发布到小红书' }] };
    expect(validateWorkflow(bad).join()).toMatch(/硬边界/);
    expect(validateWorkflow({ ...WORKFLOW_TEMPLATES[0]!, nodes: [{ id: 'a', type: 'agent', agent: 'ghost', goal: 'x' }] }, agents).join()).toMatch(/不存在/);
  });
  it('三类触发：手动 / 定时（启用需 L3 确认；打开执行、关闭只通知、服务器只跑无审批步骤）/ 事件', () => {
    const w = { ...WORKFLOW_TEMPLATES[0]!, enabled: true };
    expect(scheduleNeedsApproval(w)).toBe(true);
    const now = Date.parse('2026-10-24T01:00:00Z'); // 北京 09:00
    expect(dueSchedules([w], {}, now)).toEqual([]);
    const ok = { ...w, scheduleApproved: true };
    expect(dueSchedules([ok], {}, now)).toEqual(['daily-briefing']);
    expect(dueSchedules([ok], { 'daily-briefing': '2026-10-24T00:40:00Z' }, now)).toEqual([]);
    expect(dueSchedules([ok], {}, Date.parse('2026-10-23T23:00:00Z'))).toEqual([]);
    expect(scheduleAction(ok, { appOpen: true, serverConnected: false })).toBe('run');
    expect(scheduleAction(ok, { appOpen: false, serverConnected: false })).toBe('notify');
    expect(scheduleAction(ok, { appOpen: false, serverConnected: true })).toBe('server');
    const pub = WORKFLOW_TEMPLATES[1]!; expect(serverRunnable(pub)).toBe(false);
    expect(scheduleAction(pub, { appOpen: false, serverConnected: true })).toBe('notify');
    expect(WF_EVENTS).toEqual(['inbox.new', 'data.imported', 'draft.approved']);
    expect(eventWorkflows(WORKFLOW_TEMPLATES.map((x) => ({ ...x, enabled: true })), 'data.imported')).toEqual(['weekly-review']);
    expect(eventWorkflows(WORKFLOW_TEMPLATES, 'data.imported')).toEqual([]);
  });
  it('一稿多发：写母稿 → 适配 → 审核 → 审批节点停住（待你批准），批准后续跑完成；输出逐步传递', async () => {
    const log: string[] = [];
    const w = WORKFLOW_TEMPLATES[1]!;
    let s = await runWorkflow(w, ctx({ log, approval: () => 'pending' }));
    expect(s.status).toBe('awaiting_user'); expect(s.resumeAt).toBe('publish');
    expect(log).toEqual(['super:写一篇母稿（自由创作，不带平台格式）', 'platform-adapter:把母稿适配到已选平台，母稿不改：', 'compliance-reviewer:审核这些适配稿，只出意见不改稿：']);
    s = await runWorkflow(w, ctx({ log }), s);
    expect(s.status).toBe('done'); expect(log).toHaveLength(3); expect(s.cost).toBeCloseTo(0.03);
    const rej = await runWorkflow(w, ctx({ approval: () => 'rejected' }));
    expect(rej.status).toBe('failed');
  });
  it('条件、并行、等待、失败与取消', async () => {
    const w: WorkflowDef = { schemaVersion: 1, id: 'mix', name: '混合', description: '', version: 1, enabled: true, createdBy: 'user', scheduleApproved: false, triggers: [{ kind: 'manual' }], nodes: [
      { id: 'a', type: 'agent', agent: 'super', goal: 'A' },
      { id: 'c', type: 'condition', ref: 'a', op: 'contains', value: '结果', then: [{ id: 'p', type: 'parallel', branches: [[{ id: 'b1', type: 'agent', agent: 'topic-researcher', goal: 'B1' }], [{ id: 'b2', type: 'agent', agent: 'data-analyst', goal: 'B2' }]] }], else: [{ id: 'z', type: 'agent', agent: 'super', goal: 'Z' }] },
      { id: 'w', type: 'wait', minutes: 10 },
      { id: 'end', type: 'agent', agent: 'super', goal: 'END' },
    ] };
    expect(validateWorkflow(w, agents)).toEqual([]);
    let t = 0; const log: string[] = [];
    let s = await runWorkflow(w, ctx({ log, now: () => t }));
    expect(s.status).toBe('waiting'); expect(s.nodes.z?.status).toBe('skipped'); expect(log.sort()).toEqual(['data-analyst:B2', 'super:A', 'topic-researcher:B1']);
    t = 11 * 60000; s = await runWorkflow(w, ctx({ log, now: () => t }), s);
    expect(s.status).toBe('done'); expect(log).toContain('super:END');
    const fail = await runWorkflow(w, ctx({ runAgent: async () => ({ ok: false, output: '', error: '超额度' }) }));
    expect(fail.status).toBe('failed'); expect(fail.nodes.a?.note).toBe('超额度');
    const ac = new AbortController(); ac.abort();
    expect((await runWorkflow(w, ctx({ signal: ac.signal }))).status).toBe('cancelled');
  });
  it('提议保存：L1 草稿，停用、只能手动触发', () => {
    const p = proposeWorkflow('我的一稿多发', [{ agentId: 'super', goal: '写' }, { agentId: 'platform-adapter', goal: '适配' }], ['saved-run']);
    expect(p.id).toBe('saved-run-2'); expect(p.enabled).toBe(false); expect(p.triggers).toEqual([{ kind: 'manual' }]); expect(p.createdBy).toBe('super');
    expect(validateWorkflow(p, agents)).toEqual([]);
  });
});
