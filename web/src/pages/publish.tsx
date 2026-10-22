import { createElement, useCallback, useEffect, useState } from 'react';
import { get, post } from '../api';
import { useT } from '../i18n';
import { copyText, electronBridge, openExternal, runtime, type LoginState } from '../runtime';
import { Badge, Card, ErrorBox, Field, Loading, useLoad, useToast } from '../ui';
import { LocalAppLauncher, useLocalApps } from './localapps';
import { useAddApp } from '../components/addAppContext';

export { PLATFORM_LABEL } from '../format';
import { PLATFORM_LABEL } from '../format';

export const LOGIN_LABEL: Record<LoginState, [string, 'ok' | 'neutral' | 'warn']> = { saved: ['已保存会话', 'ok'], none: ['未登录', 'neutral'], expired: ['会话已被平台过期', 'warn'] };

/** 桌面端各平台登录状态：只根据该平台分区内是否存在其域名的 Cookie（主进程只数数量，不读值）。 */
export function useLoginStatus(ids: string[]) {
  const [status, setStatus] = useState<Record<string, LoginState>>({});
  const key = ids.join(',');
  const refresh = useCallback(async () => {
    const b = electronBridge()?.creator;
    if (!b || !key) return;
    try { setStatus(await b.status(key.split(','))); } catch { /* 忽略 */ }
  }, [key]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, refresh };
}

/** 桌面端 webview：恢复上次地址；每个平台独立持久分区。 */
function CreatorWebview({ center, onNavigate }: { center: any; onNavigate: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const b = electronBridge()?.creator;
    (b ? b.lastUrl(center.id).catch(() => null) : Promise.resolve(null)).then((u) => { if (alive) setSrc(u || center.url); });
    return () => { alive = false; };
  }, [center.id, center.url]);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.addEventListener('did-navigate', onNavigate);
  }, [onNavigate]);
  if (!src) return <Loading show />;
  return createElement('webview', { key: center.id, ref, src, partition: `persist:creator-${center.id}`, className: 'webview', allowpopups: 'false', title: center.label });
}

