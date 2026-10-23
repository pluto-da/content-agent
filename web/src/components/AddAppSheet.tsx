import { useEffect, useMemo, useState } from 'react';
import { put } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import { canListInstalled, launchLocalApp, listInstalledApps, pickDesktopApp, type KnownApp, type LocalAppEntry } from '../native';
import { appOs, runtime, type AppOs } from '../runtime';
import { Problem } from '../ui';
import { OS_LABEL, presetFor, type LocalAppsData } from '../format';
import { Button } from './ui/button';
import * as D from '@radix-ui/react-dialog';
import { Drawer as Vaul } from 'vaul';
import { cn } from './ui/utils';
import { KNOWN_APPS } from '../data/platforms';


/** 本机系统；无法识别时（如 Linux 浏览器）按手机最常见的 Android 处理，可在“高级”里改。 */
export function defaultOs(): AppOs { return appOs() ?? 'android'; }

/** 预填：Android 官方包名、iOS URL Scheme；电脑端预填官方 App 注册的协议（与 iOS Scheme 相同），程序路径可用“选择应用”补充。 */
export function prefill(known: KnownApp[], platform: string, os: AppOs): LocalAppEntry {
  const base = presetFor(known, platform, os);
  if (os === 'windows' || os === 'mac') return { ...base, protocol: known.find((k) => k.platform === platform)?.ios ?? '' };
  return base;
}

