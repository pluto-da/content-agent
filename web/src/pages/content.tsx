import { useState } from 'react';
import { get, post, del } from '../api';
import { useT } from '../i18n';
import { notify, type Device } from '../runtime';
import { Badge, Card, ErrorBox, Field, Loading, StatusBadge, useLoad, useToast } from '../ui';

export function Overview({ go }: { go: (p: string) => void }) {
  const { t } = useT();
  const n = useLoad(() => get('/api/notifications'));
  const tasks = useLoad(() => get('/api/tasks?limit=5'));
  const models = useLoad(() => get('/api/models'));
  const b = useLoad(() => get('/api/boundaries'));
  const [toast, say] = useToast();
  return (
    <div className="grid">
      {toast}
      <Card title={t('通知')} actions={<button onClick={async () => {
        const d = n.data;
        const ok = await notify('内容运营助手', `待审草稿 ${d?.pendingDrafts ?? 0} 篇；热点命中 ${d?.hotMatches?.length ?? 0} 条`);
        say(ok ? '已发送本地通知' : '通知权限未开启');
      }}>{t('开启通知')}</button>}>
        <ErrorBox error={n.error} />
        <div className="stats">
          <button className="stat" onClick={() => go('review')}><b>{n.data?.pendingDrafts ?? '–'}</b><span>{t('待审草稿')}</span></button>
          <button className="stat" onClick={() => go('hot')}><b>{n.data?.hotMatches?.length ?? '–'}</b><span>{t('热点命中')}</span></button>
          <button className="stat" onClick={() => go('tasks')}><b>{tasks.data?.stats?.failed ?? 0}</b><span>失败任务</span></button>
        </div>
        {n.data?.hotMatches?.length > 0 && <ul className="list">{n.data.hotMatches.map((h: string) => <li key={h}>{h}</li>)}</ul>}
      </Card>
      <Card title={t('模型能力')} actions={<button onClick={() => go('settings')}>{t('设置')}</button>}>
        <ErrorBox error={models.error} />
        <ul className="caps">
          {models.data?.status?.map((s: any) => (
            <li key={s.capability}>
              <span>{s.label}</span>
              {s.configured ? <Badge tone={s.provider === 'mock' ? 'info' : 'ok'}>{s.provider === 'mock' ? t('模拟输出') : `${s.provider}/${s.model}`}</Badge> : <Badge tone="warn">{t('未配置')}</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('硬边界')}>
        <ol className="small">{b.data?.boundaries?.map((x: string) => <li key={x}>{x}</li>)}</ol>
      </Card>
    </div>
  );
}

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
      <Card title={t('热点')} actions={<>
        <button disabled={!!busy} onClick={() => run('f', async () => { setResults((await post('/api/hot/fetch', { device })).results); hot.reload(); })}>{t('采集热榜')}</button>
        <button disabled={!!busy} onClick={() => run('f2', async () => { setResults((await post('/api/hot/fetch', { device, force: true })).results); hot.reload(); })}>{t('强制刷新')}</button>
        <button className="primary" disabled={!!busy} onClick={() => run('c', async () => setClusters((await post('/api/hot/cluster')).clusters))}>{t('聚类')}</button>
      </>}>
        <p className="muted small">只读取公开热榜标题与官方接口；访问前检查 robots.txt，被禁止的如实标注，不绕过。结果缓存 30 分钟。</p>
        <ErrorBox error={err ?? hot.error} />
        {busy && <p className="muted" aria-live="polite">处理中…</p>}
        <table className="table">
          <thead><tr><th>热榜</th><th>{t('状态')}</th><th>说明</th></tr></thead>
          <tbody>
            {(results ?? hot.data?.runs ?? []).map((r: any) => (
              <tr key={r.board}><td>{r.label ?? r.board}</td><td><StatusBadge status={r.status} />{r.fromCache && <Badge>缓存</Badge>}</td><td className="small">{r.message ?? `${r.count ?? r.items?.length ?? 0} 条`}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      {clusters && (
        <Card title="话题簇">
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
      <Card title="跨榜单合并（最新）">
        <Loading show={hot.loading} />
        <ol className="list compact">
          {hot.data?.merged?.slice(0, 40).map((m: any) => (
            <li key={m.id}><span>{m.title}</span> {m.boards.map((b: any) => <Badge key={b.board}>{b.board}#{b.rank}</Badge>)}</li>
          ))}
        </ol>
        {!hot.loading && !hot.data?.merged?.length && <p className="muted">{t('暂无数据')}</p>}
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
      <Card title={t('信息源')}>
        <ErrorBox error={err ?? src.error} />
        <table className="table">
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
        </table>
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
      <Card title={t('内容库')} actions={<button className="primary" disabled={!sel.length} onClick={() => act(async () => { const r = await post('/api/topics/generate', { itemIds: sel }); say(`生成选题 ${r.topicIds.length} 个`); setSel([]); go('topics'); })}>{t('生成选题')}（{sel.length}）</button>}>
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
        {!items.loading && !list.length && <p className="muted">{t('暂无数据')}</p>}
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
      {!topics.loading && !topics.data?.topics?.length && <p className="muted">{t('暂无数据')}：先在内容库或热点页生成选题。</p>}
    </div>
  );
}
