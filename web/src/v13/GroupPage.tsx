/**
 * 1.3.0 “统领”页（#group）：组织图、会话、会议室、文档与公文、目标、制度库、驾驶舱。
 * 延续 Hark 式卡片与动词按钮，不做成 OA 后台；“我的”不增加入口，集团功能全部在这里。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { REGULATIONS, MECHANISMS, MECHANISM_TEXT, DEPT_KIND_TEXT, PHASE_TEXT, TRIGGER_TEXT, parseDoa, MATTER_TEXT, currentReg, blindCards, okrProgress, GROUP_HONESTY, type GroupState, type DeptKind, type Meeting, type TempSession, type Race } from '@content-agent/shared';
import { useT } from '../i18n';
import { Section, Note, SegTabs } from '../pages/me/v9/common';
import { useToast } from '../ui';
import {
  getGroup, onGroupChange, enableGroup, disableGroup, setYearGoal, checkConflicts, runSessionTurns, sessionSay, dissolveSession, sessionToMeeting, pullGroup, createMeeting, meetingIntervene, runMeetingNow,
  decide, startRace, pickWinner, collabDrafts, proposeDept, startGray, grayObserve, grayEvaluate, quarterlyReview, proposeRegulation, rollbackRegulation, pauseGroup, resumeGroup, toggleMechanism, groupOverview, leaderboardOf, GROUP_ROOMS, type GroupOverview,
} from './store';

export type GroupTab = 'org' | 'sessions' | 'rooms' | 'docs' | 'okr' | 'regs' | 'cockpit';
export const GROUP_TABS: [GroupTab, string][] = [['org', 'ui.v13_tab_org'], ['sessions', 'ui.v13_tab_sessions'], ['rooms', 'ui.v13_tab_rooms'], ['docs', 'ui.v13_tab_docs'], ['okr', 'ui.v13_tab_okr'], ['regs', 'ui.v13_tab_regs'], ['cockpit', 'ui.v13_tab_cockpit']];
type Run = (fn: () => Promise<unknown>, ok?: string) => void;
const Row = ({ children, testId }: { children: ReactNode; testId?: string }) => <div className="flex flex-wrap items-center gap-2" data-testid={testId}>{children}</div>;
const yuan = (n: number) => `¥${n.toFixed(n < 1 ? 3 : 2)}`;

function useGroup(): [GroupState | null, GroupOverview | null, () => void] {
  const [s, setS] = useState<GroupState | null>(null);
  const [o, setO] = useState<GroupOverview | null>(null);
  const load = useCallback(() => { void Promise.all([getGroup(), groupOverview()]).then(([a, b]) => { setS(a); setO(b); }).catch(() => undefined); }, []);
  useEffect(() => { load(); return onGroupChange(load); }, [load]);
  return [s, o, load];
}

export function GroupPage({ tab: initial, go }: { tab?: string; go: (to: string) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<GroupTab>(GROUP_TABS.find(([k]) => k === initial)?.[0] ?? 'org');
  useEffect(() => { const k = GROUP_TABS.find(([x]) => x === initial)?.[0]; if (k) setTab(k); }, [initial]);
  const [s, o, reload] = useGroup();
  const [toast, show] = useToast();
  const run: Run = (fn, ok) => { void fn().then(() => { if (ok) show(t(ok)); reload(); }).catch((e) => show(String((e as Error).message ?? e))); };
  if (!s) return <div className="page"><Note>{t('ui.loading')}</Note></div>;
  if (!s.enabled) return <div className="page flex flex-col gap-3" data-testid="group-page">{toast}<Enable run={run} name={s.name} /></div>;
  const pendingDocs = s.docs.filter((d) => d.status === 'pending').length;
  return (
    <div className="page flex flex-col gap-3" data-testid="group-page">
      {toast}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 min-w-0 grow truncate text-[17px]" data-testid="group-name" title={s.name}>{s.name}</h2>
        {s.paused ? <button type="button" className="primary" data-testid="group-resume" onClick={() => run(resumeGroup, 'ui.v12_resumed')}>{t('ui.v12_resume')}</button>
          : <button type="button" className="!border-warn !text-warn" data-testid="group-pause" onClick={() => run(async () => { const r = await pauseGroup(); show(`${t('ui.v12_paused_toast')} · ${r.ms} ms`); })}>{t('ui.v12_pause_all')}</button>}
      </div>
      <p className="m-0 text-[13px] text-muted" data-testid="group-honesty">{t(GROUP_HONESTY)}</p>
      <div className="v12-tabs"><SegTabs value={tab} options={GROUP_TABS.map(([k, l]) => [k, k === 'docs' && pendingDocs ? `${t(l)} ${pendingDocs}` : l])} onChange={(v) => { setTab(v); go(`group?tab=${v}`); }} label={t('ui.v13_group')} /></div>
      {tab === 'org' ? <Org s={s} run={run} />
        : tab === 'sessions' ? <Sessions s={s} run={run} />
        : tab === 'rooms' ? <Rooms s={s} run={run} />
        : tab === 'docs' ? <Docs s={s} run={run} go={go} />
        : tab === 'okr' ? <Okr s={s} run={run} />
        : tab === 'regs' ? <Regs s={s} run={run} />
        : <Cockpit s={s} o={o} run={run} />}
    </div>
  );
}

function Enable({ run, name }: { run: Run; name: string }) {
  const { t } = useT();
  const [n, setN] = useState(name === '我的集团' ? t('ui.v13_default_name') : name);
  return (
    <Section title={t('ui.v13_enable_title')} testId="group-enable-card">
      <Note>{t('ui.v13_enable_desc')}</Note>
      <Note>{t(GROUP_HONESTY)}</Note>
      <label className="field"><span>{t('ui.v13_group_name')}</span><input value={n} maxLength={20} onChange={(e) => setN(e.target.value)} data-testid="group-name-input" /></label>
      <Row><button type="button" className="primary" data-testid="group-enable" onClick={() => run(() => enableGroup(n), 'ui.v13_enabled')}>{t('ui.v13_enable')}</button></Row>
    </Section>
  );
}

/* ---------------- 组织图 ---------------- */
function Org({ s, run }: { s: GroupState; run: Run }) {
  const { t } = useT();
  const [zoom, setZoom] = useState(1);
  const [nm, setNm] = useState('');
  const spent = useMemo(() => { const m: Record<string, number> = {}; const month = new Date().toISOString().slice(0, 7); for (const e of s.ledger) if (e.at.startsWith(month)) m[e.deptId] = (m[e.deptId] ?? 0) + e.yuan; return m; }, [s.ledger]);
  const busy = (head: string) => (s.meetings.some((m) => m.status === 'running' && m.participants.includes(head)) ? 'ui.v13_st_meeting' : s.sessions.some((x) => x.status === 'open' && x.members.includes(head)) ? 'ui.v13_st_session' : 'ui.v13_st_idle');
  const kinds: DeptKind[] = ['hq', 'bu', 'shared', 'pending'];
  return (
    <>
      <Section title={t('ui.v13_org_chart')} testId="group-org" actions={<Row><button type="button" className="ghost" aria-label={t('ui.v13_zoom_out')} data-testid="group-zoom-out" onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(1)))}>−</button><span className="text-[13px] text-muted">{Math.round(zoom * 100)}%</span><button type="button" className="ghost" aria-label={t('ui.v13_zoom_in')} data-testid="group-zoom-in" onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.1).toFixed(1)))}>+</button></Row>}>
        <Note>{t('ui.v13_chain')}</Note>
        <div style={{ fontSize: `${zoom}em` }} className="flex flex-col gap-3">
          {kinds.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <strong className="text-[13px]">{t(DEPT_KIND_TEXT[k])}</strong>
              <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4" data-testid={`org-${k}`}>
                {s.org.depts.filter((d) => d.kind === k).map((d) => (
                  <li key={d.id} className="card v9-card flex flex-col gap-1" data-testid={`dept-${d.id}`}>
                    <div className="flex items-center gap-2"><strong className="min-w-0 grow truncate" title={t(d.name)}>{t(d.name)}</strong><span className="pill text-[12px]">{d.status === 'paused' ? t('ui.v13_st_paused') : t(busy(d.head))}</span></div>
                    <span className="text-[12px] text-muted">{t('ui.v13_members')} {d.members.length} · {t('ui.v13_month_spend')} {yuan(spent[d.id] ?? 0)}{d.veto ? ` · ${t('ui.v13_veto_compliance')}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <strong className="text-[13px]">{t('ui.v13_committees')}</strong>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3" data-testid="org-committees">
              {s.org.committees.map((c) => <li key={c.id} className="card v9-card flex flex-col gap-1" data-testid={`committee-${c.id}`}><strong className="truncate" title={t(c.name)}>{t(c.name)}</strong><span className="text-[12px] text-muted">{c.parent ? t('ui.v13_under_tech') : c.scope.map((x) => t(x)).join(' · ')}{c.veto ? ` · ${t('ui.v13_veto_quality')}` : ''}</span></li>)}
            </ul>
          </div>
        </div>
      </Section>
      <Section title={t('ui.v13_org_adjust')} testId="group-org-adjust">
        <Note>{t('ui.v13_org_adjust_desc')}</Note>
        <Row><input className="min-w-0 grow" value={nm} onChange={(e) => setNm(e.target.value)} placeholder={t('ui.v13_new_dept_ph')} aria-label={t('ui.v13_new_dept_ph')} data-testid="group-dept-name" /><button type="button" disabled={!nm.trim()} data-testid="group-propose-dept" onClick={() => run(() => proposeDept(nm.trim()).then(() => setNm('')), 'ui.v13_proposed')}>{t('ui.v13_propose_dept')}</button></Row>
        <Row><button type="button" className="ghost" data-testid="group-disable" onClick={() => run(disableGroup, 'ui.v13_disabled')}>{t('ui.v13_back_to_12')}</button></Row>
      </Section>
    </>
  );
}

/* ---------------- 会话 ---------------- */
function Sessions({ s, run }: { s: GroupState; run: Run }) {
  const { t } = useT();
  const [sel, setSel] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [say, setSay] = useState('');
  const list = [...s.sessions].reverse();
  const cur: TempSession | undefined = s.sessions.find((x) => x.id === sel) ?? list[0];
  const nm = (id: string) => t(s.org.depts.find((d) => d.head === id)?.name ?? (id === 'chairman' ? '董事长' : id === 'system' ? '系统' : id));
  return (
    <>
      <Section title={t('ui.v13_sessions')} testId="group-sessions">
        <Note>{t('ui.v13_sessions_desc')}</Note>
        <Row>
          <button type="button" data-testid="group-check-conflicts" onClick={() => run(async () => { const r = await checkConflicts(); if (r.sessionId) setSel(r.sessionId); }, 'ui.v13_checked')}>{t('ui.v13_check_conflicts')}</button>
          <input className="min-w-0 grow" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('ui.v13_pull_ph')} aria-label={t('ui.v13_pull_ph')} data-testid="group-pull-input" />
          <button type="button" disabled={!topic.trim()} data-testid="group-pull" onClick={() => run(async () => { setSel(await pullGroup(topic.trim())); setTopic(''); })}>{t('ui.v13_pull')}</button>
        </Row>
        {!list.length && <Note>{t('ui.v13_no_sessions')}</Note>}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {list.slice(0, 8).map((x) => <li key={x.id}><button type="button" className={`ghost w-full !justify-start text-left ${cur?.id === x.id ? '!border-accent' : ''}`} data-testid={`session-${x.id}`} onClick={() => setSel(x.id)}><span className="min-w-0 grow truncate" title={x.topic}>{x.topic}</span><span className="pill shrink-0 text-[12px]">{t(`ui.v13_ss_${x.status}`)}</span></button></li>)}
        </ul>
      </Section>
      {cur && (
        <Section title={cur.topic} testId="group-session-view">
          <Note>{t(TRIGGER_TEXT[cur.trigger])} · {t('ui.v13_members')} {cur.members.map(nm).join('、')} · {cur.messages.filter((m) => m.kind === 'msg').length}/{cur.max_turns} · {yuan(cur.spent)}/{yuan(cur.budget)}</Note>
          <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="session-messages">
            {cur.messages.map((m, i) => <li key={i} className={`text-[13px] ${m.kind === 'system' ? 'text-muted' : ''}`}><strong>{nm(m.from)}</strong>：{m.text}</li>)}
          </ol>
          {cur.status === 'open' && (
            <>
              <Row>
                <button type="button" data-testid="group-session-run" onClick={() => run(() => runSessionTurns(cur.id, 4))}>{t('ui.v13_session_run')}</button>
                <button type="button" className="primary" data-testid="group-session-dissolve" onClick={() => run(() => dissolveSession(cur.id), 'ui.v13_dissolved')}>{t('ui.v13_check_dissolve')}</button>
                <button type="button" className="ghost" data-testid="group-session-escalate" onClick={() => run(() => sessionToMeeting(cur.id), 'ui.v13_escalated')}>{t('ui.v13_escalate')}</button>
              </Row>
              <Row><input className="min-w-0 grow" value={say} onChange={(e) => setSay(e.target.value)} placeholder={t('ui.v13_interject_ph')} aria-label={t('ui.v13_interject_ph')} data-testid="group-session-say-input" /><button type="button" disabled={!say.trim()} data-testid="group-session-say" onClick={() => run(() => sessionSay(cur.id, say.trim()).then(() => setSay('')))}>{t('ui.v13_interject')}</button></Row>
            </>
          )}
          {cur.outcome && (
            <div className="flex flex-col gap-1 border-t border-line pt-2" data-testid="session-outcome">
              <strong className="text-[13px]">{t('ui.v13_summary')}</strong>
              {cur.outcome.conclusions.map((c, i) => <Note key={i}>✓ {c}</Note>)}
              {cur.outcome.todos.map((c, i) => <Note key={`t${i}`} tone="ok">{t('ui.v13_ticket')}：{c.title}（{nm(c.owner)}）</Note>)}
              {cur.outcome.open.map((c, i) => <Note key={`o${i}`} tone="warn">{t('ui.v13_open_item')}：{c}</Note>)}
            </div>
          )}
        </Section>
      )}
    </>
  );
}

/* ---------------- 会议室（含赛马评审室） ---------------- */
function Rooms({ s, run }: { s: GroupState; run: Run }) {
  const { t } = useT();
  const [room, setRoom] = useState('strategy');
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [say, setSay] = useState('');
  const [rule, setRule] = useState('');
  const [raceTopic, setRaceTopic] = useState('');
  const list = [...s.meetings].reverse();
  const cur: Meeting | undefined = s.meetings.find((m) => m.id === sel) ?? list[0];
  const nm = (id: string) => t(s.org.depts.find((d) => d.head === id)?.name ?? (id === 'secretary' ? '秘书' : id === 'chair' ? '主持人' : id === 'ceo' ? 'CEO' : id));
  return (
    <>
      <Section title={t('ui.v13_rooms')} testId="group-rooms">
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4">
          {GROUP_ROOMS.map((r) => <li key={r.id} className={`card v9-card flex flex-col gap-1 ${room === r.id ? '!border-accent' : ''}`} data-testid={`room-${r.id}`}><button type="button" className="ghost !justify-start !p-0 !border-0 text-left" onClick={() => setRoom(r.id)}><strong className="truncate">{t(r.name)}</strong></button><span className="line-clamp-2 text-[12px] text-muted" title={r.procedure.map((x) => t(x)).join(' → ')}>{r.procedure.map((x) => t(x)).join(' → ')}</span></li>)}
        </ul>
        <Row><input className="min-w-0 grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('ui.v13_meeting_ph')} aria-label={t('ui.v13_meeting_ph')} data-testid="group-meeting-title" /><button type="button" disabled={!title.trim()} data-testid="group-meeting-create" onClick={() => run(async () => { setSel(await createMeeting({ roomId: room, title: title.trim() })); setTitle(''); }, 'ui.v13_scheduled')}>{t('ui.v13_book')}</button></Row>
      </Section>
      {cur && (
        <Section title={`${t(GROUP_ROOMS.find((r) => r.id === cur.roomId)?.name ?? '')} · ${cur.title}`} testId="group-meeting-view">
          <Row>{list.slice(0, 6).map((m) => <button key={m.id} type="button" className={`ghost text-[12px] ${m.id === cur.id ? '!border-accent' : ''}`} data-testid={`meeting-${m.id}`} onClick={() => setSel(m.id)}><span className="max-w-[10em] truncate" title={m.title}>{m.title}</span></button>)}</Row>
          <Note>{t('ui.v13_participants')}：{cur.participants.map(nm).join('、')} · {t(`ui.v13_ms_${cur.status}`)} · {yuan(cur.spent)}</Note>
          <details data-testid="meeting-predoc"><summary className="cursor-pointer text-[13px]">{t('ui.v13_predoc')}</summary><pre className="whitespace-pre-wrap break-words text-[12px]">{cur.preDoc}</pre></details>
          {cur.status === 'scheduled' && (
            <>
              <Row><input className="min-w-0 grow" value={say} onChange={(e) => setSay(e.target.value)} placeholder={t('ui.v13_interject_ph')} aria-label={t('ui.v13_interject_ph')} data-testid="group-meeting-say-input" /><button type="button" disabled={!say.trim()} data-testid="group-meeting-say" onClick={() => run(() => meetingIntervene(cur.id, 'speak', say.trim()).then(() => setSay('')), 'ui.v13_noted')}>{t('ui.v13_interject')}</button></Row>
              <Row><input className="min-w-0 grow" value={rule} onChange={(e) => setRule(e.target.value)} placeholder={t('ui.v13_rule_ph')} aria-label={t('ui.v13_rule_ph')} data-testid="group-meeting-rule-input" /><button type="button" disabled={!rule.trim()} data-testid="group-meeting-rule" onClick={() => run(() => meetingIntervene(cur.id, 'rule', rule.trim()).then(() => setRule('')), 'ui.v13_noted')}>{t('ui.v13_rule')}</button></Row>
              <Row><button type="button" className="primary" data-testid="group-meeting-run" onClick={() => run(() => runMeetingNow(cur.id), 'ui.v13_meeting_done')}>{t('ui.v13_hold')}</button><button type="button" className="ghost" data-testid="group-meeting-stop" onClick={() => run(() => meetingIntervene(cur.id, 'stop', '董事长叫停'))}>{t('ui.v13_stop')}</button></Row>
            </>
          )}
          {cur.interventions.length > 0 && <Note>{t('ui.v13_interventions')}：{cur.interventions.map((i) => `${t(`ui.v13_iv_${i.kind}`)} ${i.text}`).join('；')}</Note>}
          {cur.record && (
            <div className="flex flex-col gap-2" data-testid="meeting-rounds">
              {[...new Set(cur.record.speeches.map((x) => x.round))].map((r) => (
                <div key={r} className="flex flex-col gap-1 border-t border-line pt-2">
                  <strong className="text-[13px]">{t('ui.v13_round')} {r}</strong>
                  {cur.record!.speeches.filter((x) => x.round === r).map((x) => <p key={x.id} className="m-0 text-[13px]"><span className="pill mr-1 text-[11px]">{t(PHASE_TEXT[x.phase])}</span><strong>{nm(x.from)}</strong>{x.to ? ` → ${nm(x.to)}` : ''}：{x.text}{x.flags.includes('speculative') ? '' : ''}</p>)}
                </div>
              ))}
              <Note>{t('ui.v13_coverage')} {Math.round(cur.record.coverage * 100)}% · {t('ui.v13_blocked')} {cur.record.blocked.length}{cur.record.stopReason ? ` · ${t(`ui.v13_stop_${cur.record.stopReason}`)}` : ''}</Note>
            </div>
          )}
          {cur.minutes && (
            <div className="flex flex-col gap-1 border-t border-line pt-2" data-testid="meeting-minutes">
              <strong className="text-[13px]">{cur.minutes.no} · {t('ui.v13_minutes')}</strong>
              <Note>{t('ui.v13_whiteboard')}：{t('ui.v13_consensus')} {cur.whiteboard.consensus.join('；') || '—'} ／ {t('ui.v13_disagreement')} {cur.whiteboard.disagreements.join('；') || '—'}</Note>
              <p className="m-0 text-[13px]"><strong>{t('ui.v13_resolution')}</strong>：{cur.minutes.resolution}</p>
              {cur.minutes.todos.map((x, i) => <Note key={i} tone="ok">{t('ui.v13_ticket')}：{x.title}（{nm(x.owner)}，{x.due}）</Note>)}
            </div>
          )}
        </Section>
      )}
      <Section title={t('ui.v13_race')} testId="group-race">
        <Note>{t('ui.v13_race_desc')}</Note>
        <Row><input className="min-w-0 grow" value={raceTopic} onChange={(e) => setRaceTopic(e.target.value)} placeholder={t('ui.v13_race_ph')} aria-label={t('ui.v13_race_ph')} data-testid="group-race-topic" /><button type="button" disabled={!raceTopic.trim()} data-testid="group-race-start" onClick={() => run(() => startRace(raceTopic.trim(), 3).then(() => setRaceTopic('')), 'ui.v13_race_started')}>{t('ui.v13_race_start')}</button></Row>
        {[...s.races].reverse().slice(0, 3).map((r: Race) => (
          <div key={r.id} className="flex flex-col gap-1 border-t border-line pt-2" data-testid={`race-${r.id}`}>
            <strong className="truncate text-[13px]" title={r.topic}>{r.topic} · {yuan(r.spent)}/{yuan(r.budgetYuan)}</strong>
            {blindCards(r).map((c) => { const lb = leaderboardOf(r).find((x) => x.alias === c.alias); return (
              <div key={c.alias} className="card v9-card flex flex-col gap-1">
                <Row><strong>{t('ui.v13_plan')} {c.alias}</strong><span className="text-[12px] text-muted">{t('ui.v13_blind_score')} {lb?.score ?? 0}</span><span className="grow" />{r.status === 'reviewing' && <button type="button" className="primary" data-testid={`group-race-pick-${c.alias}`} onClick={() => run(() => pickWinner(r.id, c.alias), 'ui.v13_race_decided')}>{t('ui.v13_pick')}</button>}{r.status === 'decided' && r.winner === r.entries.find((e) => e.alias === c.alias)?.horseId && <span className="pill text-[12px]">{t('ui.v13_winner')}</span>}</Row>
                <p className="m-0 line-clamp-3 text-[13px]" title={c.proposal}>{c.proposal}</p>
              </div>
            ); })}
            {r.status === 'decided' && <Note tone="ok">{t('ui.v13_archived')} {r.archived.length}</Note>}
          </div>
        ))}
      </Section>
    </>
  );
}

/* ---------------- 文档与公文 ---------------- */
function Docs({ s, run, go }: { s: GroupState; run: Run; go: (to: string) => void }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const list = [...s.docs].reverse().filter((d) => !q || d.no.includes(q) || d.title.includes(q) || d.type === q);
  return (
    <Section title={t('ui.v13_docs')} testId="group-docs">
      <Row>
        <input className="min-w-0 grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ui.v13_doc_search')} aria-label={t('ui.v13_doc_search')} data-testid="group-doc-search" />
        <button type="button" data-testid="group-collab" onClick={() => run(collabDrafts, 'ui.v13_collab_done')}>{t('ui.v13_collab')}</button>
      </Row>
      {!list.length && <Note>{t('ui.v13_no_docs')}</Note>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.slice(0, 30).map((d) => (
          <li key={d.id} className="card v9-card flex flex-col gap-1" data-testid={`doc-${d.id}`}>
            <Row><span className="pill text-[12px]">{t(d.type)}</span><strong className="min-w-0 grow truncate" title={d.title}>{d.title}</strong><span className="text-[12px] text-muted">{d.no}</span></Row>
            <p className="m-0 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted" title={d.body}>{d.body}</p>
            <Row>
              <span className="text-[12px]">{t(`ui.v13_ds_${d.status}`)}</span><span className="grow" />
              {d.status === 'pending' && <><button type="button" className="primary" data-testid={`group-doc-approve-${d.id}`} onClick={() => run(() => decide(d.id, true), 'ui.v12_approved')}>{t('ui.v12_approve')}</button><button type="button" className="ghost" data-testid={`group-doc-reject-${d.id}`} onClick={() => run(() => decide(d.id, false), 'ui.v12_rejected')}>{t('ui.v12_reject')}</button></>}
              {d.status === 'approved' && d.refs[0]?.startsWith('draft:') && <button type="button" data-testid={`group-doc-publish-${d.id}`} onClick={() => go('agent/drafts?filter=approved')}>{t('ui.v13_copy_publish')}</button>}
            </Row>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ---------------- 目标（公开 OKR 树） ---------------- */
function Okr({ s, run }: { s: GroupState; run: Run }) {
  const { t } = useT();
  const [g, setG] = useState({ title: s.yearGoal?.title ?? '', target: String(s.yearGoal?.target ?? 100000), unit: s.yearGoal?.unit ?? t('ui.v13_unit_fans') });
  const year = s.okrs.find((o) => o.level === 'year');
  return (
    <>
      <Section title={t('ui.v13_year_goal')} testId="group-goal">
        <label className="field"><span>{t('ui.v13_goal_title')}</span><input value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} placeholder={t('ui.v13_goal_ph')} data-testid="group-goal-title" /></label>
        <Row><label className="field grow"><span>{t('ui.v13_goal_target')}</span><input inputMode="numeric" value={g.target} onChange={(e) => setG({ ...g, target: e.target.value })} data-testid="group-goal-target" /></label><label className="field grow"><span>{t('ui.v13_goal_unit')}</span><input value={g.unit} onChange={(e) => setG({ ...g, unit: e.target.value })} data-testid="group-goal-unit" /></label></Row>
        <Row><button type="button" className="primary" disabled={!g.title.trim() || !(Number(g.target) > 0)} data-testid="group-goal-save" onClick={() => run(() => setYearGoal({ title: g.title.trim(), metric: 'followers', target: Number(g.target), unit: g.unit.trim() || '粉' }), 'ui.v13_okr_done')}>{t('ui.v13_goal_save')}</button></Row>
      </Section>
      {year && (
        <Section title={t('ui.v13_okr_tree')} testId="group-okr-tree">
          <Note>{t('ui.v13_okr_public')} · {s.okrs[1]?.period}</Note>
          <p className="m-0 text-[14px]"><strong>{year.title}</strong> · {t(okrProgress(year).text)}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {s.okrs.filter((o) => o.level === 'dept').map((o) => (
              <li key={o.id} className="flex flex-col border-l-2 border-line pl-2" data-testid={`okr-${o.owner}`}>
                <span className="truncate text-[13px] font-semibold" title={o.title}>{t(s.org.depts.find((d) => d.id === o.owner)?.name ?? o.owner)}</span>
                {o.krs.map((k) => <span key={k.id} className="truncate text-[12px] text-muted" title={k.title}>KR · {k.title} · {k.current == null ? t('ui.v13_z_tbd') : k.current}</span>)}
              </li>
            ))}
          </ul>
          {s.aligns.length > 0 && <div data-testid="group-aligns">{s.aligns.map((a) => <Note key={a.id} tone="warn">{t('ui.v13_align')}：{t(s.org.depts.find((d) => d.id === a.conflict.a)?.name ?? a.conflict.a)} ↔ {t(s.org.depts.find((d) => d.id === a.conflict.b)?.name ?? a.conflict.b)} · {a.conflict.why}</Note>)}</div>}
        </Section>
      )}
    </>
  );
}

/* ---------------- 制度库 ---------------- */
function Regs({ s, run }: { s: GroupState; run: Run }) {
  const { t } = useT();
  const [sel, setSel] = useState('budget');
  const [add, setAdd] = useState('');
  const doa = useMemo(() => parseDoa(), []);
  const cur = currentReg(s.regs, sel);
  return (
    <>
      <Section title={t('ui.v13_regs')} testId="group-regs">
        <Note>{t('ui.v13_regs_source')}</Note>
        <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
          {REGULATIONS.map((r) => <li key={r.id}><button type="button" className={`ghost w-full !justify-start ${sel === r.id ? '!border-accent' : ''}`} data-testid={`reg-${r.id}`} onClick={() => setSel(r.id)}><span className="min-w-0 grow truncate text-left">{r.no}. {t(r.title)}</span><span className="text-[12px] text-muted">v{currentReg(s.regs, r.id)?.version ?? 1}</span></button></li>)}
        </ul>
        {cur && <details open data-testid="reg-text"><summary className="cursor-pointer text-[13px]">{t(REGULATIONS.find((r) => r.id === sel)!.title)} v{cur.version}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px]">{cur.text}</pre></details>}
        <label className="field"><span>{t('ui.v13_reg_add')}</span><textarea rows={2} value={add} onChange={(e) => setAdd(e.target.value)} placeholder={t('ui.v13_reg_add_ph')} data-testid="group-reg-add" /></label>
        <Row>
          <button type="button" disabled={!add.trim()} data-testid="group-reg-propose" onClick={() => run(() => proposeRegulation(sel, add).then(() => setAdd('')), 'ui.v13_proposed')}>{t('ui.v13_reg_propose')}</button>
          <button type="button" className="ghost" disabled={(s.regs[sel]?.length ?? 0) < 2} data-testid="group-reg-rollback" onClick={() => run(() => rollbackRegulation(sel), 'ui.v13_rolled_back')}>{t('ui.v13_rollback')}</button>
        </Row>
      </Section>
      <Section title={t('ui.v13_doa')} testId="group-doa">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {Object.values(doa).map((r) => <li key={r.matter} className="text-[13px]"><strong>{t(MATTER_TEXT[r.matter])}</strong> · {t('ui.v13_doa_decide')} {r.decide === 'forbidden' ? t('ui.v13_forbidden') : t(`ui.v13_role_${r.decide}`)}{r.review ? ` · ${t('ui.v13_doa_review')} ${t(s.org.depts.find((d) => d.id === r.review)?.name ?? s.org.committees.find((c) => c.id === r.review)?.name ?? r.review)}` : ''}{r.ceoMaxYuan != null ? ` · ≤¥${r.deptMaxYuan} / ≤¥${r.ceoMaxYuan}` : ''}{r.control ? ` · ${t('ui.v13_control')}` : ''}</li>)}
        </ul>
      </Section>
      <Section title={t('ui.v13_mechanisms')} testId="group-mechanisms">
        <Row>{MECHANISMS.map((m) => <label key={m} className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={s.mechanisms[m]} onChange={(e) => run(() => toggleMechanism(m, e.target.checked))} data-testid={`mech-${m}`} />{t(MECHANISM_TEXT[m])}</label>)}</Row>
      </Section>
    </>
  );
}

/* ---------------- 驾驶舱 ---------------- */
function Cockpit({ s, o, run }: { s: GroupState; o: GroupOverview | null; run: Run }) {
  const { t } = useT();
  const [gid, setGid] = useState<string | null>(null);
  const [gv, setGv] = useState({ ctrl: '0.8', gray: '0.6' });
  const year = s.okrs.find((x) => x.level === 'year');
  const gray = s.grays.find((g) => g.id === gid) ?? s.grays.at(-1);
  const risks = [...s.vetoes.map((v) => `${t(v.by === 'legal' ? '法务合规部' : '质量委员会')}：${v.reason}`), ...s.escalations.filter((e) => e.toChairman).map((e) => e.subject)];
  const brief = [`${t('ui.v13_brief_goal')} ${year ? `${year.title} · ${t(okrProgress(year).text)}` : t('ui.v13_z_tbd')}`, `${t('ui.v13_tab_sessions')} ${o?.liveSessions ?? 0} · ${t('ui.v13_tab_rooms')} ${o?.liveMeetings ?? 0} · ${t('ui.v13_pending_docs')} ${o?.pendingDocs ?? 0}`, ...s.flow.slice(-3).map((f) => `· ${f.title}`)];
  return (
    <>
      <Section title={t('ui.v13_cockpit')} testId="group-cockpit">
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
          <li className="card v9-card flex flex-col gap-1" data-testid="kpi-goal"><span className="text-[12px] text-muted">{t('ui.v13_goal_progress')}</span><strong>{year ? (okrProgress(year).percent == null ? t('ui.v13_z_tbd') : `${okrProgress(year).percent}%`) : t('ui.v13_z_tbd')}</strong></li>
          <li className="card v9-card flex flex-col gap-1" data-testid="kpi-share"><span className="text-[12px] text-muted">{t('ui.v13_meeting_share')}</span><strong className={o?.share.alert ? 'text-warn' : ''}>{o?.share.share == null ? '—' : `${Math.round(o.share.share * 100)}%`}</strong>{o?.share.alert && <Note tone="warn">{t('ui.v13_share_alert')}</Note>}</li>
          <li className="card v9-card flex flex-col gap-1" data-testid="kpi-hit"><span className="text-[12px] text-muted">{t('ui.v13_hit_rate')}</span><strong>{o?.hitRate == null ? '—' : `${Math.round(o.hitRate * 100)}%`}</strong></li>
          <li className="card v9-card flex flex-col gap-1" data-testid="kpi-race"><span className="text-[12px] text-muted">{t('ui.v13_race_effect')}</span><strong className="text-[13px]">{s.races.filter((r) => r.status === 'decided').length} · {t(o?.raceEffect.verdict.startsWith('待录入') ? 'ui.v13_race_effect_wait' : 'ui.v13_race_effect_has')}</strong></li>
          <li className="card v9-card flex flex-col gap-1" data-testid="kpi-budget"><span className="text-[12px] text-muted">{t('ui.v13_budget_by_dept')}</span><span className="text-[13px]">{Object.entries(o?.byDept ?? {}).map(([d, y]) => `${t(s.org.depts.find((x) => x.id === d)?.name ?? d)} ${yuan(y)}`).join(' · ') || '—'}</span></li>
          <li className="card v9-card flex flex-col gap-1" data-testid="kpi-risk"><span className="text-[12px] text-muted">{t('ui.v13_risks')}</span><span className="line-clamp-3 text-[13px]" title={risks.join('；')}>{risks.join('；') || '—'}</span></li>
        </ul>
      </Section>
      <Section title={t('ui.v13_brief')} testId="group-brief">{brief.map((b, i) => <Note key={i}>{b}</Note>)}</Section>
      <Section title={t('ui.v13_gray')} testId="group-gray">
        <Note>{t('ui.v13_gray_desc')}</Note>
        <Row><button type="button" data-testid="group-gray-start" onClick={() => run(async () => setGid(await startGray('skills/douyin-script/SKILL.md')), 'ui.v13_gray_started')}>{t('ui.v13_gray_start')}</button></Row>
        {gray && (
          <div className="flex flex-col gap-1" data-testid="gray-view">
            <Note>{gray.target.id} v{gray.target.version} · {t(`ui.v13_gs_${gray.status}`)}{gray.reason ? ` · ${gray.reason}` : ''}</Note>
            {gray.status === 'trial' && (
              <Row>
                <label className="field"><span>{t('ui.v13_gray_ctrl')}</span><input value={gv.ctrl} onChange={(e) => setGv({ ...gv, ctrl: e.target.value })} data-testid="gray-ctrl" /></label>
                <label className="field"><span>{t('ui.v13_gray_val')}</span><input value={gv.gray} onChange={(e) => setGv({ ...gv, gray: e.target.value })} data-testid="gray-val" /></label>
                <button type="button" data-testid="group-gray-observe" onClick={() => run(async () => { await grayObserve(gray.id, Number(gv.ctrl), false); await grayObserve(gray.id, Number(gv.gray), true); }, 'ui.v13_noted')}>{t('ui.v13_gray_record')}</button>
                <button type="button" className="primary" data-testid="group-gray-eval" onClick={() => run(() => grayEvaluate(gray.id))}>{t('ui.v13_gray_eval')}</button>
              </Row>
            )}
          </div>
        )}
      </Section>
      <Section title={t('ui.v13_quarterly')} testId="group-quarterly">
        <Note>{t('ui.v13_quarterly_desc')}</Note>
        <Row><button type="button" data-testid="group-quarterly-run" onClick={() => run(quarterlyReview, 'ui.v13_quarterly_done')}>{t('ui.v13_quarterly_run')}</button></Row>
        {s.advice.map((a, i) => <Note key={i} tone="warn">{t('ui.v13_commissar')}（{t(s.org.depts.find((d) => d.id === a.deptId)?.name ?? a.deptId)}）：{a.text} → {t(`ui.v13_sg_${a.suggestion}`)}</Note>)}
        {s.retros.at(-1) && <Note tone="ok">{t('ui.v13_lesson')}：{s.retros.at(-1)!.lessons.filter((l) => l.status === 'adopted').map((l) => l.text).join('；')}</Note>}
      </Section>
      <Section title={t('ui.v13_flow')} testId="group-flow">
        <ol className="m-0 flex list-none flex-col gap-1 p-0">{[...s.flow].reverse().slice(0, 8).map((f) => <li key={f.id} className="truncate text-[13px]" title={f.body}><span className="pill mr-1 text-[11px]">{t(`ui.v13_fk_${f.kind}`)}</span>{f.title}：{f.body}</li>)}</ol>
      </Section>
    </>
  );
}
