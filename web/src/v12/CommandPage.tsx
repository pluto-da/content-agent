/**
 * 1.2.0 指挥台（#command）：我的团队、任务板、工作流、审批收件箱、目标与进度、连接（自定义平台 / 数据源 / 外部工具 MCP / A2A）。
 * 延续 Hark 式卡片：一屏一件事、动词按钮；“我的”不增加入口（冲突审计 A13）。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AGENT_TEMPLATES, BOARD_COLUMNS, BOARD_TEXT, APPROVAL_KIND_TEXT, PERM_TEXT, WORKFLOW_TEMPLATES, PLATFORM_TEMPLATES, PLATFORM_NOTICE, SPEC_KEYS, DATA_SOURCE_TEXT, WF_EVENT_TEXT,
  draftAgentFromSentence, exportAgentZip, importAgentZip, agentChangeRisk, statsView, idleHint, goalProgress, weeklyReviewDraft, platformFromTemplate, draftPlatformFromSentence, importPlatformZip,
  validateDataSource, grantDataSource, buildServerConfig, setToolEnabled, McpClient, flagOn, scheduleNeedsApproval, serializeAgentMd, fetchAgentCard, newA2ARef,
  type SubAgentDef, type SuperState, type WorkflowDef, type PlatformManifest, type PermLevel, type DataSource, type DataSourceKind, type Goal, type ApprovalItem, type FetchLike,
} from '@content-agent/shared';
import { useT } from '../i18n';
import { Section, Note, SegTabs, download } from '../pages/me/v9/common';
import { useToast } from '../ui';
import { getPrefs } from '../local/store';
import {
  getState, updateState, onSuperChange, listAgents, saveAgent, deleteAgent, proposeAgent, enableTemplate, listUserPlatforms, savePlatform, listWorkflows, saveWorkflow, decide, addApproval,
  togglePauseItem, startWorkflow, pauseAll, resumeAll, rollbackAgent,
} from './store';

export type CommandTab = 'team' | 'board' | 'workflows' | 'inbox' | 'goals' | 'connect';
export const COMMAND_TABS: [CommandTab, string][] = [['team', 'ui.v12_team'], ['board', 'ui.v12_board'], ['workflows', 'ui.v12_workflows'], ['inbox', 'ui.v12_inbox'], ['goals', 'ui.v12_goals'], ['connect', 'ui.v12_connect']];

interface Data { s: SuperState; agents: SubAgentDef[]; wfs: WorkflowDef[]; plats: PlatformManifest[]; flags: Record<string, boolean> }
function useSuperData(): [Data | null, () => void] {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(() => { void Promise.all([getState(), listAgents(), listWorkflows(), listUserPlatforms(), getPrefs()]).then(([s, agents, wfs, plats, p]) => setD({ s, agents, wfs, plats, flags: (p as { flags?: Record<string, boolean> }).flags ?? {} })).catch(() => undefined); }, []);
  useEffect(() => { load(); return onSuperChange(load); }, [load]);
  return [d, load];
}

/** 英文界面下把系统生成的审批 / 任务文字换成英文（存储里保留中文原文；用户与模型的内容不翻）。 */
const EN_RULES: [RegExp, (m: RegExpExecArray, t: (k: string) => string) => string][] = [
  [/^为新平台 (.+) 起草写法技能$/, (m) => `Draft a writing skill for the new platform ${m[1]}`],
  [/^写入 (\S+)（写法只在技能里）$/, (m) => `Writes ${m[1]} (writing rules live only in skills)`],
  [/^工作流「(.+)」的审批节点$/, (m, t) => `Approval step of workflow "${t(m[1]!)}"`],
  [/^批准后继续执行剩余步骤$/, () => 'Approve to run the remaining steps'],
  [/^AGENTS\.md 增加“指挥职责”引用（修订建议 P1）$/, () => 'AGENTS.md: add a reference to the command duties (proposal P1)'],
  [/^只是引用 super\/SUPER\.md.*$/, () => 'Only a reference to super/SUPER.md — no permission or boundary changes; rejecting it does not affect 1.2 features'],
  [/^权限 (\S+)；额度 ¥([\d.]+)\/月；工具 (\d+) 个$/, (m) => `Permissions ${m[1]}; budget ¥${m[2]}/month; ${m[3]} tools`],
  [/^批准后 (.+) 本月额度 \+¥1 并恢复运行$/, (m, t) => `Approve to add ¥1 to ${t(m[1]!)}'s monthly budget and resume it`],
  [/^修改子 Agent (.+)：(.+)$/, (m, t) => `Change sub-agent ${t(m[1]!)}: ${m[2]!.split('、').map((x) => ({ 职责: 'duties', 权限: 'permissions', 工具: 'tools', 额度: 'budget', 模型: 'model', 数据源授权: 'data-source grants' } as Record<string, string>)[x] ?? x).join(', ')}`],
  [/^职责 \/ 权限 \/ 工具 \/ 额度改动属于 L3，批准后生效$/, () => 'Duty / permission / tool / budget changes are L3 and apply after approval'],
  [/^启用外部工具服务器「(.+)」（MCP (.+)）$/, (m) => `Enable external tool server "${m[1]}" (MCP ${m[2]})`],
  [/^(\d+) 个工具，其中 (\d+) 个因硬边界被拒；其余默认关闭，需逐个勾选$/, (m) => `${m[1]} tools, ${m[2]} refused by hard boundaries; the rest start off — tick them one by one`],
  [/^添加外部 Agent「(.+)」（A2A）$/, (m) => `Add external agent "${m[1]}" (A2A)`],
  [/^调用属 L2，额度 ¥3\/月$/, () => 'Calls are L2; budget ¥3/month'],
  [/^启用工作流「(.+)」的定时$/, (m, t) => `Enable the schedule of workflow "${t(m[1]!)}"`],
  [/^App 打开时执行到期任务；关闭时只发通知$/, () => 'Runs due tasks while the app is open; only notifies when closed'],
  [/^你描述的专项：(.*)$/, (m) => `Your request: ${m[1]}`],
  [/^导入 (.+)$/, (m) => `Import ${m[1]}`],
  [/^(.+) 本月额度 ¥([\d.]+) 将超出（已花 ¥([\d.]+)）$/, (m) => `${m[1]} would exceed its monthly budget ¥${m[2]} (spent ¥${m[3]})`],
  [/^汇总今天合法来源的热点，按账号画像出 5 个选题$/, () => 'Gather today’s trends from lawful sources and suggest 5 topics for the profile'],
  [/^写一篇母稿（自由创作，不带平台格式）$/, () => 'Write a master draft (free writing, no platform format)'],
  [/^把母稿适配到已选平台，母稿不改：?$/, () => 'Adapt the master draft to the chosen platforms; keep the master unchanged'],
  [/^审核这些适配稿，只出意见不改稿：?$/, () => 'Review these adaptations — notes only, no edits'],
  [/^用录入或导入的数据做本周复盘；没有数据就写待录入$/, () => 'Weekly review from entered or imported data; write “to be entered” when there is none'],
];
export function sysText(s: string, lang: string, t: (k: string) => string): string {
  if (lang !== 'en') return s;
  const parts = s.split(' · ');
  if (parts.length > 1) return parts.map((x) => sysText(x, lang, t)).join(' · ');
  for (const [re, f] of EN_RULES) { const m = re.exec(s.trim()); if (m) return f(m, t); }
  return t(s);
}
const yuan = (n: number) => `¥${n.toFixed(n < 1 ? 3 : 2)}`;
const Row = ({ children, testId }: { children: ReactNode; testId?: string }) => <div className="flex flex-wrap items-center gap-2" data-testid={testId}>{children}</div>;

