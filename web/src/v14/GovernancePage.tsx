/**
 * 1.4.0 “统领 → 治理”分区（上市公司模式）：董事会、监督、经营、披露、战略、人才、集团大学、董事长学堂。
 * 每页顶部一句大白话 + “1 分钟看懂”；专业词可点开看解释；延续磨砂大圆角卡片，不做成 OA。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ACADEMY_CARDS, cardById, findTerms, PAGE_PLAIN, LISTED_HONESTY, BOARD_MATTER_TEXT, VOTE_TEXT, DIRECTOR_KIND_TEXT, INDEPENDENCE_TEXT, AUDIT_CHECK_TEXT, FINDING_LEVEL_TEXT, COSO, BSC_TEXT, BSC_DIMS, REPORT_CHAPTERS,
  BLM_STEPS, SCENARIO_TEXT, COMP_RULES_TEXT, CASE_KIND_TEXT, AGM_STEPS, NO_DATA, independenceOf, isWeak, riskRegisterView, govNow, showFig, type ListedState, type Motion, type AcademyCard, type WeeklyLesson,
} from '@content-agent/shared';
import { useT } from '../i18n';
import { Section, Note, SegTabs, download } from '../pages/me/v9/common';
import { useToast } from '../ui';
import { getGroup } from '../v13/store';
import {
  getListed, onListedChange, enableListed, finishOnboarding, disableListed, refreshBoardModels, setMonthBudget, conveneBoard, decideMotion, runVotes, refreshMinutes, startAgm, agmNext, runInternalAudit, noteRemediation, runControls,
  reviewAllRisks, runMonthlyReview, budgetView, requestBudgetAdjust, generateReport, editReportFigure, recheckReport, reportHtml, reportDocx, holdEarningsCall, computeBrief, startStrategy, reviewStrategy, nominateAgent,
  decideNomination, runAssessments, startSuccession, rollbackHandover, syncCases, startTraining, quarterBestPractice, universityHealth, markCardRead, setWeeklyOff, thisWeekLesson, badges, simulateMonth, simulateRemediation, demoAllowed,
} from './store';

export type GovSec = 'board' | 'oversight' | 'ops' | 'disclosure' | 'strategy' | 'talent' | 'university' | 'academy';
export const GOV_SECS: [GovSec, string][] = [['board', 'ui.v14_sec_board'], ['oversight', 'ui.v14_sec_oversight'], ['ops', 'ui.v14_sec_ops'], ['disclosure', 'ui.v14_sec_disclosure'], ['strategy', 'ui.v14_sec_strategy'], ['talent', 'ui.v14_sec_talent'], ['university', 'ui.v14_sec_university'], ['academy', 'ui.v14_sec_academy']];
type Run = (fn: () => Promise<unknown>, ok?: string) => void;
const Row = ({ children, testId }: { children: ReactNode; testId?: string }) => <div className="flex flex-wrap items-center gap-2" data-testid={testId}>{children}</div>;
const yuan = (n: number) => `¥${n.toFixed(n < 1 ? 3 : 2)}`;
const pct = (n: number | null) => (n == null ? NO_DATA : `${(n * 100).toFixed(0)}%`);

function useListed(): [ListedState | null, () => void] {
  const [s, setS] = useState<ListedState | null>(null);
  const load = useCallback(() => { void getListed().then(setS).catch(() => undefined); }, []);
  useEffect(() => { load(); return onListedChange(load); }, [load]);
  return [s, load];
}

/* ---------------- 术语与大白话 ---------------- */
function CardText({ c }: { c: AcademyCard }) {
  const { lang } = useT();
  return <span><strong>{lang === 'en' ? c.termEn : c.term}</strong>{lang === 'en' ? ' — ' : '：'}{lang === 'en' ? c.plainEn : c.plain}</span>;
}
/** 术语悬停 / 点开：文本里的专业词变成可点开的按钮。 */
export function Glossed({ text }: { text: string }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const hits = findTerms(text);
  if (!hits.length) return <>{text}</>;
  const parts: ReactNode[] = []; let i = 0;
  for (const h of hits) {
    if (h.index > i) parts.push(text.slice(i, h.index));
    const c = cardById(h.id)!;
    parts.push(<span key={`${h.index}`} className="relative inline"><button type="button" className="gov-term" aria-expanded={open === `${h.index}`} data-testid={`term-${h.id}`} title={lang === 'en' ? c.plainEn : c.plain} onClick={() => setOpen(open === `${h.index}` ? null : `${h.index}`)}>{h.term}</button>{open === `${h.index}` && <span role="note" className="gov-term-pop" data-testid="term-pop"><CardText c={c} /> <button type="button" className="ghost" onClick={() => setOpen(null)}>{t('ui.v14_close')}</button></span>}</span>);
    i = h.index + h.term.length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}
function Plain({ sec, run }: { sec: GovSec; run: Run }) {
  const { t, lang } = useT();
  const c = cardById(PAGE_PLAIN[sec]!)!;
  const [open, setOpen] = useState(false);
  return (
    <div className="gov-plain" data-testid={`gov-plain-${sec}`}>
      <p className="m-0 text-[14px]"><CardText c={c} /></p>
      <button type="button" className="ghost !min-h-11" aria-expanded={open} data-testid={`gov-minute-${sec}`} onClick={() => { setOpen(!open); if (!open) run(() => markCardRead(c.id)); }}>{t('ui.v14_one_minute')}</button>
      {open && <p className="m-0 text-[13px] text-muted" data-testid="gov-minute-body">{lang === 'en' ? c.minuteEn : c.minute}</p>}
    </div>
  );
}

/* ---------------- 页面 ---------------- */
export function GovernancePage({ sec: initial, go }: { sec?: string; go: (to: string) => void }) {
  const { t } = useT();
  const [sec, setSec] = useState<GovSec>(GOV_SECS.find(([k]) => k === initial)?.[0] ?? 'board');
  useEffect(() => { const k = GOV_SECS.find(([x]) => x === initial)?.[0]; if (k) setSec(k); }, [initial]);
  const [s, reload] = useListed();
  const [toast, show] = useToast();
  const [groupOn, setGroupOn] = useState<boolean | null>(null);
  useEffect(() => { void getGroup().then((g) => setGroupOn(g.enabled)); }, [s]);
  const run: Run = (fn, ok) => { void fn().then((r) => { if (ok) show(t(ok)); else if (typeof r === 'string' && r && !/^[a-z]+-/.test(r)) show(r); reload(); }).catch((e) => show(String((e as Error).message ?? e))); };
  if (!s || groupOn === null) return <Note>{t('ui.loading')}</Note>;
  if (!s.enabled) return <div className="flex flex-col gap-3" data-testid="gov-page">{toast}<EnableCard run={run} groupOn={groupOn} /></div>;
  if (!s.onboarded) return <div className="flex flex-col gap-3" data-testid="gov-page">{toast}<Onboarding run={run} /></div>;
  const pending = s.motions.filter((m) => m.status === 'voting').length;
  return (
    <div className="flex flex-col gap-3" data-testid="gov-page">
      {toast}
      <p className="m-0 text-[12.5px] text-muted" data-testid="gov-honesty">{t(LISTED_HONESTY)}</p>
      <div className="v12-tabs"><SegTabs value={sec} options={GOV_SECS.map(([k, l]) => [k, k === 'board' && pending ? `${t(l)} ${pending}` : l])} onChange={(v) => { setSec(v); go(`group?tab=gov&sec=${v}`); }} label={t('ui.v14_gov')} /></div>
      <Plain sec={sec} run={run} />
      {sec === 'board' ? <BoardSec s={s} run={run} />
        : sec === 'oversight' ? <OversightSec s={s} run={run} />
        : sec === 'ops' ? <OpsSec s={s} run={run} />
        : sec === 'disclosure' ? <DisclosureSec s={s} run={run} />
        : sec === 'strategy' ? <StrategySec s={s} run={run} />
        : sec === 'talent' ? <TalentSec s={s} run={run} />
        : sec === 'university' ? <UniversitySec s={s} run={run} />
        : <AcademySec s={s} run={run} />}
      <Row><button type="button" className="ghost" data-testid="gov-disable" onClick={() => run(disableListed, 'ui.v14_disabled')}>{t('ui.v14_disable')}</button></Row>
    </div>
  );
}

function EnableCard({ run, groupOn }: { run: Run; groupOn: boolean }) {
  const { t } = useT();
  return (
    <Section title={t('ui.v14_enable_title')} testId="gov-enable-card">
      <Note>{t('ui.v14_enable_desc')}</Note>
      <Note>{t(LISTED_HONESTY)}</Note>
      {!groupOn && <Note tone="warn">{t('ui.v14_need_group')}</Note>}
      <Row><button type="button" className="primary" disabled={!groupOn} data-testid="gov-enable" onClick={() => run(enableListed, 'ui.v14_enabled')}>{t('ui.v14_enable')}</button></Row>
    </Section>
  );
}
const ONB: [string, string][] = [['ui.v14_onb1_t', 'ui.v14_onb1_b'], ['ui.v14_onb2_t', 'ui.v14_onb2_b'], ['ui.v14_onb3_t', 'ui.v14_onb3_b']];
function Onboarding({ run }: { run: Run }) {
  const { t } = useT();
  const [i, setI] = useState(0);
  return (
    <Section title={`${t(ONB[i]![0])}（${i + 1}/3）`} testId="gov-onboarding">
      <p className="m-0 text-[14px]" data-testid={`gov-onb-${i + 1}`}>{t(ONB[i]![1])}</p>
      {i === 2 && <Note>{t(LISTED_HONESTY)}</Note>}
      <Row>{i > 0 && <button type="button" className="ghost" onClick={() => setI(i - 1)}>{t('ui.v14_prev')}</button>}{i < 2 ? <button type="button" className="primary" data-testid="gov-onb-next" onClick={() => setI(i + 1)}>{t('ui.v14_next')}</button> : <button type="button" className="primary" data-testid="gov-onb-done" onClick={() => run(finishOnboarding)}>{t('ui.v14_onb_done')}</button>}</Row>
    </Section>
  );
}

/* ---------------- 董事会 ---------------- */
function MotionCard({ m, s, run }: { m: Motion; s: ListedState; run: Run }) {
  const { t } = useT();
  const name = (id: string) => s.board.directors.find((d) => d.id === id)?.name ?? id;
  return (
    <div className="card v9-card flex flex-col gap-1" data-testid={`gov-motion-${m.id}`}>
      <Row><strong className="min-w-0 grow break-words">{m.no}  {m.title}</strong><span className="text-[12px] text-muted">{t(BOARD_MATTER_TEXT[m.matter])}</span></Row>
      {m.status === 'refused' ? <Note tone="warn">{m.refusedReason}</Note> : <>
        <details><summary className="text-[13px]">{t('ui.v14_materials')}</summary><pre className="whitespace-pre-wrap text-[12.5px]">{m.materials}</pre></details>
        {m.votes.map((v) => <p key={v.directorId} className="m-0 text-[13px]" data-testid={`gov-vote-${v.directorId}`}><strong>{name(v.directorId)}</strong>：{t(VOTE_TEXT[v.choice])}  <Glossed text={v.reason} />{v.runs === 2 ? `（${t('ui.v14_two_runs')}）` : ''}</p>)}
        {m.status === 'voting' && (m.votes.length ? <Row><button type="button" className="primary" data-testid={`gov-approve-${m.id}`} onClick={() => run(async () => { const r = await decideMotion(m.id, true); return r.notice ?? ''; })}>{t('ui.v14_approve')}</button><button type="button" data-testid={`gov-reject-${m.id}`} onClick={() => run(() => decideMotion(m.id, false))}>{t('ui.v14_reject')}</button></Row>
          : <Row><button type="button" data-testid={`gov-votes-${m.id}`} onClick={() => run(() => runVotes(m.id))}>{t('ui.v14_ask_votes')}</button></Row>)}
        {m.status === 'decided' && <Note tone={m.decision === 'approved' ? 'ok' : 'muted'}>{t(m.decision === 'approved' ? 'ui.v14_approved' : 'ui.v14_rejected')}{m.override ? `  ${t('ui.v14_override_note')}` : ''}</Note>}
      </>}
    </div>
  );
}
function BoardSec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const ceo = s.board.directors.find((d) => d.kind === 'executive')?.model;
  const agm = s.agms.find((a) => a.status === 'open') ?? s.agms.at(-1);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-board">
      <Section title={t('ui.v14_board_members')} actions={<button type="button" className="ghost" data-testid="gov-board-refresh" onClick={() => run(refreshBoardModels, 'ui.v14_saved')}>{t('ui.v14_rebind')}</button>}>
        {s.board.directors.map((d) => { const ind = d.kind === 'independent' ? (d.independence ?? independenceOf(d, ceo)) : null; return (
          <Row key={d.id} testId={`gov-director-${d.id}`}><strong className="min-w-0 grow">{d.name}</strong><span className="text-[12px] text-muted">{t(DIRECTOR_KIND_TEXT[d.kind])}{d.model ? ` · ${d.model.model}` : ''}</span>{ind && <span className={`gov-chip ${isWeak(ind) ? 'warn' : ''}`} data-testid={isWeak(ind) ? 'gov-independence-weak' : 'gov-independence'}>{t(INDEPENDENCE_TEXT[ind])}</span>}</Row>); })}
        <Note>{t('ui.v14_board_rule')}</Note>
        {s.board.committees.map((c) => <p key={c.id} className="m-0 text-[13px]" data-testid={`gov-committee-${c.id}`}><strong><Glossed text={c.name} /></strong>：{c.members.map((id) => s.board.directors.find((d) => d.id === id)?.name ?? id).join('、')}（{t('ui.v14_chair')}：{s.board.directors.find((d) => d.id === c.chair)?.name}）</p>)}
        <Note>{t('ui.v14_reports_from')}：{s.board.reportsFrom.join('、')}</Note>
      </Section>
      <Section title={t('ui.v14_motions')} actions={<button type="button" className="primary" data-testid="gov-convene" onClick={() => run(conveneBoard, 'ui.v14_convened')}>{t('ui.v14_convene')}</button>}>
        {!s.motions.length && <Note>{t('ui.v14_no_motions')}</Note>}
        {[...s.motions].reverse().slice(0, 8).map((m) => <MotionCard key={m.id} m={m} s={s} run={run} />)}
        {s.boardMeetings.length > 0 && <details data-testid="gov-minutes"><summary className="text-[13px]">{t('ui.v14_minutes')}（{s.boardMeetings.at(-1)!.no}）</summary><button type="button" className="ghost" onClick={() => run(refreshMinutes)}>{t('ui.v14_refresh')}</button><pre className="whitespace-pre-wrap text-[12.5px]">{s.boardMeetings.at(-1)!.minutes}</pre></details>}
      </Section>
      <Section title={t('ui.v14_agm')} testId="gov-agm" actions={!agm || agm.status === 'closed' ? <button type="button" data-testid="gov-agm-start" onClick={() => run(startAgm)}>{t('ui.v14_agm_start')}</button> : <button type="button" className="primary" data-testid="gov-agm-next" onClick={() => run(() => agmNext(''))}>{t('ui.v14_agm_next')}</button>}>
        <Note>{t('ui.v14_agm_desc')}</Note>
        {agm && AGM_STEPS.map((k, i) => <p key={k} className="m-0 text-[13px]">{agm.steps[k].done ? '✓' : '○'} {i + 1}. {t(k)}</p>)}
        {agm?.status === 'closed' && <Note tone="ok">{t('ui.v14_agm_closed')}</Note>}
      </Section>
    </div>
  );
}

