import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { SAMPLE_IDEAS } from '../local/hot';
import { loadHot, refreshHot, type HotState } from '../services';
import { ago } from '../format';
import { Busy, EmptyState, HelpTip, Problem } from '../ui';
import { Composer } from '../components/Composer';
import { runtime } from '../runtime';

/** 找选题：热点列表 + “手动输入一个想法”。每条热点只有一个按钮“用它写一篇”。读取失败时主线不中断。 */
export function Topics({ go }: { go: (to: string) => void }) {
  const { t, lang } = useT();
  const [hot, setHot] = useState<HotState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [pick, setPick] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true); setErr(null);
    try { setHot(await refreshHot()); } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e))); } finally { setBusy(false); }
  };
  useEffect(() => {
    loadHot().then((h) => { setHot(h); if (!h.at && runtime() !== 'web') void refresh(); }).catch((e) => setErr(e instanceof ApiError ? e : new ApiError('error', String(e))));
  }, []);

  const failed = hot?.sources.filter((s) => !s.ok) ?? [];
  const allFailed = !!hot && hot.sources.length > 0 && failed.length === hot.sources.length;
  const reason = failed.map((s) => `${s.label}：${s.reason}`).join('；');

  return (
    <div className="page page-narrow flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="section-t !m-0 !mx-1">{t('ui.type_an_idea_by_hand')}</h2>
        <Composer key={pick ?? 'none'} go={go} initialText={pick ?? undefined} autoFocus={!!pick} />
      </section>

      {(allFailed || err) && (
        <Problem
          testId="hot-error"
          title={allFailed ? `${t('ui.trend_sources_cant_be_reached')}（${failed[0]?.reason ?? t('ui.network_timeout')}）` : err!.message}
          advice={allFailed ? t('ui.write_an_idea_above_by') + (failed.length > 1 ? ` ${reason}` : '') : err!.advice}
          action={t('ui.reload')} onAction={() => void refresh()}
        />
      )}

      <section aria-label={t('ui.todays_trends')}>
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="section-t !m-0">{t('ui.todays_trends')}</h2>
          <HelpTip label={t('ui.where_trends_come_from')}>{t('ui.from_official_rss_and_public')}</HelpTip>
          <span className="grow" />
          {hot?.at && <span className="item-meta">{ago(hot.at, lang)}</span>}
          <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? <Busy label={t('ui.reading')} /> : <><Icon name="retry" size={16} />{t('ui.refresh_trends')}</>}</button>
        </div>
        {hot && hot.items.length > 0 ? (
          <ul className="item-list" data-testid="hot-list">
            {hot.items.slice(0, 40).map((h, i) => (
              <li key={`${h.source}-${i}`}>
                <span className="w-6 shrink-0 text-center text-[13px] tabular-nums text-muted">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col"><span className="item-title">{h.title}</span><span className="item-meta">{h.source}</span></span>
                <button type="button" className="shrink-0" onClick={() => { setPick(h.title); window.scrollTo?.(0, 0); }} data-testid="use-hot">{t('ui.write_with_this')}</button>
              </li>
            ))}
          </ul>
        ) : !busy && hot && (
          <div className="card !p-0">
            <EmptyState icon="hot" title={t('ui.no_trends_yet')} why={allFailed ? t('ui.trend_sources_cant_be_read') : t('ui.tap_refresh_trends_to_load')} />
            <div className="suggest justify-center px-4 pb-6" aria-label={t('ui.sample_ideas')}>
              {SAMPLE_IDEAS.map((s) => <button key={s} type="button" onClick={() => setPick(s)}>{t('ui.example')}：{s}</button>)}
            </div>
          </div>
        )}
        {!hot && !err && <Busy label={t('ui.reading')} />}
      </section>
    </div>
  );
}