export function CommandPage({ tab: initial, go }: { tab?: string; go: (to: string) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<CommandTab>((COMMAND_TABS.find(([k]) => k === initial)?.[0]) ?? 'team');
  useEffect(() => { const k = COMMAND_TABS.find(([x]) => x === initial)?.[0]; if (k) setTab(k); }, [initial]);
  const [d, reload] = useSuperData();
  const [toast, show] = useToast();
  const run = (fn: () => Promise<unknown>, ok?: string) => fn().then(() => { if (ok) show(t(ok)); reload(); }).catch((e) => show(String((e as Error).message ?? e)));
  const pending = d?.s.approvals.filter((a) => a.status === 'pending').length ?? 0;
  return (
    <div className="page flex flex-col gap-3" data-testid="command-page">
      {toast}
      {(tab === 'team' || tab === 'connect') && <p className="m-0 text-[13px] text-muted" data-testid="command-boundary">{t('ui.v12_boundary_line')}</p>}
      {d?.s.paused && (
        <div className="card v9-card flex flex-wrap items-center gap-2" role="status" data-testid="paused-banner">
          <strong className="grow">{t('ui.v12_all_paused')}</strong>
          <button type="button" className="primary" data-testid="resume-all" onClick={() => void run(resumeAll, 'ui.v12_resumed')}>{t('ui.v12_resume')}</button>
        </div>
      )}
      <div className="v12-tabs"><SegTabs value={tab} options={COMMAND_TABS.map(([k, l]) => [k, k === 'inbox' && pending ? `${t(l)} ${pending}` : l])} onChange={(v) => { setTab(v); go(`command?tab=${v}`); }} label={t('ui.v12_command')} /></div>
      {!d ? <Note>{t('ui.loading')}</Note>
        : tab === 'team' ? <Team d={d} run={run} />
        : tab === 'board' ? <Board d={d} />
        : tab === 'workflows' ? <Workflows d={d} run={run} />
        : tab === 'inbox' ? <Inbox d={d} run={run} />
        : tab === 'goals' ? <Goals d={d} run={run} />
        : <Connect d={d} run={run} go={go} />}
      {d && !d.s.paused && tab === 'team' && <button type="button" className="ghost self-start" data-testid="pause-all-page" onClick={() => void run(pauseAll, 'ui.v12_paused_toast')}>{t('ui.v12_pause_all')}</button>}
    </div>
  );
}
type Run = (fn: () => Promise<unknown>, ok?: string) => void;

/* ---------------- 我的团队 ---------------- */
function Team({ d, run }: { d: Data; run: Run }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [sentence, setSentence] = useState('');
  const [edit, setEdit] = useState<SubAgentDef | null>(null);
  const have = new Set(d.agents.map((a) => a.id));
  return (
    <>
      <Section title={t('ui.v12_my_team')} testId="team" actions={<button type="button" className="primary" data-testid="agent-new" onClick={() => setAdding((x) => !x)}>{t('ui.v12_new_agent')}</button>}>
        {adding && (
          <div className="flex flex-col gap-2 border-t border-line pt-2" data-testid="agent-new-panel">
            <Note>{t('ui.v12_from_template')}</Note>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {AGENT_TEMPLATES.map((tp) => (
                <li key={tp.id} className="flex items-center gap-2">
                  <div className="min-w-0 grow"><strong>{t(tp.name)}</strong><p className="m-0 line-clamp-2 text-[13px] text-muted" title={t(tp.description)}>{t(tp.description)}</p></div>
                  <button type="button" className="shrink-0" disabled={have.has(tp.id)} data-testid={`tpl-enable-${tp.id}`} onClick={() => void run(() => enableTemplate(tp.id), 'ui.v12_enabled')}>{have.has(tp.id) ? t('ui.v12_enabled_short') : t('ui.v12_enable')}</button>
                </li>
              ))}
            </ul>
            <label className="field"><span>{t('ui.v12_describe_agent')}</span><textarea rows={2} value={sentence} onChange={(e) => setSentence(e.target.value)} data-testid="agent-sentence" placeholder={t('ui.v12_describe_agent_ph')} /></label>
            <Row>
              <button type="button" disabled={!sentence.trim()} data-testid="agent-draft" onClick={() => void run(async () => { await proposeAgent(draftAgentFromSentence(sentence, [...have]), `你描述的专项：${sentence.slice(0, 60)}`); setSentence(''); }, 'ui.v12_sent_to_inbox')}>{t('ui.v12_let_super_draft')}</button>
              <label className="button ghost" data-testid="agent-import-label">{t('ui.v12_import_agent')}<input type="file" accept=".zip" className="sr-only" data-testid="agent-import" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; void run(async () => { const im = importAgentZip(new Uint8Array(await f.arrayBuffer()), { existing: [...have] }); if (!im.ok || !im.def) throw new Error(im.errors.join('；')); await proposeAgent(im.def, `导入 ${f.name}${im.narrowed.length ? `（权限已收窄，去掉 ${im.narrowed.join('、')}）` : ''}`); }, 'ui.v12_sent_to_inbox'); }} /></label>
            </Row>
          </div>
        )}
        {!d.agents.length && <Note>{t('ui.v12_no_agents')}</Note>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="agent-list">
          {d.agents.map((a) => {
            const paused = d.s.pausedItems.includes(a.id);
            const spent = d.s.spendByAgent[a.id]?.yuan ?? 0;
            const st = statsView(d.s.stats[a.id] ?? { completed: 0, returned: 0, failed: 0, runs: 0, costTotal: 0, offered: 0, adopted: 0 });
            const last = [...d.s.tasks].reverse().find((x) => x.agentId === a.id);
            const idle = idleHint(d.s.stats[a.id], d.s.stats[a.id]?.lastActiveAt ?? new Date().toISOString());
            const running = d.s.tasks.some((x) => x.agentId === a.id && x.state === 'running');
            return (
              <li key={a.id} className="card v9-card flex flex-col gap-1" data-testid={`agent-${a.id}`}>
                <Row>
                  <strong className="min-w-0 grow truncate" title={a.name}>{t(a.name)}</strong>
                  <span className={`badge ${paused ? 'warn' : running ? 'ok' : ''}`} data-testid={`agent-status-${a.id}`}>{t(paused ? 'ui.v12_paused' : running ? 'ui.v12_running' : 'ui.v12_idle')}</span>
                </Row>
                <p className="m-0 line-clamp-2 text-[13px] text-muted" title={t(a.description)}>{t(a.description)}</p>
                <p className="m-0 text-[13px]" data-testid={`agent-spend-${a.id}`}>{t('ui.v12_this_month')} {yuan(spent)} / ¥{a.budget.monthYuan} · {a.permissions.map((p) => t(PERM_TEXT[p])).join(' / ')}</p>
                <p className="m-0 text-[13px] text-muted">{t('ui.v12_done_count')} {st.completed} · {t('ui.v12_return_rate')} {st.returnRate === null ? '—' : `${Math.round(st.returnRate * 100)}%`} · {t('ui.v12_avg_cost')} {st.avgCost === null ? '—' : yuan(st.avgCost)}</p>
                {last?.summary && <p className="m-0 line-clamp-2 text-[13px]" title={last.summary}>{t('ui.v12_latest_output')}{last.summary}</p>}
                {idle && <Note tone="warn">{t('ui.v12_idle_hint')}</Note>}
                <Row>
                  <button type="button" data-testid={`agent-pause-${a.id}`} onClick={() => void run(() => togglePauseItem(a.id, !paused), paused ? 'ui.v12_resumed' : 'ui.v12_paused_toast')}>{t(paused ? 'ui.v12_resume' : 'ui.v12_pause')}</button>
                  <button type="button" className="ghost" data-testid={`agent-edit-${a.id}`} onClick={() => setEdit(a)}>{t('ui.v12_edit')}</button>
                  {a.version > 1 && <button type="button" className="ghost" data-testid={`agent-rollback-${a.id}`} onClick={() => void run(() => rollbackAgent(a.id), 'ui.v12_rolled_back')}>{t('ui.v12_rollback')}</button>}
                  <button type="button" className="ghost" data-testid={`agent-export-${a.id}`} onClick={() => download(`${a.id}.agent.zip`, exportAgentZip(a), 'application/zip')}>{t('ui.v12_export')}</button>
                  <button type="button" className="ghost" data-testid={`agent-delete-${a.id}`} onClick={() => { if (confirm(t('ui.v12_delete_confirm'))) void run(() => deleteAgent(a.id), 'ui.v12_deleted'); }}>{t('ui.v12_delete')}</button>
                </Row>
                {edit?.id === a.id && <AgentEditor a={a} onClose={() => setEdit(null)} run={run} />}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={t('ui.v12_concurrency')} testId="concurrency">
        <label className="field"><span>{t('ui.v12_concurrency_hint')}</span>
          <select value={d.s.concurrency} data-testid="concurrency-select" onChange={(e) => void run(() => updateState((s) => ({ ...s, concurrency: Number(e.target.value) })), 'ui.v12_saved')}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
      </Section>
    </>
  );
}
function AgentEditor({ a, onClose, run }: { a: SubAgentDef; onClose: () => void; run: Run }) {
  const { t } = useT();
  const [x, setX] = useState<SubAgentDef>(a);
  const toggle = (p: PermLevel) => setX((v) => ({ ...v, permissions: v.permissions.includes(p) ? v.permissions.filter((q) => q !== p) : [...v.permissions, p] }));
  const save = () => run(async () => {
    const risk = agentChangeRisk(a, x);
    if (risk.risk === 'L3') { await addApproval({ kind: 'l3', from: 'user', why: `修改子 Agent ${a.name}：${risk.fields.join('、')}`, impact: '职责 / 权限 / 工具 / 额度改动属于 L3，批准后生效', estCost: null, preview: serializeAgentMd({ ...x, version: a.version + 1 }), payload: { action: 'agent_change', agentId: a.id } }); onClose(); return; }
    await saveAgent({ ...x, version: a.version + 1 }, 'user'); onClose();
  }, agentChangeRisk(a, x).risk === 'L3' ? 'ui.v12_sent_to_inbox' : 'ui.v12_saved');
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2" data-testid="agent-editor">
      <label className="field"><span>{t('ui.v12_name')}</span><input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} data-testid="agent-edit-name" /></label>
      <label className="field"><span>{t('ui.v12_description')}</span><textarea rows={2} value={x.description} onChange={(e) => setX({ ...x, description: e.target.value })} /></label>
      <div className="form-row">
        <label className="field"><span>{t('ui.v12_month_budget')}</span><input inputMode="decimal" value={x.budget.monthYuan} onChange={(e) => setX({ ...x, budget: { ...x.budget, monthYuan: Number(e.target.value) || 0 } })} data-testid="agent-edit-budget" /></label>
        <label className="field"><span>{t('ui.v12_per_run_cap')}</span><input inputMode="decimal" value={x.budget.perRunYuan} onChange={(e) => setX({ ...x, budget: { ...x.budget, perRunYuan: Number(e.target.value) || 0 } })} /></label>
      </div>
      <fieldset className="flex flex-wrap gap-3 border-0 p-0"><legend className="text-[13px] text-muted">{t('ui.v12_permissions')}</legend>
        {(['L0', 'L1', 'L2'] as PermLevel[]).map((p) => <label key={p} className="flex min-h-11 items-center gap-1"><input type="checkbox" checked={x.permissions.includes(p)} onChange={() => toggle(p)} data-testid={`agent-perm-${p}`} />{p} {t(PERM_TEXT[p])}</label>)}
      </fieldset>
      <label className="field"><span>{t('ui.v12_duties')}</span><textarea rows={5} value={x.body} onChange={(e) => setX({ ...x, body: e.target.value })} data-testid="agent-edit-body" /></label>
      <Note>{t('ui.v12_l3_change_note')}</Note>
      <Row><button type="button" className="primary" data-testid="agent-edit-save" onClick={save}>{t('ui.v12_save')}</button><button type="button" className="ghost" onClick={onClose}>{t('ui.cancel')}</button></Row>
    </div>
  );
}

/* ---------------- 任务板 ---------------- */
function Board({ d }: { d: Data }) {
  const { t, lang } = useT();
  const name = (id: string) => t(d.agents.find((a) => a.id === id)?.name ?? id);
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} data-testid="board">
      {BOARD_COLUMNS.map((c) => {
        const list = d.s.tasks.filter((x) => x.state === c).slice(-20).reverse();
        return (
          <section key={c} className="card v9-card flex flex-col gap-1" data-testid={`board-col-${c}`}>
            <h3 className="m-0 text-[15px]">{t(BOARD_TEXT[c])} <span className="text-muted">{list.length}</span></h3>
            {!list.length && <Note>{t('ui.v12_empty')}</Note>}
            {list.map((x) => (
              <article key={x.id} className="rounded-[10px] border border-line p-2" data-testid={`task-${x.id}`}>
                <p className="m-0 line-clamp-2 text-[14px]" title={sysText(x.title, lang, t)}>{sysText(x.title, lang, t)}</p>
                <p className="m-0 text-[12px] text-muted">{name(x.agentId)} · {yuan(x.cost)}{x.returned ? ` · ${t('ui.v12_returned_once')}` : ''}</p>
                {x.summary && <p className="m-0 line-clamp-3 text-[13px]" title={x.summary}>{x.summary}</p>}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- 工作流 ---------------- */
function Workflows({ d, run }: { d: Data; run: Run }) {
  const { t } = useT();
  const have = new Set(d.wfs.map((w) => w.id));
  const trig = (w: WorkflowDef) => w.triggers.map((x) => (x.kind === 'manual' ? t('ui.v12_trigger_manual') : x.kind === 'schedule' ? `${t('ui.v12_trigger_schedule')} ${x.at}` : `${t('ui.v12_trigger_event')}${t(WF_EVENT_TEXT[x.event])}`)).join(' · ');
  return (
    <>
      <Section title={t('ui.v12_workflow_templates')} testId="wf-templates">
        {WORKFLOW_TEMPLATES.map((w) => (
          <Row key={w.id}><div className="min-w-0 grow"><strong>{t(w.name)}</strong><p className="m-0 line-clamp-2 text-[13px] text-muted" title={t(w.description)}>{t(w.description)}</p></div>
            <button type="button" disabled={have.has(w.id)} data-testid={`wf-add-${w.id}`} onClick={() => void run(() => saveWorkflow({ ...w, enabled: true }), 'ui.v12_added')}>{have.has(w.id) ? t('ui.v12_added_short') : t('ui.v12_add')}</button></Row>
        ))}
      </Section>
      <Section title={t('ui.v12_my_workflows')} testId="wf-list">
        {!d.wfs.length && <Note>{t('ui.v12_no_workflows')}</Note>}
        {d.wfs.map((w) => {
          const st = d.s.wfRuns[w.id];
          const paused = d.s.pausedItems.includes(w.id);
          return (
            <div key={w.id} className="flex flex-col gap-1 border-t border-line pt-2" data-testid={`wf-${w.id}`}>
              <Row><strong className="grow">{t(w.name)}</strong>{st && <span className="badge" data-testid={`wf-status-${w.id}`}>{t(`ui.v12_wf_${st.status}`)}</span>}</Row>
              <p className="m-0 text-[13px] text-muted">{trig(w)}{scheduleNeedsApproval(w) ? ` · ${t('ui.v12_schedule_needs_ok')}` : ''}</p>
              {st && <p className="m-0 text-[13px] text-muted">{Object.values(st.nodes).filter((n) => n.status === 'done').length} {t('ui.v12_steps_done')} · {yuan(st.cost)}</p>}
              <Row>
                <button type="button" className="primary" data-testid={`wf-run-${w.id}`} disabled={paused || d.s.paused} onClick={() => void run(() => startWorkflow(w.id), 'ui.v12_wf_started')}>{t('ui.v12_run')}</button>
                {scheduleNeedsApproval(w) && <button type="button" data-testid={`wf-schedule-${w.id}`} onClick={() => void run(() => addApproval({ kind: 'l3', from: 'user', why: `启用工作流「${w.name}」的定时`, impact: 'App 打开时执行到期任务；关闭时只发通知', estCost: null, preview: trig(w), payload: { action: 'workflow_schedule', workflowId: w.id } }), 'ui.v12_sent_to_inbox')}>{t('ui.v12_enable_schedule')}</button>}
                <button type="button" className="ghost" data-testid={`wf-pause-${w.id}`} onClick={() => void run(() => togglePauseItem(w.id, !paused))}>{t(paused ? 'ui.v12_resume' : 'ui.v12_pause')}</button>
              </Row>
            </div>
          );
        })}
      </Section>
    </>
  );
}

/* ---------------- 审批收件箱 ---------------- */
function Inbox({ d, run }: { d: Data; run: Run }) {
  const { t, lang } = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const pending = d.s.approvals.filter((a) => a.status === 'pending').reverse();
  const done = d.s.approvals.filter((a) => a.status !== 'pending').slice(-10).reverse();
  const who = (a: ApprovalItem) => (a.from === 'super' ? t('ui.v12_super_agent') : a.from === 'user' ? t('ui.v12_you') : t(d.agents.find((x) => x.id === a.from)?.name ?? a.from));
  return (
    <>
      <Section title={`${t('ui.v12_pending_approvals')} ${pending.length}`} testId="inbox">
        {!pending.length && <Note>{t('ui.v12_inbox_empty')}</Note>}
        {pending.map((a) => (
          <article key={a.id} className="flex flex-col gap-1 border-t border-line pt-2" data-testid={`ap-${a.id}`} data-kind={a.kind}>
            <Row><span className="badge">{t(APPROVAL_KIND_TEXT[a.kind])}</span><span className="text-[13px] text-muted">{t('ui.v12_from')}{who(a)}</span></Row>
            <p className="m-0 text-[14px]">{sysText(a.why, lang, t)}</p>
            <p className="m-0 text-[13px] text-muted">{t('ui.v12_impact')}{sysText(a.impact, lang, t)}{a.estCost !== null ? ` · ${t('ui.v12_est_cost')}${yuan(a.estCost)}` : ''}</p>
            <details><summary className="min-h-11 cursor-pointer text-[13px]">{t('ui.v12_preview')}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[12px]">{a.preview}</pre></details>
            {editing === a.id && <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} data-testid={`ap-edit-text-${a.id}`} aria-label={t('ui.v12_edit_then_approve')} />}
            <Row>
              <button type="button" className="primary" data-testid={`ap-approve-${a.id}`} onClick={() => void run(() => decide(a.id, editing === a.id ? { type: 'edit', preview: text } : { type: 'approve' }), 'ui.v12_approved')}>{t(editing === a.id ? 'ui.v12_approve_edited' : 'ui.v12_approve')}</button>
              <button type="button" data-testid={`ap-edit-${a.id}`} onClick={() => { setEditing(a.id); setText(a.preview); }}>{t('ui.v12_edit_then_approve')}</button>
              <button type="button" className="ghost" data-testid={`ap-reject-${a.id}`} onClick={() => void run(() => decide(a.id, { type: 'reject' }), 'ui.v12_rejected')}>{t('ui.v12_reject')}</button>
            </Row>
          </article>
        ))}
      </Section>
      {!!done.length && <Section title={t('ui.v12_recent_decisions')} testId="inbox-done">
        {done.map((a) => <p key={a.id} className="m-0 text-[13px]"><span className="badge">{t(a.status === 'approved' ? (a.edited ? 'ui.v12_approve_edited' : 'ui.v12_approve') : 'ui.v12_reject')}</span> {sysText(a.why, lang, t)}</p>)}
      </Section>}
    </>
  );
}

/* ---------------- 目标与进度 ---------------- */
function Goals({ d, run }: { d: Data; run: Run }) {
  const { t, lang } = useT();
  const [g, setG] = useState({ title: '', metric: 'followers' as Goal['metric'], platform: '', target: '', unit: '', from: new Date().toISOString().slice(0, 8) + '01', to: new Date().toISOString().slice(0, 10) });
  const [p, setP] = useState({ metric: 'followers' as Goal['metric'], platform: '', value: '', at: new Date().toISOString().slice(0, 10) });
  const [review, setReview] = useState('');
  return (
    <>
      <Section title={t('ui.v12_goals')} testId="goals">
        {!d.s.goals.length && <Note>{t('ui.v12_no_goals')}</Note>}
        {d.s.goals.map((x) => { const pr = goalProgress(x, d.s.dataPoints); return (
          <div key={x.id} className="flex flex-col gap-1 border-t border-line pt-2" data-testid={`goal-${x.id}`}>
            <strong>{x.title}</strong>
            <p className="m-0 text-[14px]" data-testid={`goal-progress-${x.id}`}>{pr.value === null ? t('ui.v12_to_be_entered') : `${pr.value} / ${x.target} ${t(`ui.v12_unit_${x.metric}`)}${pr.percent !== null ? (lang === 'en' ? ` (${pr.percent}%)` : `（${pr.percent}%）`) : ''} · ${t('ui.v12_based_on')} ${pr.points} ${t('ui.v12_data_points')}`}</p>
            {pr.percent !== null && <div className="v1-meter" role="progressbar" aria-label={x.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pr.percent)}><span style={{ width: `${Math.min(100, Math.max(0, pr.percent))}%` }} /></div>}
          </div>); })}
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <label className="field"><span>{t('ui.v12_goal_title')}</span><input value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} data-testid="goal-title" placeholder={t('ui.v12_goal_ph')} /></label>
          <div className="form-row">
            <label className="field"><span>{t('ui.v12_metric')}</span><select value={g.metric} onChange={(e) => setG({ ...g, metric: e.target.value as Goal['metric'] })} data-testid="goal-metric">{(['followers', 'revenue', 'views', 'posts'] as const).map((m) => <option key={m} value={m}>{t(`ui.v12_metric_${m}`)}</option>)}</select></label>
            <label className="field"><span>{t('ui.v12_target')}</span><input inputMode="decimal" value={g.target} onChange={(e) => setG({ ...g, target: e.target.value })} data-testid="goal-target" /></label>
            <label className="field"><span>{t('ui.v12_platform_optional')}</span><input value={g.platform} onChange={(e) => setG({ ...g, platform: e.target.value })} data-testid="goal-platform" /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>{t('ui.v12_from_date')}</span><input type="date" value={g.from} onChange={(e) => setG({ ...g, from: e.target.value })} /></label>
            <label className="field"><span>{t('ui.v12_to_date')}</span><input type="date" value={g.to} onChange={(e) => setG({ ...g, to: e.target.value })} data-testid="goal-to" /></label>
          </div>
          <button type="button" className="self-start" disabled={!g.title.trim() || !(Number(g.target) > 0)} data-testid="goal-add" onClick={() => void run(() => updateState((s) => ({ ...s, goals: [...s.goals, { id: `g${Date.now().toString(36)}`, title: g.title.trim(), metric: g.metric, platform: g.platform || undefined, target: Number(g.target), unit: '', from: g.from, to: g.to, createdAt: new Date().toISOString() }] })), 'ui.v12_saved')}>{t('ui.v12_add_goal')}</button>
        </div>
      </Section>
      <Section title={t('ui.v12_enter_data')} testId="goal-data">
        <Note>{t('ui.v12_only_real_data')}</Note>
        <div className="form-row">
          <label className="field"><span>{t('ui.v12_metric')}</span><select value={p.metric} onChange={(e) => setP({ ...p, metric: e.target.value as Goal['metric'] })} data-testid="dp-metric">{(['followers', 'revenue', 'views', 'posts'] as const).map((m) => <option key={m} value={m}>{t(`ui.v12_metric_${m}`)}</option>)}</select></label>
          <label className="field"><span>{t('ui.v12_value')}</span><input inputMode="decimal" value={p.value} onChange={(e) => setP({ ...p, value: e.target.value })} data-testid="dp-value" /></label>
          <label className="field"><span>{t('ui.v12_platform_optional')}</span><input value={p.platform} onChange={(e) => setP({ ...p, platform: e.target.value })} data-testid="dp-platform" /></label>
          <label className="field"><span>{t('ui.v12_date')}</span><input type="date" value={p.at} onChange={(e) => setP({ ...p, at: e.target.value })} data-testid="dp-date" /></label>
        </div>
        <Row>
          <button type="button" disabled={!Number.isFinite(Number(p.value)) || p.value === ''} data-testid="dp-add" onClick={() => void run(() => updateState((s) => ({ ...s, dataPoints: [...s.dataPoints, { metric: p.metric, platform: p.platform || undefined, value: Number(p.value), at: p.at, source: 'manual' }] })), 'ui.v12_saved')}>{t('ui.v12_add_data')}</button>
          <button type="button" className="ghost" data-testid="weekly-review" onClick={() => setReview(weeklyReviewDraft(d.s.goals, d.s.dataPoints))}>{t('ui.v12_weekly_review')}</button>
        </Row>
        {review && <pre className="whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[13px]" data-testid="weekly-review-text">{review}</pre>}
      </Section>
    </>
  );
}

/* ---------------- 连接：自定义平台 / 数据源 / MCP / A2A ---------------- */
function Connect({ d, run, go }: { d: Data; run: Run; go: (to: string) => void }) {
  const { t } = useT();
  const [tpl, setTpl] = useState('bilibili');
  const [pid, setPid] = useState('');
  const [sentence, setSentence] = useState('');
  const [ds, setDs] = useState<{ kind: DataSourceKind; label: string; url: string; interval: string }>({ kind: 'rss', label: '', url: '', interval: '60' });
  const [mcp, setMcp] = useState({ name: '', url: '' });
  const [a2a, setA2a] = useState('');
  const existing = d.plats.map((p) => p.id);
  const unverified = (p: PlatformManifest) => SPEC_KEYS.filter((k) => !p.spec[k].verified).length;
  return (
    <>
      <Section title={t('ui.v12_custom_platforms')} testId="platforms12">
        <Note>{t(PLATFORM_NOTICE)}</Note>
        <div className="form-row">
          <label className="field"><span>{t('ui.v12_copy_from_template')}</span><select value={tpl} onChange={(e) => setTpl(e.target.value)} data-testid="plat-template">{PLATFORM_TEMPLATES.map((p) => <option key={p.id} value={p.id}>{t(p.name)}</option>)}</select></label>
          <label className="field"><span>{t('ui.v12_new_id_optional')}</span><input value={pid} onChange={(e) => setPid(e.target.value.toLowerCase())} data-testid="plat-id" placeholder="bilibili-main" /></label>
        </div>
        <button type="button" className="self-start" data-testid="plat-copy" onClick={() => void run(async () => { const base = platformFromTemplate(tpl); let id = pid || base.id; let n = 1; while (existing.includes(id)) id = `${pid || base.id}-${++n}`; await savePlatform({ ...base, id }); setPid(''); }, 'ui.v12_saved')}>{t('ui.v12_copy_template')}</button>
        <label className="field"><span>{t('ui.v12_describe_platform')}</span><textarea rows={2} value={sentence} onChange={(e) => setSentence(e.target.value)} data-testid="plat-sentence" placeholder={t('ui.v12_describe_platform_ph')} /></label>
        <Row>
          <button type="button" disabled={!sentence.trim()} data-testid="plat-draft" onClick={() => void run(async () => { const dr = draftPlatformFromSentence(sentence, existing); await savePlatform(dr.manifest, dr.skill); setSentence(''); }, 'ui.v12_platform_drafted')}>{t('ui.v12_let_super_draft')}</button>
          <label className="button ghost">{t('ui.v12_import_platform')}<input type="file" accept=".zip" className="sr-only" data-testid="plat-import" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; void run(async () => { const im = importPlatformZip(new Uint8Array(await f.arrayBuffer()), { existing }); if (!im.ok || !im.manifest) throw new Error(im.errors.join('；')); await savePlatform(im.manifest, im.skill ? { path: `skills/${im.manifest.id}/SKILL.md`, content: im.skill } : undefined); }, 'ui.v12_saved'); }} /></label>
        </Row>
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="plat-list">
          {d.plats.map((p) => <li key={p.id} className="flex items-center gap-2 border-t border-line pt-2" data-testid={`plat-${p.id}`}><strong className="min-w-0 grow truncate" title={p.name}>{t(p.name)}</strong>{p.readonly && <span className="badge">{t('ui.v12_readonly_template')}</span>}<span className="text-[13px] text-muted">{unverified(p)} {t('ui.v12_unverified_fields')}</span><button type="button" className="ghost" onClick={() => go(`p/${p.id}`)}>{t('ui.v12_open')}</button></li>)}
        </ul>
        <button type="button" className="ghost self-start" onClick={() => go('me/platforms')}>{t('ui.v12_apps_entry')}</button>
      </Section>
      <Section title={t('ui.v12_data_sources')} testId="datasources">
        <div className="form-row">
          <label className="field"><span>{t('ui.v12_kind')}</span><select value={ds.kind} onChange={(e) => setDs({ ...ds, kind: e.target.value as DataSourceKind })} data-testid="ds-kind">{(Object.keys(DATA_SOURCE_TEXT) as DataSourceKind[]).map((k) => <option key={k} value={k}>{t(DATA_SOURCE_TEXT[k])}</option>)}</select></label>
          <label className="field"><span>{t('ui.v12_name')}</span><input value={ds.label} onChange={(e) => setDs({ ...ds, label: e.target.value })} data-testid="ds-label" /></label>
          <label className="field"><span>{t('ui.v12_url')}</span><input value={ds.url} onChange={(e) => setDs({ ...ds, url: e.target.value })} data-testid="ds-url" placeholder="https://" /></label>
        </div>
        {ds.kind === 'official_api' && <Note>{t('ui.v12_api_key_note')}</Note>}
        <button type="button" className="self-start" data-testid="ds-add" onClick={() => void run(async () => { const id = `ds-${Date.now().toString(36)}`; const x: DataSource = { id, kind: ds.kind, label: ds.label, url: ds.url || undefined, minIntervalMin: Number(ds.interval) || 60, mapping: ds.kind === 'csv' ? { 日期: 'date', 标题: 'title', 阅读: 'views', 点赞: 'likes' } : undefined, secretRef: ds.kind === 'official_api' ? `secret:${id}` : undefined, grants: [], enabled: true }; const errs = validateDataSource(x); if (errs.length) throw new Error(errs.join('；')); await updateState((s) => ({ ...s, dataSources: [...s.dataSources, x] })); setDs({ ...ds, label: '', url: '' }); }, 'ui.v12_saved')}>{t('ui.v12_add_source')}</button>
        {d.s.dataSources.map((x) => (
          <div key={x.id} className="flex flex-col gap-1 border-t border-line pt-2" data-testid={`ds-${x.id}`}>
            <Row><strong className="grow">{x.label}</strong><span className="text-[13px] text-muted">{t(DATA_SOURCE_TEXT[x.kind])}</span></Row>
            <Row>{d.agents.map((a) => <label key={a.id} className="flex min-h-11 items-center gap-1 text-[13px]"><input type="checkbox" checked={x.grants.includes(a.id)} onChange={(e) => void run(() => updateState((s) => ({ ...s, dataSources: s.dataSources.map((y) => (y.id === x.id ? grantDataSource(y, a.id, e.target.checked) : y)) })))} />{t(a.name)}</label>)}</Row>
          </div>
        ))}
      </Section>
      <Section title={t('ui.v12_external_tools')} testId="mcp">
        <Note>{t('ui.v12_mcp_note')}</Note>
        <div className="form-row">
          <label className="field"><span>{t('ui.v12_name')}</span><input value={mcp.name} onChange={(e) => setMcp({ ...mcp, name: e.target.value })} data-testid="mcp-name" /></label>
          <label className="field"><span>{t('ui.v12_mcp_url')}</span><input value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} data-testid="mcp-url" placeholder="https://…/mcp" /></label>
        </div>
        <button type="button" className="self-start" disabled={!mcp.url.trim()} data-testid="mcp-add" onClick={() => void run(async () => {
          const f: FetchLike = async (u, init) => { const r = await fetch(u, init); return { status: r.status, headers: r.headers, text: () => r.text() }; };
          const c = new McpClient(mcp.url.trim(), f); const version = await c.connect(); const tools = await c.listTools();
          const id = `mcp-${Date.now().toString(36)}`;
          const cfg = buildServerConfig({ id, name: mcp.name || String(c.serverInfo.name ?? 'MCP'), url: mcp.url.trim(), protocol: version, secretRef: `secret:${id}` }, tools);
          await updateState((s) => ({ ...s, mcpServers: [...s.mcpServers, cfg] }));
          await addApproval({ kind: 'external_tool', from: 'user', why: `启用外部工具服务器「${cfg.name}」（MCP ${version}）`, impact: `${tools.length} 个工具，其中 ${cfg.tools.filter((x) => x.verdict === 'rejected').length} 个因硬边界被拒；其余默认关闭，需逐个勾选`, estCost: null, preview: cfg.tools.map((x) => `${x.verdict === 'rejected' ? '✗' : x.verdict === 'confirm_each' ? '!' : '✓'} ${x.name}：${x.reason}`).join('\n'), payload: { action: 'enable_mcp', serverId: id } });
          setMcp({ name: '', url: '' });
        }, 'ui.v12_sent_to_inbox')}>{t('ui.v12_connect_list_tools')}</button>
        {d.s.mcpServers.map((m) => (
          <div key={m.id} className="flex flex-col gap-1 border-t border-line pt-2" data-testid={`mcp-${m.id}`}>
            <Row><strong className="grow">{m.name}</strong><span className="badge">{m.approved ? t(m.enabled ? 'ui.v12_enabled_short' : 'ui.v12_paused') : t('ui.v12_awaiting_approval')}</span><span className="text-[12px] text-muted">{m.protocol}</span></Row>
            {m.tools.map((x) => <label key={x.name} className="flex min-h-11 items-center gap-2 text-[13px]"><input type="checkbox" disabled={x.verdict === 'rejected'} checked={x.enabled} data-testid={`mcp-tool-${x.name}`} onChange={(e) => void run(() => updateState((s) => ({ ...s, mcpServers: s.mcpServers.map((y) => (y.id === m.id ? setToolEnabled(y, x.name, e.target.checked) : y)) })))} /><span className="min-w-0 grow">{x.name} · {x.level}</span><span className={x.verdict === 'rejected' ? 'text-warn' : 'text-muted'}>{t(x.verdict === 'rejected' ? 'ui.v12_rejected_boundary' : x.verdict === 'confirm_each' ? 'ui.v12_confirm_each' : 'ui.v12_read_only')}</span></label>)}
          </div>
        ))}
      </Section>
      <Section title={t('ui.v12_a2a')} testId="a2a">
        <Note>{t(flagOn('a2a.client', d.flags) ? 'ui.v12_a2a_on' : 'ui.v12_a2a_off')}</Note>
        {flagOn('a2a.client', d.flags) && <>
          <label className="field"><span>{t('ui.v12_a2a_url')}</span><input value={a2a} onChange={(e) => setA2a(e.target.value)} data-testid="a2a-url" placeholder="https://agent.example.com" /></label>
          <button type="button" className="self-start" disabled={!a2a.trim()} data-testid="a2a-add" onClick={() => void run(async () => { const r = await fetchAgentCard(a2a.trim(), (u, i) => fetch(u, i).then((x) => ({ status: x.status, text: () => x.text() }))); if (!r.ok) throw new Error(r.errors.join('；')); const id = `ext-${Date.now().toString(36)}`; const ref = newA2ARef(id, r.url, r.card, { secretRef: `secret:${id}` }); await updateState((s) => ({ ...s, a2aAgents: [...s.a2aAgents, ref] })); await addApproval({ kind: 'external_tool', from: 'user', why: `添加外部 Agent「${r.card.name}」（A2A）`, impact: '调用属 L2，额度 ¥3/月', estCost: null, preview: JSON.stringify(r.card, null, 1).slice(0, 3000), payload: { action: 'enable_a2a', refId: id } }); setA2a(''); }, 'ui.v12_sent_to_inbox')}>{t('ui.v12_read_agent_card')}</button>
        </>}
        {d.s.a2aAgents.map((x) => <p key={x.id} className="m-0 text-[13px]" data-testid={`a2a-${x.id}`}>{x.name} · {t(x.approved ? 'ui.v12_enabled_short' : 'ui.v12_awaiting_approval')}</p>)}
      </Section>
    </>
  );
}
