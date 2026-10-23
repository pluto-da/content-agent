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

const yesNo = (v: boolean | undefined, t: (k: string) => string) => (v === undefined ? t('ui.unknown') : v ? t('ui.yes') : t('ui.no'));

export function KeyStorageSection() {
  const { t } = useT();
  const [d, setD] = useState<KeyStorageDiag | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const load = () => void keyStorageDiag().then(setD).catch(() => setD(null));
  useEffect(load, []);
  if (!d) return <Section title={t('ui.key_storage')} testId="keystore-diag"><Busy label={t('ui.reading')} /></Section>;
  const hw = d.hardware;
  const failed = d.migration.status === 'failed';
  return (
    <Section title={t('ui.key_storage')} testId="keystore-diag">
      {toast}
      <div className="flex flex-wrap items-center gap-2"><StatusDot tone={d.active === 'android-keystore' && hw.isInsideSecureHardware ? 'ok' : d.active === 'webcrypto' && d.preferred !== 'webcrypto' ? 'warn' : 'neutral'}>{t(d.label)}</StatusDot></div>
      <dl className="m-0 grid gap-x-3 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "max-content minmax(0, 1fr)" }} data-testid="keystore-fields">
        <dt className="text-muted">{t('ui.preferred_backend')}</dt><dd className="m-0 break-all">{d.preferred}</dd>
        <dt className="text-muted">{t('ui.active_backend')}</dt><dd className="m-0 break-all" data-testid="keystore-active">{d.active}</dd>
        <dt className="text-muted">isInsideSecureHardware</dt><dd className="m-0" data-testid="keystore-hw">{d.active === 'android-keystore' ? yesNo(hw.isInsideSecureHardware, t) : t('ui.n_a_not_android_hardware')}</dd>
        {d.active === 'android-keystore' && <><dt className="text-muted">{t('ui.security_level')}</dt><dd className="m-0">{hw.securityLevel ?? t('ui.unknown')}{hw.strongBox ? ' · StrongBox' : ''}</dd>
          <dt className="text-muted">StrongBox</dt><dd className="m-0">{t('ui.device_supports')} {yesNo(hw.strongBoxFeature, t)} · {t('ui.this_key_uses')} {yesNo(hw.strongBox, t)}</dd>
          <dt className="text-muted">{t('ui.unlock_required')}</dt><dd className="m-0">{yesNo(hw.userAuthRequired, t)}</dd>
          <dt className="text-muted">Android SDK</dt><dd className="m-0">{hw.sdk ?? '—'}</dd></>}
        {d.active === 'electron-safeStorage' && <><dt className="text-muted">{t('ui.keychain')}</dt><dd className="m-0">{hw.storageBackend ?? t('ui.system_default')}</dd></>}
        <dt className="text-muted">{t('ui.legacy_key_migration')}</dt><dd className="m-0" data-testid="keystore-migration">{({ none: t('ui.not_run'), done: `${t('ui.done_3')}（${d.migration.count ?? 0} ${t('ui.items_2')}${d.migration.at ? ` · ${fmtTime(d.migration.at)}` : ''}）`, failed: `${t('ui.failed')}：${d.migration.reason ?? ''}`, not_needed: t('ui.not_needed') } as Record<string, string>)[d.migration.status]}</dd>
      </dl>
      {d.fallbackReason && <Note tone="warn">{t(d.fallbackReason)}</Note>}
      {!!d.undecryptable.length && <Note tone="warn">{t('ui.some_keys_cant_be_decrypted')}：{d.undecryptable.length} {t('ui.items_2')}</Note>}
      <div className="flex flex-wrap gap-2">
        {failed && <button type="button" disabled={busy} onClick={async () => { setBusy(true); await retryMigration(); setBusy(false); load(); }} data-testid="keystore-retry">{t('ui.retry_migration')}</button>}
        {d.active === 'android-keystore' && <label className="list-row static !min-h-11 !px-0"><input type="checkbox" checked={!!hw.userAuthRequired} disabled={busy} onChange={async (e) => { setBusy(true); const r = await setRequireAuth(e.target.checked); setBusy(false); show(r.ok ? t('ui.switched') : `${t('ui.not_switched')}：${r.reason}`); load(); }} /><span className="row-text"><span className="row-label">{t('ui.require_unlocking_the_phone_within')}</span><span className="row-hint">{t('ui.safer_after_a_long_lock')}</span></span></label>}
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
    <Section title={t('ui.uploads_downloads_multipart_binary')} testId="transport-diag">
      <Note>{t('ui.current_packing')}：{multipartMode() === 'js' ? t('ui.js_built_android_app_default') : 'FormData'}{t('ui.if_formdata_fails_it_retries')}</Note>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setRes(await transportSelfTest()); setBusy(false); }} data-testid="transport-selftest">{busy ? <Busy label={t('ui.self_checking')} /> : t('ui.self_test_echo_via_httpbin')}</button>
        <button type="button" className="ghost" onClick={() => download(`transport-trace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(list, null, 2), 'application/json')} disabled={!list.length}>{t('ui.export_trace')}</button>
        <button type="button" className="ghost" onClick={() => { clearTransportTrace(); setList([]); }} disabled={!list.length}>{t('ui.clear')}</button>
      </div>
      {res && <ul className="m-0 list-none p-0 text-[13px]" data-testid="transport-result"><li><StatusDot tone={res.multipart.ok ? 'ok' : 'bad'}>multipart</StatusDot> {res.multipart.detail}</li><li><StatusDot tone={res.binary.ok ? 'ok' : 'bad'}>{t('ui.binary')}</StatusDot> {res.binary.detail}</li></ul>}
      {!list.length ? <Note>{t('ui.nothing_yet_image_edits_transcription')}</Note> : (
        <ul className="item-list" data-testid="transport-trace">{list.slice(0, 10).map((e, i) => (
          <li key={`${e.at}-${i}`}><StatusDot tone={e.error ? 'bad' : 'ok'}>{e.error ? t('ui.failed') : String(e.status ?? '')}</StatusDot><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[13px] break-all">{e.method} {e.host}{e.path}</span>
            <span className="item-meta break-all">{e.mode ? `${e.mode} · ` : ''}{e.fields ? `${e.fields.map((f) => `${f.name}(${f.kind === 'file' ? `${f.bytes}B ${f.mime ?? ''}` : `${f.bytes}B`})`).join(' ')} · ` : ''}{e.responseBase64Len !== undefined ? `Base64 ${e.responseBase64Len} · ` : ''}{e.decodedFrom === 'base64-text' ? `${t('ui.decoded_as_base64_text')} · ` : ''}{e.ms} ms{e.error ? ` · ${e.error}` : ''}</span></span></li>
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
    <Section title={compact ? undefined : t('ui.notification_permission')} testId="notify-diag">
      <div className="flex flex-wrap gap-3 text-[13px]">
        <StatusDot tone={p.display === 'granted' ? 'ok' : p.display === 'denied' ? 'bad' : 'warn'}>{t('ui.notifications')}：{label(p.display)}</StatusDot>
        {p.native && <StatusDot tone={p.exact === 'granted' ? 'ok' : p.exact === 'unsupported' ? 'neutral' : 'warn'}>{t('ui.exact_alarms')}：{label(p.exact)}</StatusDot>}
      </div>
      {p.display !== 'granted' && <Note tone="warn">{t('ui.without_permission_reminders_show_only')}</Note>}
      {p.native && p.exact === 'denied' && <Note tone="warn">{t('ui.without_alarms_reminders_the_system')}</Note>}
      <div className="flex flex-wrap gap-2">
        {p.display !== 'granted' && p.display !== 'unsupported' && <button type="button" onClick={async () => { const r = await requestNotifyPermission(); if (r === 'granted') { const s = await syncNativeSchedule(); setMsg(`${t('ui.allowed')}${s.scheduled ? `，${t('ui.scheduled')} ${s.scheduled} ${t('ui.items_2')}` : ''}`); } else setMsg(t('ui.not_allowed_you_can_turn')); load(); }} data-testid="notify-request">{t('ui.allow_notifications')}</button>}
        {p.native && p.exact === 'denied' && <button type="button" onClick={async () => { await openExactAlarmSettings(); load(); }} data-testid="exact-open">{t('ui.enable_exact_alarms_in_system')}</button>}
      </div>
      {msg && <p className="m-0 text-[13px] text-muted" role="status">{msg}</p>}
    </Section>
  );
}

export function Diagnostics() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3" data-testid="diagnostics">
      <h3 className="m-0 mt-2 text-[15px] font-semibold">{t('ui.diagnostics')}</h3>
      <KeyStorageSection />
      <TransportSection />
      <NotifySection />
      <a className="v9-return" href="#me/status/cards" data-testid="cards-preview-link">{t('ui.card_preview_demo_data')} ›</a>
    </div>
  );
}
