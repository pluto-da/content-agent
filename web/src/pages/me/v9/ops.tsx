/**
 * 0.9.0 企业级运维页：运行状态（modelStats）、审计日志（listAudit：筛选 + 导出 CSV / JSONL）、设置（花钱阈值、实验开关、Key 共用方式）、本机提醒、备份（zip，永不含 Key）。
 * 所有失败都显示“原因 + 下一步”。
 */
import { useState } from 'react';
import { FLAGS, flagOn, AUDIT_KIND_LABEL, parseWhenZh, shDateTime, type AuditKind, type AuditFilter, type FlagOverrides } from '@content-agent/shared';
import { useT, tr } from '../../../i18n';
import { modelStats, listAudit, auditToCsv, auditToJsonl, audit } from '../../../v9/ops';
import { exportBackup, restoreBackup, rollbackRestore, migrateLegacyBackup, BackupReadError } from '../../../v9/backup';
import { listReminders, addReminder, cancelReminder, tick } from '../../../v9/reminders';
import { doctorReport } from '../../../v9/vfsBackend';
import { getPrefs, setPrefs, getModelsV3, saveModelsV3 } from '../../../local/store';
import { post } from '../../../api';
import { GroupList, Problem, useToast, EmptyState, StatusDot, Busy } from '../../../ui';
import { useAsync, Section, Note, download, fmtTime, pct, SegTabs } from './common';
import { Diagnostics, NotifySection } from '../../../v10/Diagnostics';
import { CardGallery } from '../../../v10/CardGallery';
import { SpendGuardSection } from '../../../v1/SpendGuard';

/* ---------------- 运行状态 ---------------- */
export function StatusPage({ go, id }: { go: (to: string) => void; id?: string | null }) {
  if (id === 'cards') return <CardGallery go={go} />;
  return <StatusMain go={go} />;
}
/** 1.1.0：运行详情只讲健康、延迟、错误与缓存；花费只在“花钱”页显示（这里给链接）。 */
export function StatusMain({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const { data, error, reload } = useAsync(() => modelStats(Number(days)), ['usage_log'], [days]);
  const doc = doctorReport();
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="status-page">
      <SegTabs value={days} onChange={setDays} label={t('ui.time_range')} options={[['1', '今天'], ['7', '近 7 天'], ['30', '近 30 天']]} />
      {error && <Problem title={t('ui.failed_to_read_run_data')} advice={error} action={t('ui.retry')} onAction={reload} />}
      {data && <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }} data-testid="status-totals">
        {[[t('ui.calls_2'), String(data.totals.calls)], [t('ui.error_rate'), pct(data.totals.errorRate)], [t('ui.cache_hits'), pct(data.totals.cacheRate)]].map(([k, v]) => <div key={k} className="stat"><span className="text-[13px] text-muted">{k}</span><strong className="text-[22px] tabular-nums">{v}</strong></div>)}
      </div>}
      {data && !data.stats.length && <div className="card !p-0"><EmptyState icon="activity" title={t('ui.no_calls_yet')} why={t('ui.chats_try_it_and_connection')} action={t('ui.connect_a_model')} onAction={() => go('me/models')} /></div>}
      {!!data?.stats.length && (
        <ul className="item-list" data-testid="status-models">
          {data.stats.map((s) => (
            <li key={s.key}>
              <StatusDot tone={!s.healthy ? 'bad' : s.errorRate > 0.2 ? 'warn' : 'ok'}>{s.healthy ? t('ui.healthy') : t('ui.unstable')}</StatusDot>
              <span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px] break-all">{s.model} · {s.vendor} · {t(s.role)}</span>
                <span className="item-meta">{s.calls} {t('ui.calls')} · p50 {(s.p50 / 1000).toFixed(1)}s · p95 {(s.p95 / 1000).toFixed(1)}s · {t('ui.cache_hits')} {pct(s.cacheRate)} · {t('ui.error_rate')} {pct(s.errorRate)}{s.lastError ? ` · ${t('ui.last_error')} ${s.lastError}` : ''}</span></span>
            </li>
          ))}
        </ul>
      )}
      <Section title={t('ui.settings_file_self_check')}>
        <Note tone={doc && doc.problems.filter((p) => !p.fixed).length ? 'warn' : 'ok'}>{doc ? `${doc.files} ${t('ui.files_2')} · ${doc.folders} ${t('ui.folders')} · ${t('ui.question')} ${doc.problems.filter((p) => !p.fixed).length}（${t('ui.auto_fixed')} ${doc.fixed}）` : t('ui.self_check_runs_once_after')}</Note>
      </Section>
      <Note>{t('ui.health_routing_when_the_default')}</Note>
      <button type="button" className="ghost self-start" onClick={() => go('me/spend')} data-testid="status-cost-link">{t('ui.see_spending')} ›</button>
      <Diagnostics />
    </div>
  );
}

