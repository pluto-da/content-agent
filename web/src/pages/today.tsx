import { useState } from 'react';
import { get, post } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import { notify } from '../runtime';
import { Button } from '../components/ui/button';
import { cn } from '../components/ui/utils';
import { ErrorBox, Skeleton, SkeletonLines, useLoad, useToast } from '../ui';
import { PLATFORM_LABEL } from './publish';
import { ago } from './content';

type Kind = 'review' | 'publish' | 'failed' | 'hot';
interface FeedItem { key: string; kind: Kind; title: string; meta: string; action: string; run: () => void | Promise<void>; secondary?: { label: string; run: () => void } }

const KIND: Record<Kind, { label: string; icon: string; tone: string }> = {
  review: { label: '待审', icon: 'review', tone: 'text-fg' },
  publish: { label: '待发布', icon: 'send', tone: 'text-accent' },
  failed: { label: '失败', icon: 'alert', tone: 'text-bad' },
  hot: { label: '新热点', icon: 'hot', tone: 'text-warn' },
};

/** 今天：单一待办流。每条只有一个主操作——待审 → 审核；待发布 → 去发布；失败任务 → 查看；新热点 → 转选题。 */
export function Today({ go, lay }: { go: (p: string) => void; lay: Layout }) {
  const { t, lang } = useT();
  const n = useLoad(() => get('/api/notifications'));
  const drafts = useLoad(() => get('/api/drafts'));
  const tasks = useLoad(() => get('/api/tasks?limit=200'));
  const hot = useLoad(() => get('/api/hot'));
  const topics = useLoad(() => get('/api/topics'));
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();

  const draftRows: any[] = Array.isArray(drafts.data?.drafts) ? drafts.data.drafts : [];
  const taskRows: any[] = Array.isArray(tasks.data?.tasks) ? tasks.data.tasks : [];
  const merged: any[] = Array.isArray(hot.data?.merged) ? hot.data.merged : [];
  const hotMatches: string[] = Array.isArray(n.data?.hotMatches) ? n.data.hotMatches : [];
  const topicRows: any[] = Array.isArray(topics.data?.topics) ? topics.data.topics : [];
  const stats: Record<string, number> = tasks.data?.stats ?? {};
  const okN = stats.succeeded ?? 0;
  const failN = stats.failed ?? 0;
  const successRate = okN + failN ? Math.round((okN / (okN + failN)) * 100) : 0;
  const pending = draftRows.filter((d) => d.status === 'pending');
  const approved = draftRows.filter((d) => d.status === 'approved');
  const failed = taskRows.filter((x) => x.status === 'failed').slice(0, 5);
  const candidates = topicRows.filter((x) => x.status === 'candidate').length;

  const toTopic = async (title: string, key: string) => {
    setBusy(key); setErr(null);
    try {
      const r = await post('/api/hot/research', { name: title, titles: [title] });
      setDone((d) => [...d, key]);
      say(`${t('已转为选题')} #${r.topicId}`);
    } catch (e) { setErr(e); } finally { setBusy(''); }
  };

  const draftTitle = (d: any) => d.title || String(d.body ?? '').slice(0, 40) || `#${d.id}`;
  const hotTitles = [...hotMatches.map((h) => ({ title: h, match: true })), ...merged.slice(0, 5).map((m) => ({ title: String(m.title), match: false, boards: (m.boards ?? []).length }))]
    .filter((x, i, arr) => arr.findIndex((y) => y.title === x.title) === i).slice(0, 6);

  const feed: FeedItem[] = [
    ...pending.map((d): FeedItem => ({ key: `r${d.id}`, kind: 'review', title: draftTitle(d), meta: `${PLATFORM_LABEL[d.platform] ?? d.platform} · ${ago(d.created_at, lang)}`, action: t('审核'), run: () => go(`create/drafts/${d.id}`) })),
    ...approved.map((d): FeedItem => ({ key: `p${d.id}`, kind: 'publish', title: draftTitle(d), meta: `${PLATFORM_LABEL[d.platform] ?? d.platform} · ${t('已通过，等你本人发布')}`, action: t('去发布'), run: () => go(`create/drafts/${d.id}`) })),
    ...failed.map((x): FeedItem => ({ key: `f${x.id}`, kind: 'failed', title: String(x.label ?? `#${x.id}`), meta: `${x.error ?? t('失败')} · ${ago(x.created_at, lang)}`, action: t('查看'), run: () => go('settings/tasks') })),
    ...hotTitles.map((h): FeedItem => ({
      key: `h${h.title}`, kind: 'hot', title: h.title,
      meta: h.match ? t('命中你的关注词') : `${'boards' in h ? h.boards : 0} ${t('个榜单')}`,
      action: t('转选题'), run: () => toTopic(h.title, `h${h.title}`),
    })),
  ];
  const loading = drafts.loading || tasks.loading || hot.loading || n.loading;
  const dateStr = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' });
  const isPhone = lay === 'phone';

  const summary: { label: string; value: string; to: string }[] = [
    { label: '待审', value: String(pending.length), to: 'create/drafts' },
    { label: '待发布', value: String(approved.length), to: 'create/drafts' },
    { label: '候选选题', value: String(candidates), to: 'inspire/topics' },
    { label: '任务成功率', value: `${successRate}%`, to: 'settings/tasks' },
  ];

  return (
    <div className="page mx-auto w-full max-w-[880px]">
      {toast}
      <section className="flex flex-wrap items-end justify-between gap-3 pt-2 pb-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] text-muted">{dateStr}</p>
          <h2 className={cn('m-0 font-semibold tracking-[-0.02em]', isPhone ? 'text-xl' : 'text-2xl')}>
            {feed.length ? `${feed.length} ${t('件事等你处理')}` : t('今天要处理什么')}
          </h2>
        </div>
        <div className={cn('flex gap-2', isPhone && 'w-full')}>
          <Button size={isPhone ? 'lg' : 'md'} className={cn(isPhone && 'flex-1')} onClick={async () => {
            const d = n.data;
            const ok = await notify('内容运营助手', `待审草稿 ${d?.pendingDrafts ?? 0} 篇；热点命中 ${d?.hotMatches?.length ?? 0} 条`);
            say(ok ? '已发送本地通知' : '通知权限未开启');
          }}><Icon name="bell" />{t('开启通知')}</Button>
          <Button variant="primary" size={isPhone ? 'lg' : 'md'} className={cn(isPhone && 'flex-1')} onClick={() => go('inspire/hot')}><Icon name="hot" />{t('采集热榜')}</Button>
        </div>
      </section>

      <div className={cn('mb-6 grid gap-2', isPhone ? 'grid-cols-2' : 'grid-cols-4')}>
        {summary.map((s) => (
          <button key={s.label} onClick={() => go(s.to)} aria-label={`${t(s.label)}：${s.value}`}
            className="!h-auto !min-h-0 !flex-col !items-start !justify-start !gap-0.5 !whitespace-normal !rounded-card !border-line !bg-surface !px-4 !py-3 text-left hover:!border-line-strong">
            <span className="text-[12px] font-normal text-muted">{t(s.label)}</span>
            {loading ? <Skeleton w={40} h={24} /> : <span className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-fg">{s.value}</span>}
          </button>
        ))}
      </div>

      <ErrorBox error={err ?? n.error} />
      <section aria-label={t('待办')} className="overflow-hidden rounded-card border border-line bg-surface">
        {loading ? <div className="p-5"><SkeletonLines lines={5} /></div> : feed.length ? (
          <ul className="m-0 list-none p-0">
            {feed.map((it) => {
              const k = KIND[it.kind];
              const isDone = done.includes(it.key);
              return (
                <li key={it.key} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2', k.tone)} aria-hidden="true"><Icon name={k.icon} size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('shrink-0 text-[12px] font-medium', k.tone)}>{t(k.label)}</span>
                      <span className="truncate text-sm text-fg">{it.title}</span>
                    </div>
                    <div className="truncate text-[12px] text-muted">{it.meta}</div>
                  </div>
                  <Button
                    size={isPhone ? 'lg' : 'sm'} variant={it.kind === 'publish' || it.kind === 'review' ? 'primary' : 'default'}
                    className={cn('shrink-0', isPhone && '!h-10 !min-h-10 px-3')} disabled={busy === it.key || isDone}
                    onClick={() => void it.run()}
                  >
                    {isDone ? <><Icon name="check" size={14} />{t('已转')}</> : busy === it.key ? t('处理中…') : it.action}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-muted">
            <Icon name="check" size={20} />
            <span className="text-sm">{t('今天没有待办')}</span>
            <Button size="sm" onClick={() => go('inspire/hot')}>{t('去找灵感')}</Button>
          </div>
        )}
      </section>
      <p className="mt-3 text-[12px] text-muted">{t('发布由你本人在官方后台或 App 中点击完成；本应用不自动点赞、评论、私信或关注。')}</p>
    </div>
  );
}
