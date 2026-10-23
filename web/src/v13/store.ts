/**
 * 1.3.0 集团模式的本机接线：config/group.json（唯一真相源）+ company/ 清单与制度（Agent VFS，随备份导出，不含 Key）。
 * 集团模式默认关闭；启用写入 company/；退回 1.2 只关开关、保留数据。所有动作按执行者本人的权限与 DOA 判定，会话 / 会议不提升权限。
 * 发言：接入的是本机模拟服务商（mock://）或没有模型时用 shared 的 mockSpeaker（不联网）；否则走与对话相同的服务商。
 */
import {
  readGroupState, writeGroupState, emptyGroupState, defaultOrg, deptPath, committeePath, serializeDeptMd, serializeCommitteeMd, REGULATION_FILES, REGULATION_INDEX, REGULATION_INDEX_TEXT, initRegHistory, assignAgents,
  addContext, decomposeYearGoal, detectOkrConflicts, alignRequest, retrieveContext, contextHitRate, openSession, postMessage, checkOff, escalateToMeeting, todosToTickets, recommendMembers, parseChairmanPull, tickSession, promoteQueued,
  newMeeting, runMeeting, intervene, preDocument, newDoc, decideDoc, mockSpeaker, speakPrompt, canStartRace, newRace, runRace, scoreBlind, decideRace, archivedAssets, leaderboard, newGray, observe, evaluateGray,
  veto, appeal, retro, review360, commissarObserve, appointment, applyOrgChange, meetingShare, spendByDept, parseDoa, doaCheck, proposeRegChange, applyRegChange, rollbackReg, currentReg, checkResolution, parseGroupCommand,
  findSecrets, GROUP_HONESTY, raceEffect, okrProgress, ROOMS,
  type GroupState, type Speaker, type SpendEntry, type SpendKind, type TempSession, type Meeting, type Race, type Dept, type ContextItem, type DocType, type BoardTask, type GrayRelease,
} from '@content-agent/shared';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';
import { getModels, resolveProvider } from '../local/store';
import { chat, costOf } from '../local/llm';
import { addMessage } from '../agent/store';
import { listAgents, updateState as updateSuper, pauseAll as pauseSuper, resumeAll as resumeSuper, isPausedNow } from '../v12/store';
import { post } from '../api';

export const GROUP_STATE = 'config/group.json';
type Listener = () => void;
const listeners = new Set<Listener>();
export function onGroupChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { for (const f of [...listeners]) f(); };

let queue: Promise<unknown> = Promise.resolve();
export async function getGroup(): Promise<GroupState> { const v = await getVfs(); return readGroupState((await v.read(GROUP_STATE))?.content); }
export function updateGroup(fn: (s: GroupState) => GroupState | Promise<GroupState>): Promise<GroupState> {
  const p = queue.then(async () => {
    const v = await getVfs();
    const cur = readGroupState((await v.read(GROUP_STATE))?.content);
    const next = await fn(cur);
    await v.write(GROUP_STATE, writeGroupState(next), { author: 'system', allowLarge: true });
    emit();
    return next;
  });
  queue = p.catch(() => undefined);
  return p;
}
const flow = (s: GroupState, item: Omit<ContextItem, 'id' | 'at' | 'refs'> & { refs?: string[] }): GroupState => ({ ...s, flow: addContext(s.flow, { refs: [], ...item }).flow });
const spend = (s: GroupState, deptId: string, kind: SpendKind, yuan: number, ref: string): GroupState => (yuan > 0 ? { ...s, ledger: [...s.ledger, { deptId, kind, yuan: +yuan.toFixed(6), at: new Date().toISOString(), ref } as SpendEntry] } : s);
const names = (s: GroupState): Record<string, string> => Object.fromEntries([...s.org.depts.map((d) => [d.head, d.name]), ['ceo', 'CEO'], ['chairman', '董事长']]);
function guard(s: GroupState): void { if (s.paused || isPausedNow()) throw new Error('已全部暂停：恢复需你手动'); if (!s.enabled) throw new Error('集团模式未启用'); }

/* ---------------- 发言（模拟 / 真实服务商） ---------------- */
export async function groupSpeaker(): Promise<{ speak: Speaker; mock: boolean }> {
  const cfg = resolveProvider(await getModels());
  if (!cfg || /^mock:/.test(cfg.baseURL)) return { speak: mockSpeaker, mock: true };
  return { mock: false, speak: async (r) => {
    const p = speakPrompt(r);
    const out = await chat(cfg, [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: p.maxTokens, timeoutMs: 60000 });
    return { text: out.content, cost: costOf(cfg.id, out.model, out.usage) };
  } };
}

