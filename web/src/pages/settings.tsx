import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { useT, type Lang } from '../i18n';
import { runtime, serverBase } from '../runtime';
import { Card, ErrorBox, Field, useLoad, useToast } from '../ui';

export type Theme = 'light' | 'dark' | 'system';

const SECRET_LABELS: Record<string, string> = {
  'wechat.appid': '公众号 AppID', 'wechat.secret': '公众号 AppSecret', 'wechat.thumb_media_id': '公众号默认封面 media_id',
  'x.bearer': 'X Bearer Token', 'douyin.access_token': '抖音 access_token（用户授权）', 'douyin.open_id': '抖音 open_id',
  'model.dashscope.key': '百炼 DashScope API Key', 'model.deepseek.key': 'DeepSeek API Key', 'model.mimo.key': '小米 MiMo API Key（sk- 按量 / tp- Token Plan）', 'model.zhipu.key': '智谱 API Key', 'model.ark.key': '火山方舟 API Key',
  'model.minimax.key': 'MiniMax API Key', 'model.kimi.key': 'Kimi API Key', 'model.openai.key': 'OpenAI API Key', 'model.anthropic.key': 'Anthropic API Key',
  'model.gemini.key': 'Gemini API Key', 'model.elevenlabs.key': 'ElevenLabs API Key',
};

/** 0.5.0：原设置中心的通用 / 密钥 / 模型路由 / 备份组件，分别挂在“偏好”与“模型”两页。 */
export function General({ theme, setTheme, lang, setLang }: { theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
  const { t } = useT();
  const s = useLoad(() => get('/api/settings'));
  const [proxy, setProxy] = useState('');
  const [kw, setKw] = useState('');
  const [server, setServer] = useState(localStorage.getItem('ca.server') ?? '');
  const [token, setToken] = useState(localStorage.getItem('ca.token') ?? '');
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  useEffect(() => { if (s.data) { setProxy(s.data.proxy ?? ''); setKw((s.data.hotKeywords ?? []).join('，')); } }, [s.data]);
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr(e); } };
  return (
    <div className="grid">
      {toast}
      <Card icon="sun" title={`${t('主题')} / ${t('语言')}`}>
        <div className="form-row">
          <Field label={t('主题')}><select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="system">{t('跟随系统')}</option><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option></select></Field>
          <Field label={t('语言')}><select value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="zh">简体中文</option><option value="en">English</option></select></Field>
        </div>
      </Card>
      <Card icon="activity" title={t('连接')}>
        {runtime() !== 'web' && <Field label={t('服务地址')} hint="运行后端的电脑或你自己的服务器，例如 http://192.168.1.10:8787"><input value={server} onChange={(e) => setServer(e.target.value)} /></Field>}
        <Field label={t('访问口令')} hint="与后端环境变量 CA_ACCESS_TOKEN 一致；仅保存在本机"><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
        <div className="actions">
          <button onClick={() => { localStorage.setItem('ca.server', server); localStorage.setItem('ca.token', token); say('已保存到本机'); s.reload(); }}>{t('保存')}</button>
          <span className="muted small">当前服务：{serverBase() || '同源'}</span>
        </div>
      </Card>
      <Card icon="hot" title={`${t('代理')} / 采集`}>
        <ErrorBox error={err ?? s.error} />
        <Field label={t('代理')} hint="境外模型、X API、Google Trends 走此代理（如本机 VPN 客户端的 HTTP 代理端口）；国内模型与平台默认直连"><input value={proxy} placeholder="http://127.0.0.1:7890" onChange={(e) => setProxy(e.target.value)} /></Field>
        <Field label="热点关注关键词（逗号分隔，用于本地通知）"><input value={kw} onChange={(e) => setKw(e.target.value)} /></Field>
        <div className="actions">
          <button className="primary" onClick={() => act(async () => { await put('/api/settings', { proxy, hotKeywords: kw.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }); say('已保存'); })}>{t('保存')}</button>
        </div>
      </Card>
    </div>
  );
}

/** 常用（默认展开）的密钥；其余放在“更多密钥”折叠里。已配置的总是显示。 */
const COMMON_SECRETS = ['model.mimo.key', 'model.deepseek.key', 'model.dashscope.key', 'wechat.appid', 'wechat.secret', 'x.bearer'];