/* ---------------- 监督 ---------------- */
function OversightSec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  const risks = riskRegisterView(s.risks, govNow(s.clock));
  const last = s.audits.at(-1);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-oversight">
      <Section title={t('ui.v14_three_lines')}>
        <p className="m-0 text-[13px]"><Glossed text={t('ui.v14_line1')} /></p><p className="m-0 text-[13px]"><Glossed text={t('ui.v14_line2')} /></p><p className="m-0 text-[13px]"><Glossed text={t('ui.v14_line3')} /></p>
      </Section>
      <Section title={t('ui.v14_audit')} actions={<button type="button" className="primary" data-testid="gov-audit-run" onClick={() => run(runInternalAudit, 'ui.v14_audit_done')}>{t('ui.v14_audit_run')}</button>}>
        <Note>{t('ui.v14_audit_desc')}</Note>
        {s.audits.slice(-3).reverse().map((a) => (
          <div key={a.id} className="card v9-card flex flex-col gap-1" data-testid={`gov-audit-${a.id}`}>
            <Row><strong className="grow">{a.no}</strong><span className="text-[12px] text-muted">{t('ui.v14_to')}：{t('ui.v14_to_chair')} · {t('ui.v14_cc')}：CEO</span></Row>
            <p className="m-0 text-[13px]">{a.summary}</p>
            {a.findings.map((f) => <div key={f.id} className="text-[13px]" data-testid={`gov-finding-${f.check}`}><strong>[{t(FINDING_LEVEL_TEXT[f.level])}] {f.title}</strong><br />{t('ui.v14_evidence')}：{f.evidence.join('；')}<br />{t('ui.v14_suggestion')}：{f.suggestion}（{f.dept}，{t('ui.v14_due')} {f.due}）</div>)}
            {a.carried.length > 0 && <p className="m-0 text-[13px]" data-testid="gov-carried">{t('ui.v14_followup')}：{a.carried.map((f) => `${f.title}（${f.status === 'closed' ? t('ui.v14_closed') : t('ui.v14_open')}）`).join('；')}</p>}
          </div>))}
        {last && last.findings.length > 0 && <Row><input className="min-w-0 grow" value={note} placeholder={t('ui.v14_remed_ph')} aria-label={t('ui.v14_remed_ph')} onChange={(e) => setNote(e.target.value)} data-testid="gov-remed-input" /><button type="button" data-testid="gov-remed" onClick={() => run(async () => { for (const f of last.findings) await noteRemediation(last.id, f.id, note || t('ui.v14_remed_default')); if (s.sim) await simulateRemediation(); }, 'ui.v14_saved')}>{t('ui.v14_remed')}</button></Row>}
        <Note>{Object.entries(AUDIT_CHECK_TEXT).map(([, v]) => t(v)).join(' · ')}</Note>
      </Section>
      <Section title={t('ui.v14_risks')} testId="gov-risks" actions={<button type="button" className="ghost" data-testid="gov-risks-review" onClick={() => run(reviewAllRisks, 'ui.v14_saved')}>{t('ui.v14_risks_review')}</button>}>
        {risks.stale > 0 && <Note tone="warn">{t('ui.v14_risks_stale')}：{risks.stale}</Note>}
        <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{t('ui.v14_risk')}</th><th>{t('ui.v14_score')}</th><th>{t('ui.v14_response')}</th><th>{t('ui.v14_owner')}</th></tr></thead><tbody>{risks.risks.map((r) => <tr key={r.id}><td>{r.title}</td><td>{r.likelihood}×{r.impact}={r.score}</td><td>{r.response}</td><td>{r.owner}</td></tr>)}</tbody></table></div>
      </Section>
      <Section title={t('ui.v14_controls')} actions={<button type="button" data-testid="gov-controls-run" onClick={() => run(runControls)}>{t('ui.v14_controls_run')}</button>}>
        {s.controls ? <><Note>{s.controls.text}</Note>{COSO.map((k) => <p key={k} className="m-0 text-[13px]" data-testid={`gov-coso-${k}`}><strong>{t(k)}</strong>：{s.controls!.results.filter((r) => r.component === k).map((r) => `${r.ok ? '✓' : '✗'} ${r.id} ${r.note}`).join('；')}</p>)}</> : <Note>{t('ui.v14_controls_none')}</Note>}
      </Section>
    </div>
  );
}