/* ---------------- 启用 / 退回 ---------------- */
export async function enableGroup(name = '我的集团'): Promise<GroupState> {
  const clean = name.trim().slice(0, 20) || '我的集团';
  if (findSecrets(clean).length) throw new Error('集团名称里不能有 Key');
  const v = await getVfs();
  const agents = await listAgents().catch(() => []);
  const cur = await getGroup();
  const org = cur.org.depts.length ? cur.org : defaultOrg(clean);
  const assigned = assignAgents({ ...org, name: clean }, agents.map((a) => ({ id: a.id, description: a.description })));
  for (const d of assigned.depts) await v.write(deptPath(d.id), serializeDeptMd(d), { author: 'system' });
  for (const c of assigned.committees) await v.write(committeePath(c.id), serializeCommitteeMd(c), { author: 'system' });
  for (const [p, t] of Object.entries(REGULATION_FILES)) if (!(await v.read(p))) await v.write(p, t, { author: 'system', allowLarge: true });
  if (!(await v.read(REGULATION_INDEX))) await v.write(REGULATION_INDEX, REGULATION_INDEX_TEXT, { author: 'system' });
  await audit({ kind: 'setting_change', actor: 'user', summary: `启用集团模式「${clean}」（${GROUP_HONESTY}）`, outcome: 'ok' });
  return updateGroup((s) => flow({ ...s, enabled: true, enabledAt: s.enabledAt ?? new Date().toISOString(), name: clean, org: assigned, regs: Object.keys(s.regs).length ? s.regs : initRegHistory() }, { kind: 'org', level: 'public', title: '集团成立', body: `「${clean}」启用集团模式：4 职能部门、4 事业部、共享能力中心、5 委员会。` }));
}
export async function disableGroup(): Promise<void> { await updateGroup((s) => ({ ...s, enabled: false })); await audit({ kind: 'setting_change', actor: 'user', summary: '退回 1.2 体验（集团模式关闭，数据保留）', outcome: 'ok' }); }
export async function renameGroup(name: string): Promise<void> { await updateGroup((s) => ({ ...s, name: name.trim().slice(0, 20) || s.name, org: { ...s.org, name: name.trim().slice(0, 20) || s.name } })); }
export async function toggleMechanism(m: keyof GroupState['mechanisms'], on: boolean): Promise<void> { await updateGroup((s) => ({ ...s, mechanisms: { ...s.mechanisms, [m]: on } })); }

/* ---------------- 目标与 OKR ---------------- */
export async function setYearGoal(goal: { title: string; metric: string; target: number; unit: string }): Promise<GroupState> {
  return updateGroup((s) => {
    guard(s);
    const okrs = decomposeYearGoal(goal, s.org, s.okrCycle);
    // 事业部各自申请所在主平台的黄金档（独占资源），数据中心据此发现冲突
    for (const o of okrs) { const d = s.org.depts.find((x) => x.id === o.owner && x.kind === 'bu'); if (d?.platforms[0]) o.krs.push({ id: `kr-${d.id}-slot`, title: `${d.platforms[0]} 黄金档固定发布`, metric: `slot-${d.id}`, platform: d.platforms[0], direction: 'up', target: 1, unit: '档', current: null, resource: `slot:${d.platforms[0]}-prime` }); }
    let n = flow({ ...s, yearGoal: goal, okrs }, { kind: 'goal', level: 'public', title: '董事长年度目标', body: `${goal.title}（${goal.metric} ${goal.target}${goal.unit}）` });
    n = flow(n, { kind: 'okr', level: 'public', title: '经管会拆解 OKR（公开）', body: okrs.filter((o) => o.level === 'dept').map((o) => o.title).join('；') });
    return n;
  });
}
/** 数据中心检查 KR 冲突 → 对齐请求 → 自动建临时会话（成员按议题推荐）。 */
export async function checkConflicts(): Promise<{ conflicts: number; sessionId: string | null }> {
  let sid: string | null = null; let count = 0;
  await updateGroup((s) => {
    guard(s);
    const cs = detectOkrConflicts(s.okrs).filter((c) => !s.aligns.some((a) => a.id === alignRequest('data-center', c).id));
    count = cs.length;
    if (!cs.length) return s;
    const c = cs[0]!;
    const nm = (id: string) => s.org.depts.find((d) => d.id === id);
    let n: GroupState = { ...s, aligns: [...s.aligns, ...cs.map((x) => alignRequest('data-center', x))] };
    if (!s.mechanisms.sessions) return n;
    const topic = `${nm(c.a)?.name ?? c.a}与${nm(c.b)?.name ?? c.b}的 KR 冲突：${c.why}`;
    const members = [...new Set(['data-center-head', nm(c.a)?.head, nm(c.b)?.head].filter((x): x is string => !!x))];
    const r = openSession(n.sessions, { topic, goal: '双方就档期达成一致', initiator: 'data-center-head', members, trigger: 'okr_conflict', context_refs: [c.krA, c.krB] });
    sid = r.session.id;
    n = { ...n, sessions: r.list };
    return flow(n, { kind: 'session', level: 'public', title: '自动建临时会话', body: topic });
  });
  return { conflicts: count, sessionId: sid };
}

