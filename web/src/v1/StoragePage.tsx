/**
 * 1.0 “我的 → 存储”：媒体配额（用量条、按类型、受保护多少、可清理多少）+ 清理任务状态 + 立即清理（先确认）；
 * 设定文件版本修剪可视化（每个文件一排小方块：绿色 = 永久保留，蓝色 = 保留，灰色虚线 = 按规则可修剪）+ 按规则修剪（先确认）。
 */
import { useState } from 'react';
import { useT } from '../i18n';
import { Problem, useToast, EmptyState } from '../ui';
import { useAsync, Section, Note } from '../pages/me/v9/common';
import { storageReport, runCleanup, saveQuota, versionPreview, pruneVersions, requestPersist, cleanupTick, type TaskResult } from '../v9/media/store';
import { fmtBytes, MB } from '../v9/media/policy';
import { db } from '../local/db';

const KIND: Record<string, string> = { image: '图片', audio: '音频', video: '视频' };
const QUOTAS = [256, 512, 1024, 2048, 4096];

export function StoragePage() {
  const { t } = useT();
  const { data: rep, error, reload } = useAsync(() => storageReport(), ['media', 'kv:media.quota', 'kv:media.index']);
  const { data: last } = useAsync(() => db.getKV<TaskResult>('media.lastTask'), ['kv:media.lastTask']);
  const { data: vers, reload: reloadVers } = useAsync(() => versionPreview(), ['kv:vfs_versions']);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const [showAll, setShowAll] = useState(false);
  if (error) return <div className="page page-narrow"><Problem title={t('ui.failed_to_read_storage_info')} advice={error} action={t('ui.retry')} onAction={reload} /></div>;
  if (!rep) return <div className="page page-narrow" data-testid="storage-page" aria-busy="true"><Note>{t('ui.counting')}</Note></div>;
  const used = rep.media.total, q = rep.quota.quotaBytes;
  const pctUsed = Math.min(100, Math.round((used / q) * 100));
  const clean = async () => {
    if (!rep.plan.remove.length) return;
    if (!window.confirm(`${t('ui.will_delete')} ${rep.plan.remove.length} ${t('ui.oldest_media_files')}（${fmtBytes(rep.plan.freed)}）。${t('ui.media_used_by_drafts_or')}`)) return;
    setBusy(true); try { const r = await runCleanup({ actor: 'user' }); show(`${t('ui.cleaned')} ${r.removed} ${t('ui.items')}，${t('ui.freed')} ${fmtBytes(r.freed)}`); reload(); } finally { setBusy(false); }
  };
  const prune = async () => {
    const n = (vers ?? []).reduce((s, f) => s + f.dropCount, 0);
    if (!n || !window.confirm(`${t('ui.will_delete')} ${n} ${t('ui.old_versions')}。${t('ui.versions_of_root_system_files')}`)) return;
    setBusy(true); try { const r = await pruneVersions(); show(`${t('ui.pruned')} ${r.versions} ${t('ui.versions')}（${fmtBytes(r.bytes)}）`); reloadVers(); } finally { setBusy(false); }
  };
  const files = (vers ?? []).filter((f) => showAll || f.dropCount > 0 || f.versions.length > 3);
  const dropTotal = (vers ?? []).reduce((s, f) => s + f.dropCount, 0);
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="storage-page">
      {toast}
      <Section title={t('ui.media_quota')} testId="storage-media">
        <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] text-muted">{rep.media.count} {t('ui.media_files')}</span><strong className="tabular-nums text-[18px]" data-testid="storage-used">{fmtBytes(used)} / {fmtBytes(q)}</strong></div>
        <div className="v1-meter" role="progressbar" aria-label={t('ui.media_quota_usage')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctUsed}><span style={{ width: `${pctUsed}%` }} data-tone={pctUsed >= 100 ? 'bad' : pctUsed >= 80 ? 'warn' : 'ok'} /></div>
        <div className="v1-bars" data-testid="storage-kinds">
          {Object.entries(rep.media.byKind).map(([k, v]) => <div key={k} className="v1-bar"><span>{t(KIND[k] ?? k)} · {v.count}</span><span className="tabular-nums">{fmtBytes(v.bytes)}</span><div className="v1-meter" aria-hidden="true"><span style={{ width: `${used ? Math.round((v.bytes / used) * 100) : 0}%` }} /></div></div>)}
        </div>
        {rep.estimate.usage !== undefined && <Note>{t('ui.total_space_this_app_uses')} {fmtBytes(rep.estimate.usage)}{rep.estimate.quota ? `（${t('ui.browser_allows')} ${fmtBytes(rep.estimate.quota)}）` : ''} · {rep.estimate.persisted ? t('ui.persistent_storage_granted') : t('ui.persistent_storage_not_requested')}</Note>}
        <Note tone={rep.plan.over ? 'warn' : 'ok'}>{rep.plan.over ? `${t('ui.over_quota_can_clean')} ${rep.plan.remove.length} ${t('ui.oldest_files')}（${fmtBytes(rep.plan.freed)}）；${t('ui.protected')} ${fmtBytes(rep.plan.protectedBytes)}${rep.plan.reason === 'all_protected' ? `，${t('ui.the_rest_are_all_protected')}` : ''}` : `${t('ui.within_quota_protected_used_by')} ${rep.quota.keepDays} ${t('ui.days_kept')} ${fmtBytes(rep.plan.protectedBytes)}`}</Note>
        <div className="form-row">
          <label className="field"><span>{t('ui.quota')}</span><select value={String(Math.round(q / MB))} onChange={async (e) => { await saveQuota({ quotaBytes: Number(e.target.value) * MB }); reload(); }} data-testid="storage-quota">{QUOTAS.map((m) => <option key={m} value={m}>{fmtBytes(m * MB)}</option>)}</select></label>
          <label className="field"><span>{t('ui.dont_clean_items_from_the')}</span><select value={String(rep.quota.keepDays)} onChange={async (e) => { await saveQuota({ keepDays: Number(e.target.value) }); reload(); }} data-testid="storage-keepdays">{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} {t('ui.days')}</option>)}</select></label>
        </div>
        <label className="list-row cursor-pointer"><input type="checkbox" checked={rep.quota.autoClean} onChange={async (e) => { await saveQuota({ autoClean: e.target.checked }); reload(); }} data-testid="storage-auto" /><span className="row-text"><span className="row-label">{t('ui.clean_automatically_when_over_quota')}</span><span className="row-hint">{t('ui.off_by_default_only_reminds')}</span></span></label>
        {last && <Note>{t('ui.cleanup_task_last_checked')}：{last.at.slice(0, 16).replace('T', ' ')} · {last.note}</Note>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="primary" disabled={busy || !rep.plan.remove.length} onClick={() => void clean()} data-testid="storage-clean">{t('ui.clean_now')}</button>
          <button type="button" disabled={busy} onClick={async () => { const r = await cleanupTick(); show(r.note); }} data-testid="storage-check">{t('ui.check_now')}</button>
          {!rep.estimate.persisted && <button type="button" className="ghost" onClick={async () => show((await requestPersist()) ? t('ui.persistent_storage_granted') : t('ui.the_browser_didnt_grant_persistent'))}>{t('ui.request_persistent_storage')}</button>}
        </div>
      </Section>
      <Section title={t('ui.settings_file_versions')} testId="storage-versions" actions={<button type="button" className="ghost" onClick={() => setShowAll((x) => !x)} aria-pressed={showAll}>{showAll ? t('ui.show_prunable_only') : t('ui.show_all_files')}</button>}>
        <Note>{t('ui.rule_versions_of_root_system')}</Note>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted" aria-hidden="true"><span><i className="v1-ver" data-forever="1" />{t('ui.kept_forever')}</span><span><i className="v1-ver" />{t('ui.keep')}</span><span><i className="v1-ver" data-drop="1" />{t('ui.prunable')}</span></div>
        {!files.length && <EmptyState icon="check" title={t('ui.no_old_versions_to_prune')} why={t('ui.after_more_edits_old_versions')} />}
        {!!files.length && <ul className="item-list" data-testid="storage-files">{files.slice(0, 60).map((f) => (
          <li key={f.path}><span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="item-title !text-[14px] break-all">{f.path}</span>
            <span className="flex flex-wrap" role="img" aria-label={`${f.path}：${f.versions.length} ${t('ui.versions')}，${t('ui.prunable')} ${f.dropCount}`}>{f.versions.slice(-60).map((v) => <i key={v.version} className="v1-ver" data-drop={v.drop ? '1' : undefined} data-forever={f.forever ? '1' : undefined} title={`v${v.version} · ${v.updated.slice(0, 10)} · ${fmtBytes(v.size)}`} />)}</span>
            <span className="item-meta">{f.versions.length} {t('ui.versions')} · {fmtBytes(f.totalBytes)}{f.dropCount ? ` · ${t('ui.prunable')} ${f.dropCount}（${fmtBytes(f.dropBytes)}）` : ''}{f.forever ? ` · ${t('ui.kept_forever')}` : ''}</span>
          </span></li>
        ))}</ul>}
        <button type="button" className="self-start" disabled={busy || !dropTotal} onClick={() => void prune()} data-testid="storage-prune">{t('ui.prune_by_rule')}{dropTotal ? `（${dropTotal}）` : ''}</button>
      </Section>
    </div>
  );
}
