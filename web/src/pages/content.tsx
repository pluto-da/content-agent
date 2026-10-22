import { useState } from 'react';
import { get, post, del } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { notify, type Device } from '../runtime';
import { Badge, Card, CountUp, Empty, ErrorBox, Field, Loading, Skeleton, SkeletonLines, Sparkline, StatusBadge, useLoad, useToast } from '../ui';

/* ---------- 总览 Dashboard ---------- */

/** 最近 n 天（UTC 日期，与 SQLite datetime('now') 对齐）。 */
function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  return out;
}
function perDay(rows: any[], days: string[], field = 'created_at', value?: (r: any) => number): number[] {
  const m = new Map(days.map((d) => [d, 0]));
  for (const r of rows ?? []) {
    const d = String(r?.[field] ?? '').slice(0, 10);
    if (m.has(d)) m.set(d, m.get(d)! + (value ? value(r) : 1));
  }
  return days.map((d) => m.get(d)!);
}
function weekDelta(series: number[]): number | null {
  const a = series.slice(-7).reduce((s, x) => s + x, 0);
  const b = series.slice(-14, -7).reduce((s, x) => s + x, 0);
  if (!a && !b) return null;
  if (!b) return 100;
  return Math.round(((a - b) / b) * 100);
}
function ago(ts: string | undefined, lang: string): string {
  if (!ts) return '';
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return ts;
  const s = Math.max(0, (Date.now() - t) / 1000);
  const zh = lang === 'zh';
  if (s < 60) return zh ? '刚刚' : 'just now';
  if (s < 3600) return zh ? `${Math.floor(s / 60)} 分钟前` : `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return zh ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 3600)}h ago`;
  return zh ? `${Math.floor(s / 86400)} 天前` : `${Math.floor(s / 86400)}d ago`;
}

function Kpi({ label, value, decimals, prefix, suffix, delta, deltaGoodWhenUp = true, loading, onClick, hint }: {
  label: string; value: number; decimals?: number; prefix?: string; suffix?: string; delta?: number | null; deltaGoodWhenUp?: boolean;
  loading: boolean; onClick?: () => void; hint?: string;
}) {
  const { t } = useT();
  const good = delta == null ? null : (delta >= 0) === deltaGoodWhenUp;
  return (
    <button className="kpi" onClick={onClick} aria-label={`${label}：${loading ? t('加载中') : value.toFixed(decimals ?? 0)}${suffix ?? ''}`}>
      <span className="kpi-top">
        <span className="kpi-label">{label}</span>
        <Icon name="arrowRight" size={14} className="kpi-go" />
      </span>
      {loading ? <Skeleton w="40%" h={32} r={6} style={{ margin: '4px 0' }} /> : <span className="kpi-value"><CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} /></span>}
      <span className="kpi-foot">
        {delta != null && !loading
          ? <span className={`delta ${good ? 'up' : 'down'}`}><Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />{Math.abs(delta)}%<span className="muted"> {t('较上周')}</span></span>
          : <span className="muted">{hint ?? ''}</span>}
      </span>
    </button>
  );
}

