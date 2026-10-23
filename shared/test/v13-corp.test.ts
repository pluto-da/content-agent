import { describe, it, expect } from 'vitest';
import {
  veto, appeal, ruleAppeal, chairmanOverride, escalate, escalateAgain, chairmanAsk, reviewRound, DECISION_LADDER, retro, RETRO_STEPS, kpi, review360, VALUES, commissarObserve, commissarCommand, appointment,
  spendByDept, meetingShare, addContext, parseGroupCommand, defaultOrg, emptyGroupState, readGroupState, writeGroupState, MECHANISMS, type SpendEntry,
} from '../src/index.js';

describe('F11 否决、申诉、升级路径、董事长终裁', () => {
  it('否决须引用条款；仅法务合规部与质量委员会；申诉一次由 CEO 裁决；硬边界不可申诉、董事长也不能推翻', () => {
    expect(() => veto({ by: 'staff', target: 'd1', clause: 'charter#5', reason: 'x' })).toThrow(/仅法务合规部/);
    expect(() => veto({ by: 'legal', target: 'd1', clause: '第99条', reason: '涉嫌违规' })).toThrow(/条款/);
    const hb = veto({ by: 'legal', target: 'd1', clause: 'charter#5', reason: '要求“自动私信引流”', hardBoundary: true });
    expect(hb.reason).toMatch(/《集团章程》第五条/);
    expect(() => appeal(hb, 'bu-ecom-head', '只是建议')).toThrow(/不可申诉/);
    expect(() => chairmanOverride(hb, 'overturned')).toThrow(/硬边界/);
    let q = veto({ by: 'quality', target: 'd2', clause: 'quality#2', reason: '标题夸大' });
    q = appeal(q, 'bu-article-head', '已改标题');
    expect(() => appeal(q, 'x', 'y')).toThrow(/一次/);
    q = ruleAppeal(q, 'overturned');
    expect(q.appeal!.ruling).toBe('overturned');
    expect(chairmanOverride(q, 'upheld').appeal!.ruling).toBe('upheld');
  });
  it('升级：执行 → 部门负责人 → 委员会 → CEO → 董事长；超权直达董事长并附双方意见与 CEO 建议；审核退回最多两轮', () => {
    expect(DECISION_LADDER).toEqual(['executor', 'dept_head', 'committee', 'ceo', 'chairman']);
    let e = escalate({ trigger: 'dept_conflict', subject: '周三档期之争', level: 'dept_head', opinions: [{ side: '短视频', text: '留 20:00' }, { side: '图文', text: '也要 20:00' }] });
    expect(e.level).toBe('committee');
    e = escalateAgain(e, '经管会无决议');
    expect(e.level).toBe('ceo');
    e = escalateAgain(e, 'CEO 无法裁决', '建议轮换档期');
    expect(e.toChairman).toBe(true);
    const ask = chairmanAsk(e);
    expect(ask.body).toMatch(/短视频：留 20:00[\s\S]*图文：也要 20:00[\s\S]*CEO 建议：建议轮换档期/);
    expect(escalate({ trigger: 'over_authority', subject: 'x', level: 'executor', opinions: [] }).toChairman).toBe(true);
    expect(reviewRound(1)).toEqual({ allowReturn: true, escalate: false });
    expect(reviewRound(2)).toEqual({ allowReturn: false, escalate: true });
  });
});

describe('F12 复盘四步与 lesson 沉淀', () => {
  it('四步齐全；低风险 lesson 自动采纳并写入上下文流，高风险进收件箱', () => {
    expect(RETRO_STEPS).toEqual(['目标回顾', '结果对比', '原因分析', '经验沉淀']);
    const r = retro({ subject: 'Q4 第一个月', trigger: 'okr_cycle', goal: '粉丝 +2000', result: '待录入', causes: '发布时间不固定', lessons: ['口播前三秒先给结论', '把配音预算提高到 ¥2'] });
    expect(r.lessons.map((l) => [l.risk, l.status])).toEqual([['low', 'adopted'], ['high', 'pending']]);
    let flow = addContext([], { kind: 'lesson', level: 'public', title: '复盘经验', body: r.lessons.filter((l) => l.status === 'adopted').map((l) => l.text).join('；'), refs: [r.id] }).flow;
    expect(flow[0]!.body).toMatch(/口播前三秒/);
    flow = flow.filter(Boolean);
  });
});