/* ---------------- 经营 ---------------- */
function OpsSec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const [v, setV] = useState<Awaited<ReturnType<typeof budgetView>> | null>(null);
  const [mb, setMb] = useState(String(s.monthBudgetYuan ?? ''));
  useEffect(() => { void budgetView().then(setV); }, [s]);
  const r = s.reviews.at(-1);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-ops">
      {demoAllowed() && <Section title={t('ui.v14_sim')} testId="gov-sim"><Note tone="warn">{t('ui.v14_sim_desc')}</Note><Row><button type="button" data-testid="gov-sim-month" onClick={() => run(simulateMonth)}>{t('ui.v14_sim_month')}</button></Row></Section>}
      <Section title={t('ui.v14_review')} actions={<button type="button" className="primary" data-testid="gov-review-run" onClick={() => run(runMonthlyReview, 'ui.v14_review_done')}>{t('ui.v14_review_run')}</button>}>
        <Note>{t('ui.v14_review_desc')}</Note>
        {r && <>
          <Note>{r.month}{r.sim ? `（${t('ui.v14_has_sim')}）` : ''}  {BSC_DIMS.map((d) => `${t(BSC_TEXT[d])} ${r.byDim[d].total - r.byDim[d].noData}/${r.byDim[d].total}`).join(' · ')}</Note>
          <div className="gov-table-wrap"><table className="gov-table" data-testid="gov-gap-table"><thead><tr><th>{t('ui.v14_dim')}</th><th>{t('ui.v14_metric')}</th><th>{t('ui.v14_target')}</th><th>{t('ui.v14_actual')}</th><th>{t('ui.v14_gap')}</th><th>{t('ui.v14_cause')}</th><th>{t('ui.v14_action')}</th></tr></thead><tbody>{r.rows.map((x) => <tr key={x.key}><td>{t(BSC_TEXT[x.dim])}</td><td>{x.label}</td><td>{x.target}</td><td>{x.actual}</td><td className={x.behind ? 'text-warn' : ''}>{x.gap}</td><td>{x.cause}</td><td>{x.action}</td></tr>)}</tbody></table></div>
          {r.budgetAlerts.length > 0 && <div data-testid="gov-budget-alerts">{r.budgetAlerts.map((a) => <Note key={a} tone="warn">{a}</Note>)}</div>}
        </>}
      </Section>
      <Section title={t('ui.v14_budget')} testId="gov-budget">
        {s.budget ? <Note>{t('ui.v14_budget_total')} ¥{s.budget.total} · v{s.budget.version} · {s.budget.approvedBy ? t('ui.v14_approved') : t('ui.v14_budget_pending')}</Note> : <Note>{t('ui.v14_budget_none')}</Note>}
        {v?.exec && <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{t('ui.v14_item')}</th><th>{t('ui.v14_planned_td')}</th><th>{t('ui.v14_spent')}</th><th>{t('ui.v14_deviation')}</th></tr></thead><tbody>{v.exec.lines.map((l) => <tr key={l.key} className={l.alert ? 'text-warn' : ''}><td>{l.label}</td><td>{yuan(l.plannedToDate)}</td><td>{yuan(l.spent)}</td><td>{pct(l.deviation)}</td></tr>)}</tbody></table></div>}
        {s.budget && <Row><button type="button" data-testid="gov-adjust" onClick={() => run(() => requestBudgetAdjust(4, Object.keys(s.budget!.depts)[0] ?? 'bu-video', 6, t('ui.v14_adjust_reason')), 'ui.v14_adjust_sent')}>{t('ui.v14_adjust')}</button></Row>}
        <Row><label className="field min-w-0 grow"><span>{t('ui.v14_month_budget')}</span><input inputMode="decimal" value={mb} onChange={(e) => setMb(e.target.value)} data-testid="gov-month-budget" /></label><button type="button" onClick={() => run(() => setMonthBudget(Number(mb) || 0), 'ui.v14_saved')}>{t('ui.v14_save')}</button></Row>
        {v && <Note tone={v.cost.over ? 'warn' : 'muted'}>{v.cost.text}</Note>}
      </Section>
      <Section title={t('ui.v14_roi')} testId="gov-roi">
        {v && v.roi.length ? <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{t('ui.v14_dept')}</th><th>{t('ui.v14_spent')}</th><th>{t('ui.v14_outputs')}</th><th>{t('ui.v14_adopted')}</th><th>{t('ui.v14_cost_per_adopted')}</th></tr></thead><tbody>{v.roi.map((x) => <tr key={x.key}><td>{x.label}</td><td>{yuan(x.spent)}</td><td>{x.outputs}</td><td>{x.adopted}</td><td>{x.costPerAdopted == null ? NO_DATA : yuan(x.costPerAdopted)}</td></tr>)}</tbody></table></div> : <Note>{NO_DATA}</Note>}
      </Section>
    </div>
  );
}