/* ---------------- 临时会话 ---------------- */
const SESSION_LINES = (topic: string): [string, string][] => [
  ['data-center-head', `数据：两个事业部都申请了同一黄金档，KR 冲突（${topic.slice(0, 30)}），建议错峰发布。`],
  ['', '我建议视频保留黄金档，因为历史完播率最高（来源：我的 CSV 导出）。'],
  ['', '同意错峰：我们改到次黄金档，收藏型内容受时段影响小；待办：调整本部门排期到次黄金档'],
  ['data-center-head', '结论：视频保留黄金档、另一方次黄金档，下个 OKR 周期复盘再看。'],
];
export async function runSessionTurns(id: string, n = 4): Promise<TempSession | null> {
  const { speak, mock } = await groupSpeaker();
  let out: TempSession | null = null;
  const s0 = await getGroup();
  guard(s0);
  const sess = s0.sessions.find((x) => x.id === id);
  if (!sess || sess.status !== 'open') return sess ?? null;
  const others = sess.members.filter((m) => m !== sess.initiator);
  const lines = SESSION_LINES(sess.topic).map(([who, text], i) => [who || others[(i - 1) % Math.max(1, others.length)] || sess.initiator, text] as [string, string]);
  let cur = sess; let cost = 0;
  for (let i = 0; i < Math.min(n, lines.length) && cur.status === 'open'; i++) {
    const [from, fallback] = lines[i]!;
    let text = fallback; let c = 0;
    if (!mock) { try { const o = await speak({ party: { id: from, name: names(s0)[from] ?? from }, phase: i === lines.length - 1 ? 'synthesis' : i === 0 ? 'independent' : 'answer', round: 1, topic: cur.topic, doc: cur.goal, visible: cur.messages.map((m, k) => ({ id: `m${k}`, round: 1, phase: 'answer', from: m.from, text: m.text, cost: 0, flags: [], score: 100, visible: [] })), tier: 'cheap', criticism: true, chairmanNotes: cur.messages.filter((m) => m.kind === 'chairman').map((m) => m.text) }); text = o.text; c = o.cost; } catch { text = fallback; } }
    const r = postMessage(cur, { from, text, cost: c });
    if (r.ok) { cur = r.session; cost += c; }
  }
  await updateGroup((s) => { out = cur; return spend({ ...s, sessions: s.sessions.map((x) => (x.id === id ? cur : x)) }, s.org.depts.find((d) => d.head === cur.initiator)?.id ?? 'staff', 'session', cost, id); });
  return out;
}
export async function sessionSay(id: string, text: string): Promise<void> {
  await updateGroup((s) => { guard(s); const x = s.sessions.find((y) => y.id === id); if (!x) throw new Error('没有这个会话'); const r = postMessage(x, { from: 'chairman', text }); if (!r.ok) throw new Error(r.text); return { ...s, sessions: s.sessions.map((y) => (y.id === id ? r.session : y)) }; });
}
export async function dissolveSession(id: string, by = 'chairman'): Promise<TempSession> {
  let closed!: TempSession;
  await updateGroup((s) => {
    const x = s.sessions.find((y) => y.id === id); if (!x) throw new Error('没有这个会话');
    closed = checkOff(x, by);
    let n: GroupState = { ...s, sessions: promoteQueued(s.sessions.map((y) => (y.id === id ? closed : y))) };
    n = flow(n, { kind: 'session', level: 'public', title: `会话小结：${closed.topic}`, body: (closed.outcome?.conclusions ?? []).join('；') || '无结论', refs: [id] });
    return n;
  });
  const tickets = todosToTickets(closed);
  if (tickets.length) await addTickets(tickets.map((t) => ({ title: t.title, agentId: t.agentId })));
  return closed;
}
export async function sessionToMeeting(id: string): Promise<string> {
  let mid = '';
  await updateGroup((s) => { const x = s.sessions.find((y) => y.id === id); if (!x) throw new Error('没有这个会话'); const { session, meeting } = escalateToMeeting(x); const m = newMeeting({ ...meeting, preDoc: preDocument({ title: meeting.title, background: x.goal, question: x.topic, options: [], data: [] }) }); mid = m.id; return { ...s, sessions: s.sessions.map((y) => (y.id === id ? session : y)), meetings: [...s.meetings, m] }; });
  return mid;
}
export async function pullGroup(topic: string, explicit: string[] = []): Promise<string> {
  let sid = '';
  await updateGroup((s) => { guard(s); const members = explicit.length ? ['staff-head', ...explicit] : recommendMembers(topic, s.org, 'staff-head'); const r = openSession(s.sessions, { topic, initiator: 'staff-head', members, trigger: 'chairman_request' }); sid = r.session.id; return { ...s, sessions: r.list }; });
  return sid;
}
export async function tickSessions(now = Date.now()): Promise<void> { const s = await getGroup(); if (!s.sessions.some((x) => x.status === 'open' && x.openedAt != null && now - x.openedAt >= x.ttl)) return; await updateGroup((g) => ({ ...g, sessions: promoteQueued(g.sessions.map((x) => tickSession(x, now))) })); }

