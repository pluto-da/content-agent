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
        <h2 className="section-t !m-0 !mx-1">{t('手动输入一个想法')}</h2>
        <Composer key={pick ?? 'none'} go={go} initialText={pick ?? undefined} autoFocus={!!pick} />
      </section>

      {(allFailed || err) && (
        <Problem
          testId="hot-error"
          title={allFailed ? `${t('热点源暂时连不上')}（${failed[0]?.reason ?? t('网络超时')}）` : err!.message}
          advice={allFailed ? t('你可以先在上面手动写一个想法，或换个网络后再读一次。') + (failed.length > 1 ? ` ${reason}` : '') : err!.advice}
          action={t('再读一次')} onAction={() => void refresh()}
        />
      )}

      <section aria-label={t('今天的热点')}>
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="section-t !m-0">{t('今天的热点')}</h2>
          <HelpTip label={t('热点从哪里来')}>{t('来自官方 RSS 和遵守 robots.txt 的公开榜单；App 内直接读取，网页版可能因跨域读不到。被 robots 禁止的来源会如实跳过。')}</HelpTip>
          <span className="grow" />
          {hot?.at && <span className="item-meta">{ago(hot.at, lang)}</span>}
          <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? <Busy label={t('正在读取…')} /> : <><Icon name="retry" size={16} />{t('刷新热点')}</>}</button>
        </div>
        {hot && hot.items.length > 0 ? (
          <ul className="item-list" data-testid="hot-list">
            {hot.items.slice(0, 40).map((h, i) => (
              <li key={`${h.source}-${i}`}>
                <span className="w-6 shrink-0 text-center text-[13px] tabular-nums text-muted">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col"><span className="item-title">{h.title}</span><span className="item-meta">{h.source}</span></span>
                <button type="button" className="shrink-0" onClick={() => { setPick(h.title); window.scrollTo?.(0, 0); }} data-testid="use-hot">{t('用它写一篇')}</button>
              </li>
            ))}
          </ul>
        ) : !busy && hot && (
          <div className="card !p-0">
            <EmptyState icon="hot" title={t('还没有热点')} why={allFailed ? t('热点源暂时读不到。先试试下面的示例想法，或在上面输入自己的。') : t('点“刷新热点”读取今天的热点。')} />
            <div className="suggest justify-center px-4 pb-6" aria-label={t('示例想法')}>
              {SAMPLE_IDEAS.map((s) => <button key={s} type="button" onClick={() => setPick(s)}>{t('示例')}：{s}</button>)}
            </div>
          </div>
        )}
        {!hot && !err && <Busy label={t('正在读取…')} />}
      </section>
    </div>
  );
}
