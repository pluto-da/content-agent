import { describe, it, expect } from 'vitest';
import { addContext, retrieveContext, contextHitRate, decomposeYearGoal, decomposeDeptOkr, detectOkrConflicts, alignRequest, okrProgress, cycleLabel, defaultOrg, findSecrets, type ContextItem } from '../src/index.js';

describe('F5 集团上下文流与 OKR 公开', () => {
  it('上下文流：按时间汇流、按相关性检索并受 token 预算约束；部门级只给本部门', () => {
    let flow: ContextItem[] = [];
    flow = addContext(flow, { kind: 'goal', level: 'public', title: '年度目标', body: '抖音粉丝年内到 10 万', refs: [] }).flow;
    flow = addContext(flow, { kind: 'resolution', level: 'public', title: '经管会决议', body: '本季度主推口播短视频，图文配合', refs: ['集团〔2026〕001号'] }).flow;
    flow = addContext(flow, { kind: 'progress', level: 'dept', deptId: 'bu-video', title: '短视频周报', body: '口播脚本 3 篇', refs: [] }).flow;
    const r = retrieveContext(flow, '写一条口播短视频脚本', { deptId: 'bu-article', tokenBudget: 200 });
    expect(r.items.map((x) => x.kind)).toContain('resolution');
    expect(r.items.some((x) => x.level === 'dept')).toBe(false);
    expect(retrieveContext(flow, '口播短视频周报', { deptId: 'bu-video' }).items.some((x) => x.kind === 'progress')).toBe(true);
    expect(retrieveContext(flow, '口播短视频', { tokenBudget: 5 }).items).toHaveLength(0);
    expect(contextHitRate([{ usedContextRefs: 2 }, { usedContextRefs: 0 }])).toBe(0.5);
    expect(contextHitRate([])).toBeNull();
  });
  it('上下文流不含私密记忆和 Key', () => {
    const p = addContext([], { kind: 'lesson', level: 'private', title: '私密记忆', body: '我的生日', refs: [] });
    expect(p.added).toBeNull();
    const k = addContext([], { kind: 'lesson', level: 'public', title: 'x', body: 'key sk-abcdefghijklmnopqrstuvwxyz123', refs: [] });
    expect(k.added).toBeNull();
    const flow = addContext([], { kind: 'lesson', level: 'public', title: '经验', body: '口播前三秒给结论', refs: [] }).flow;
    expect(findSecrets(JSON.stringify(flow), { strict: true })).toHaveLength(0);
    expect(JSON.stringify(flow)).not.toMatch(/生日/);
  });
  it('OKR：年度目标 → 部门 OKR → Agent KR，全部公开；无数据写待录入；季度默认、可设双月', () => {
    const okrs = decomposeYearGoal({ title: '账号年内到 10 万粉', metric: 'followers', target: 100000, unit: '粉' }, defaultOrg(), 'quarter', new Date('2026-10-24'));
    expect(okrs[0]!.level).toBe('year');
    expect(okrs.filter((o) => o.level === 'dept' && o.owner.startsWith('bu-'))).toHaveLength(4);
    expect(okrs.every((o) => o.public)).toBe(true);
    expect(okrs[1]!.period).toBe('2026Q4');
    expect(cycleLabel('bimonth', new Date('2026-10-24'))).toBe('2026B5');
    const ag = decomposeDeptOkr(okrs[1]!, ['script-a', 'script-b']);
    expect(ag.every((o) => o.level === 'agent' && o.parent === okrs[1]!.id)).toBe(true);
    expect(okrProgress(okrs[1]!).text).toBe('待录入');
  });
  it('对齐请求：数据中心发现两个事业部 KR 冲突', () => {
    const okrs = decomposeYearGoal({ title: 'g', metric: 'followers', target: 100, unit: '粉' }, defaultOrg());
    const v = okrs.find((o) => o.owner === 'bu-video')!, a = okrs.find((o) => o.owner === 'bu-article')!;
    v.krs.push({ id: 'kr-v-slot', title: '周三晚 8 点档发视频', metric: 'slot', direction: 'up', target: 1, unit: '条', current: null, resource: 'wed-20:00' });
    a.krs.push({ id: 'kr-a-slot', title: '周三晚 8 点档发图文', metric: 'slot2', direction: 'up', target: 1, unit: '条', current: null, resource: 'wed-20:00' });
    const c = detectOkrConflicts(okrs);
    expect(c).toHaveLength(1);
    expect(c[0]!.why).toMatch(/资源/);
    const req = alignRequest('data-center', c[0]!);
    expect(req.status).toBe('open');
  });
});

describe('1.3 截图复核回归：KR 标题不露内部 id', () => {
  it('followers / douyin 显示为 粉丝 / 抖音', async () => {
    const { decomposeYearGoal, defaultOrg, okrPlatformText } = await import('../src/index.js');
    const okrs = decomposeYearGoal({ title: '年内 10 万粉', metric: 'followers', target: 100000, unit: '粉' }, defaultOrg('测试'));
    const titles = okrs.flatMap((o) => o.krs.map((k) => k.title)).join('\n');
    expect(titles).not.toMatch(/followers|douyin|xiaohongshu/);
    expect(okrs[0]!.krs[0]!.title).toBe('粉丝 达到 100000粉');
    expect(titles).toMatch(/抖音 粉丝 贡献/);
    expect(okrPlatformText('unknown-x')).toBe('unknown-x');
  });
});