async function addTickets(list: { title: string; agentId: string }[]): Promise<void> {
  const at = new Date().toISOString();
  await updateSuper((st) => ({ ...st, tasks: [...st.tasks, ...list.map((t, i): BoardTask => ({ id: `grp-${Date.now().toString(36)}-${i}`, title: t.title.slice(0, 80), agentId: t.agentId, state: 'todo', depth: 1, returned: 0, cost: 0, createdAt: at, updatedAt: at, history: [{ state: 'todo', at, note: '集团小结 / 纪要待办' }] }))] }));
}

/* ---------------- 会议 ---------------- */
export async function createMeeting(o: { roomId: string; title: string; agenda?: string; participants?: string[]; scheduledAt?: string | null; recurring?: string | null }): Promise<string> {
  let id = '';
  await updateGroup((s) => {
    guard(s);
    const parts = o.participants?.length ? o.participants : recommendMembers(`${o.title} ${o.agenda ?? ''}`, s.org, 'staff-head').slice(0, 3);
    const ctx = retrieveContext(s.flow, o.title, { tokenBudget: 300 });
    const doc = preDocument({ title: o.title, background: o.agenda || o.title, question: o.title, options: [], data: ctx.items.map((x) => `${x.title}：${x.body.slice(0, 60)}`) });
    const m = newMeeting({ roomId: o.roomId, title: o.title, agenda: o.agenda ?? o.title, participants: parts, scheduledAt: o.scheduledAt ?? null, recurring: o.recurring ?? null, preDoc: doc });
    id = m.id;
    return { ...s, meetings: [...s.meetings, m], contextUse: [...s.contextUse, { usedContextRefs: ctx.items.length }] };
  });
  return id;
}
export async function meetingIntervene(id: string, kind: 'speak' | 'agenda' | 'stop' | 'rule', text: string): Promise<void> {
  await updateGroup((s) => ({ ...s, meetings: s.meetings.map((m) => (m.id === id ? intervene(m, kind, text) : m)) }));
}
export async function runMeetingNow(id: string): Promise<Meeting> {
  const s0 = await getGroup(); guard(s0);
  const m = s0.meetings.find((x) => x.id === id); if (!m) throw new Error('没有这场会议');
  const { speak } = await groupSpeaker();
  const seq = s0.docs.filter((d) => d.no.includes(`〔${new Date().getFullYear()}〕`)).length + 1;
  await updateGroup((s) => ({ ...s, meetings: s.meetings.map((x) => (x.id === id ? { ...x, status: 'running' } : x)) }));
  const done = await runMeeting({ ...m, status: m.status === 'stopped' ? 'stopped' : 'scheduled' }, speak, { names: names(s0), seq });
  let todos: { title: string; agentId: string }[] = [];
  await updateGroup((s) => {
    let n: GroupState = { ...s, meetings: s.meetings.map((x) => (x.id === id ? done : x)), meetingRuns: { ...s.meetingRuns, [id]: new Date().toISOString() } };
    if (done.minutes) {
      const chk = checkResolution(done.minutes.resolution, done.roomId);
      const r = newDoc(n.docs, { type: '纪要', title: done.minutes.title, body: `${done.minutes.no}\n参会：${done.minutes.participants.map((p) => names(s)[p] ?? p).join('、')}\n要点：\n${done.minutes.points.map((x) => `- ${x}`).join('\n')}\n决议：${chk.ok ? done.minutes.resolution : `（引擎拒绝：${chk.hit}）`}\n待办：\n${done.minutes.todos.map((t) => `- ${t.title}（${names(s)[t.owner] ?? t.owner}，${t.due}）`).join('\n')}`, from: done.host, to: 'all', refs: [id] });
      n = { ...n, docs: r.list };
      n = flow(n, { kind: 'meeting', level: 'public', title: `${done.minutes.title}`, body: chk.ok ? done.minutes.resolution : `决议触碰硬边界被拒：${chk.hit}`, refs: [r.doc.no] });
      todos = done.minutes.todos.map((t) => ({ title: t.title, agentId: t.owner }));
    }
    return spend(n, done.deptId, 'meeting', done.spent, id);
  });
  if (todos.length) await addTickets(todos);
  return done;
}

