/**
 * 0.10.0 诊断（我的 → 运行状态 下方）：Key 存储后端与硬件信息（isInsideSecureHardware）、传输 trace 与自检、通知权限。
 * 只显示诊断信息，永不显示 Key 明文、请求头或请求内容。真机验收按 design/acceptance-v10.md 的“待真机”步骤在这里读数。
 */
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { keyStorageDiag, retryMigration, setRequireAuth, type KeyStorageDiag } from '../local/secretBackend';
import { getTransportTrace, clearTransportTrace, transportSelfTest, multipartMode, type TraceEntry } from '../v9/transport';
import { notifyPerms, requestNotifyPermission, openExactAlarmSettings, syncNativeSchedule, type NotifyPerms } from '../v9/reminders';
import { Section, Note, download, fmtTime } from '../pages/me/v9/common';
import { StatusDot, Busy, useToast } from '../ui';

const yesNo = (v: boolean | undefined, t: (k: string) => string) => (v === undefined ? t('未知') : v ? t('是') : t('否'));

export function KeyStorageSection() {
  const { t } = useT();
  const [d, setD] = useState<KeyStorageDiag | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const load = () => void keyStorageDiag().then(setD).catch(() => setD(null));
  useEffect(load, []);
  if (!d) return <Section title={t('Key 存储')} testId="keystore-diag"><Busy label={t('正在读取…')} /></Section>;
  const hw = d.hardware;
  const failed = d.migration.status === 'failed';
  return (
    <Section title={t('Key 存储')} testId="keystore-diag">
      {toast}
      <div className="flex flex-wrap items-center gap-2"><StatusDot tone={d.active === 'android-keystore' && hw.isInsideSecureHardware ? 'ok' : d.active === 'webcrypto' && d.preferred !== 'webcrypto' ? 'warn' : 'neutral'}>{t(d.label)}</StatusDot></div>
      <dl className="m-0 grid gap-x-3 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "max-content minmax(0, 1fr)" }} data-testid="keystore-fields">
        <dt className="text-muted">{t('首选后端')}</dt><dd className="m-0 break-all">{d.preferred}</dd>
        <dt className="text-muted">{t('当前后端')}</dt><dd className="m-0 break-all" data-testid="keystore-active">{d.active}</dd>
        <dt className="text-muted">isInsideSecureHardware</dt><dd className="m-0" data-testid="keystore-hw">{d.active === 'android-keystore' ? yesNo(hw.isInsideSecureHardware, t) : t('不适用（非安卓硬件密钥库）')}</dd>
        {d.active === 'android-keystore' && <><dt className="text-muted">{t('安全级别')}</dt><dd className="m-0">{hw.securityLevel ?? t('未知')}{hw.strongBox ? ' · StrongBox' : ''}</dd>
          <dt className="text-muted">StrongBox</dt><dd className="m-0">{t('设备支持')} {yesNo(hw.strongBoxFeature, t)} · {t('本密钥在用')} {yesNo(hw.strongBox, t)}</dd>
          <dt className="text-muted">{t('需要解锁')}</dt><dd className="m-0">{yesNo(hw.userAuthRequired, t)}</dd>
          <dt className="text-muted">Android SDK</dt><dd className="m-0">{hw.sdk ?? '—'}</dd></>}
        {d.active === 'electron-safeStorage' && <><dt className="text-muted">{t('钥匙串')}</dt><dd className="m-0">{hw.storageBackend ?? t('系统默认')}</dd></>}
        <dt className="text-muted">{t('旧 Key 迁移')}</dt><dd className="m-0" data-testid="keystore-migration">{({ none: t('未进行'), done: `${t('已完成')}（${d.migration.count ?? 0} ${t('条')}${d.migration.at ? ` · ${fmtTime(d.migration.at)}` : ''}）`, failed: `${t('失败')}：${d.migration.reason ?? ''}`, not_needed: t('无需迁移') } as Record<string, string>)[d.migration.status]}</dd>
      </dl>
      {d.fallbackReason && <Note tone="warn">{t(d.fallbackReason)}</Note>}
      {!!d.undecryptable.length && <Note tone="warn">{t('有 Key 在本机解不开（重装、换机或恢复了别的设备的数据后属正常），请到“账号与 Key”重新填写')}：{d.undecryptable.length} {t('条')}</Note>}
      <div className="flex flex-wrap gap-2">
        {failed && <button type="button" disabled={busy} onClick={async () => { setBusy(true); await retryMigration(); setBusy(false); load(); }} data-testid="keystore-retry">{t('重试迁移')}</button>}
        {d.active === 'android-keystore' && <label className="list-row static !min-h-11 !px-0"><input type="checkbox" checked={!!hw.userAuthRequired} disabled={busy} onChange={async (e) => { setBusy(true); const r = await setRequireAuth(e.target.checked); setBusy(false); show(r.ok ? t('已切换') : `${t('没有切换')}：${r.reason}`); load(); }} /><span className="row-text"><span className="row-label">{t('需要解锁手机后 5 分钟内才能使用 Key')}</span><span className="row-hint">{t('更安全；锁屏太久后发消息会提示先解锁')}</span></span></label>}
      </div>
    </Section>
  );
}

