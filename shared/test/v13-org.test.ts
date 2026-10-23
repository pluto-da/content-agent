import { describe, it, expect } from 'vitest';
import {
  defaultOrg, orgSummary, topCommittees, applyOrgChange, orgChangeLevel, serializeDeptMd, parseDeptMd, serializeCommitteeMd, parseCommitteeMd, deptPath, committeePath, isDeptPath, isCommitteePath,
  checkHeadcount, clampHeadcount, validateDept, assignAgents, deptForAgent, deptOfAgent, AGENT_TEMPLATES, CHAIN, GROUP_HONESTY, GROUP_SOURCE_NOTE, type Dept,
} from '../src/index.js';

describe('F1 融合组织', () => {
  it('默认组织：4 职能部门 + 4 事业部 + 共享能力中心 + 5 委员会（设计委员会隶属技术委员会）', () => {
    const o = defaultOrg();
    const s = orgSummary(o);
    expect([s.hq, s.bu, s.committees]).toEqual([4, 4, 5]);
    expect(s.shared).toBeGreaterThanOrEqual(1);
    expect(o.depts.filter((x) => x.kind === 'hq').map((x) => x.name)).toEqual(['参谋部', '组织部', '财务部', '法务合规部']);
    expect(topCommittees(o).map((x) => x.name)).toEqual(['经营管理委员会', '人力资源委员会', '质量委员会', '技术委员会', '采购委员会']);
    expect(o.committees.find((x) => x.id === 'design')?.parent).toBe('tech');
    expect(o.depts.find((x) => x.id === 'legal')?.veto).toBe('compliance');
    expect(o.committees.find((x) => x.id === 'quality')?.veto).toBe('quality');
    expect(o.depts.filter((x) => x.kind === 'bu').every((x) => (x.posts ?? []).length === 3)).toBe(true);
    expect(CHAIN).toEqual(['chairman', 'ceo', 'dept_head', 'executor']);
    expect(o.name).toBe('我的集团');
  });
  it('可增、改名、删（成员转待分配）、合并；结构变化属 L3，调岗 / 暂停属 L1', () => {
    let o = defaultOrg('长鱼集团');
    const live: Dept = { id: 'live-plan', name: '直播策划组', kind: 'bu', head: 'live-plan-head', members: [], duties: ['直播脚本草稿'], budgetYuan: 1, permCap: 'L2', peers: [], platforms: ['douyin'], status: 'active' };
    o = applyOrgChange(o, { op: 'add', dept: live });
    expect(o.depts.some((x) => x.id === 'live-plan')).toBe(true);
    o = applyOrgChange(o, { op: 'move', agentId: 'a1', to: 'bu-ecom' });
    o = applyOrgChange(o, { op: 'rename', id: 'bu-ecom', name: '电商与直播事业部' });
    o = applyOrgChange(o, { op: 'merge', from: 'live-plan', into: 'bu-ecom' });
    expect(o.depts.find((x) => x.id === 'bu-ecom')?.duties).toContain('直播脚本草稿');
    o = applyOrgChange(o, { op: 'remove', id: 'bu-ecom' });
    expect(o.depts.find((x) => x.id === 'pending')?.members).toContain('a1');
    expect(() => applyOrgChange(o, { op: 'remove', id: 'pending' })).toThrow();
    expect(orgChangeLevel({ op: 'add', dept: live })).toBe('L3');
    expect(orgChangeLevel({ op: 'merge', from: 'a', into: 'b' })).toBe('L3');
    expect(orgChangeLevel({ op: 'move', agentId: 'x', to: 'y' })).toBe('L1');
  });
  it('诚实声明与来源注明', () => {
    expect(GROUP_HONESTY).toMatch(/不是法律实体/);
    expect(GROUP_SOURCE_NOTE).toMatch(/非任何公司官方制度/);
  });
});

describe('F2 DEPT / COMMITTEE 清单与编制上限', () => {
  it('DEPT.md / COMMITTEE.md 往返一致，路径规则', () => {
    const o = defaultOrg();
    for (const x of o.depts) expect(parseDeptMd(serializeDeptMd(x))).toEqual(JSON.parse(JSON.stringify({ ...x, posts: x.posts })));
    for (const x of o.committees) expect(parseCommitteeMd(serializeCommitteeMd(x))).toEqual(x);
    expect(isDeptPath(deptPath('bu-video'))).toBe(true);
    expect(isCommitteePath(committeePath('hr'))).toBe(true);
    expect(isDeptPath('company/departments/BAD/DEPT.md')).toBe(false);
  });
  it('编制：执行 Agent ≤20、同时运行 ≤3（可调，属 L3）；清单校验拒绝 L3 权限上限与 Key', () => {
    let o = defaultOrg();
    for (let i = 0; i < 20; i++) o = applyOrgChange(o, { op: 'move', agentId: `a${i}`, to: 'pending' });
    expect(checkHeadcount(o, 0).ok).toBe(true);
    expect(checkHeadcount(o, 1).ok).toBe(false);
    expect(clampHeadcount({ maxAgents: 999, maxConcurrent: 9 })).toEqual({ maxAgents: 50, maxConcurrent: 5 });
    expect(o.headcount).toEqual({ maxAgents: 20, maxConcurrent: 3 });
    const bad = { ...o.depts[0]!, id: 'x-y', permCap: 'L3' as const, name: 'sk-abcdefghijklmnopqrstuv' };
    expect(validateDept(bad).join()).toMatch(/L0–L2/);
    expect(validateDept(bad).join()).toMatch(/Key/);
  });
  it('1.2 子 Agent 按职责归入默认部门，其余进待分配', () => {
    const o = assignAgents(defaultOrg(), [...AGENT_TEMPLATES.map((a) => ({ id: a.id, description: a.description })), { id: 'mystery', description: '???' }]);
    expect(deptOfAgent(o, 'compliance-reviewer')?.id).toBe('legal');
    expect(deptOfAgent(o, 'data-analyst')?.id).toBe('data-center');
    expect(deptOfAgent(o, 'mystery')?.id).toBe('pending');
    expect(deptForAgent({ id: 'x-video', description: '短视频脚本' })).toBe('bu-video');
  });
});