/* ---------------- 公文 ---------------- */
export async function addDoc(type: DocType, title: string, body: string, from = 'ceo'): Promise<string> { let id = ''; await updateGroup((s) => { const r = newDoc(s.docs, { type, title, body, from }); id = r.doc.id; return { ...s, docs: r.list }; }); return id; }
export async function decide(docId: string, approve: boolean, note?: string): Promise<void> {
  let after: (() => Promise<void>) | null = null;
  await updateGroup((s) => {
    let n: GroupState = { ...s, docs: decideDoc(s.docs, docId, 'chairman', approve, note) };
    const d = n.docs.find((x) => x.id === docId)!;
    if (approve && d.type === '提案' && /^新设部门「(.+)」/.test(d.title)) { const nm = /^新设部门「(.+)」/.exec(d.title)![1]!; const dept: Dept = { id: `live-${n.org.depts.length}`, name: nm, kind: 'bu', head: `live-${n.org.depts.length}-head`, members: [], duties: ['直播脚本草稿', '直播选品清单'], budgetYuan: 1, permCap: 'L2', peers: ['bu-ecom'], platforms: ['douyin'], status: 'active', posts: ['策划', '内容', '视觉'] }; n = { ...n, org: applyOrgChange(n.org, { op: 'add', dept }) }; n = flow(n, { kind: 'org', level: 'public', title: '组织调整', body: `新设「${nm}」（人力资源委员会提案，董事长批准）` }); const p = deptPath(dept.id); after = async () => { const v = await getVfs(); await v.write(p, serializeDeptMd(dept), { author: 'user_approved' }); }; }
    if (approve && d.type === '提案' && d.refs[0]?.startsWith('reg:')) { const regId = d.refs[0].slice(4); const pr = proposeRegChange(n.regs, regId, d.body); n = { ...n, regs: applyRegChange(n.regs, pr, true) }; n = flow(n, { kind: 'regulation', level: 'public', title: '制度变更', body: `《${pr.title}》更新到 v${currentReg(n.regs, regId)!.version}` }); }
    if (approve && d.type === '请示' && d.refs[0]?.startsWith('draft:')) { const id = Number(d.refs[0].slice(6)); after = async () => { await post(`/api/drafts/${id}/status`, { status: 'approved' }).catch(() => undefined); }; }
    return n;
  });
  if (after) await (after as () => Promise<void>)();
  await audit({ kind: 'approval', actor: 'user', summary: `${approve ? '批准' : '驳回'}公文 ${docId}`, outcome: 'ok' });
}

/* ---------------- 赛马 ---------------- */
export async function startRace(topic: string, horses = 3, budgetYuan = 0.3): Promise<string> {
  const s0 = await getGroup(); guard(s0);
  const month = new Date().toISOString().slice(0, 7);
  const monthSpent = s0.ledger.filter((e) => e.kind === 'race' && e.at.startsWith(month)).reduce((a, e) => a + e.yuan, 0);
  const ok = canStartRace({ highValue: true, uncertain: true, horses, monthSpent, requestYuan: budgetYuan });
  if (!ok.ok) throw new Error(ok.reason);
  const bus = s0.org.depts.filter((d) => d.kind === 'bu' && d.status === 'active');
  const r0 = newRace({ topic, deptId: 'bu-video', budgetYuan, horses: Array.from({ length: horses }, (_, i) => ({ id: `h${i + 1}`, agentId: (bus[i] ?? bus[0]!).head, skill: ['悬念开场', '清单盘点', '反差对比'][i] })) });
  const { speak } = await groupSpeaker();
  const r = await runRace(r0, async (h, t) => speak({ party: { id: h.agentId, name: `${names(s0)[h.agentId] ?? h.agentId}`, view: `用“${h.skill}”的角度` }, phase: 'independent', round: 1, topic: `${t}（角度：${h.skill}）`, doc: '给出一个可执行的切入方案：开头一句话、结构、风险。', visible: [], tier: 'cheap', criticism: false, chairmanNotes: [] }));
  // 赛马评审室盲评：参谋部与数据中心按代号打分（模拟评分按方案完整度；真实模型同样只看代号）
  let scored = r;
  for (const reviewer of ['staff-head', 'data-center-head']) scored = scoreBlind(scored, reviewer, Object.fromEntries(r.entries.filter((e) => e.status === 'done').map((e) => [e.alias, Math.min(10, 5 + Math.round(e.proposal.length / 40) + (reviewer === 'staff-head' ? (e.alias === 'A' ? 1 : 0) : 0))])));
  await updateGroup((s) => spend(flow({ ...s, races: [...s.races, scored] }, { kind: 'race', level: 'public', title: '发起赛马', body: `${topic}：${horses} 匹，专项预算 ¥${budgetYuan}` }), 'bu-video', 'race', scored.spent, scored.id));
  return scored.id;
}
export async function pickWinner(raceId: string, alias: string): Promise<void> {
  let race!: Race;
  await updateGroup((s) => { const r = s.races.find((x) => x.id === raceId); if (!r) throw new Error('没有这次赛马'); race = decideRace(r, alias, 'chairman'); return flow({ ...s, races: s.races.map((x) => (x.id === raceId ? race : x)) }, { kind: 'race', level: 'public', title: '赛马结果', body: `${race.topic}：董事长选定方案 ${alias}，落选 ${race.archived.length} 个方案已入素材库` }); });
  const v = await getVfs();
  for (const [i, a] of archivedAssets(race).entries()) await v.write(`company/assets/${race.id}-${i + 1}.md`, `# ${a.title}\n\n标签：${a.tags.join('、')}\n\n${a.body}\n`, { author: 'system' });
}

