import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, localOnly } from '../api';
import { useT } from '../i18n';
import { writePlatform } from '../data/platforms';
import { listDrafts, type Draft } from '../services';
import { EmptyState, ErrorNext, HelpTip, Sparkline, useToast } from '../ui';

interface Metric { id: number; draft_id: number; views: number; likes: number; comments: number; collects: number; shares: number }
const FIELDS: [keyof Omit<Metric, 'id' | 'draft_id'>, string][] = [['views', '阅读/播放'], ['likes', '点赞'], ['comments', '评论'], ['collects', '收藏'], ['shares', '转发']];

/** 看效果：手动录入每篇已发布内容的数据（来自平台后台），显示简单趋势与复盘建议。图表只在这一页。 */
export function Results({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [toast, show] = useToast();
  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([listDrafts('handed_off'), localOnly<{ metrics: Metric[] }>('/api/metrics').catch(() => ({ metrics: [] }))]);
      setDrafts(d); setMetrics(m.metrics); setErr(null);
    } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e))); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const mOf = (id: number) => metrics.find((m) => m.draft_id === id);
  const rate = (m?: Metric) => (m && m.views ? (m.likes + m.comments + m.collects + m.shares) / m.views : 0);
  const advice = useMemo(() => {
    const rows = (drafts ?? []).map((d) => ({ d, m: mOf(d.id) })).filter((x) => x.m && x.m.views > 0);
    if (rows.length < 2) return [t('至少录入 2 篇的数据，才能比较出哪种写法更好。')];
    const best = [...rows].sort((a, b) => rate(b.m) - rate(a.m))[0]!;
    const byPlat = new Map<string, number[]>();
    rows.forEach((r) => byPlat.set(r.d.platform, [...(byPlat.get(r.d.platform) ?? []), rate(r.m)]));
    const plat = [...byPlat.entries()].map(([p, v]) => [p, v.reduce((a, b) => a + b, 0) / v.length] as const).sort((a, b) => b[1] - a[1])[0]!;
    return [
      `${t('互动率最高的是')}「${best.d.title || best.d.body.slice(0, 16)}」（${(rate(best.m) * 100).toFixed(1)}%），${t('下一篇可以沿用它的开头和结构。')}`,
      `${writePlatform(plat[0]).short} ${t('的平均互动率最高')}（${(plat[1] * 100).toFixed(1)}%）。`,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, metrics, t]);

  return (
    <div className="page page-narrow flex flex-col gap-5">
      {toast}
      <ErrorNext error={err} action={t('重新加载')} onAction={() => void load()} />
      {drafts && !drafts.length && <div className="card !p-0"><EmptyState icon="analytics" title={t('还没有已发布的内容')} why={t('在“去发布”里发出一篇并点“我已发布”，就能在这里记录效果。')} action={t('去发布')} onAction={() => go('publish')} /></div>}
      {drafts && drafts.length > 0 && (
        <>
          <section className="card flex flex-col gap-3" aria-label={t('趋势与建议')}>
            <div className="flex items-center gap-2"><h2>{t('趋势与建议')}</h2><HelpTip label={t('数据从哪里来')}>{t('数据由你从平台后台抄录（或导出后对照填写）；本应用不抓取任何登录后的数据。')}</HelpTip></div>
            <Sparkline values={drafts.slice().reverse().map((d) => mOf(d.id)?.views ?? 0)} w={600} h={60} label={t('每篇阅读/播放趋势')} />
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px] text-fg-2">{advice.map((a) => <li key={a}>{a}</li>)}</ul>
          </section>
          {drafts.map((d) => <MetricRow key={d.id} d={d} m={mOf(d.id)} onSaved={() => { show(t('已保存')); void load(); }} />)}
        </>
      )}
    </div>
  );
}

function MetricRow({ d, m, onSaved }: { d: Draft; m?: Metric; onSaved: () => void }) {
  const { t } = useT();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, m ? String(m[k]) : ''])));
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <form className="draft-card flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); localOnly(`/api/metrics/${d.id}`, 'PUT', v).then(onSaved).catch((x) => setErr(x)); }}>
      <div className="flex items-center gap-2"><span className="chip">{writePlatform(d.platform).short}</span><strong className="ellipsis text-[15px] text-fg">{d.title || d.body.slice(0, 24)}</strong></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FIELDS.map(([k, label]) => <label key={k} className="field !m-0"><span>{t(label)}</span><input inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, '') })} /></label>)}
      </div>
      <ErrorNext error={err} />
      <div><button type="submit">{t('保存数据')}</button></div>
    </form>
  );
}
