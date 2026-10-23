import { describe, it, expect } from 'vitest';
import {
  SESSION_TRIGGERS, SESSION_DEFAULTS, recommendMembers, parseChairmanPull, openSession, promoteQueued, postMessage, tickSession, checkOff, escalateToMeeting, todosToTickets, hasArgument, similarity,
  defaultOrg, authorize, parseDoa, doaCheck, type TempSession,
} from '../src/index.js';

const org = defaultOrg();
const mk = (o: Partial<Parameters<typeof openSession>[1]> = {}) => openSession([], { topic: '两个事业部周三晚档 KR 冲突', initiator: 'data-center-head', members: ['bu-video-head', 'bu-article-head'], trigger: 'okr_conflict', now: 0, ...o }).session;

describe('F6 临时会话', () => {
  it('6 种触发；自动推荐成员 ≤5 并附上下文；董事长“拉个群 / 叫上 X 和 Y”', () => {
    expect(SESSION_TRIGGERS).toHaveLength(6);
    const rec = recommendMembers('短视频和图文的 OKR 冲突怎么对齐', org, 'staff-head');
    expect(rec.length).toBeLessThanOrEqual(5);
    expect(rec[0]).toBe('staff-head');
    expect(rec).toContain('data-center-head');
    expect(parseChairmanPull('拉个群讨论下周主推方向', org)?.topic).toBe('下周主推方向');
    const p = parseChairmanPull('叫上短视频和法务合规商量一下', org)!;
    expect(p.members).toEqual(expect.arrayContaining(['bu-video-head', 'legal-head']));
    expect(SESSION_DEFAULTS).toMatchObject({ maxMembers: 5, maxTurns: 10, budgetYuan: 0.2, maxAlive: 5 });
  });
  it('4 条消息达成一致 → √ 解散 → 小结与工单', () => {
    let s = mk({ context_refs: ['okr-bu-video', 'okr-bu-article'] });
    const say = (from: string, text: string) => { const r = postMessage(s, { from, text, cost: 0.001, now: 1000 }); expect(r.ok).toBe(true); s = r.session; };
    say('data-center-head', '数据：两个事业部都把周三 20:00 定为唯一黄金档，KR 冲突，建议错峰。');
    say('bu-video-head', '短视频周三 20:00 历史完播率最高，我建议视频留在 20:00，因为样本 6 周。');
    say('bu-article-head', '图文可以挪到 21:30，小红书该时段收藏率不低；待办：图文排期改 21:30');
    say('data-center-head', '结论：视频 20:00、图文 21:30，下季度复盘再看。');
    s = checkOff(s, 'data-center-head', 2000);
    expect(s.status).toBe('dissolved');
    expect(s.closeReason).toBe('goal');
    expect(s.outcome!.conclusions.join()).toMatch(/21:30/);
    expect(todosToTickets(s)[0]).toMatchObject({ title: '图文排期改 21:30', agentId: 'bu-article-head' });
    expect(() => checkOff(mk(), 'bu-video-head')).toThrow(/发起方或董事长/);
  });
  it('会话 TTL 和上限解散：消息上限、费用上限、TTL 到期、同时存活 ≤5 排队', () => {
    let s = mk({ limits: { maxTurns: 2 } });
    s = (postMessage(s, { from: 'bu-video-head', text: '建议视频留在 20:00，因为完播率最高' }) as { session: TempSession }).session;
    s = (postMessage(s, { from: 'bu-article-head', text: '图文挪到 21:30 风险可控，收藏率差不多' }) as { session: TempSession }).session;
    expect([s.status, s.closeReason]).toEqual(['dissolved', 'turns']);
    let b = mk();
    b = (postMessage(b, { from: 'bu-video-head', text: '这条发言很贵，因为调用了主模型', cost: 0.25 }) as { session: TempSession }).session;
    expect(b.closeReason).toBe('budget');
    const t = tickSession(mk(), SESSION_DEFAULTS.ttlMs + 1);
    expect(t.closeReason).toBe('ttl');
    expect(t.outcome).not.toBeNull();
    let list: TempSession[] = [];
    for (let i = 0; i < 6; i++) list = openSession(list, { topic: `议题${i}`, initiator: 'staff-head', members: [], trigger: 'multi_dept', now: i }).list;
    expect(list.filter((x) => x.status === 'open')).toHaveLength(5);
    expect(list[5]!.status).toBe('queued');
    list[0] = checkOff(list[0]!, 'staff-head');
    expect(promoteQueued(list)[5]!.status).toBe('open');
  });
  it('重复发言被拦截；无论点被拒；非成员被拒；Key 不进入', () => {
    let s = mk();
    s = (postMessage(s, { from: 'bu-video-head', text: '建议视频留在周三 20:00，因为完播率最高' }) as { session: TempSession }).session;
    const dup = postMessage(s, { from: 'bu-article-head', text: '建议视频留在周三 20:00，因为完播率最高。' });
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.reason).toBe('duplicate');
    expect(!postMessage(s, { from: 'bu-article-head', text: '同意' }).ok).toBe(true);
    expect((postMessage(s, { from: 'finance-head', text: '我认为预算不够，因为本月已花 80%' }) as { reason: string }).reason).toBe('not_member');
    expect((postMessage(s, { from: 'bu-video-head', text: 'key 是 sk-abcdefghijklmnopqrstuvwxyz 因为' }) as { reason: string }).reason).toBe('secret');
    expect(hasArgument('收到')).toBe(false);
    expect(similarity('完全一样的话', '完全一样的话')).toBe(1);
    expect(postMessage(s, { from: 'chairman', text: '嗯' }).ok).toBe(true);
  });
  it('可升级为会议（未决事项带进评审室议题）', () => {
    let s = mk();
    s = (postMessage(s, { from: 'bu-video-head', text: '视频是否要改成每天两条？需要数据支持' }) as { session: TempSession }).session;
    const { session, meeting } = escalateToMeeting(s);
    expect(session.closeReason).toBe('escalated');
    expect(meeting.roomId).toBe('review');
    expect(meeting.agenda).toMatch(/未决/);
  });
  it('会话或会议不提升权限：成员在会话里的动作仍按本人授权与 DOA 判定', () => {
    const s = mk();
    expect(s.members).toContain('bu-video-head');
    const grant = { agentId: 'bu-video-head', permissions: ['L0', 'L1'] as ('L0' | 'L1')[] };
    expect(authorize({ ...grant, permissions: [...grant.permissions] }, { name: 'tts_generate', level: 'L2' }).allow).toBe(false);
    expect(doaCheck(parseDoa(), { matter: 'spend', actor: { role: 'dept_head', id: 'bu-video-head' }, amountYuan: 1, summary: '会话里决定买配音' }).allow).toBe(false);
  });
});