/* ---------------- 协作出稿：否决 / 申诉 / 退回 / 请示 ---------------- */
export async function collabDrafts(): Promise<{ vetoed: string; passed: string; askDoc: string; draftIds: number[] }> {
  const s0 = await getGroup(); guard(s0);
  const mk = async (idea: string, platform: string) => { try { const r = await post<{ draft: { id: number } }>('/api/compose', { idea, platform }); return r.draft.id; } catch { return 0; } };
  const d1 = await mk('电商事业部：新品种草口播，结尾引导评论区自动私信领券', 'douyin');
  const d2 = await mk('图文事业部：秋季护肤清单，第一版标题写“全网最好用”', 'xiaohongshu');
  let askId = '';
  await updateGroup((s) => {
    const v1 = veto({ by: 'legal', target: `draft:${d1}`, clause: 'charter#5', reason: '稿件要求“自动私信领券”，属自动互动', hardBoundary: true });
    let appealed = '申诉被拒：涉及硬边界的否决不可申诉';
    try { appeal(v1, 'bu-ecom-head', '只是引导用户私信'); appealed = '申诉已受理'; } catch (e) { appealed = (e as Error).message; }
    const q = veto({ by: 'quality', target: `draft:${d2}`, clause: 'quality#2', reason: '标题“全网最好用”属广告法极限用语，退回一轮' });
    let n: GroupState = { ...s, vetoes: [...s.vetoes, v1, q] };
    n = flow(n, { kind: 'resolution', level: 'public', title: '法务合规部否决', body: `${v1.reason}；${appealed}` });
    n = flow(n, { kind: 'resolution', level: 'public', title: '质量委员会退回一轮后通过', body: '标题改为“我反复回购的 5 件秋季护肤品”，复审通过' });
    const r = newDoc(n.docs, { type: '请示', title: `请示：图文稿件 #${d2} 发布`, body: '质量委员会退回一轮后通过；法务合规部无异议。请董事长批准后由你本人复制去发布。', from: 'ceo', refs: [`draft:${d2}`] });
    askId = r.doc.id;
    return { ...n, docs: r.list };
  });
  return { vetoed: `draft:${d1}`, passed: `draft:${d2}`, askDoc: askId, draftIds: [d1, d2] };
}
/** 人力资源委员会提议新设部门（提案进公文，董事长批准后生效）。 */
export async function proposeDept(name: string): Promise<string> { const a = appointment('new_dept', name); return addDoc('提案', `新设部门「${name}」`, `${a.text}。职责：直播脚本草稿、直播选品清单；只出草稿，直播由你本人进行。`, 'org-head'); }