/** 三步流程：选平台 → 确认软件 → 完成。常见平台：点“添加软件”→ 点平台 → 点“添加”，共 3 次点击。只保存启动信息；只能打开 App 或调用系统分享。 */
export function AddAppFlow({ data, initial, onSaved, onClose }: { data: LocalAppsData | null; initial?: string; onSaved: () => void; onClose: () => void }) {
  const { t } = useT();
  // 0.6.0：平台清单来自打包进前端的静态数据，接口没连上也永远有 9 个平台可选（0.7.0 加 B站、快手）
  const known = useMemo(() => (data?.known?.length ? data.known : KNOWN_APPS), [data]);
  const [os, setOs] = useState<AppOs>(defaultOs());
  const [step, setStep] = useState<1 | 2 | 3>(initial ? 2 : 1);
  const [v, setV] = useState<LocalAppEntry | null>(initial ? prefill(known, initial, defaultOs()) : null);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [installed, setInstalled] = useState<{ packageName: string; label: string }[] | null>(null);
  useEffect(() => { if (initial && known.length && !v) setV(prefill(known, initial, os)); }, [initial, known, os, v]);
  const registered = (p: string) => !!data?.apps?.some((a) => a.platform === p && a.os === os);
  const pick = (p: string) => { setV(prefill(known, p, os)); setErr(null); setStep(2); };
  const set = (k: keyof LocalAppEntry, x: string) => v && setV({ ...v, [k]: x });
  const desktop = v?.os === 'windows' || v?.os === 'mac';
  const save = async () => {
    if (!v) return;
    setBusy(true); setErr(null);
    try { await put('/api/local-apps', v); onSaved(); setStep(3); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const steps = ['选平台', '确认软件', '完成'];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ol className="m-0 flex list-none items-center gap-2 p-0 text-[13px] text-muted" aria-label={t('ui.steps')}>
        {steps.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? 'step' : undefined} className={cn('flex items-center gap-1.5', step === i + 1 && 'font-medium text-fg')}>
            <span className={cn('grid h-5 w-5 place-items-center rounded-full border text-[13px] tabular-nums', step > i ? 'border-ink bg-ink text-ink-fg' : 'border-line-strong')}>{step > i + 1 ? <Icon name="check" size={12} /> : i + 1}</span>
            {t(s)}{i < 2 && <span aria-hidden="true" className="mx-1 h-px w-4 bg-line-strong" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div>
          <p className="m-0 mb-3 text-[15px] text-fg-2">{t('ui.tap_a_platform')}<span className="text-muted">（{OS_LABEL[os]}）</span></p>
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4" aria-label={t('ui.platforms')}>
            {known.map((k) => (
              <li key={k.platform}>
                <button
                  type="button" onClick={() => pick(k.platform)} aria-label={`${k.label}${registered(k.platform) ? `（${t('ui.added')}）` : ''}`}
                  className="!relative !flex !h-[84px] !min-h-[84px] w-full !flex-col !items-center !justify-center !gap-1.5 !whitespace-normal !rounded-card !border-line !bg-surface !px-2 !font-normal hover:!border-line-strong"
                >
                  <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold text-fg">{k.label.slice(0, 1)}</span>
                  <span className="text-[13px] leading-tight text-fg">{k.label}</span>
                  {registered(k.platform) && <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-ink-fg" aria-hidden="true"><Icon name="check" size={10} strokeWidth={2.5} /></span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 2 && v && (
        <form className="flex flex-col gap-3" aria-label={t('ui.confirm_app')} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
            <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold">{v.label.slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-fg">{v.label} · {OS_LABEL[v.os]}</div>
              <div className="truncate font-mono text-[13px] text-muted">
                {v.os === 'android' ? v.package_name : v.os === 'ios' ? v.url_scheme : (v.exec_path || v.protocol) || t('ui.no_program_path_yet')}
              </div>
            </div>
            <Button size="lg" variant="ghost" onClick={() => setStep(1)}>{t('ui.change')}</Button>
          </div>
          {v.os === 'android' && canListInstalled() && (
            <div>
              <Button size="lg" onClick={async () => { setErr(null); try { setInstalled(await listInstalledApps()); } catch (x) { setErr(x); } }}>{t('ui.choose_from_installed_apps')}</Button>
              {installed && (installed.length
                ? <ul className="m-0 mt-2 list-none p-0">{installed.map((a) => <li key={a.packageName}><button type="button" className="linklike" onClick={() => setV({ ...v, package_name: a.packageName })}>{a.label} <span className="muted small">{a.packageName}</span></button></li>)}</ul>
                : <p className="muted small">{t('ui.only_official_apps_declared_in')}</p>)}
            </div>
          )}
          {desktop && runtime() === 'electron' && <Button size="lg" onClick={async () => { const p = await pickDesktopApp(); if (p) set('exec_path', p); }}>{t('ui.choose_app')}</Button>}
          {v.os === 'ios' && <p className="m-0 text-[13px] text-muted">{t('ui.ios_opens_via_url_scheme')}<span className="font-mono">{v.url_scheme}</span></p>}
          <details>
            <summary>{t('ui.advanced')}</summary>
            <div className="mt-2 flex flex-col gap-1">
              <label className="field"><span>{t('ui.system_2')}</span>
                <select value={v.os} onChange={(e) => { const o = e.target.value as AppOs; setOs(o); setV(prefill(known, v.platform, o)); }}>
                  {(Object.keys(OS_LABEL) as AppOs[]).map((o) => <option key={o} value={o}>{OS_LABEL[o]}</option>)}
                </select>
              </label>
              {v.os === 'android' && <>
                <label className="field"><span>{t('ui.package')}</span><input value={v.package_name ?? ''} onChange={(e) => set('package_name', e.target.value)} /></label>
                <label className="field"><span>{t('ui.deep_link_optional')}</span><input value={v.deep_link ?? ''} placeholder="zhihu://" onChange={(e) => set('deep_link', e.target.value)} /></label>
              </>}
              {v.os === 'ios' && <label className="field"><span>URL Scheme</span><input value={v.url_scheme ?? ''} onChange={(e) => set('url_scheme', e.target.value)} /></label>}
              {desktop && <>
                <label className="field"><span>{v.os === 'windows' ? t('ui.program_path_exe_lnk') : t('ui.app_path_app')}</span><input value={v.exec_path ?? ''} onChange={(e) => set('exec_path', e.target.value)} /></label>
                <label className="field"><span>{t('ui.protocol')}</span><input value={v.protocol ?? ''} onChange={(e) => set('protocol', e.target.value)} /></label>
              </>}
            </div>
          </details>
          {err && <Problem title={err.message ?? String(err)} advice={err.advice} action={t('ui.try_again')} onAction={() => void save()} />}
          <div className="flex justify-end gap-2">
            <Button variant="primary" type="submit" size="lg" disabled={busy}>{busy ? t('ui.working') : t('ui.add')}</Button>
          </div>
        </form>
      )}

      {step === 3 && v && (
        <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-ink-fg" aria-hidden="true"><Icon name="check" size={20} /></span>
          <p className="m-0 text-[16px] font-medium text-fg" data-testid="addapp-done">{t('ui.added_open_it_in_one')}</p>
          <p className="m-0 text-[13px] text-muted">{t('ui.you_still_publish_in_the')}</p>
          {msg && <p className="m-0 text-[13px] text-muted">{msg}</p>}
          <div className="flex gap-2">
            <Button size="lg" onClick={async () => setMsg((await launchLocalApp(v)).message)}>{t('ui.try_opening')}</Button>
            <Button size="lg" variant="primary" onClick={onClose}>{t('ui.done_2')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 承载：手机用底部抽屉，平板/电脑用右侧 Sheet；不跳页。关闭后焦点回到触发按钮（Radix/vaul 默认行为）。 */
export function AddAppSheet({ open, onOpenChange, lay, data, initial, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; lay: Layout; data: LocalAppsData | null; initial?: string; onSaved: () => void }) {
  const { t } = useT();
  const flow = <AddAppFlow key={initial ?? ''} data={data} initial={initial} onSaved={onSaved} onClose={() => onOpenChange(false)} />;
  if (lay === 'phone') return (
    <Vaul.Root open={open} onOpenChange={onOpenChange}>
      <Vaul.Portal>
        <Vaul.Overlay className="fixed inset-0 z-[60] bg-black/32" />
        <Vaul.Content className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[calc(92dvh-var(--sa-top))] flex-col rounded-t-card bg-surface text-fg shadow-pop outline-none" aria-describedby={undefined}>
          <div aria-hidden="true" className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
          <div className="px-4 pt-2"><Vaul.Title className="m-0 text-base font-semibold">{t('ui.add_app')}</Vaul.Title></div>
          <div className="overflow-y-auto px-4 pt-3 pb-[calc(16px+var(--sa-bottom))]">{flow}</div>
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  );
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[80] bg-black/32 data-[state=open]:animate-[fade-in_200ms_ease-out]" />
        <D.Content className="sheet-right fixed inset-y-0 right-0 z-[81] flex w-[min(440px,100vw)] flex-col bg-surface text-fg shadow-pop outline-none" aria-describedby={undefined}>
          <header className="flex items-center gap-2 border-b border-line px-5 pb-4 pt-[calc(16px+var(--sa-top))]" data-testid="sheet-header">
            <D.Title className="m-0 flex-1 text-base font-semibold">{t('ui.add_app')}</D.Title>
            <D.Close asChild><Button variant="ghost" size="icon" aria-label={t('ui.close')}><Icon name="close" size={16} /></Button></D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{flow}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