/* ---------------- 披露 ---------------- */
function DisclosureSec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const r = s.reports.at(-1);
  const [fig, setFig] = useState(''); const [val, setVal] = useState(''); const [trace, setTrace] = useState<string | null>(null);
  const call = r ? s.calls.find((c) => c.reportId === r.id) : undefined;
  const exportPdf = async (id: string) => { const html = await reportHtml(id); const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); } else download(`${id}.html`, html, 'text/html'); };
  return (
    <div className="flex flex-col gap-3" data-testid="gov-disclosure">
      <Section title={t('ui.v14_brief')} actions={<button type="button" data-testid="gov-brief-run" onClick={() => run(computeBrief)}>{t('ui.v14_brief_run')}</button>}>
        {s.brief ? <pre className="whitespace-pre-wrap text-[13.5px]" data-testid="gov-brief">{s.brief.text}</pre> : <Note>{t('ui.v14_brief_none')}</Note>}
      </Section>
      <Section title={t('ui.v14_reports')} actions={<Row><button type="button" className="primary" data-testid="gov-report-quarter" onClick={() => run(() => generateReport('quarter'), 'ui.v14_report_done')}>{t('ui.v14_report_quarter')}</button><button type="button" data-testid="gov-report-annual" onClick={() => run(() => generateReport('annual'), 'ui.v14_report_done')}>{t('ui.v14_report_annual')}</button></Row>}>
        {!r && <Note>{t('ui.v14_reports_none')}</Note>}
        {r && <div className="gov-report" data-testid={`gov-report-${r.status}`}>
          <div className="gov-cover"><span className="text-[12px] tracking-widest text-muted">{r.kind === 'annual' ? 'ANNUAL REPORT' : 'QUARTERLY REPORT'}</span><strong className="text-[20px] leading-tight break-words">{r.title}</strong><span className="text-[12px] text-muted">{r.no} · {t('ui.v14_signed')} {r.author}{r.sim ? ` · ${t('ui.v14_has_sim')}` : ''}</span>
            <div className="gov-keys">{['outputs', 'adopted', 'spend', 'budget_rate'].map((id) => r.figures.find((f) => f.id === id)).filter((f) => !!f).map((f) => <button key={f!.id} type="button" className="gov-key" data-testid={`gov-fig-${f!.id}`} onClick={() => setTrace(`${f!.label}：${showFig(f!)} ← ${f!.ref ?? NO_DATA}`)}><b>{showFig(f!)}</b><span>{f!.label}</span></button>)}</div></div>
          {trace && <Note tone="ok"><span data-testid="gov-trace">{t('ui.v14_trace')}：{trace}</span></Note>}
          {r.status === 'blocked' ? <div data-testid="gov-report-diffs"><Note tone="warn">{t('ui.v14_blocked')}</Note>{r.diffs.map((d) => <Note key={d} tone="warn">· {d}</Note>)}<Row><button type="button" data-testid="gov-report-recheck" onClick={() => run(() => recheckReport(r.id))}>{t('ui.v14_recheck')}</button></Row></div>
            : <Row><button type="button" data-testid="gov-export-pdf" onClick={() => run(() => exportPdf(r.id))}>{t('ui.v14_export_pdf')}</button><button type="button" data-testid="gov-export-docx" onClick={() => run(async () => download(`${r.title}.docx`, await reportDocx(r.id), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))}>{t('ui.v14_export_docx')}</button><button type="button" className="primary" data-testid="gov-call-run" onClick={() => run(() => holdEarningsCall(r.id), 'ui.v14_call_done')}>{t('ui.v14_call_run')}</button></Row>}
          <details><summary className="text-[13px]">{t('ui.v14_chapters')}（{REPORT_CHAPTERS.length}）</summary>{r.chapters.map((c) => <div key={c.no} className="mt-2"><strong className="text-[14px]">{c.no}. {t(c.title)}</strong>{c.paragraphs.map((p, i) => <p key={i} className="m-0 text-[13px] break-words">{p}</p>)}</div>)}</details>
          <details data-testid="gov-fig-editor"><summary className="text-[13px]">{t('ui.v14_edit_fig')}</summary><Note>{t('ui.v14_edit_fig_desc')}</Note>
            <Row><select value={fig} onChange={(e) => setFig(e.target.value)} aria-label={t('ui.v14_edit_fig')} data-testid="gov-fig-select"><option value="">—</option>{r.figures.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select><input className="min-w-0 w-24" value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" aria-label={t('ui.v14_value')} data-testid="gov-fig-value" /><button type="button" data-testid="gov-fig-save" onClick={() => run(() => editReportFigure(r.id, fig, val === '' ? null : Number(val)))}>{t('ui.v14_save_check')}</button></Row></details>
        </div>}
      </Section>
      {call && <Section title={t('ui.v14_call')} testId="gov-call">
        <details open><summary className="text-[13px]">{t('ui.v14_call_speech')}</summary><p className="m-0 whitespace-pre-wrap text-[13px]">{call.speech}</p></details>
        {call.qa.map((q) => <div key={q.id} className="text-[13px]" data-testid={`gov-qa-${q.id}`}><strong>{q.asker}</strong>：{q.question}<br /><strong>CEO</strong>：{q.answer}{q.todo ? `（${t('ui.v14_todo')}）` : ''}</div>)}
        <Note>{t('ui.v14_todos')}：{call.todos.length} · {yuan(call.spent)} / {yuan(call.budget)}</Note>
      </Section>}
    </div>
  );
}