/* ---------------- 灰度 ---------------- */
export async function startGray(path: string, scope: 'percent' | 'dept' = 'percent'): Promise<string> {
  const v = await getVfs();
  const f = await v.read(path);
  if (!f) throw new Error(`没有文件 ${path}`);
  const next = await v.write(path, `${f.content.trimEnd()}\n\n<!-- 灰度试行：新写法 v${f.version + 1} -->\n- 开头先抛问题再给答案\n`, { author: 'user_approved', note: '灰度试行' });
  const g = newGray({ target: { kind: 'skill', id: path, version: next.version, prevVersion: f.version }, metric: '一次通过率', scope: scope === 'dept' ? { deptId: 'bu-video' } : { percent: 20 } });
  await updateGroup((s) => flow({ ...s, grays: [...s.grays, g] }, { kind: 'gray', level: 'public', title: '灰度试行', body: `${path} v${next.version}：${scope === 'dept' ? '短视频事业部' : '20% 任务'}试行一周期` }));
  return g.id;
}
export async function grayObserve(id: string, value: number, isGray: boolean): Promise<void> { await updateGroup((s) => ({ ...s, grays: s.grays.map((g) => (g.id === id ? observe(g, value, isGray) : g)) })); }
export async function grayEvaluate(id: string, now = new Date()): Promise<GrayRelease> {
  const s0 = await getGroup();
  const g = s0.grays.find((x) => x.id === id); if (!g) throw new Error('没有这个灰度');
  const v = await getVfs();
  const res = await evaluateGray(g, now, async (t) => { await v.rollback(t.id, t.prevVersion, 'system'); });
  await updateGroup((s) => { let n = { ...s, grays: s.grays.map((x) => (x.id === id ? res : x)) }; if (res.status !== g.status) n = flow(n, { kind: 'gray', level: 'public', title: res.status === 'rolled_back' ? '灰度自动回滚' : '灰度全量', body: res.reason ?? '' }); return n; });
  if (res.status === 'rolled_back') await audit({ kind: 'system_file_change', actor: 'system', summary: res.reason ?? '灰度回滚', target: g.target.id, outcome: 'ok' });
  return res;
}

/* ---------------- 复盘 / 360 / 政委 ---------------- */
export async function quarterlyReview(): Promise<void> {
  const st = await getGroup(); guard(st);
  const r = retro({ subject: `${st.okrs[0]?.period ?? '本季度'} OKR 周期`, trigger: 'okr_cycle', goal: st.yearGoal?.title ?? '待设定', result: st.okrs.filter((o) => o.level === 'dept').map((o) => `${o.owner} ${okrProgress(o).text}`).slice(0, 4).join('；') || '待录入', causes: '发布时间不固定、样本少（按录入数据）', lessons: ['口播前三秒先给结论', '同一平台黄金档提前一周对齐，避免两个事业部撞档'] });
  const peer = [{ from: 'bu-video', to: 'data-center', score: 4, note: '冲突发现及时' }, { from: 'bu-article', to: 'data-center', score: 4, note: '' }, { from: 'data-center', to: 'bu-video', score: 3, note: '数据录入不全' }, { from: 'legal', to: 'bu-ecom', score: 2, note: '触碰硬边界一次' }];
  const collab: [string, string][] = [['bu-video', 'data-center'], ['bu-article', 'data-center'], ['legal', 'bu-ecom']];
  const rev = review360(peer, collab);
  const advice = [...commissarObserve({ deptId: 'bu-ecom', returnRate: 0.5, contextHitRate: contextHitRate(st.contextUse), failures: 0, boundaryHits: st.vetoes.filter((v) => v.hardBoundary).length || 1, idleDays: 0, missingSkills: ['直播合规话术'], fabricatedData: 0 }), ...commissarObserve({ deptId: 'bu-video', returnRate: 0.1, contextHitRate: 0.2, failures: 0, boundaryHits: 0, idleDays: 0, missingSkills: [], fabricatedData: 1 })];
  await updateGroup((s) => {
    let n: GroupState = { ...s, retros: [...s.retros, r], peer: [...s.peer, ...peer], advice };
    n = flow(n, { kind: 'review', level: 'public', title: '360 评议（组织部汇总，CEO 综合）', body: Object.entries(rev.byDept).map(([d, x]) => `${s.org.depts.find((y) => y.id === d)?.name ?? d} ${x.avg}/5（${x.n} 份）`).join('；') });
    n = flow(n, { kind: 'lesson', level: 'public', title: '复盘室 lesson（低风险自动采纳）', body: r.lessons.filter((l) => l.status === 'adopted').map((l) => l.text).join('；'), refs: [r.id] });
    return n;
  });
}

/* ---------------- 制度修改 ---------------- */
export async function proposeRegulation(regId: string, addition: string): Promise<string> {
  const s = await getGroup();
  const cur = currentReg(s.regs, regId); if (!cur) throw new Error('没有这项制度');
  const p = proposeRegChange(s.regs, regId, `${cur.text.trimEnd()}\n\n${addition.trim()}\n`);
  if (p.errors.length) throw new Error(p.errors.join('；'));
  const id = await addDoc('提案', `修改《${p.title}》`, p.text, 'staff-head');
  await updateGroup((g) => ({ ...g, docs: g.docs.map((d) => (d.id === id ? { ...d, refs: [`reg:${regId}`] } : d)) }));
  return id;
}
export async function rollbackRegulation(regId: string): Promise<void> {
  const v = await getVfs();
  await updateGroup((s) => { const n = { ...s, regs: rollbackReg(s.regs, regId) }; return flow(n, { kind: 'regulation', level: 'public', title: '制度回滚', body: `《${regId}》回滚到 v${currentReg(n.regs, regId)!.version}` }); });
  const s = await getGroup(); const cur = currentReg(s.regs, regId);
  const path = Object.keys(REGULATION_FILES).find((p) => p.endsWith(`-${regId}.md`));
  if (cur && path) await v.write(path, cur.text, { author: 'user_approved', note: '制度回滚', allowLarge: true });
}

