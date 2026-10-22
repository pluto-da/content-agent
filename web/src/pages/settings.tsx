import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { useT, type Lang } from '../i18n';
import { runtime, serverBase } from '../runtime';
import { Badge, Card, ErrorBox, Field, useLoad, useToast } from '../ui';

export type Theme = 'light' | 'dark' | 'system';

const SECRET_LABELS: Record<string, string> = {
  'wechat.appid': '公众号 AppID', 'wechat.secret': '公众号 AppSecret', 'wechat.thumb_media_id': '公众号默认封面 media_id',
  'x.bearer': 'X Bearer Token', 'douyin.access_token': '抖音 access_token（用户授权）', 'douyin.open_id': '抖音 open_id',
  'model.dashscope.key': '百炼 DashScope API Key', 'model.deepseek.key': 'DeepSeek API Key', 'model.zhipu.key': '智谱 API Key', 'model.ark.key': '火山方舟 API Key',
  'model.minimax.key': 'MiniMax API Key', 'model.kimi.key': 'Kimi API Key', 'model.openai.key': 'OpenAI API Key', 'model.anthropic.key': 'Anthropic API Key',
  'model.gemini.key': 'Gemini API Key', 'model.elevenlabs.key': 'ElevenLabs API Key',
};

/** 设置中心的“偏好”分组：general（主题/语言/连接/代理）、secrets、models、backup。原设置页功能拆分，不删减。 */
export function SettingsSection({ section, theme, setTheme, lang, setLang }: { section: string; theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
  if (section === 'models') return <div className="grid"><Models /></div>;
  if (section === 'backup') return <div className="grid"><Backup /></div>;
  if (section === 'secrets') return <Secrets />;
  return <General theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
}

/** 兼容旧调用：完整设置页（全部分组依次排列）。 */
export function Settings(props: { theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
  return <div className="grid"><General {...props} /><Secrets /><Models /><Backup /></div>;
}

function General({ theme, setTheme, lang, setLang }: { theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
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
          <button className="primary" onClick={() => { localStorage.setItem('ca.server', server); localStorage.setItem('ca.token', token); say('已保存到本机'); s.reload(); }}>{t('保存')}</button>
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

function Secrets() {
  const { t } = useT();
  const s = useLoad(() => get('/api/settings'));
  const [secretVals, setSecretVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr(e); } };
  return (
    <div className="grid">
      {toast}
      <Card icon="shield" title={t('密钥')}>
        <p className="muted small">密钥只保存在后端本机的加密密钥库（AES-256-GCM），界面只显示末四位；不会进入前端包、日志或备份。</p>
        <ErrorBox error={err ?? s.error} />
        <ul className="secrets">
          {Object.entries(s.data?.secrets ?? {}).map(([name, v]: [string, any]) => (
            <li key={name}>
              <Field label={SECRET_LABELS[name] ?? name}>
                <div className="row secret-row">
                  <input type="password" autoComplete="off" placeholder={v.configured ? `${t('已配置')} ${v.hint}` : t('未配置')} value={secretVals[name] ?? ''} onChange={(e) => setSecretVals({ ...secretVals, [name]: e.target.value })} />
                  <button onClick={() => act(async () => { await put(`/api/secrets/${name}`, { value: secretVals[name] ?? '' }); setSecretVals({ ...secretVals, [name]: '' }); s.reload(); say('已更新'); })}>{t('保存')}</button>
                </div>
              </Field>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Models() {
  const { t } = useT();
  const m = useLoad(() => get('/api/models'));
  const costs = useLoad(() => get('/api/models/costs?days=30'));
  const [routes, setRoutes] = useState<Record<string, any>>({});
  const [prices, setPrices] = useState('{}');
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  useEffect(() => { if (m.data) { setRoutes(m.data.routes ?? {}); setPrices(JSON.stringify(m.data.prices ?? {}, null, 2)); } }, [m.data]);
  const providersFor = (cap: string) => (m.data?.providers ?? []).filter((p: any) => p.capabilities.includes(cap));
  const setRoute = (cap: string, key: 'default' | 'fallback', provider: string, model?: string) => {
    const r = { ...(routes[cap] ?? {}) };
    if (!provider) delete r[key]; else r[key] = { provider, model: model || undefined };
    setRoutes({ ...routes, [cap]: r });
  };
  return (
    <Card icon="cpu" title={`${t('模型')}（按能力分模块）`}>
      {toast}
      <ErrorBox error={err ?? m.error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>能力</th><th>{t('提供方')}</th><th>模型名</th><th>备用</th><th>{t('状态')}</th></tr></thead>
          <tbody>
            {m.data?.capabilities?.map((c: any) => {
              const st = m.data.status.find((x: any) => x.capability === c.id);
              const r = routes[c.id] ?? {};
              return (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td><select aria-label={`${c.label} 提供方`} value={r.default?.provider ?? ''} onChange={(e) => setRoute(c.id, 'default', e.target.value, r.default?.model)}><option value="">{t('未配置')}</option>{providersFor(c.id).map((p: any) => <option key={p.id} value={p.id}>{p.label}{p.ready.ok ? '' : '（缺密钥）'}</option>)}</select></td>
                  <td><input aria-label={`${c.label} 模型名`} value={r.default?.model ?? ''} placeholder={providersFor(c.id).find((p: any) => p.id === r.default?.provider)?.models?.[c.id] ?? ''} onChange={(e) => setRoute(c.id, 'default', r.default?.provider ?? '', e.target.value)} /></td>
                  <td><select aria-label={`${c.label} 备用`} value={r.fallback?.provider ?? ''} onChange={(e) => setRoute(c.id, 'fallback', e.target.value)}><option value="">无</option>{providersFor(c.id).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></td>
                  <td>{st?.configured ? <Badge tone={st.provider === 'mock' ? 'info' : 'ok'}>{st.provider === 'mock' ? t('模拟输出') : t('已配置')}</Badge> : <Badge tone="warn" >{t('未配置')}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="primary" onClick={async () => { setErr(null); try { await put('/api/models/routes', { routes }); say('路由已保存'); m.reload(); } catch (e) { setErr(e); } }}>{t('保存')}</button>
        <button onClick={async () => { setErr(null); try { const r = await post('/api/models/test/llm'); say(`${r.provider}/${r.model}：${r.sample}`); } catch (e) { setErr(e); } }}>{t('测试')} LLM</button>
      </div>
      <details>
        <summary>单价（用于成本统计）</summary>
        <p className="muted small">键为“提供方”或“提供方:模型”。token 为每百万；image 每张；char 每万字；second 每分钟。例如 {'{"deepseek": {"input": 2, "output": 8}}'}</p>
        <textarea className="mono" rows={5} value={prices} onChange={(e) => setPrices(e.target.value)} aria-label="单价 JSON" />
        <div className="actions"><button onClick={async () => { setErr(null); try { await put('/api/models/prices', { prices: JSON.parse(prices) }); say('已保存'); } catch (e) { setErr(e); } }}>{t('保存')}</button></div>
      </details>
      <h3>{t('成本')}（近 30 天）：¥{Number(costs.data?.total ?? 0).toFixed(4)}</h3>
      <div className="table-wrap"><table className="table small">
        <thead><tr><th>能力</th><th>调用</th><th>失败</th><th>费用</th></tr></thead>
        <tbody>{costs.data?.byCapability?.map((c: any) => <tr key={c.capability}><td>{c.capability}</td><td>{c.calls}</td><td>{c.failed}</td><td>{c.cost}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

function Backup() {
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
