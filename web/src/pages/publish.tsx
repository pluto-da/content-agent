import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { center, centerOfWrite, publishUrlOfWrite, writePlatform } from '../data/platforms';
import { builtinMode, builtinOpenLabel, builtinPublishLabel, canSplitScreen, copyAndOpenBuiltin, currentEnv, openBuiltin, openSplit, splitLabel } from '../builtin';
import { launchLocalApp, type LocalAppEntry } from '../native';
import { appOs, copyText, openExternal } from '../runtime';
import { listDrafts, markPublished, type Draft } from '../services';
import { presetFor, useLocalApps } from '../format';
import { KNOWN_APPS } from '../data/platforms';
import { EmptyState, ErrorNext, HelpTip, Problem, useToast } from '../ui';
import { useAddApp } from '../components/addAppContext';

/** 发布用的完整文案：标题 + 正文 + 话题标签。 */
export function draftText(d: Pick<Draft, 'title' | 'body' | 'tags'>): string {
  return [d.title, d.body, (d.tags ?? []).map((x) => `#${x.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n');
}

/** 去发布：待发布内容逐条显示，按钮是具体动作“复制文案并打开小红书”。发布永远由用户在平台 App 里点击。 */
export function Publish({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { open: openAdd, version } = useAddApp();
  const apps = useLocalApps(version);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState<Record<number, { text: string; fallback?: string }>>({});
  const env = currentEnv();
  const mode = builtinMode(env.rt, env.os);
  const [toast, show] = useToast();
  const load = useCallback(() => { listDrafts('approved').then((d) => { setDrafts(d); setErr(null); }).catch((e) => setErr(e instanceof ApiError ? e : new ApiError('error', String(e)))); }, []);
  useEffect(load, [load]);
  const os = appOs() ?? 'android';
  const registered = apps.data?.apps ?? [];

  const entryFor = (centerId: string): LocalAppEntry => registered.find((a) => a.platform === centerId && a.os === os) ?? presetFor(KNOWN_APPS, centerId, os);

  const handoff = async (d: Draft) => {
    const c = centerOfWrite(d.platform);
    const ok = await copyText(draftText(d));
    const r = await launchLocalApp(entryFor(c.id));
    if (!r.ok) await openExternal(c.url);
    setCopied((m) => ({ ...m, [d.id]: { text: ok ? `${t('ui.text_copied')}。${r.ok ? t('ui.opened') + c.app : t('ui.opened') + c.label + t('ui.web_version')}，${t('ui.paste_it_and_press_publish')}` : t('ui.copy_failed_long_press_the') } }));
  };

  /** 0.7.0：在软件内打开该平台网页版发布页（先复制文案）。打不开时显示原因 + “打开官方 App”。 */
  const builtin = async (d: Draft) => {
    const c = centerOfWrite(d.platform);
    const entry = entryFor(c.id);
    const r = await copyAndOpenBuiltin(c, draftText(d), { url: publishUrlOfWrite(d.platform), packageName: entry.package_name ?? undefined });
    setCopied((m) => ({ ...m, [d.id]: { text: r.message, fallback: r.fallbackApp ? c.id : undefined } }));
  };
  const fallbackApp = async (d: Draft, centerId: string) => {
    const r = await launchLocalApp(entryFor(centerId));
    setCopied((m) => ({ ...m, [d.id]: { text: r.ok ? `${t('ui.opened')}${center(centerId)?.app ?? ''}，${t('ui.paste_it_and_press_publish')}` : r.message } }));
  };

  return (
    <div className="page page-narrow flex flex-col gap-5">
      {toast}
      <p className="m-0 flex items-center gap-2 text-[15px] text-fg-2">{t('ui.you_publish_every_post_yourself')}<HelpTip label={t('ui.why_no_auto_publish')}>{t('ui.for_account_safety_and_platform')}</HelpTip></p>
      <ErrorNext error={err} action={t('ui.reload_2')} onAction={load} />
      {drafts && !drafts.length && (
        <div className="card !p-0"><EmptyState icon="send" title={t('ui.nothing_waiting_to_publish')} why={t('ui.approve_a_draft_in_write')} action={t('ui.go_review')} onAction={() => go('write/pending')} /></div>
      )}
      {drafts?.map((d) => {
        const c = centerOfWrite(d.platform);
        return (
          <article key={d.id} className="draft-card" data-testid="publish-item">
            <div className="mb-1 flex items-center gap-2 text-[13px] text-muted"><span className="chip">{writePlatform(d.platform).label}</span></div>
            <h3>{d.title || d.body.slice(0, 24)}</h3>
            <div className="body !max-h-24">{d.body}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="primary" onClick={() => void builtin(d)} data-testid="builtin-publish">{t(builtinPublishLabel(c, mode))}</button>
              <button type="button" onClick={() => void handoff(d)} data-testid="handoff">{t('ui.copy_text_and_open')}{c.label}</button>
              <button type="button" onClick={() => go(`write/${d.id}`)}>{t('ui.revise')}</button>
            </div>
            {copied[d.id] && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] bg-surface-2 px-4 py-3" role="status">
                <span className="min-w-0 grow basis-[16rem] text-[14px] text-fg-2" data-testid="publish-status">{copied[d.id]!.text}</span>
                {copied[d.id]!.fallback && <button type="button" onClick={() => void fallbackApp(d, copied[d.id]!.fallback!)} data-testid="fallback-app">{t('ui.open_official_app')}</button>}
                <button type="button" className="primary" onClick={() => void markPublished(d.id).then(() => { show(t('ui.marked_as_published_enter_data')); load(); }).catch((e) => setErr(e))}>{t('ui.i_published')}</button>
              </div>
            )}
          </article>
        );
      })}

      <section aria-label={t('ui.registered_apps')}>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="section-t !m-0">{t('ui.registered_apps')}</h2>
          <button type="button" className="ghost" onClick={() => go('results')}>{t('ui.results')} ›</button>
        </div>
        {apps.error ? <Problem title={apps.error.message} advice={apps.error.advice} action={t('ui.retry')} onAction={apps.reload} />
          : registered.length ? (
            <ul className="item-list">
              {registered.map((a) => (
                <li key={a.id} className="flex-wrap">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold text-fg" aria-hidden="true">{a.label.slice(0, 1)}</span>
                  <span className="flex min-w-0 flex-1 flex-col"><span className="item-title">{a.label}</span><span className="item-meta">{a.os}</span></span>
                  <span className="flex basis-full flex-wrap justify-start gap-2 sm:basis-auto sm:justify-end">
                    {center(a.platform) && <button type="button" onClick={async () => { const r = await openBuiltin(center(a.platform)!, { packageName: a.package_name ?? undefined }); show(r.message); }} data-testid="builtin-open">{t(builtinOpenLabel(center(a.platform)!, mode))}</button>}
                    {center(a.platform) && canSplitScreen(env, a) && <button type="button" onClick={async () => show((await openSplit(a, center(a.platform)!.app)).message)} data-testid="split-open">{t(splitLabel(center(a.platform)!))}</button>}
                    <button type="button" onClick={async () => show((await launchLocalApp(a)).message)}><Icon name="external" size={16} />{t('ui.open_app_3')}</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : <div className="card !p-0"><EmptyState icon="phone" title={t('ui.no_apps_registered')} why={t('ui.add_official_phone_apps_like')} action={t('ui.add_app')} onAction={() => openAdd()} /></div>}
      </section>
    </div>
  );
}