/* ---------------- 暂停 / 指挥 / 总览 ---------------- */
export async function pauseGroup(): Promise<{ ms: number }> { const t0 = performance.now(); const r = await pauseSuper(); await updateGroup((s) => ({ ...s, paused: true })); return { ms: Math.max(r.ms, Math.round(performance.now() - t0)) }; }
export async function resumeGroup(): Promise<void> { await resumeSuper(); await updateGroup((s) => ({ ...s, paused: false })); }
export function doaFor(role: 'executor' | 'dept_head' | 'ceo' | 'chairman', matter: Parameters<typeof doaCheck>[1]['matter'], amountYuan?: number) { return doaCheck(parseDoa(), { matter, actor: { role, id: role }, amountYuan, summary: matter }); }

export interface GroupOverview { enabled: boolean; liveSessions: number; liveMeetings: number; pendingDocs: number; share: ReturnType<typeof meetingShare>; byDept: Record<string, number>; hitRate: number | null; raceEffect: ReturnType<typeof raceEffect> }
export async function groupOverview(): Promise<GroupOverview> {
  const s = await getGroup();
  return { enabled: s.enabled, liveSessions: s.sessions.filter((x) => x.status === 'open').length, liveMeetings: s.meetings.filter((x) => x.status === 'running' || x.status === 'scheduled').length, pendingDocs: s.docs.filter((d) => d.status === 'pending').length, share: meetingShare(s.ledger), byDept: spendByDept(s.ledger), hitRate: contextHitRate(s.contextUse), raceEffect: raceEffect(s.races, [], null) };
}
export function leaderboardOf(r: Race) { return leaderboard(r); }
export { ROOMS };

/** 对话里的集团指令（@部门 / @委员会 / 拉群 / 开会 / 赛马）；集团模式未启用时不接管。 */
export async function handleGroupCommand(conversationId: number, text: string): Promise<boolean> {
  const s = await getGroup();
  if (!s.enabled) return false;
  const cmd = parseGroupCommand(text, s.org);
  if (!cmd) return false;
  if (cmd.kind === 'pull') { const p = parseChairmanPull(text, s.org); await addMessage({ conversationId, role: 'user', content: text } as never); const id = await pullGroup(cmd.topic, p?.members ?? []); await addMessage({ conversationId, role: 'assistant', content: `已拉群「${cmd.topic}」（${id}）。成员按议题推荐，会话不赋予任何新权限；结果在“统领 → 会话”。` } as never); return true; }
  if (cmd.kind === 'meeting') { await addMessage({ conversationId, role: 'user', content: text } as never); await createMeeting({ roomId: cmd.roomId, title: cmd.topic }); await addMessage({ conversationId, role: 'assistant', content: `已在「${ROOMS.find((r) => r.id === cmd.roomId)?.name}」预约会议：${cmd.topic}。会前文档已生成，去“统领 → 会议室”开会。` } as never); return true; }
  if (cmd.kind === 'race') { await addMessage({ conversationId, role: 'user', content: text } as never); try { const id = await startRace(cmd.topic, 3); await addMessage({ conversationId, role: 'assistant', content: `已发起赛马「${cmd.topic}」（${id}，3 匹，专项预算）。盲评结果在“统领 → 会议室 → 赛马评审室”，由你选定胜者。` } as never); } catch (e) { await addMessage({ conversationId, role: 'assistant', content: `没有发起赛马：${(e as Error).message}` } as never); } return true; }
  const name = cmd.name;
  await addMessage({ conversationId, role: 'user', content: text } as never);
  const ticket = cmd.rest || '待补充';
  await addTickets([{ title: `${name}：${ticket}`, agentId: cmd.kind === 'mention_dept' ? (s.org.depts.find((d) => d.id === cmd.id)?.head ?? cmd.id) : cmd.id }]);
  await addMessage({ conversationId, role: 'assistant', content: `交给了「${name}」 · 已生成工单（指挥 → 任务板）。能派单不拉群：需要多部门时我会拉群。` } as never);
  return true;
}
export { emptyGroupState, ROOMS as GROUP_ROOMS };