/* ---------------- 战略 ---------------- */
function StrategySec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const p = s.strategies.at(-1);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-strategy">
      <Section title={t('ui.v14_strategy')} actions={<button type="button" className="primary" data-testid="gov-strategy-run" onClick={() => run(startStrategy, 'ui.v14_strategy_done')}>{t('ui.v14_strategy_run')}</button>}>
        <Note>{t('ui.v14_strategy_desc')}</Note>
        {p && <>
          <Note>{p.year} · {t(`ui.v14_st_${p.status}`)}{p.chosen ? ` · ${t(SCENARIO_TEXT[p.chosen])}` : ''}{p.okrIds.length ? ` · OKR ${p.okrIds.length}` : ''}</Note>
          <ol className="m-0 pl-5 text-[13px]" data-testid="gov-blm">{BLM_STEPS.map((x) => <li key={x.id}><strong>{t(x.title)}</strong>：{p.steps[x.id]}</li>)}</ol>
          <div className="gov-table-wrap"><table className="gov-table" data-testid="gov-map"><thead><tr><th>{t('ui.v14_goal')}</th><th>{t('ui.v14_initiative')}</th><th>{t('ui.v14_dept')}</th><th>{t('ui.v14_metric')}</th><th>{t('ui.v14_budget')}</th></tr></thead><tbody>{p.map.map((r, i) => <tr key={i}><td>{r.goal}</td><td>{r.initiative}</td><td>{r.dept}</td><td>{r.metric} {r.target}{r.unit}</td><td>¥{r.budget}</td></tr>)}</tbody></table></div>
          <div className="gov-grid" data-testid="gov-scenarios">{p.scenarios.map((x) => <div key={x.id} className="card v9-card text-[13px]"><strong>{t(SCENARIO_TEXT[x.id])}</strong>  ×{x.factor}<br />{x.targets.map((g) => `${g.metric} ${g.target}${g.unit}`).join('；')} · ¥{x.budget}<br /><span className="text-muted">{x.assumptions.join('；')}</span></div>)}</div>
          {p.status === 'approved' && <Row><button type="button" data-testid="gov-strategy-review" onClick={() => run(() => reviewStrategy(p.id, [p.scenarios.find((x) => x.id === p.chosen)!.assumptions[0]!]))}>{t('ui.v14_strategy_review')}</button></Row>}
          {p.reviews.length > 0 && <Note>{t('ui.v14_strategy_reviewed')}：{p.reviews.at(-1)!.holds.filter((h) => h.holds === false).map((h) => h.assumption).join('；') || t('ui.v14_all_hold')}</Note>}
        </>}
      </Section>
    </div>
  );
}