/* ---------------- 审计日志 ---------------- */
export function AuditPage({ initialKind = '', kinds: fixedKinds, outcome }: { initialKind?: AuditKind | ''; kinds?: AuditKind[]; outcome?: 'failed' } = {}) {
  const { t } = useT();
  const [kind, setKind] = useState<AuditKind | ''>(initialKind);
  const [actor, setActor] = useState<'' | 'user' | 'agent' | 'system'>('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const f: AuditFilter = { ...(outcome ? { outcome } : {}), ...(kind ? { kinds: [kind] } : fixedKinds ? { kinds: fixedKinds } : {}), ...(actor ? { actor } : {}), ...(text.trim() ? { text: text.trim() } : {}), ...(from ? { from: `${from}T00:00:00` } : {}) };
  const { data, error, reload } = useAsync(() => listAudit(f), ['audit'], [kind, actor, text, from, (fixedKinds ?? []).join()]);
  const exp = async (fmt: 'csv' | 'jsonl') => {
    const list = data ?? [];
    download(`audit-${new Date().toISOString().slice(0, 10)}.${fmt}`, fmt === 'csv' ? `\uFEFF${auditToCsv(list)}` : auditToJsonl(list), fmt === 'csv' ? 'text/csv' : 'application/x-ndjson');
    await audit({ kind: 'export', actor: 'user', summary: `导出审计日志 ${list.length} 条（${fmt.toUpperCase()}，已打码）`, outcome: 'ok' });
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="audit-page">
      <Note>{t('ui.records_tool_calls_approvals_spend')}</Note>
      <div className="form-row">
        <label className="field"><span>{t('ui.type')}</span><select value={kind} onChange={(e) => setKind(e.target.value as AuditKind | '')} data-testid="audit-kind"><option value="">{t('ui.all')}</option>{(Object.keys(AUDIT_KIND_LABEL) as AuditKind[]).map((k) => <option key={k} value={k}>{t(AUDIT_KIND_LABEL[k])}</option>)}</select></label>
        <label className="field"><span>{t('ui.who')}</span><select value={actor} onChange={(e) => setActor(e.target.value as typeof actor)}><option value="">{t('ui.all')}</option><option value="user">{t('ui.you')}</option><option value="agent">Agent</option><option value="system">{t('ui.system_2')}</option></select></label>
        <label className="field"><span>{t('ui.start_date')}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </div>
      <input placeholder={t('ui.search_summaries')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('ui.search_summaries')} />
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void exp('csv')} data-testid="audit-csv">{t('ui.export_csv')}</button><button type="button" onClick={() => void exp('jsonl')}>{t('ui.export_jsonl')}</button></div>
      {error && <Problem title={t('ui.failed_to_read_the_audit')} advice={error} action={t('ui.retry')} onAction={reload} />}
      {data && !data.length && <div className="card !p-0"><EmptyState icon="shield" title={t('ui.no_matching_records')} why={t('ui.try_other_filters_or_use')} /></div>}
      {!!data?.length && <ul className="item-list" data-testid="audit-list">{data.slice(0, 300).map((e, i) => (
        <li key={`${e.at}-${i}`}><StatusDot tone={e.outcome === 'failed' ? 'bad' : e.outcome === 'denied' ? 'warn' : 'ok'}>{t(AUDIT_KIND_LABEL[e.kind])}</StatusDot><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{e.summary}</span><span className="item-meta">{fmtTime(e.at)} · {e.actor}{e.tool ? ` · ${e.tool}` : ''}{e.cost ? ` · ¥${e.cost.toFixed(3)}` : ''}</span></span></li>
      ))}</ul>}
    </div>
  );
}