/** 总览：只回答“今天要处理什么”——4 个指标卡 + 待审队列 + 热点前 5。成本、模型、流水线、任务与硬边界见“运行状态”页。 */
export function Overview({ go }: { go: (p: string) => void }) {
  const { t, lang } = useT();
  const n = useLoad(() => get('/api/notifications'));
  const tasks = useLoad(() => get('/api/tasks?limit=200'));
  const hot = useLoad(() => get('/api/hot'));
  const drafts = useLoad(() => get('/api/drafts'));
  const topics = useLoad(() => get('/api/topics'));
  const [toast, say] = useToast();

  const days = lastDays(14);
  const draftRows: any[] = Array.isArray(drafts.data?.drafts) ? drafts.data.drafts : [];
  const topicRows: any[] = Array.isArray(topics.data?.topics) ? topics.data.topics : [];
  const merged: any[] = Array.isArray(hot.data?.merged) ? hot.data.merged : [];
  const hotMatches: string[] = Array.isArray(n.data?.hotMatches) ? n.data.hotMatches : [];
  const stats: Record<string, number> = tasks.data?.stats ?? {};

  const draftSeries = perDay(draftRows, days);
  const okN = stats.succeeded ?? 0;
  const failN = stats.failed ?? 0;
  const successRate = okN + failN ? (okN / (okN + failN)) * 100 : 0;
  const pendingAll = draftRows.filter((d) => d.status === 'pending');
  const pendingList = pendingAll.slice(0, 5);
  const candidates = topicRows.filter((x) => x.status === 'candidate').length;
  const dateStr = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div className="dash">
      {toast}
      <section className="dash-hero">
        <div>
          <p className="eyebrow">{dateStr}</p>
          <h2 className="hero-title">{t('今天要处理什么')}</h2>
        </div>
        <div className="row wrap">
          <button onClick={async () => {
            const d = n.data;
            const ok = await notify('内容运营助手', `待审草稿 ${d?.pendingDrafts ?? 0} 篇；热点命中 ${d?.hotMatches?.length ?? 0} 条`);
            say(ok ? '已发送本地通知' : '通知权限未开启');
          }}><Icon name="bell" />{t('开启通知')}</button>
          <button className="primary" onClick={() => go('hot')}>{t('采集热榜')}</button>
        </div>
      </section>
      <ErrorBox error={n.error} />

      <div className="dash-grid">
        <div className="kpis span-12">
          <Kpi label={t('待审草稿')} value={Number(n.data?.pendingDrafts ?? 0)} loading={n.loading} onClick={() => go('review')} delta={weekDelta(draftSeries)} />
          <Kpi label={t('候选选题')} value={candidates} loading={topics.loading} onClick={() => go('topics')} hint={t('待改写')} />
          <Kpi label={t('热榜条目')} value={merged.length} loading={hot.loading} onClick={() => go('hot')} hint={`${t('热点命中')} ${hotMatches.length}`} />
          <Kpi label={t('任务成功率')} value={successRate} decimals={0} suffix="%" loading={tasks.loading} onClick={() => go('tasks')} hint={`${t('失败任务')} ${failN}`} />
        </div>

        <Card className="span-7" title={t('审核队列')} subtitle={`${pendingAll.length} ${t('篇待审')}`} actions={<button className="ghost" onClick={() => go('review')}>{t('全部')}<Icon name="chevronRight" size={14} /></button>}>
          {drafts.loading ? <SkeletonLines lines={4} /> : pendingList.length ? (
            <ul className="list rows">
              {pendingList.map((d) => (
                <li key={d.id}>
                  <button className="row-btn" onClick={() => go('review')}>
                    <span className="plat">{PLATFORM_SHORT[d.platform] ?? d.platform}</span>
                    <span className="grow ellipsis">{d.title || String(d.body ?? '').slice(0, 30)}</span>
                    <span className="muted small nowrap">{ago(d.created_at, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty icon="check">{t('没有待审草稿')}</Empty>}
        </Card>

        <Card className="span-5" title={t('热点前 5')} subtitle={t('跨榜单合并 · 最新')} actions={<button className="ghost" onClick={() => go('hot')}>{t('全部')}<Icon name="chevronRight" size={14} /></button>}>
          {hotMatches.length > 0 && (
            <div className="matches" aria-label={t('关注词命中')}>
              <span className="muted small">{t('关注词命中')}</span>
              <ul className="list match-list">{hotMatches.map((h) => <li key={h}><Badge tone="warn">{h}</Badge></li>)}</ul>
            </div>
          )}
          {hot.loading ? <SkeletonLines lines={5} /> : merged.length ? (
            <ol className="list hot-list">
              {merged.slice(0, 5).map((m, i) => (
                <li key={m.id ?? m.title}>
                  <span className={`rank r${i + 1}`}>{i + 1}</span>
                  <span className="grow ellipsis">{m.title}</span>
                  <span className="muted small nowrap num">{(m.boards ?? []).length} {t('榜')}</span>
                </li>
              ))}
            </ol>
          ) : <Empty icon="hot">{t('暂无数据')}：{t('先采集热榜')}</Empty>}
        </Card>
      </div>
    </div>
  );
}

/** 运行状态（二级页）：成本、各能力成本、模型能力、流水线、最近任务、硬边界。从总览下沉，功能不变。 */
export function Status({ go }: { go: (p: string) => void }) {
  const { t, lang } = useT();
  const tasks = useLoad(() => get('/api/tasks?limit=200'));
  const models = useLoad(() => get('/api/models'));
  const b = useLoad(() => get('/api/boundaries'));
  const costs = useLoad(() => get('/api/models/costs?days=30'));
  const drafts = useLoad(() => get('/api/drafts'));
  const topics = useLoad(() => get('/api/topics'));

  const days = lastDays(14);
  const draftRows: any[] = Array.isArray(drafts.data?.drafts) ? drafts.data.drafts : [];
  const taskRows: any[] = Array.isArray(tasks.data?.tasks) ? tasks.data.tasks : [];
  const topicRows: any[] = Array.isArray(topics.data?.topics) ? topics.data.topics : [];
  const costSeries = perDay(costs.data?.byDay ?? [], days, 'day', (r) => Number(r.cost) || 0);
  const byStatus = (s: string) => draftRows.filter((d) => d.status === s).length;
  const candidates = topicRows.filter((x) => x.status === 'candidate').length;
  const stages: { key: string; label: string; n: number; page: string; tone: string }[] = [
    { key: 'topic', label: '候选选题', n: candidates, page: 'topics', tone: 's1' },
    { key: 'pending', label: '待审核', n: byStatus('pending'), page: 'review', tone: 's2' },
    { key: 'approved', label: '已通过', n: byStatus('approved'), page: 'review', tone: 's3' },
    { key: 'handed_off', label: '已交接', n: byStatus('handed_off'), page: 'review', tone: 's4' },
    { key: 'rejected', label: '已驳回', n: byStatus('rejected'), page: 'review', tone: 's5' },
  ];
  const stageTotal = stages.reduce((s, x) => s + x.n, 0);
  const capCosts: any[] = Array.isArray(costs.data?.byCapability) ? costs.data.byCapability : [];
  const capMax = Math.max(...capCosts.map((c) => Number(c.cost) || 0), 0);
  const callMax = Math.max(...capCosts.map((c) => Number(c.calls) || 0), 1);
  const delta = weekDelta(costSeries);

  return (
    <div className="dash-grid">
      <Card className="span-7" title={t('近 30 天成本')} actions={<button className="ghost" onClick={() => go('settings')}>{t('模型设置')}<Icon name="chevronRight" size={14} /></button>}>
        {costs.loading ? <SkeletonLines lines={2} /> : (
          <div className="status-cost">
            <div>
              <div className="kpi-value"><CountUp value={Number(costs.data?.total ?? 0)} decimals={2} prefix="¥" /></div>
              {delta != null
                ? <span className={`delta ${delta <= 0 ? 'up' : 'down'}`}><Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />{Math.abs(delta)}%<span className="muted"> {t('较上周')}</span></span>
                : <span className="muted small">{t('近 14 天成本')}</span>}
            </div>
            <span className="kpi-chart"><Sparkline values={costSeries} label={t('近 14 天成本')} /></span>
          </div>
        )}
      </Card>

      <Card className="span-5" title={t('模型能力')}>
        <ErrorBox error={models.error} />
        {models.loading ? <SkeletonLines lines={4} /> : (
          <ul className="caps">
            {(models.data?.status ?? []).map((s: any) => (
              <li key={s.capability}>
                <span className="cap-name"><span className={`led ${s.configured ? (s.provider === 'mock' ? 'info' : 'ok') : 'warn'}`} aria-hidden="true" />{s.label}</span>
                {s.configured ? <Badge tone={s.provider === 'mock' ? 'info' : 'ok'}>{s.provider === 'mock' ? t('模拟输出') : `${s.provider}/${s.model}`}</Badge> : <Badge tone="warn">{t('未配置')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="span-7" title={t('流水线状态')} subtitle={t('从选题到交接的内容流转')}>
        {drafts.loading || topics.loading ? <SkeletonLines lines={3} /> : (
          <>
            <div className="stack-bar" role="img" aria-label={stages.map((s) => `${t(s.label)} ${s.n}`).join('，')}>
              {stageTotal > 0
                ? stages.filter((s) => s.n > 0).map((s) => <span key={s.key} className={`seg ${s.tone}`} style={{ flexGrow: s.n }} />)
                : <span className="seg empty" style={{ flexGrow: 1 }} />}
            </div>
            <ol className="stages">
              {stages.map((s) => (
                <li key={s.key}>
                  <button className="stage" onClick={() => go(s.page)}>
                    <span className={`dot ${s.tone}`} aria-hidden="true" />
                    <span className="stage-n"><CountUp value={s.n} /></span>
                    <span className="stage-l">{t(s.label)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>

      <Card className="span-5" title={t('各能力成本')} subtitle={t('近 30 天')}>
        {costs.loading ? <SkeletonLines lines={4} /> : capCosts.length ? (
          <ul className="bars">
            {capCosts.map((c) => {
              const v = Number(c.cost) || 0;
              const pct = capMax > 0 ? (v / capMax) * 100 : ((Number(c.calls) || 0) / callMax) * 100;
              return (
                <li key={c.capability || 'other'}>
                  <div className="row between small"><span>{c.capability || '—'}</span><span className="num muted">¥{v.toFixed(4)} · {c.calls}{t('次')}{c.failed ? ` · ${c.failed} ${t('失败')}` : ''}</span></div>
                  <div className="bar"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        ) : <Empty icon="coin">{t('暂无调用记录')}</Empty>}
      </Card>

      <Card className="span-7" title={t('最近任务')} actions={<button className="ghost" onClick={() => go('tasks')}>{t('任务与日志')}<Icon name="chevronRight" size={14} /></button>}>
        {tasks.loading ? <SkeletonLines lines={5} /> : taskRows.length ? (
          <ul className="list rows">
            {taskRows.slice(0, 6).map((x) => (
              <li key={x.id} className="task-row">
                <span className={`led ${x.status === 'succeeded' ? 'ok' : x.status === 'failed' ? 'bad' : x.status === 'running' ? 'info' : 'neutral'}`} aria-hidden="true" />
                <span className="grow ellipsis">{x.label}{x.error && <span className="muted small"> · {x.error}</span>}</span>
                <StatusBadge status={x.status} />
                <span className="muted small nowrap num">{x.ms != null ? `${x.ms}ms` : '–'}</span>
                <span className="muted small nowrap hide-sm">{ago(x.created_at, lang)}</span>
              </li>
            ))}
          </ul>
        ) : <Empty icon="tasks">{t('暂无数据')}</Empty>}
      </Card>

      <Card className="span-5" title={t('硬边界')} subtitle={t('写在代码中，不可放宽')}>
        {b.loading ? <SkeletonLines lines={4} /> : <ol className="boundaries">{(b.data?.boundaries ?? []).map((x: string) => <li key={x}>{x}</li>)}</ol>}
      </Card>
    </div>
  );
}

const PLATFORM_SHORT: Record<string, string> = { xiaohongshu: '小红书', douyin_script: '抖音', channels: '视频号', wechat_article: '公众号', xianyu: '闲鱼', x_post: 'X', zhihu_answer: '知乎', zhihu_article: '知乎' };

export function Hot({ device, go }: { device: Device; go: (p: string) => void }) {
  const { t } = useT();
  const hot = useLoad(() => get('/api/hot'));
  const [results, setResults] = useState<any[] | null>(null);
  const [clusters, setClusters] = useState<any[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  return (
    <div className="grid">
      {toast}
      <Card icon="hot" title={t('热点')} actions={<>
        <button disabled={!!busy} onClick={() => run('f', async () => { setResults((await post('/api/hot/fetch', { device })).results); hot.reload(); })}>{t('采集热榜')}</button>
        <button disabled={!!busy} onClick={() => run('f2', async () => { setResults((await post('/api/hot/fetch', { device, force: true })).results); hot.reload(); })}>{t('强制刷新')}</button>
        <button className="primary" disabled={!!busy} onClick={() => run('c', async () => setClusters((await post('/api/hot/cluster')).clusters))}>{t('聚类')}</button>
      </>}>
        <p className="muted small">只读取公开热榜标题与官方接口；访问前检查 robots.txt，被禁止的如实标注，不绕过。结果缓存 30 分钟。</p>
        <ErrorBox error={err ?? hot.error} />
        {busy && <p className="muted" aria-live="polite">处理中…</p>}
        <div className="table-wrap"><table className="table">
          <thead><tr><th>热榜</th><th>{t('状态')}</th><th>说明</th></tr></thead>
          <tbody>
            {(results ?? hot.data?.runs ?? []).map((r: any) => (
              <tr key={r.board}><td>{r.label ?? r.board}</td><td><StatusBadge status={r.status} />{r.fromCache && <Badge>缓存</Badge>}</td><td className="small">{r.message ?? `${r.count ?? r.items?.length ?? 0} 条`}</td></tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {clusters && (
        <Card icon="topics" title="话题簇">
          <ul className="list">
            {clusters.map((c) => (
              <li key={c.name} className="row between">
                <div><b>{c.name}</b><div className="muted small">{c.titles.join(' / ')}</div></div>
                <button disabled={!!busy} onClick={() => run('r' + c.name, async () => { const r = await post('/api/hot/research', { name: c.name, titles: c.titles }); say(`已生成选题卡 #${r.topicId}`); go('topics'); })}>{t('深度调研')}</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card icon="activity" title="跨榜单合并（最新）">
        <Loading show={hot.loading} />
        <ol className="list compact hot-merged">
          {hot.data?.merged?.slice(0, 40).map((m: any) => (
            <li key={m.id}><span>{m.title}</span> {m.boards.map((b: any) => <Badge key={b.board}>{b.board}#{b.rank}</Badge>)}</li>
          ))}
        </ol>
        {!hot.loading && !hot.data?.merged?.length && <Empty icon="hot">{t('暂无数据')}</Empty>}
      </Card>
    </div>
  );
}

export function Library({ go }: { go: (p: string) => void }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const items = useLoad(() => get(`/api/items?limit=100&search=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`), [q, tag]);
  const src = useLoad(() => get('/api/sources'));
  const [sel, setSel] = useState<number[]>([]);
  const [form, setForm] = useState({ kind: 'rss', name: '', url: '', selector: '', query: '' });
  const [err, setErr] = useState<any>(null);
  const [sem, setSem] = useState<any[] | null>(null);
  const [toast, say] = useToast();
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr(e); } };
  const list = sem ?? items.data?.items ?? [];
  return (
    <div className="grid">
      {toast}
      <Card icon="library" title={t('信息源')}>
        <ErrorBox error={err ?? src.error} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>名称</th><th>类型</th><th>{t('状态')}</th><th /></tr></thead>
          <tbody>
            {src.data?.sources?.map((s: any) => (
              <tr key={s.id}>
                <td>{s.name}</td><td className="small">{s.kind}</td>
                <td><StatusBadge status={s.status} />{s.missing?.length > 0 && <span className="muted small"> 缺少 {s.missing.join('、')}</span>}</td>
                <td className="row">
                  <button onClick={() => act(async () => { const r = await post(`/api/sources/${s.id}/run`); say(`${r.status}：抓取 ${r.fetched}，新增 ${r.inserted}${r.message ? '（' + r.message + '）' : ''}`); items.reload(); src.reload(); })}>{t('运行')}</button>
                  <button aria-label={`${t('删除')} ${s.name}`} onClick={() => act(async () => { await del(`/api/sources/${s.id}`); src.reload(); })}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); act(async () => {
          const config = form.kind === 'rss' || form.kind === 'web' ? { url: form.url, selector: form.selector || undefined } : form.kind === 'x_api' ? { query: form.query } : {};
          await post('/api/sources', { kind: form.kind, name: form.name || form.kind, config });
          setForm({ ...form, name: '', url: '' }); src.reload();
        }); }}>
          <Field label="类型">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {src.data?.adapters?.map((a: any) => <option key={a.kind} value={a.kind}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="名称"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {(form.kind === 'rss' || form.kind === 'web') && <Field label="地址"><input required type="url" value={form.url} placeholder="https://www.solidot.org/index.rss" onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>}
          {form.kind === 'web' && <Field label="列表选择器（可选）"><input value={form.selector} onChange={(e) => setForm({ ...form, selector: e.target.value })} /></Field>}
          {form.kind === 'x_api' && <Field label="搜索词"><input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} /></Field>}
          <button className="primary" type="submit">{t('添加')}</button>
        </form>
      </Card>
      <Card icon="inbox" title={t('内容库')} actions={<button className="primary" disabled={!sel.length} onClick={() => act(async () => { const r = await post('/api/topics/generate', { itemIds: sel }); say(`生成选题 ${r.topicIds.length} 个`); setSel([]); go('topics'); })}>{t('生成选题')}（{sel.length}）</button>}>
        <div className="form-row">
          <Field label={t('搜索')}><input type="search" value={q} onChange={(e) => { setSem(null); setQ(e.target.value); }} /></Field>
          <Field label="标签"><select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">全部</option>{['AI', '科技', '财经', '教育', '生活', '电商'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <button disabled={!q} onClick={() => act(async () => setSem((await post('/api/items/semantic-search', { query: q })).items))}>{t('语义检索')}</button>
        </div>
        <ErrorBox error={items.error} />
        <Loading show={items.loading} />
        <ul className="list">
          {list.map((i: any) => (
            <li key={i.id} className="row top">
              <input type="checkbox" aria-label={`选择 ${i.title}`} checked={sel.includes(i.id)} onChange={(e) => setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))} />
              <div className="grow">
                <a href={i.url ?? '#'} target="_blank" rel="noreferrer noopener">{i.title}</a>
                <div className="muted small">{i.summary?.slice(0, 120)}</div>
                <div>{i.tags?.map((g: string) => <Badge key={g}>{g}</Badge>)}{i.score !== undefined && <Badge tone="info">相关度 {i.score.toFixed(2)}</Badge>}</div>
              </div>
            </li>
          ))}
        </ul>
        {!items.loading && !list.length && <Empty>{t('暂无数据')}</Empty>}
      </Card>
    </div>
  );
}

export function Topics({ device, go }: { device: Device; go: (p: string) => void }) {
  const { t } = useT();
  const topics = useLoad(() => get('/api/topics'));
  const plats = useLoad(() => get(`/api/platforms?device=${device}`), [device]);
  const [pick, setPick] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  return (
    <div className="grid">
      {toast}
      <ErrorBox error={err ?? topics.error} />
      <Loading show={topics.loading} />
      {topics.data?.topics?.filter((x: any) => x.status !== 'dismissed').map((tp: any) => {
        const chosen = pick[tp.id] ?? tp.platforms;
        return (
          <Card key={tp.id} title={<>{tp.title} {tp.origin === 'hot' && <Badge tone="warn">热点</Badge>} <StatusBadge status={tp.status} /></>}>
            {tp.angle && <p><b>角度：</b>{tp.angle}</p>}
            {tp.research && (
              <details>
                <summary>调研详情</summary>
                <p><b>背景：</b>{tp.research.background}</p>
                <p><b>受众：</b>{tp.research.audience}</p>
                <ul>{tp.research.angles?.map((a: any) => <li key={a.angle}>{a.angle}（{a.platforms?.join('、')}）</li>)}</ul>
                <p><b>风险：</b>{tp.research.risks?.join('；')}</p>
              </details>
            )}
            {tp.reason && <p className="muted small">理由：{tp.reason}</p>}
            {tp.risk && <p className="small">⚠️ {tp.risk}</p>}
            <fieldset className="chips">
              <legend className="small">改写到</legend>
              {plats.data?.platforms?.map((p: any) => (
                <label key={p.id} className="chip">
                  <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setPick({ ...pick, [tp.id]: e.target.checked ? [...chosen, p.id] : chosen.filter((x: string) => x !== p.id) })} />
                  {p.label}{p.missing?.length > 0 && <span className="muted small">（{p.missing.join('/')} 未配置）</span>}
                </label>
              ))}
            </fieldset>
            <div className="row">
              <button className="primary" disabled={busy !== null || !chosen.length} onClick={async () => {
                setBusy(tp.id); setErr(null);
                try {
                  const r = await post('/api/rewrite', { topicId: tp.id, platforms: chosen });
                  say(r.results.map((x: any) => `${x.platform}${x.ok ? '✓' : '✗ ' + x.error}`).join('，'));
                  go('review');
                } catch (e) { setErr(e); } finally { setBusy(null); }
              }}>{busy === tp.id ? '生成中…' : t('改写')}</button>
              <button onClick={async () => { await post(`/api/topics/${tp.id}/dismiss`); topics.reload(); }}>{t('跳过')}</button>
            </div>
          </Card>
        );
      })}
      {!topics.loading && !topics.data?.topics?.length && <Empty icon="topics">{t('暂无数据')}：先在内容库或热点页生成选题。</Empty>}
    </div>
  );
}