/* ---------------- 人才 ---------------- */
function TalentSec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const [nm, setNm] = useState('');
  const x = s.successions.at(-1);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-talent">
      <Section title={t('ui.v14_nominate')}>
        <Row><input className="min-w-0 grow" value={nm} onChange={(e) => setNm(e.target.value)} placeholder={t('ui.v14_nominate_ph')} aria-label={t('ui.v14_nominate_ph')} data-testid="gov-nominate-name" /><button type="button" data-testid="gov-nominate" onClick={() => run(() => nominateAgent(nm || t('ui.v14_nominate_default'), 'live'))}>{t('ui.v14_nominate_run')}</button></Row>
        {s.nominations.slice(-3).map((n) => <Row key={n.id}><span className="min-w-0 grow text-[13px]">{n.candidate.name} · {n.candidate.model} · {n.candidate.perms.join('/')} · ¥{n.candidate.budgetMonth}/{t('ui.v14_month')} · {t(`ui.v14_nom_${n.status}`)}</span>{n.status === 'proposed' && <button type="button" data-testid={`gov-nom-approve-${n.id}`} onClick={() => run(() => decideNomination(n.id, true))}>{t('ui.v14_approve')}</button>}</Row>)}
      </Section>
      <Section title={t('ui.v14_comp')} actions={<button type="button" data-testid="gov-assess" onClick={() => run(runAssessments)}>{t('ui.v14_assess')}</button>}>
        <pre className="whitespace-pre-wrap text-[12.5px]" data-testid="gov-comp-rules">{COMP_RULES_TEXT}</pre>
        {s.assessments.slice(-6).map((a) => <p key={a.agentId + a.quarter} className="m-0 text-[13px]">{a.agentId}：{a.score ?? NO_DATA} → ¥{a.nextQuota} · {t(a.nextTier)}</p>)}
      </Section>
      <Section title={t('ui.v14_succession')} actions={<button type="button" className="primary" data-testid="gov-shadow-run" onClick={() => run(startSuccession, 'ui.v14_shadow_done')}>{t('ui.v14_shadow_run')}</button>}>
        <Note>{t('ui.v14_succession_desc')}</Note>
        {x && <div className="text-[13px]" data-testid="gov-succession">
          <p className="m-0">{x.incumbent.label} → {x.candidate.label} · {x.runs.length}/{x.n} · {yuan(x.spent)} / {yuan(x.capYuan)} · {t(`ui.v14_succ_${x.status}`)}</p>
          {x.verdict && <p className="m-0">{x.verdict.why}</p>}
          {x.history.slice(-3).map((h, i) => <p key={i} className="m-0 text-muted">{h.event}</p>)}
          {x.status === 'handed_over' && <Row><button type="button" data-testid="gov-rollback" onClick={() => run(() => rollbackHandover(x.id, ''))}>{t('ui.v14_rollback')}</button></Row>}
        </div>}
      </Section>
    </div>
  );
}