/* ---------------- 设置：花钱阈值、实验开关、Key 共用方式 ---------------- */
export function SettingsV9Page({ part = 'all' }: { part?: 'all' | 'spend' | 'flags' } = {}) {
  const { t } = useT();
  const { data: prefs, reload } = useAsync(getPrefs, ['kv:prefs']);
  const [perCall, setPerCall] = useState<string | null>(null);
  const [perDay, setPerDay] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  if (!prefs) return null;
  const ov: FlagOverrides = prefs.flags ?? {};
  const spend = prefs.spend ?? { perCallConfirmYuan: 1, perDayConfirmYuan: 10 };
  const saveSpend = async () => {
    setErr(null);
    const a = Number(perCall ?? spend.perCallConfirmYuan), b = Number(perDay ?? spend.perDayConfirmYuan);
    if (!(a >= 0 && a <= 1000) || !(b >= 0 && b <= 10000)) { setErr(t('ui.per_call_0_1000_per')); return; }
    await setPrefs({ spend: { perCallConfirmYuan: a, perDayConfirmYuan: b } });
    const m = await getModelsV3(); m.budget = { ...m.budget, perCallConfirmYuan: a, perDayConfirmYuan: b }; await saveModelsV3(m);
    await audit({ kind: 'setting_change', actor: 'user', summary: `花钱确认线：单次 ¥${a}、当日 ¥${b}`, outcome: 'ok' });
    setPerCall(null); setPerDay(null); show(t('ui.saved_applies_to_the_next_2'));
  };
  const setFlag = async (id: string, on: boolean) => { await setPrefs({ flags: { ...(prefs.flags ?? {}), [id]: on } }); await audit({ kind: 'flag_change', actor: 'user', summary: `${on ? '打开' : '关闭'}实验功能 ${id}`, outcome: 'ok' }); reload(); };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="settings-v9">
      {toast}
      {part !== 'flags' && <><Section title={t('ui.ask_before_spending')} testId="spend">
        <div className="form-row">
          <label className="field"><span>{t('ui.per_call_estimate_reaches')}</span><input inputMode="decimal" value={perCall ?? String(spend.perCallConfirmYuan)} onChange={(e) => setPerCall(e.target.value)} data-testid="spend-call" /></label>
          <label className="field"><span>{t('ui.daily_total_reaches')}</span><input inputMode="decimal" value={perDay ?? String(spend.perDayConfirmYuan)} onChange={(e) => setPerDay(e.target.value)} data-testid="spend-day" /></label>
        </div>
        <label className="list-row static"><input type="checkbox" checked disabled aria-label={t('ui.confirm_video_every_time')} /><span className="row-text"><span className="row-label">{t('ui.always_ask_before_video')}</span><span className="row-hint">{t('ui.video_is_expensive_so_the')}</span></span></label>
        {err && <Problem title={err} advice={t('ui.fix_it_then_save')} />}
        <button type="button" className="primary self-start" onClick={() => void saveSpend()} data-testid="spend-save">{t('ui.save')}</button>
      </Section>
      <SpendGuardSection /></>}

      {part !== 'spend' && <><GroupList title={t('ui.experimental_features')}>
        {FLAGS.list().map((f) => (
          <li key={f.id}><label className={`list-row ${f.stage === 'reserved' ? 'static' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={flagOn(f.id, ov)} disabled={f.stage === 'reserved'} onChange={(e) => void setFlag(f.id, e.target.checked)} aria-label={f.label} data-testid={`flag-${f.id}`} />
            <span className="row-text"><span className="row-label">{t(f.label)}{f.stage !== 'stable' ? ` · ${t({ beta: '测试版', experimental: '实验', reserved: '预留，暂未开放' }[f.stage])}` : ''}</span><span className="row-hint">{t(f.description)}</span></span>
          </label></li>
        ))}
      </GroupList>
      <Note>{t('ui.switches_cant_relax_hard_boundaries')}</Note></>}
    </div>
  );
}

/* ---------------- 本机提醒 ---------------- */
export function RemindersPage() {
  const { t } = useT();
  const { data, reload } = useAsync(listReminders, ['reminders']);
  const [text, setText] = useState('');
  const [when, setWhen] = useState(() => tr('ui.reminder_default_when'));
  const [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  const add = async () => {
    setErr(null);
    const w = parseWhenZh(when, new Date());
    if (!text.trim()) { setErr(t('ui.write_what_to_be_reminded')); return; }
    if (!w?.at) { setErr(`${t('ui.couldnt_understand_the_time')}“${when}”`); return; }
    await addReminder({ text: text.trim(), at: w.at.toISOString(), rrule: w.rrule });
    setText(''); show(`${t('ui.set')}：${shDateTime(w.at)}`);
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="reminders-page">
      {toast}
      <Note>{t('ui.reminders_only_show_local_notifications')}</Note>
      <NotifySection compact />
      <Section title={t('ui.new_reminder')}>
        <label className="field !m-0"><span>{t('ui.remind_me_about')}</span><input value={text} onChange={(e) => setText(e.target.value)} data-testid="rem-text" /></label>
        <label className="field !m-0"><span>{t('ui.when_e_g_9_am')}</span><input value={when} onChange={(e) => setWhen(e.target.value)} data-testid="rem-when" /></label>
        {err && <Problem title={err} advice={t('ui.try_another_wording_e_g')} />}
        <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void add()} data-testid="rem-add">{t('ui.set_reminder')}</button><button type="button" onClick={async () => { const n = await tick(); show(n ? `${t('ui.reminded')} ${n} ${t('ui.items_2')}` : t('ui.no_reminders_due_right_now')); reload(); }}>{t('ui.check_now')}</button></div>
      </Section>
      {data && !data.length && <div className="card !p-0"><EmptyState icon="bell" title={t('ui.no_reminders_yet')} why={t('ui.you_can_also_say_remind')} /></div>}
      {!!data?.length && <ul className="item-list" data-testid="rem-list">{data.map((r) => (
        <li key={r.id}><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{r.text}</span><span className="item-meta flex flex-wrap items-center gap-x-1"><StatusDot tone={r.status === 'scheduled' ? 'ok' : 'neutral'}>{t({ scheduled: '待提醒', fired: '已提醒', cancelled: '已取消' }[r.status])}</StatusDot><span>{r.at ? fmtTime(r.at) : ''}{r.rrule ? ` · ${t('ui.repeat')}` : ''}</span></span></span>{r.status === 'scheduled' && <button type="button" className="ghost" onClick={async () => { await cancelReminder(r.id); reload(); }}>{t('ui.cancel')}</button>}</li>
      ))}</ul>}
    </div>
  );
}

/* ---------------- 备份与恢复（zip，ADR-003/004） ---------------- */
export function BackupV9Page() {
  const { t } = useT();
  const [media, setMedia] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<{ message: string; advice?: string } | null>(null);
  const [snap, setSnap] = useState(false);
  const doExport = async () => {
    setErr(null); setMsg(''); setBusy('export');
    try { const z = await exportBackup({ includeMedia: media }); download(`super-workbench-backup-${new Date().toISOString().slice(0, 10)}.zip`, z, 'application/zip'); setMsg(t('ui.exported_no_keys')); }
    catch (e) { setErr({ message: (e as Error).message, advice: t(e instanceof BackupReadError ? 'ui.export_local_db_read_failed' : 'ui.export_is_blocked_if_something') }); }
    finally { setBusy(null); }
  };
  const doImport = async (f: File) => {
    setErr(null); setMsg(''); setBusy('import');
    try {
      if (/\.json$/i.test(f.name)) {   // 0.6–0.8 的 JSON 备份：前滚后交给旧接口恢复业务数据
        const doc = migrateLegacyBackup(JSON.parse(await f.text()));
        const r = await post<{ restored?: number }>('/api/backup/import', doc);
        setMsg(`${t('ui.restored_legacy_backup')} ${r.restored ?? ''} ${t('ui.records')}；${t('ui.key_needs_to_be_re')}`); return;
      }
      const r = await restoreBackup(new Uint8Array(await f.arrayBuffer()));
      if (r.errors.length) { setErr({ message: t('ui.backup_file_failed_verification'), advice: r.errors.slice(0, 3).join('；') }); return; }
      setSnap(r.snapshot);
      setMsg(`${t('ui.restored')}：${t('ui.files')} ${r.restored.files}、${t('ui.datasets')} ${r.restored.collections}、${t('ui.settings')} ${r.restored.kv}。${t('ui.key_needs_to_be_re')}`);
    } catch (e) { setErr({ message: t('ui.cant_read_the_file'), advice: `${t('ui.choose_a_zip_backup_exported')}（${(e as Error).message}）` }); }
    finally { setBusy(null); }
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="backup-v9">
      <Note>{t('ui.data_lives_only_on_this')}</Note>
      <GroupList title={t('ui.export')}>
        <li><label className="list-row cursor-pointer"><input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} aria-label={t('ui.includes_generated_images_and_audio')} /><span className="row-text"><span className="row-label">{t('ui.includes_generated_images_and_audio')}</span><span className="row-hint">{t('ui.files_get_larger_by_default')}</span></span></label></li>
        <li><button type="button" className="list-row" onClick={() => void doExport()} disabled={!!busy} data-testid="export-zip"><span className="row-text"><span className="row-label">{busy === 'export' ? <Busy label={t('ui.packing')} /> : t('ui.export_backup_zip')}</span><span className="row-hint">{t('ui.includes_manifest_and_per_file')}</span></span></button></li>
      </GroupList>
      <GroupList title={t('ui.restore')}>
        <li><label className="list-row cursor-pointer"><span className="row-text"><span className="row-label">{busy === 'import' ? <Busy label={t('ui.restoring')} /> : t('ui.restore_from_backup')}</span><span className="row-hint">{t('ui.a_snapshot_of_current_data')}</span></span><input type="file" accept=".zip,application/zip,.json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); }} data-testid="import-file" /></label></li>
        {snap && <li><button type="button" className="list-row" onClick={async () => setMsg((await rollbackRestore()) ? t('ui.back_to_the_state_before') : t('ui.no_snapshot_to_roll_back'))}><span className="row-text"><span className="row-label">{t('ui.undo_this_restore')}</span></span></button></li>}
      </GroupList>
      {msg && <p className="ok-line m-0" role="status" data-testid="backup-msg">{msg}</p>}
      {err && <Problem title={err.message} advice={err.advice} />}
    </div>
  );
}