describe('F13 360 评议、政委、任免', () => {
  it('KPI 只用可验证数据（无数据 = null）；360 只由协作过的部门互评；价值观三条', () => {
    const k = kpi({ outputs: 10, firstPass: 7, returned: 2, offered: 5, adopted: 3, onTime: 9, due: 10, cost: 0.1234, userMetric: null });
    expect(k).toMatchObject({ 产出数: 10, 一次通过率: 0.7, 退回率: 0.2, 采纳率: 0.6, 按时率: 0.9, 效果数据: null });
    expect(kpi({ outputs: 0, firstPass: 0, returned: 0, offered: 0, adopted: 0, onTime: 0, due: 0, cost: 0 }).一次通过率).toBeNull();
    const r = review360([{ from: 'bu-video', to: 'data-center', score: 4, note: '' }, { from: 'bu-intl', to: 'data-center', score: 1, note: '没合作过' }, { from: 'legal', to: 'legal', score: 5, note: '' }], [['bu-video', 'data-center']]);
    expect(r.byDept['data-center']).toEqual({ avg: 4, n: 1 });
    expect(r.rejected).toHaveLength(2);
    expect(VALUES).toHaveLength(3);
  });
  it('政委只建议不指挥：建议均为非约束性；试图下指令被拒并审计', () => {
    const adv = commissarObserve({ deptId: 'bu-video', returnRate: 0.6, contextHitRate: 0.1, failures: 2, boundaryHits: 1, idleDays: 0, missingSkills: ['口播结构'], fabricatedData: 2 });
    expect(adv.map((a) => a.kind)).toEqual(['boundary', 'values', 'inefficient', 'context', 'skill']);
    expect(adv.every((a) => a.binding === false)).toBe(true);
    expect(adv.find((a) => a.kind === 'inefficient')!.suggestion).toBe('transfer');
    const c = commissarCommand('bu-video', '立刻停用脚本 Agent');
    expect(c.ok).toBe(false);
    expect(c.audit.outcome).toBe('denied');
  });
  it('任免：权限升级 / 新设撤销部门 / 停用走人资委 → 董事长；降级暂停 CEO 先处置后报告；删除被拒', () => {
    expect(appointment('new_dept', 'live-plan').route).toBe('hr_then_chairman');
    expect(appointment('disable_agent', 'x').route).toBe('hr_then_chairman');
    expect(appointment('pause', 'x').route).toBe('ceo_then_report');
    expect(appointment('delete_agent', 'x').route).toBe('refused');
  });
});

describe('F18 开会花费占比与 30% 提醒', () => {
  it('花费计入发起部门；会议 + 会话占比超过 30% 提醒精简', () => {
    const L: SpendEntry[] = [{ deptId: 'bu-video', kind: 'task', yuan: 0.5, at: '', ref: 't' }, { deptId: 'staff', kind: 'meeting', yuan: 0.3, at: '', ref: 'm' }, { deptId: 'data-center', kind: 'session', yuan: 0.1, at: '', ref: 's' }];
    expect(spendByDept(L)).toEqual({ 'bu-video': 0.5, staff: 0.3, 'data-center': 0.1 });
    const s = meetingShare(L);
    expect(s.share).toBeCloseTo(0.444, 2);
    expect(s.alert).toBe(true);
    expect(s.text).toMatch(/超过 30%/);
    expect(meetingShare([{ deptId: 'a', kind: 'task', yuan: 1, at: '', ref: '' }, { deptId: 'a', kind: 'meeting', yuan: 0.2, at: '', ref: '' }]).alert).toBe(false);
    expect(meetingShare([]).share).toBeNull();
  });
});

describe('F15 @部门 / @委员会 / 拉群 / 开会 / 赛马 指令', () => {
  const org = defaultOrg();
  it('解析五类指令', () => {
    expect(parseGroupCommand('@短视频事业部 出三个口播选题', org)).toMatchObject({ kind: 'mention_dept', id: 'bu-video', rest: '出三个口播选题' });
    expect(parseGroupCommand('@质量委员会 看看这篇', org)).toMatchObject({ kind: 'mention_committee', id: 'quality' });
    expect(parseGroupCommand('@法务合规部 查极限词', org)).toMatchObject({ kind: 'mention_dept', id: 'legal' });
    expect(parseGroupCommand('拉个群讨论下周主推方向', org)).toMatchObject({ kind: 'pull', topic: '下周主推方向' });
    expect(parseGroupCommand('叫上短视频和图文商量一下档期', org)).toMatchObject({ kind: 'pull', names: ['短视频', '图文'] });
    expect(parseGroupCommand('开个评审会：三个选题', org)).toMatchObject({ kind: 'meeting', roomId: 'review', topic: '三个选题' });
    expect(parseGroupCommand('开个复盘会', org)).toMatchObject({ kind: 'meeting', roomId: 'retro' });
    expect(parseGroupCommand('主推视频切入角度，这件事赛马', org)).toMatchObject({ kind: 'race', topic: '主推视频切入角度' });
    expect(parseGroupCommand('今天写点什么', org)).toBeNull();
    expect(parseGroupCommand('@不存在 hi', org)).toBeNull();
  });
});

describe('F16 集团模式默认关闭，可启用与退回', () => {
  it('默认关闭；状态往返；机制可开关', () => {
    const s = emptyGroupState();
    expect(s.enabled).toBe(false);
    expect(Object.values(s.mechanisms).every(Boolean)).toBe(true);
    expect(MECHANISMS).toHaveLength(8);
    const back = readGroupState(writeGroupState({ ...s, enabled: true, name: '长鱼集团' }));
    expect([back.enabled, back.name]).toEqual([true, '长鱼集团']);
    expect(readGroupState('not json').enabled).toBe(false);
  });
});