export function TransportSection() {
  const { t } = useT();
  const [list, setList] = useState<TraceEntry[]>(getTransportTrace());
  const [res, setRes] = useState<Awaited<ReturnType<typeof transportSelfTest>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const f = () => setList(getTransportTrace()); window.addEventListener('ca:transport-trace', f); return () => window.removeEventListener('ca:transport-trace', f); }, []);
  return (
    <Section title={t('上传与下载（multipart / 二进制）')} testId="transport-diag">
      <Note>{t('当前打包方式')}：{multipartMode() === 'js' ? t('JS 构造（安卓 App 默认）') : 'FormData'}{t('；FormData 失败时会自动改用 JS 构造重试一次。只记录字段名、大小与返回长度，不记 Key 与内容。')}</Note>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setRes(await transportSelfTest()); setBusy(false); }} data-testid="transport-selftest">{busy ? <Busy label={t('正在自检…')} /> : t('自检（向 httpbin.org 回显，不带 Key）')}</button>
        <button type="button" className="ghost" onClick={() => download(`transport-trace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(list, null, 2), 'application/json')} disabled={!list.length}>{t('导出 trace')}</button>
        <button type="button" className="ghost" onClick={() => { clearTransportTrace(); setList([]); }} disabled={!list.length}>{t('清空')}</button>
      </div>
      {res && <ul className="m-0 list-none p-0 text-[13px]" data-testid="transport-result"><li><StatusDot tone={res.multipart.ok ? 'ok' : 'bad'}>multipart</StatusDot> {res.multipart.detail}</li><li><StatusDot tone={res.binary.ok ? 'ok' : 'bad'}>{t('二进制')}</StatusDot> {res.binary.detail}</li></ul>}
      {!list.length ? <Note>{t('还没有记录。改图、转写、配音或自检后这里会出现。')}</Note> : (
        <ul className="item-list" data-testid="transport-trace">{list.slice(0, 10).map((e, i) => (
          <li key={`${e.at}-${i}`}><StatusDot tone={e.error ? 'bad' : 'ok'}>{e.error ? t('失败') : String(e.status ?? '')}</StatusDot><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[13px] break-all">{e.method} {e.host}{e.path}</span>
            <span className="item-meta break-all">{e.mode ? `${e.mode} · ` : ''}{e.fields ? `${e.fields.map((f) => `${f.name}(${f.kind === 'file' ? `${f.bytes}B ${f.mime ?? ''}` : `${f.bytes}B`})`).join(' ')} · ` : ''}{e.responseBase64Len !== undefined ? `Base64 ${e.responseBase64Len} · ` : ''}{e.decodedFrom === 'base64-text' ? `${t('已按 Base64 文本解码')} · ` : ''}{e.ms} ms{e.error ? ` · ${e.error}` : ''}</span></span></li>
        ))}</ul>
      )}
    </Section>
  );
}

export function NotifySection({ compact }: { compact?: boolean }) {
  const { t } = useT();
  const [p, setP] = useState<NotifyPerms | null>(null);
  const [msg, setMsg] = useState('');
  const load = () => void notifyPerms().then(setP).catch(() => setP(null));
  useEffect(load, []);
  if (!p) return null;
  const label = (s: string) => t(({ granted: '已允许', denied: '已拒绝', prompt: '未询问', unsupported: '不适用' } as Record<string, string>)[s] ?? s);
  return (
    <Section title={compact ? undefined : t('通知权限')} testId="notify-diag">
      <div className="flex flex-wrap gap-3 text-[13px]">
        <StatusDot tone={p.display === 'granted' ? 'ok' : p.display === 'denied' ? 'bad' : 'warn'}>{t('通知')}：{label(p.display)}</StatusDot>
        {p.native && <StatusDot tone={p.exact === 'granted' ? 'ok' : p.exact === 'unsupported' ? 'neutral' : 'warn'}>{t('精确闹钟')}：{label(p.exact)}</StatusDot>}
      </div>
      {p.display !== 'granted' && <Note tone="warn">{t('没有通知权限时，提醒只在打开 App 时显示；不会崩溃，也不会丢。')}</Note>}
      {p.native && p.exact === 'denied' && <Note tone="warn">{t('没开“闹钟和提醒”时系统可能晚几分钟才弹出。')}</Note>}
      <div className="flex flex-wrap gap-2">
        {p.display !== 'granted' && p.display !== 'unsupported' && <button type="button" onClick={async () => { const r = await requestNotifyPermission(); if (r === 'granted') { const s = await syncNativeSchedule(); setMsg(`${t('已允许')}${s.scheduled ? `，${t('已预排')} ${s.scheduled} ${t('条')}` : ''}`); } else setMsg(t('没有允许。可以以后在系统设置里打开')); load(); }} data-testid="notify-request">{t('允许通知')}</button>}
        {p.native && p.exact === 'denied' && <button type="button" onClick={async () => { await openExactAlarmSettings(); load(); }} data-testid="exact-open">{t('去系统设置开启精确闹钟')}</button>}
      </div>
      {msg && <p className="m-0 text-[13px] text-muted" role="status">{msg}</p>}
    </Section>
  );
}

export function Diagnostics() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3" data-testid="diagnostics">
      <h3 className="m-0 mt-2 text-[15px] font-semibold">{t('诊断')}</h3>
      <KeyStorageSection />
      <TransportSection />
      <NotifySection />
      <a className="v9-return" href="#me/status/cards" data-testid="cards-preview-link">{t('卡片预览（演示数据）')} ›</a>
    </div>
  );
}