/* ---------------- 集团大学 ---------------- */
function UniversitySec({ s, run }: { s: ListedState; run: Run }) {
  const { t } = useT();
  const [h, setH] = useState<Awaited<ReturnType<typeof universityHealth>> | null>(null);
  const [agent, setAgent] = useState('live-head');
  useEffect(() => { void universityHealth().then(setH); }, [s]);
  const tr = s.trainings.at(-1);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-university">
      <Section title={t('ui.v14_cases')} actions={<button type="button" data-testid="gov-cases-sync" onClick={() => run(syncCases)}>{t('ui.v14_cases_sync')}</button>}>
        {h && <Note>{t('ui.v14_health')}：{h.cases} · {t('ui.v14_cite_rate')} {pct(h.citationRate)} · {t('ui.v14_stale')} {h.stale}</Note>}
        {s.cases.slice(-5).reverse().map((c) => <details key={c.id} data-testid={`gov-case-${c.kind}`}><summary className="text-[13px]">{t(CASE_KIND_TEXT[c.kind])}｜{c.title}{c.cites.length ? ` · ${t('ui.v14_cited')} ${c.cites.length}` : ''}{c.bestPractice ? ` · ★ ${c.bestPractice}` : ''}</summary><p className="m-0 text-[13px]">{t('ui.v14_situation')}：{c.situation}<br />{t('ui.v14_practice')}：{c.action}<br />{t('ui.v14_result')}：{c.result}<br />{t('ui.v14_lesson')}：{c.lesson}<br />{t('ui.v14_applies')}：{c.applies}</p></details>)}
      </Section>
      <Section title={t('ui.v14_training')}>
        <Row><input className="min-w-0 grow" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label={t('ui.v14_agent_id')} data-testid="gov-train-agent" /><button type="button" className="primary" data-testid="gov-train-run" onClick={() => run(() => startTraining(agent))}>{t('ui.v14_train_run')}</button></Row>
        {tr && <div className="text-[13px]" data-testid="gov-training"><p className="m-0">{tr.agentId}：{tr.score}/5 · {tr.onDuty ? t('ui.v14_on_duty') : t('ui.v14_not_on_duty')}</p>{tr.quiz.map((q, i) => <p key={q.id} className="m-0 text-muted">{i + 1}. {q.q} {tr.answers?.[i] === q.answer ? '✓' : '✗'}</p>)}</div>}
      </Section>
      <Section title={t('ui.v14_best')} actions={<button type="button" data-testid="gov-best-run" onClick={() => run(quarterBestPractice)}>{t('ui.v14_best_run')}</button>}>
        {s.bestPractices.slice(-2).map((b) => <Note key={b.quarter}>{b.quarter}：{b.skillPaths.join('、') || NO_DATA}</Note>)}
      </Section>
    </div>
  );
}