export function Secrets() {
  const { t } = useT();
  const s = useLoad(() => get('/api/settings'));
  const [secretVals, setSecretVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr(e); } };
  const entries = Object.entries(s.data?.secrets ?? {}) as [string, any][];
  const groups: [string, (n: string) => boolean][] = [['模型', (n) => n.startsWith('model.')], ['平台', (n) => !n.startsWith('model.')]];
  const row = ([name, v]: [string, any]) => (
    <li key={name}>
      <Field label={SECRET_LABELS[name] ?? name}>
        <div className="row secret-row">
          <input type="password" autoComplete="off" placeholder={v.configured ? `${t('已配置')} ${v.hint}` : t('未配置')} value={secretVals[name] ?? ''} onChange={(e) => setSecretVals({ ...secretVals, [name]: e.target.value })} />
          <button onClick={() => act(async () => { await put(`/api/secrets/${name}`, { value: secretVals[name] ?? '' }); setSecretVals({ ...secretVals, [name]: '' }); s.reload(); say('已更新'); })}>{t('保存')}</button>
        </div>
      </Field>
    </li>
  );
  return (
    <div className="grid">
      {toast}
      <Card title={t('密钥')} subtitle={t('只保存在后端本机的加密密钥库，界面只显示末四位；不会进入前端包、日志或备份。')}>
        <ErrorBox error={err ?? s.error} />
        {groups.map(([g, f]) => {
          const list = entries.filter(([n]) => f(n));
          const shown = list.filter(([n, v]) => v.configured || COMMON_SECRETS.includes(n)).slice(0, Math.max(4, list.filter(([, v]) => v.configured).length));
          const rest = list.filter((e) => !shown.includes(e));
          return (
            <div key={g} className="mb-2">
              <h3>{t(g)}</h3>
              <ul className="secrets">{shown.map(row)}</ul>
              {rest.length > 0 && <details className="adv"><summary>{t('更多密钥')}（{rest.length}）</summary><ul className="secrets">{rest.map(row)}</ul></details>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/** 模型 → 路由：默认只显示“能力 / 服务商 / 模型”（+ 状态点）；备用、思考、接入地址、单价收进“高级”。接口调用与 0.4.1 完全一致。 */
export function Models() {
  const { t } = useT();
  const m = useLoad(() => get('/api/models'));
  const [routes, setRoutes] = useState<Record<string, any>>({});
  const [prices, setPrices] = useState('{}');
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const [dirty, setDirty] = useState(false);
  // 重新加载（如切换接入地址）时不覆盖尚未保存的路由修改
  useEffect(() => { if (m.data) { if (!dirty) setRoutes(m.data.routes ?? {}); setPrices(JSON.stringify(m.data.prices ?? {}, null, 2)); } }, [m.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const providersFor = (cap: string) => (m.data?.providers ?? []).filter((p: any) => p.capabilities.includes(cap));
  const setRoute = (cap: string, key: 'default' | 'fallback', provider: string, model?: string) => {
    const r = { ...(routes[cap] ?? {}) };
    const prev = r[key] ?? {};
    // 换服务商时清掉旧模型名；保留思考模式等其他字段
    if (!provider) delete r[key]; else r[key] = { ...prev, provider, model: (prev.provider === provider ? model : undefined) || undefined };
    setRoutes({ ...routes, [cap]: r });
    setDirty(true);
  };
  const setThinking = (cap: string, v: string) => {
    const r = { ...(routes[cap] ?? {}) };
    if (!r.default) return;
    const d = { ...r.default };
    if (v === '') delete d.thinking; else d.thinking = v === 'on';
    setRoutes({ ...routes, [cap]: { ...r, default: d } });
    setDirty(true);
  };
  const providerOf = (id?: string) => (m.data?.providers ?? []).find((p: any) => p.id === id);
  const presetProviders = (m.data?.providers ?? []).filter((p: any) => p.baseURLPresets?.length);
  const defaultPrices: Record<string, any> = m.data?.defaultPrices ?? {};
  const caps: any[] = m.data?.capabilities ?? [];
  return (
    <Card title={t('按能力选择模型')} subtitle={t('每种能力用哪个服务商、哪个模型；改完点保存。')}>
      {toast}
      <ErrorBox error={err ?? m.error} />
      <div className="table-wrap">
        <table className="table routes-table">
          <thead><tr><th>{t('能力')}</th><th>{t('服务商')}</th><th>{t('模型')}</th></tr></thead>
          <tbody>
            {caps.map((c: any) => {
              const r = routes[c.id] ?? {};
              return (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td><select aria-label={`${c.label} 服务商`} value={r.default?.provider ?? ''} onChange={(e) => setRoute(c.id, 'default', e.target.value, r.default?.model)}><option value="">{t('未配置')}</option>{providersFor(c.id).map((p: any) => <option key={p.id} value={p.id}>{p.label}{p.ready.ok ? '' : '（缺密钥）'}</option>)}</select></td>
                  <td>
                    <input aria-label={`${c.label} 模型名`} list={`models-${c.id}`} value={r.default?.model ?? ''} placeholder={providerOf(r.default?.provider)?.models?.[c.id] ?? ''} onChange={(e) => setRoute(c.id, 'default', r.default?.provider ?? '', e.target.value)} />
                    <datalist id={`models-${c.id}`}>{(providerOf(r.default?.provider)?.modelOptions ?? []).map((x: string) => <option key={x} value={x} />)}</datalist>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="primary" onClick={async () => { setErr(null); try { await put('/api/models/routes', { routes }); setDirty(false); say('路由已保存'); m.reload(); } catch (e) { setErr(e); } }}>{t('保存')}</button>
        <button onClick={async () => { setErr(null); try { const r = await post('/api/models/test/llm'); say(`${r.provider}/${r.model}：${r.sample}`); } catch (e) { setErr(e); } }}>{t('测试文本模型')}</button>
      </div>
      <details className="adv">
        <summary>{t('高级：备用模型、思考模式、接入地址、单价')}</summary>
        <div className="table-wrap">
          <table className="table routes-table">
            <thead><tr><th>{t('能力')}</th><th>{t('备用服务商')}</th><th>{t('思考')}</th></tr></thead>
            <tbody>
              {caps.map((c: any) => {
                const r = routes[c.id] ?? {};
                return (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td><select aria-label={`${c.label} 备用`} value={r.fallback?.provider ?? ''} onChange={(e) => setRoute(c.id, 'fallback', e.target.value)}><option value="">无</option>{providersFor(c.id).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></td>
                    <td>{c.id === 'llm' ? (
                      <select aria-label={`${c.label} 思考模式`} disabled={!r.default?.provider} value={r.default?.thinking === undefined ? '' : r.default.thinking ? 'on' : 'off'} onChange={(e) => setThinking(c.id, e.target.value)}>
                        <option value="">自动</option><option value="on">开</option><option value="off">关</option>
                      </select>
                    ) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">备用：主模型出错时自动改用它。思考：自动＝按模型名判断（MiMo 等未写明的按“关”处理）；开＝输出更稳但慢且贵，思考内容只留调试，不进成稿；评测始终关闭思考、temperature 0。备用与思考改完也要点上方“保存”。</p>
        {presetProviders.map((p: any) => (
          <Field key={p.id} label={`${p.label} 接入地址`}>
            <select aria-label={`${p.label} 接入地址`} value={p.baseURL} onChange={async (e) => { setErr(null); try { await put(`/api/models/providers/${p.id}`, { baseURL: e.target.value }); say('接入地址已切换'); m.reload(); } catch (x) { setErr(x); } }}>
              {p.baseURLPresets.map((o: any) => <option key={o.url} value={o.url}>{o.label}</option>)}
              {!p.baseURLPresets.some((o: any) => o.url === p.baseURL) && <option value={p.baseURL}>自定义：{p.baseURL}</option>}
            </select>
            {p.modelOptions?.length ? <p className="muted small">可选模型：{p.modelOptions.join('、')}</p> : null}
          </Field>
        ))}
        <h3>{t('单价（用于成本统计）')}</h3>
        <p className="muted small">键为“服务商”或“服务商:模型”。token 为每百万；image 每张；char 每万字；second 每分钟。例如 {'{"deepseek": {"input": 2, "output": 8}}'}</p>
        {Object.keys(defaultPrices).length ? <p className="muted small">内置默认价（元/百万 token，缓存命中/未命中/输出，可在下方同名键覆盖）：{Object.entries(defaultPrices).map(([k, v]) => `${k} ${v.cachedInput ?? '-'}/${v.input ?? '-'}/${v.output ?? '-'}`).join('；')}</p> : null}
        <textarea className="mono" rows={5} value={prices} onChange={(e) => setPrices(e.target.value)} aria-label="单价 JSON" />
        <div className="actions"><button onClick={async () => { setErr(null); try { await put('/api/models/prices', { prices: JSON.parse(prices) }); say('已保存'); } catch (e) { setErr(e); } }}>{t('保存单价')}</button></div>
      </details>
    </Card>
  );
}

export function Backup() {
  const { t } = useT();
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  return (
    <Card icon="inbox" title={t('备份')}>
      {toast}
      <p className="muted small">导出全部业务数据与系统文件为 JSON（不含任何密钥）。导入会覆盖当前数据，导入前自动备份。</p>
      <div className="actions">
        <button onClick={async () => {
          setErr(null);
          try {
            const data = await get('/api/backup/export');
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url; a.download = `content-agent-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
            URL.revokeObjectURL(url);
          } catch (e) { setErr(e); }
        }}>{t('导出')}</button>
        <label className="button-like">{t('导入')}<input type="file" accept="application/json" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f || !confirm('导入会覆盖当前数据（会先自动备份），确定吗？')) return;
          setErr(null);
          try { const r = await post('/api/backup/import', JSON.parse(await f.text())); say(`已恢复：${Object.entries(r.restored).map(([k, v]) => `${k} ${v}`).join('，')}`); } catch (x) { setErr(x); }
        }} /></label>
      </div>
      <ErrorBox error={err} />
    </Card>
  );
}
