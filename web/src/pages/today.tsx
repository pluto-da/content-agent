import { useState } from 'react';
import { get, post } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import { notify } from '../runtime';
import { Button } from '../components/ui/button';
import { cn } from '../components/ui/utils';
import { ErrorBox, SkeletonLines, useLoad, useToast } from '../ui';
import { MoreMenu } from '../components/MoreMenu';
import { useAddApp } from '../components/addAppContext';
import { appOs } from '../runtime';
import { PLATFORM_LABEL, ago } from '../format';

type Kind = 'review' | 'publish' | 'failed' | 'hot';
interface FeedItem { key: string; kind: Kind; title: string; meta: string; action: string; run: () => void | Promise<void>; more?: { label: string; onSelect: () => void }[] }

/** 失败原因的白话说明（原始错误仍在“偏好 → 日志”里）。 */
export function plainReason(err: unknown): string {
  const e = String(err ?? '');
  if (/needs_official_api|签名|开放平台/.test(e)) return '这个平台需要官方开放平台授权，配置密钥后再试';
  if (/not_configured|未配置|缺少/.test(e)) return '还没配置所需的模型或密钥';
  if (/robots/i.test(e)) return '该网站不允许采集，已按规则跳过';
  if (/timeout|超时/i.test(e)) return '等太久没有响应，稍后重试';
  if (/network|fetch failed|ECONN|ENOTFOUND|网络/i.test(e)) return '网络连不上，检查网络或代理后重试';
  if (/429|rate/i.test(e)) return '请求太频繁，被对方限流了，稍后重试';
  return e ? e.slice(0, 40) : '失败';
}

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
  const cost = useLoad(() => get('/api/models/costs?days=1'));
  const models = useLoad(() => get('/api/models'));
  const eff = useLoad(() => get('/api/metrics/efficiency?days=1'));
  const { version } = useAddApp();
  const apps = useLoad(() => get('/api/local-apps'), [version]);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();

  const draftRows: any[] = Array.isArray(drafts.data?.drafts) ? drafts.data.drafts : [];
  const taskRows: any[] = Array.isArray(tasks.data?.tasks) ? tasks.data.tasks : [];
  const merged: any[] = Array.isArray(hot.data?.merged) ? hot.data.merged : [];
  const hotMatches: string[] = Array.isArray(n.data?.hotMatches) ? n.data.hotMatches : [];
  const pending = draftRows.filter((d) => d.status === 'pending');
  const approved = draftRows.filter((d) => d.status === 'approved');
  const failed = taskRows.filter((x) => x.status === 'failed').slice(0, 5);

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
    ...failed.map((x): FeedItem => x.kind === 'hot' ? ({
      key: `f${x.id}`, kind: 'failed', title: String(x.label ?? `#${x.id}`), meta: `${t(plainReason(x.error))} · ${ago(x.created_at, lang)}`, action: t('重试'),
      run: async () => { setBusy(`f${x.id}`); setErr(null); try { await post('/api/hot/fetch', { force: true }); say(t('已重新采集')); tasks.reload(); hot.reload(); } catch (e) { setErr(e); } finally { setBusy(''); } },
      more: [{ label: t('查看日志'), onSelect: () => go(`prefs/logs/${x.id}`) }],
    }) : ({ key: `f${x.id}`, kind: 'failed', title: String(x.label ?? `#${x.id}`), meta: `${t(plainReason(x.error))} · ${ago(x.created_at, lang)}`, action: t('查看日志'), run: () => go(`prefs/logs/${x.id}`) })),
    ...hotTitles.map((h): FeedItem => ({
      key: `h${h.title}`, kind: 'hot', title: h.title,
      meta: h.match ? t('命中你的关注词') : `${'boards' in h ? h.boards : 0} ${t('个榜单')}`,
      action: t('转选题'), run: () => toTopic(h.title, `h${h.title}`),
    })),
  ];
  const loading = drafts.loading || tasks.loading || hot.loading || n.loading;
  const dateStr = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' });
  const isPhone = lay === 'phone';

  // 顶部状态条：今日花费、模型是否正常、平台连接数（3 个文字值，点一下跳到对应页面）。
  const caps: any[] = Array.isArray(models.data?.status) ? models.data.status : [];
  const llm = caps.find((c) => c.capability === 'llm');
  const badProv = (Array.isArray(eff.data?.providers) ? eff.data.providers : []).filter((p: any) => p.failRate >= 0.5 && p.calls >= 2);
  const modelState = !models.data ? '—' : !llm?.configured ? t('模型未配置') : badProv.length ? `${t('模型异常')}（${badProv.map((p: any) => p.provider).join('、')}）` : llm.provider === 'mock' ? t('模型为模拟输出') : t('模型正常');
  const modelTone = !llm?.configured || badProv.length ? 'warn' : llm.provider === 'mock' ? 'neutral' : 'ok';
  const os = appOs() ?? 'android';
  const appRows: any[] = Array.isArray(apps.data?.apps) ? apps.data.apps : [];
  const connected = new Set(appRows.filter((a) => a.os === os).map((a) => a.platform)).size;
  const totalPlatforms = Array.isArray(apps.data?.known) ? apps.data.known.length : 7;
  const statusBar: { label: string; to: string; tone?: string }[] = [
    { label: `${t('今日花费')} ¥${Number(cost.data?.total ?? 0).toFixed(2)}`, to: 'models/usage' },
    { label: modelState, to: 'models/routes', tone: modelTone },
    { label: `${t('已连接平台')} ${connected}/${totalPlatforms}`, to: 'platforms' },
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

      <nav aria-label={t('运行状态')} className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        {statusBar.map((b) => (
          <span key={b.to} className="inline-flex items-center">
            <a href={`#${b.to}`} onClick={(e) => { e.preventDefault(); go(b.to); }} className={cn('tabular inline-flex items-center gap-1.5', isPhone ? 'min-h-11' : 'min-h-8', ' rounded-ctl px-1.5 text-fg-2 no-underline hover:bg-surface-2 hover:text-fg hover:no-underline', b.tone && `status-dot ${b.tone} !text-[13px]`)}>{b.label}</a>
          </span>
        ))}
      </nav>

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
                    size={isPhone ? 'lg' : 'sm'} variant="default"
                    className={cn('shrink-0', isPhone && '!h-10 !min-h-10 px-3')} disabled={busy === it.key || isDone}
                    onClick={() => void it.run()}
                  >
                    {isDone ? <><Icon name="check" size={14} />{t('已转')}</> : busy === it.key ? t('处理中…') : it.action}
                  </Button>
                  {it.more && <MoreMenu items={it.more} label={`${it.title} ${t('更多操作')}`} size={isPhone ? 'icon-lg' : 'icon'} />}
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
