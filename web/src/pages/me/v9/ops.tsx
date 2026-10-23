/**
 * 0.9.0 企业级运维页：运行状态（modelStats）、审计日志（listAudit：筛选 + 导出 CSV / JSONL）、设置（花钱阈值、实验开关、Key 共用方式）、本机提醒、备份（zip，永不含 Key）。
 * 所有失败都显示“原因 + 下一步”。
 */
import { useState } from 'react';
import { FLAGS, flagOn, AUDIT_KIND_LABEL, parseWhenZh, shDateTime, type AuditKind, type AuditFilter, type FlagOverrides } from '@content-agent/shared';
import { useT } from '../../../i18n';
import { modelStats, listAudit, auditToCsv, auditToJsonl, audit } from '../../../v9/ops';
import { exportBackup, restoreBackup, rollbackRestore, migrateLegacyBackup } from '../../../v9/backup';
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
function StatusMain({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const { data, error, reload } = useAsync(() => modelStats(Number(days)), ['usage_log'], [days]);
  const doc = doctorReport();
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="status-page">
      <SegTabs value={days} onChange={setDays} label={t('时间范围')} options={[['1', '今天'], ['7', '近 7 天'], ['30', '近 30 天']]} />
      {error && <Problem title={t('读取运行数据失败')} advice={error} action={t('重试')} onAction={reload} />}
      {data && <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }} data-testid="status-totals">
        {[[t('调用'), String(data.totals.calls)], [t('费用'), `¥${data.totals.cost.toFixed(3)}`], [t('错误率'), pct(data.totals.errorRate)], [t('缓存命中'), pct(data.totals.cacheRate)]].map(([k, v]) => <div key={k} className="stat"><span className="text-[13px] text-muted">{k}</span><strong className="text-[22px] tabular-nums">{v}</strong></div>)}
      </div>}
      {data && !data.stats.length && <div className="card !p-0"><EmptyState icon="activity" title={t('还没有调用记录')} why={t('对话、试一试、测试连接都会在这里记下延迟、费用、缓存命中和错误。')} action={t('去接模型')} onAction={() => go('me/models')} /></div>}
      {!!data?.stats.length && (
        <ul className="item-list" data-testid="status-models">
          {data.stats.map((s) => (
            <li key={s.key}>
              <StatusDot tone={!s.healthy ? 'bad' : s.errorRate > 0.2 ? 'warn' : 'ok'}>{s.healthy ? t('健康') : t('不稳定')}</StatusDot>
              <span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px] break-all">{s.model} · {s.vendor} · {t(s.role)}</span>
                <span className="item-meta">{s.calls} {t('次')} · p50 {(s.p50 / 1000).toFixed(1)}s · p95 {(s.p95 / 1000).toFixed(1)}s · ¥{s.cost.toFixed(3)} · {t('缓存命中')} {pct(s.cacheRate)} · {t('错误率')} {pct(s.errorRate)}{s.lastError ? ` · ${t('最近错误')} ${s.lastError}` : ''}</span></span>
            </li>
          ))}
        </ul>
      )}
      <Section title={t('设定文件自检')}>
        <Note tone={doc && doc.problems.filter((p) => !p.fixed).length ? 'warn' : 'ok'}>{doc ? `${doc.files} ${t('个文件')} · ${doc.folders} ${t('个文件夹')} · ${t('问题')} ${doc.problems.filter((p) => !p.fixed).length}（${t('已自动修复')} ${doc.fixed}）` : t('打开“Agent 设定”后会自检一次')}</Note>
      </Section>
      <Note>{t('健康路由：默认模型近期失败率高时，可重试类错误先走备用。')}</Note>
      <Diagnostics />
    </div>
  );
}