/* ---------------- 董事长学堂 ---------------- */
function AcademySec({ s, run }: { s: ListedState; run: Run }) {
  const { t, lang } = useT();
  const [l, setL] = useState<WeeklyLesson | null>(null);
  const [b, setB] = useState<Awaited<ReturnType<typeof badges>> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void thisWeekLesson(lang).then(setL); void badges().then(setB); }, [s, lang]);
  return (
    <div className="flex flex-col gap-3" data-testid="gov-academy">
      <Section title={t('ui.v14_weekly')} testId="gov-weekly" actions={<button type="button" className="ghost" data-testid="gov-weekly-toggle" onClick={() => run(() => setWeeklyOff(!s.academy.weeklyOff))}>{t(s.academy.weeklyOff ? 'ui.v14_weekly_on' : 'ui.v14_weekly_off')}</button>}>
        {l ? <><p className="m-0 text-[14px]" data-testid="gov-weekly-text"><Glossed text={l.text} /></p><Row><button type="button" data-testid="gov-weekly-read" onClick={() => run(() => markCardRead(l.cardId))}>{t('ui.v14_mark_read')}</button></Row></> : <Note>{t(s.academy.weeklyOff ? 'ui.v14_weekly_is_off' : 'ui.v14_weekly_none')}</Note>}
      </Section>
      <Section title={t('ui.v14_badges')} testId="gov-badges">
        {b && <Note>{b.earned.length ? b.earned.map((id) => t(`ui.v14_badge_${id}`)).join(' · ') : t('ui.v14_badge_none')}{b.next ? `  ${t('ui.v14_badge_next')}：${t(`ui.v14_badge_${b.next.id}`)}（${b.next.needCards} / ${b.next.needMotions}）` : ''}</Note>}
        <Note>{t('ui.v14_badge_note')}</Note>
      </Section>
      <Section title={`${t('ui.v14_cards')}（${ACADEMY_CARDS.length}）`}>
        <div className="gov-grid" data-testid="gov-cards">{ACADEMY_CARDS.map((c) => <div key={c.id} className="card v9-card flex flex-col gap-1"><button type="button" className="gov-card-btn" aria-expanded={open === c.id} data-testid={`gov-card-${c.id}`} onClick={() => { setOpen(open === c.id ? null : c.id); run(() => markCardRead(c.id)); }}><strong>{lang === 'en' ? c.termEn : c.term}</strong>{s.academy.read.includes(c.id) ? ' ✓' : ''}</button><span className="text-[12.5px] text-muted">{lang === 'en' ? c.plainEn : c.plain}</span>{open === c.id && <span className="text-[13px]">{lang === 'en' ? c.minuteEn : c.minute}</span>}</div>)}</div>
      </Section>
    </div>
  );
}

