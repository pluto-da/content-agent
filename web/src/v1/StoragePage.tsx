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
  if (error) return <div className="page page-narrow"><Problem title={t('读取存储信息失败')} advice={error} action={t('重试')} onAction={reload} /></div>;
  if (!rep) return <div className="page page-narrow" data-testid="storage-page" aria-busy="true"><Note>{t('正在统计…')}</Note></div>;
  const used = rep.media.total, q = rep.quota.quotaBytes;
  const pctUsed = Math.min(100, Math.round((used / q) * 100));
  const clean = async () => {
    if (!rep.plan.remove.length) return;
    if (!window.confirm(`${t('将删除')} ${rep.plan.remove.length} ${t('个最旧的媒体文件')}（${fmtBytes(rep.plan.freed)}）。${t('被草稿或对话用到的、最近几天的、标了保留的不会删。确定吗？')}`)) return;
    setBusy(true); try { const r = await runCleanup({ actor: 'user' }); show(`${t('已清理')} ${r.removed} ${t('个')}，${t('释放')} ${fmtBytes(r.freed)}`); reload(); } finally { setBusy(false); }
  };
  const prune = async () => {
    const n = (vers ?? []).reduce((s, f) => s + f.dropCount, 0);
    if (!n || !window.confirm(`${t('将删除')} ${n} ${t('个旧版本')}。${t('根系统文件与技能的版本永久保留，不受影响。确定吗？')}`)) return;
    setBusy(true); try { const r = await pruneVersions(); show(`${t('已修剪')} ${r.versions} ${t('个版本')}（${fmtBytes(r.bytes)}）`); reloadVers(); } finally { setBusy(false); }
  };
  const files = (vers ?? []).filter((f) => showAll || f.dropCount > 0 || f.versions.length > 3);
  const dropTotal = (vers ?? []).reduce((s, f) => s + f.dropCount, 0);
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="storage-page">
      {toast}
      <Section title={t('媒体配额')} testId="storage-media">
        <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] text-muted">{rep.media.count} {t('个媒体文件')}</span><strong className="tabular-nums text-[18px]" data-testid="storage-used">{fmtBytes(used)} / {fmtBytes(q)}</strong></div>
        <div className="v1-meter" role="progressbar" aria-label={t('媒体配额用量')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctUsed}><span style={{ width: `${pctUsed}%` }} data-tone={pctUsed >= 100 ? 'bad' : pctUsed >= 80 ? 'warn' : 'ok'} /></div>
        <div className="v1-bars" data-testid="storage-kinds">
          {Object.entries(rep.media.byKind).map(([k, v]) => <div key={k} className="v1-bar"><span>{t(KIND[k] ?? k)} · {v.count}</span><span className="tabular-nums">{fmtBytes(v.bytes)}</span><div className="v1-meter" aria-hidden="true"><span style={{ width: `${used ? Math.round((v.bytes / used) * 100) : 0}%` }} /></div></div>)}
        </div>
        {rep.estimate.usage !== undefined && <Note>{t('本应用在这台设备上共占用')} {fmtBytes(rep.estimate.usage)}{rep.estimate.quota ? `（${t('浏览器允许')} ${fmtBytes(rep.estimate.quota)}）` : ''} · {rep.estimate.persisted ? t('已申请持久保存') : t('未申请持久保存')}</Note>}
        <Note tone={rep.plan.over ? 'warn' : 'ok'}>{rep.plan.over ? `${t('超出配额。可清理')} ${rep.plan.remove.length} ${t('个最旧的文件')}（${fmtBytes(rep.plan.freed)}）；${t('受保护')} ${fmtBytes(rep.plan.protectedBytes)}${rep.plan.reason === 'all_protected' ? `，${t('剩下的都受保护')}` : ''}` : `${t('在配额内。受保护（被草稿 / 对话用到、最近')} ${rep.quota.keepDays} ${t('天、标了保留）')} ${fmtBytes(rep.plan.protectedBytes)}`}</Note>
        <div className="form-row">
          <label className="field"><span>{t('配额')}</span><select value={String(Math.round(q / MB))} onChange={async (e) => { await saveQuota({ quotaBytes: Number(e.target.value) * MB }); reload(); }} data-testid="storage-quota">{QUOTAS.map((m) => <option key={m} value={m}>{fmtBytes(m * MB)}</option>)}</select></label>
          <label className="field"><span>{t('最近几天的不清理')}</span><select value={String(rep.quota.keepDays)} onChange={async (e) => { await saveQuota({ keepDays: Number(e.target.value) }); reload(); }} data-testid="storage-keepdays">{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} {t('天')}</option>)}</select></label>
        </div>
        <label className="list-row cursor-pointer"><input type="checkbox" checked={rep.quota.autoClean} onChange={async (e) => { await saveQuota({ autoClean: e.target.checked }); reload(); }} data-testid="storage-auto" /><span className="row-text"><span className="row-label">{t('超出配额时自动清理')}</span><span className="row-hint">{t('默认关闭：只提醒，等你在这里确认。打开后，清理任务每 6 小时检查一次，按上面的规则删最旧的。')}</span></span></label>
        {last && <Note>{t('清理任务上次检查')}：{last.at.slice(0, 16).replace('T', ' ')} · {last.note}</Note>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="primary" disabled={busy || !rep.plan.remove.length} onClick={() => void clean()} data-testid="storage-clean">{t('立即清理')}</button>
          <button type="button" disabled={busy} onClick={async () => { const r = await cleanupTick(); show(r.note); }} data-testid="storage-check">{t('立即检查')}</button>
          {!rep.estimate.persisted && <button type="button" className="ghost" onClick={async () => show((await requestPersist()) ? t('已申请持久保存') : t('浏览器没有同意持久保存'))}>{t('申请持久保存')}</button>}
        </div>
      </Section>
      <Section title={t('设定文件版本')} testId="storage-versions" actions={<button type="button" className="ghost" onClick={() => setShowAll((x) => !x)} aria-pressed={showAll}>{showAll ? t('只看可修剪的') : t('显示全部文件')}</button>}>
        <Note>{t('规则：根系统文件与技能的版本永久保留；其他文件保留最近 20 版，以及 90 天内的全部版本。')}</Note>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted" aria-hidden="true"><span><i className="v1-ver" data-forever="1" />{t('永久保留')}</span><span><i className="v1-ver" />{t('保留')}</span><span><i className="v1-ver" data-drop="1" />{t('可修剪')}</span></div>
        {!files.length && <EmptyState icon="check" title={t('没有可修剪的旧版本')} why={t('改动多了以后，这里会显示哪些旧版本可以删。')} />}
        {!!files.length && <ul className="item-list" data-testid="storage-files">{files.slice(0, 60).map((f) => (
          <li key={f.path}><span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="item-title !text-[14px] break-all">{f.path}</span>
            <span className="flex flex-wrap" role="img" aria-label={`${f.path}：${f.versions.length} ${t('个版本')}，${t('可修剪')} ${f.dropCount}`}>{f.versions.slice(-60).map((v) => <i key={v.version} className="v1-ver" data-drop={v.drop ? '1' : undefined} data-forever={f.forever ? '1' : undefined} title={`v${v.version} · ${v.updated.slice(0, 10)} · ${fmtBytes(v.size)}`} />)}</span>
            <span className="item-meta">{f.versions.length} {t('个版本')} · {fmtBytes(f.totalBytes)}{f.dropCount ? ` · ${t('可修剪')} ${f.dropCount}（${fmtBytes(f.dropBytes)}）` : ''}{f.forever ? ` · ${t('永久保留')}` : ''}</span>
          </span></li>
        ))}</ul>}
        <button type="button" className="self-start" disabled={busy || !dropTotal} onClick={() => void prune()} data-testid="storage-prune">{t('按规则修剪')}{dropTotal ? `（${dropTotal}）` : ''}</button>
      </Section>
    </div>
  );
}