/* ---------------- 审计日志 ---------------- */
export function AuditPage() {
  const { t } = useT();
  const [kind, setKind] = useState<AuditKind | ''>('');
  const [actor, setActor] = useState<'' | 'user' | 'agent' | 'system'>('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const f: AuditFilter = { ...(kind ? { kinds: [kind] } : {}), ...(actor ? { actor } : {}), ...(text.trim() ? { text: text.trim() } : {}), ...(from ? { from: `${from}T00:00:00` } : {}) };
  const { data, error, reload } = useAsync(() => listAudit(f), ['audit'], [kind, actor, text, from]);
  const exp = async (fmt: 'csv' | 'jsonl') => {
    const list = data ?? [];
    download(`audit-${new Date().toISOString().slice(0, 10)}.${fmt}`, fmt === 'csv' ? `\uFEFF${auditToCsv(list)}` : auditToJsonl(list), fmt === 'csv' ? 'text/csv' : 'application/x-ndjson');
    await audit({ kind: 'export', actor: 'user', summary: `导出审计日志 ${list.length} 条（${fmt.toUpperCase()}，已打码）`, outcome: 'ok' });
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="audit-page">
      <Note>{t('记录工具调用、审批、花费、设定与记忆改动、导入导出。全部打码，永不含 Key。')}</Note>
      <div className="form-row">
        <label className="field"><span>{t('类型')}</span><select value={kind} onChange={(e) => setKind(e.target.value as AuditKind | '')} data-testid="audit-kind"><option value="">{t('全部')}</option>{(Object.keys(AUDIT_KIND_LABEL) as AuditKind[]).map((k) => <option key={k} value={k}>{t(AUDIT_KIND_LABEL[k])}</option>)}</select></label>
        <label className="field"><span>{t('谁')}</span><select value={actor} onChange={(e) => setActor(e.target.value as typeof actor)}><option value="">{t('全部')}</option><option value="user">{t('你')}</option><option value="agent">Agent</option><option value="system">{t('系统')}</option></select></label>
        <label className="field"><span>{t('起始日期')}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </div>
      <input placeholder={t('搜索摘要')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('搜索摘要')} />
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void exp('csv')} data-testid="audit-csv">{t('导出 CSV')}</button><button type="button" onClick={() => void exp('jsonl')}>{t('导出 JSONL')}</button></div>
      {error && <Problem title={t('读取审计日志失败')} advice={error} action={t('重试')} onAction={reload} />}
      {data && !data.length && <div className="card !p-0"><EmptyState icon="shield" title={t('没有符合条件的记录')} why={t('换个筛选条件，或先用一会儿：调用工具、审批、改设定都会记在这里。')} /></div>}
      {!!data?.length && <ul className="item-list" data-testid="audit-list">{data.slice(0, 300).map((e, i) => (
        <li key={`${e.at}-${i}`}><StatusDot tone={e.outcome === 'failed' ? 'bad' : e.outcome === 'denied' ? 'warn' : 'ok'}>{t(AUDIT_KIND_LABEL[e.kind])}</StatusDot><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{e.summary}</span><span className="item-meta">{fmtTime(e.at)} · {e.actor}{e.tool ? ` · ${e.tool}` : ''}{e.cost ? ` · ¥${e.cost.toFixed(3)}` : ''}</span></span></li>
      ))}</ul>}
    </div>
  );
}