/** 创作中心：用户自己登录、自己操作。Agent 不注入脚本、不读取页面、不自动点击。每个平台提供网页端与本地应用两种方式。 */
export function CreatorCenters({ active, setActive }: { active: string; setActive: (id: string) => void }) {
  const { t } = useT();
  const c = useLoad(() => get('/api/creator-centers'));
  const { version } = useAddApp();
  const apps = useLocalApps(version);
  const rt = runtime();
  const centers: any[] = c.data?.centers ?? [];
  const cur = centers.find((x) => x.id === active) ?? centers[0];
  const [mode, setMode] = useState<'web' | 'app'>('web');
  const { status, refresh } = useLoginStatus(rt === 'electron' ? centers.map((x) => x.id) : []);
  const [toast, say] = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const st = cur ? status[cur.id] : undefined;
  return (
    <div className="creator">
      {toast}
      <div role="tablist" className="tabs seg-tabs" aria-label="平台">
        {centers.map((x) => (
          <button key={x.id} role="tab" aria-selected={cur?.id === x.id} className={cur?.id === x.id ? 'active' : ''} onClick={() => setActive(x.id)}>
            {String(x.label).replace(/创作者中心|创作服务平台|助手|创作中心/g, '').trim() || x.label}{status[x.id] === 'saved' ? <span className="tab-dot ok" role="img" aria-label={t('已保存会话')} /> : status[x.id] === 'expired' ? <span className="tab-dot warn" role="img" aria-label={t('会话已被平台过期')} /> : null}
          </button>
        ))}
      </div>
      <ErrorBox error={c.error} />
      {cur && (
        <>
          <div className="row wrap between">
            <div role="tablist" className="tabs segmented" aria-label="方式">
              <button role="tab" aria-selected={mode === 'web'} className={mode === 'web' ? 'active' : ''} onClick={() => setMode('web')}>{t('网页端')}（{t('创作中心')}）</button>
              <button role="tab" aria-selected={mode === 'app'} className={mode === 'app' ? 'active' : ''} onClick={() => setMode('app')}>{t('本地软件')}</button>
            </div>
            {mode === 'web' && rt === 'electron' && (
              <div className="row wrap">
                {st && <Badge tone={LOGIN_LABEL[st][1]}>{t(LOGIN_LABEL[st][0])}</Badge>}
                <button onClick={() => void refresh()}>{t('刷新')}</button>
                <button className="danger" onClick={async () => {
                  if (!window.confirm(`确定退出「${cur.label}」吗？将清除本机保存的该平台登录信息（Cookie、本地存储与缓存），下次需要重新登录。`)) return;
                  await electronBridge()?.creator?.logout(cur.id);
                  say('已清除该平台登录信息');
                  await refresh();
                  setReloadKey((k) => k + 1);
                }}>{t('退出登录/清除登录')}</button>
              </div>
            )}
          </div>
          {mode === 'app' ? <LocalAppLauncher platform={cur.id} data={apps.data} /> : (
            <>
              <p className="muted small">由你本人登录与操作；登录态只保存在本机，直到你点击“退出登录/清除登录”（平台也可能因改密、安全校验等原因让会话失效，届时重新登录即可）。本应用不会在该页面中执行任何自动点击、脚本注入或数据读取。</p>
              {rt === 'electron'
                ? <CreatorWebview key={`${cur.id}-${reloadKey}`} center={cur} onNavigate={refresh} />
                : (
                  <Card icon="creator" title={cur.label}>
                    <p>{rt === 'web'
                      ? '网页版中，官方创作后台禁止被嵌入，因此在新标签页打开；登录态由你的浏览器保存。'
                      : '在系统浏览器组件中打开官方创作后台（Android 为 Custom Tabs，与系统浏览器共享登录；iOS 为 SFSafariViewController，登录态由系统在本机保存）。'}</p>
                    <p className="muted small">{t('登录状态')}：由浏览器保存，本应用无法也不会检测。</p>
                    <div className="row wrap">
                      <button className="primary" onClick={() => openExternal(cur.url)}>{t('打开')} {cur.url}</button>
                      <button onClick={() => setMode('app')}>{t('用 App 打开')}</button>
                    </div>
                  </Card>
                )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export function ReplyDraft() {
  const [comment, setComment] = useState('');
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  return (
    <Card icon="inbox" title="评论/私信回复草稿">
      {toast}
      <p className="muted small">把评论或私信粘贴进来，系统只生成回复草稿；由你确认后在 App 内自行发送。</p>
      <Field label="评论内容"><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <button disabled={!comment} onClick={async () => { setErr(null); try { setOut(await post('/api/replies/draft', { comment })); } catch (e) { setErr(e); } }}>生成草稿</button>
      <ErrorBox error={err} />
      {out && <div className="alert info"><p>{out.draft}</p><button onClick={async () => say((await copyText(out.draft)) ? '已复制' : '复制失败')}>复制</button><div className="muted small">{out.notice}</div></div>}
    </Card>
  );
}

export function Analytics() {
  const { t } = useT();
  const sum = useLoad(() => get('/api/analytics/summary'));
  const [platform, setPlatform] = useState('douyin');
  const [review, setReview] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  return (
    <div className="grid">
      {toast}
      <Card icon="library" title={t('导入CSV')}>
        <p className="muted small">从各平台后台导出数据 CSV 后上传。自动识别“标题、播放/阅读、点赞、评论、收藏、分享、发布时间”等列。</p>
        <div className="form-row">
          <Field label="平台"><select value={platform} onChange={(e) => setPlatform(e.target.value)}>{Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="CSV 文件"><input type="file" accept=".csv,text/csv" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setErr(null);
            try { const r = await post('/api/analytics/import', { csv: await f.text(), platform }); say(`导入 ${r.rows} 行`); sum.reload(); } catch (x) { setErr(x); }
          }} /></Field>
        </div>
        <ErrorBox error={err} />
      </Card>
      <Card icon="analytics" title={t('复盘')} actions={<button className="primary" disabled={!sum.data?.count} onClick={async () => { setErr(null); try { setReview(await post('/api/analytics/review')); } catch (x) { setErr(x); } }}>{t('生成复盘')}</button>}>
        {sum.data && (
          <>
            <p>样本 {sum.data.count} 条 {sum.data.note && <Badge tone="warn">{sum.data.note}</Badge>}</p>
            <div className="stats">{Object.entries(sum.data.totals ?? {}).map(([k, v]) => <div className="stat" key={k}><b>{String(v)}</b><span>{k}</span></div>)}</div>
            <ol className="small">{sum.data.top?.map((x: any) => <li key={x.title}>{x.title}：互动率 {x.engagement}%</li>)}</ol>
          </>
        )}
        {review && <div className="alert info"><pre className="pre">{review.review}</pre><div className="muted small">{review.provider}{review.mock ? '（模拟）' : ''}</div></div>}
      </Card>
      <ReplyDraft />
    </div>
  );
}