/* ---------------- 设置：花钱阈值、实验开关、Key 共用方式 ---------------- */
export function SettingsV9Page() {
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
    if (!(a >= 0 && a <= 1000) || !(b >= 0 && b <= 10000)) { setErr(t('单次 0–1000 元、当日 0–10000 元')); return; }
    await setPrefs({ spend: { perCallConfirmYuan: a, perDayConfirmYuan: b } });
    const m = await getModelsV3(); m.budget = { ...m.budget, perCallConfirmYuan: a, perDayConfirmYuan: b }; await saveModelsV3(m);
    await audit({ kind: 'setting_change', actor: 'user', summary: `花钱确认线：单次 ¥${a}、当日 ¥${b}`, outcome: 'ok' });
    setPerCall(null); setPerDay(null); show(t('已保存，下一次运行生效'));
  };
  const setFlag = async (id: string, on: boolean) => { await setPrefs({ flags: { ...(prefs.flags ?? {}), [id]: on } }); await audit({ kind: 'flag_change', actor: 'user', summary: `${on ? '打开' : '关闭'}实验功能 ${id}`, outcome: 'ok' }); reload(); };
  const setKeyPolicy = async (p: 'account' | 'per-role') => { await setPrefs({ keyPolicy: p }); const m = await getModelsV3(); m.keyPolicy = { scope: p }; await saveModelsV3(m); await audit({ kind: 'setting_change', actor: 'user', summary: `Key 共用方式：${p === 'account' ? '同一服务商一个 Key' : '每类单独填写'}`, outcome: 'ok' }); reload(); };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="settings-v9">
      {toast}
      <Section title={t('花钱先问我')} testId="spend">
        <div className="form-row">
          <label className="field"><span>{t('单次预计达到（元）')}</span><input inputMode="decimal" value={perCall ?? String(spend.perCallConfirmYuan)} onChange={(e) => setPerCall(e.target.value)} data-testid="spend-call" /></label>
          <label className="field"><span>{t('当天累计达到（元）')}</span><input inputMode="decimal" value={perDay ?? String(spend.perDayConfirmYuan)} onChange={(e) => setPerDay(e.target.value)} data-testid="spend-day" /></label>
        </div>
        <label className="list-row static"><input type="checkbox" checked disabled aria-label={t('视频每次确认')} /><span className="row-text"><span className="row-label">{t('视频每次都先问')}</span><span className="row-hint">{t('视频费用高，代码固定每次确认，不能关闭；单价未知的生图 / 配音也会先问')}</span></span></label>
        {err && <Problem title={err} advice={t('改好后再保存')} />}
        <button type="button" className="primary self-start" onClick={() => void saveSpend()} data-testid="spend-save">{t('保存')}</button>
      </Section>
      <SpendGuardSection />
      <Section title={t('Key 共用方式')}>
        {([['account', '同一服务商一个 Key，各能力通用（默认）', '例如百炼填一次，文本、生图、配音、转写都能用；某一类仍可单独改'], ['per-role', '每类单独填写', '每个能力页都要填自己的地址与 Key']] as const).map(([v, l, h]) => (
          <label key={v} className="list-row cursor-pointer"><input type="radio" name="keypolicy" checked={(prefs.keyPolicy ?? 'account') === v} onChange={() => void setKeyPolicy(v)} /><span className="row-text"><span className="row-label">{t(l)}</span><span className="row-hint">{t(h)}</span></span></label>
        ))}
      </Section>
      <GroupList title={t('实验功能')}>
        {FLAGS.list().map((f) => (
          <li key={f.id}><label className={`list-row ${f.stage === 'reserved' ? 'static' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={flagOn(f.id, ov)} disabled={f.stage === 'reserved'} onChange={(e) => void setFlag(f.id, e.target.checked)} aria-label={f.label} data-testid={`flag-${f.id}`} />
            <span className="row-text"><span className="row-label">{t(f.label)}{f.stage !== 'stable' ? ` · ${t({ beta: '测试版', experimental: '实验', reserved: '预留，暂未开放' }[f.stage])}` : ''}</span><span className="row-hint">{t(f.description)}</span></span>
          </label></li>
        ))}
      </GroupList>
      <Note>{t('开关不能放宽硬边界与审批：没有任何开关能让 App 自动发布、点赞、评论、私信或关注。')}</Note>
    </div>
  );
}

/* ---------------- 本机提醒 ---------------- */
export function RemindersPage() {
  const { t } = useT();
  const { data, reload } = useAsync(listReminders, ['reminders']);
  const [text, setText] = useState('');
  const [when, setWhen] = useState('明早 9 点');
  const [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  const add = async () => {
    setErr(null);
    const w = parseWhenZh(when, new Date());
    if (!text.trim()) { setErr(t('写一下要提醒什么')); return; }
    if (!w?.at) { setErr(`${t('没看懂时间')}“${when}”`); return; }
    await addReminder({ text: text.trim(), at: w.at.toISOString(), rrule: w.rrule });
    setText(''); show(`${t('已设好')}：${shDateTime(w.at)}`);
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="reminders-page">
      {toast}
      <Note>{t('提醒只发本机通知，不会自动执行任何动作、不调用平台、不花钱。安卓 App 关闭时由系统通知送达（需允许通知权限）。')}</Note>
      <NotifySection compact />
      <Section title={t('新提醒')}>
        <label className="field !m-0"><span>{t('提醒什么')}</span><input value={text} onChange={(e) => setText(e.target.value)} data-testid="rem-text" /></label>
        <label className="field !m-0"><span>{t('什么时候（例如：明早 9 点 / 每周一 10 点 / 30 分钟后）')}</span><input value={when} onChange={(e) => setWhen(e.target.value)} data-testid="rem-when" /></label>
        {err && <Problem title={err} advice={t('换个说法，比如“明天下午 3 点”')} />}
        <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void add()} data-testid="rem-add">{t('设提醒')}</button><button type="button" onClick={async () => { const n = await tick(); show(n ? `${t('已提醒')} ${n} ${t('条')}` : t('现在没有到期的提醒')); reload(); }}>{t('立即检查')}</button></div>
      </Section>
      {data && !data.length && <div className="card !p-0"><EmptyState icon="bell" title={t('还没有提醒')} why={t('也可以在对话里说“明早 9 点提醒我看数据”。')} /></div>}
      {!!data?.length && <ul className="item-list" data-testid="rem-list">{data.map((r) => (
        <li key={r.id}><StatusDot tone={r.status === 'scheduled' ? 'ok' : 'neutral'}>{t({ scheduled: '待提醒', fired: '已提醒', cancelled: '已取消' }[r.status])}</StatusDot><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{r.text}</span><span className="item-meta">{r.at ? fmtTime(r.at) : ''}{r.rrule ? ` · ${t('重复')}` : ''}</span></span>{r.status === 'scheduled' && <button type="button" className="ghost" onClick={async () => { await cancelReminder(r.id); reload(); }}>{t('取消')}</button>}</li>
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
    try { const z = await exportBackup({ includeMedia: media }); download(`super-workbench-backup-${new Date().toISOString().slice(0, 10)}.zip`, z, 'application/zip'); setMsg(t('已导出（不含任何 Key）')); }
    catch (e) { setErr({ message: (e as Error).message, advice: t('导出前发现疑似密钥会直接阻止；把它从设定文件或备注里删掉后再导出') }); }
    finally { setBusy(null); }
  };
  const doImport = async (f: File) => {
    setErr(null); setMsg(''); setBusy('import');
    try {
      if (/\.json$/i.test(f.name)) {   // 0.6–0.8 的 JSON 备份：前滚后交给旧接口恢复业务数据
        const doc = migrateLegacyBackup(JSON.parse(await f.text()));
        const r = await post<{ restored?: number }>('/api/backup/import', doc);
        setMsg(`${t('已恢复旧版备份')} ${r.restored ?? ''} ${t('条记录')}；${t('Key 需要重新填写')}`); return;
      }
      const r = await restoreBackup(new Uint8Array(await f.arrayBuffer()));
      if (r.errors.length) { setErr({ message: t('备份文件校验没通过'), advice: r.errors.slice(0, 3).join('；') }); return; }
      setSnap(r.snapshot);
      setMsg(`${t('已恢复')}：${t('文件')} ${r.restored.files}、${t('数据集')} ${r.restored.collections}、${t('设置')} ${r.restored.kv}。${t('Key 需要重新填写')}`);
    } catch (e) { setErr({ message: t('文件读不出来'), advice: `${t('请选择本应用导出的 .zip（或 0.8 及以前的 .json）备份')}（${(e as Error).message}）` }); }
    finally { setBusy(null); }
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="backup-v9">
      <Note>{t('数据只存在这台设备上。换手机或清理数据前，先导出一份。备份永远不含 API Key，恢复后需要重新填写。')}</Note>
      <GroupList title={t('导出')}>
        <li><label className="list-row cursor-pointer"><input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} aria-label={t('包含生成的图片与音频')} /><span className="row-text"><span className="row-label">{t('包含生成的图片与音频')}</span><span className="row-hint">{t('文件会变大；默认只导出文字、设定与数据')}</span></span></label></li>
        <li><button type="button" className="list-row" onClick={() => void doExport()} disabled={!!busy} data-testid="export-zip"><span className="row-text"><span className="row-label">{busy === 'export' ? <Busy label={t('正在打包…')} /> : t('导出备份（.zip）')}</span><span className="row-hint">{t('含 manifest 与逐个文件的校验值')}</span></span></button></li>
      </GroupList>
      <GroupList title={t('恢复')}>
        <li><label className="list-row cursor-pointer"><span className="row-text"><span className="row-label">{busy === 'import' ? <Busy label={t('正在恢复…')} /> : t('从备份文件恢复')}</span><span className="row-hint">{t('恢复前会自动给当前数据拍一份快照，可回滚')}</span></span><input type="file" accept=".zip,application/zip,.json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); }} data-testid="import-file" /></label></li>
        {snap && <li><button type="button" className="list-row" onClick={async () => setMsg((await rollbackRestore()) ? t('已回到恢复前的状态') : t('没有可回滚的快照'))}><span className="row-text"><span className="row-label">{t('撤销这次恢复')}</span></span></button></li>}
      </GroupList>
      {msg && <p className="ok-line m-0" role="status" data-testid="backup-msg">{msg}</p>}
      {err && <Problem title={err.message} advice={err.advice} />}
    </div>
  );
}
