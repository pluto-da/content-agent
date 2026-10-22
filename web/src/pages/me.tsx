import { useEffect, useState } from 'react';
import { useStoreChange } from '../local/useStore';
import { ApiError, apiMode, del, get, post } from '../api';
import { useT, type Lang } from '../i18n';
import { Icon } from '../icons';
import { ME_GROUPS, type Layout } from '../nav';
import { CENTERS, center } from '../data/platforms';
import { canClearBuiltin, clearAllBuiltin, clearBuiltin } from '../builtin';
import { ASSISTANTS } from '../data/assistants';
import { HOT_SOURCES } from '../local/hot';
import { getAssistantOverrides, getPrefs, setAssistantOverride, setPrefs, usageToday, type AssistantOverride, type Prefs, type UsageDay } from '../local/store';
import { HARD_BOUNDARIES } from '../../../server/src/boundaries';
import { useLocalApps, OS_LABEL } from '../format';
import { Busy, EmptyState, ErrorNext, GroupList, ListRow, Problem, useToast } from '../ui';
import { ModelsPage } from './me/models';
import { SourcesPage } from './me/sources';
import { ProfilePage } from './me/profile';
import { KEEP_ALIVE_MAX, KEEP_ALIVE_MIN } from '../browser/pool';
import { ModelPicker, type Pick } from '../components/ModelPicker';
import { useAddApp } from '../components/addAppContext';
import type { Theme } from '../state';

export function Me({ sub, id, go, lay, theme, setTheme, lang, setLang }: { sub: string; id: string | null; go: (to: string) => void; lay: Layout; theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
  switch (sub) {
    case 'models': return <ModelsPage id={id} go={go} lay={lay} />;
    case 'platforms': return <PlatformsSub go={go} />;
    case 'sources': return <SourcesPage />;
    case 'profile': return <ProfilePage />;
    case 'agent': return <AgentSub go={go} />;
    case 'prefs': return <PrefsSub theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
    case 'backup': return <BackupSub />;
    case 'logs': return <LogsSub />;
    case 'server': return <ServerSub />;
    default: return <MeIndex go={go} />;
  }
}

/** “我的”首页：今日用量卡 + 分组列表（图标 + 文字 + ›）。 */
function MeIndex({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [u, setU] = useState<UsageDay | null>(null);
  useEffect(() => { void usageToday().then(setU); }, []);
  useStoreChange(['kv:usage'], () => void usageToday().then(setU));
  const mode = apiMode();
  return (
    <div className="page page-narrow">
      <section className="group" aria-label={t('今日用量')}>
        <div className="group-list" style={{ padding: '16px 18px' }} data-testid="usage-card">
          <div className="flex items-baseline justify-between gap-3"><span className="text-[15px] text-fg">{t('今日用量')}</span><span className="text-[13px] text-muted">{mode === 'server' ? t('已连接服务器') : t('本机模式')}</span></div>
          <div className="mt-2 flex items-baseline gap-4"><span className="text-[28px] font-semibold tabular-nums text-fg">¥{(u?.cost ?? 0).toFixed(3)}</span><span className="text-[14px] text-muted">{u?.calls ?? 0} {t('次调用')}</span></div>
          <div className="bar mt-3" aria-hidden="true"><span style={{ width: `${Math.min(100, ((u?.cost ?? 0) / 1) * 100)}%` }} /></div>
          <p className="m-0 mt-2 text-[13px] text-muted">{t('进度条按每天 ¥1 计；花费按服务商公开单价估算。')}</p>
        </div>
      </section>
      {ME_GROUPS.map((g) => (
        <GroupList key={g.title} title={t(g.title)}>
          {g.items.map((n) => <ListRow key={n.id} icon={n.icon} label={t(n.label)} hint={t(n.desc)} onClick={() => go(n.id)} href={`#${n.id}`} testId={`me-${n.id.replace('/', '-')}`} />)}
        </GroupList>
      ))}
    </div>
  );
}

function PlatformsSub({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { open: openAdd, version } = useAddApp();
  const apps = useLocalApps(version);
  const [prefs, setP] = useState<Prefs | null>(null);
  const [toast, show] = useToast();
  useEffect(() => { void getPrefs().then(setP); }, []);
  useStoreChange(['kv:prefs'], () => void getPrefs().then(setP));
  const toggle = async (id: string) => {
    if (!prefs) return;
    const on = prefs.platforms.includes(id);
    setP(await setPrefs({ platforms: on ? prefs.platforms.filter((x) => x !== id) : [...prefs.platforms, id] }));
  };
  const reg = apps.data?.apps ?? [];
  return (
    <div className="page page-narrow">
      {toast}
      <GroupList title={t('我要发的平台')}>
        {CENTERS.map((c) => {
          const has = reg.some((a) => a.platform === c.id);
          return (
            <li key={c.id}>
              <label className="list-row cursor-pointer">
                <input type="checkbox" checked={!!prefs?.platforms.includes(c.id)} onChange={() => void toggle(c.id)} aria-label={c.label} />
                <span className="row-text"><span className="row-label">{c.label}</span><span className="row-hint">{has ? t('手机上的 App 已登记') : t('还没登记手机上的 App')}</span></span>
                {!has && <button type="button" onClick={(e) => { e.preventDefault(); openAdd(c.id); }}>{t('加入 App')}</button>}
              </label>
            </li>
          );
        })}
      </GroupList>
      <GroupList title={t('已登记的软件')}>
        {apps.error && <li className="p-4"><Problem title={apps.error.message} advice={apps.error.advice} action={t('重试')} onAction={apps.reload} /></li>}
        {reg.map((a) => (
          <li key={a.id}>
            <div className="list-row static">
              <span className="row-ico"><Icon name="phone" size={18} /></span>
              <span className="row-text"><span className="row-label">{a.label}</span><span className="row-hint">{OS_LABEL[a.os]} · {a.package_name || a.url_scheme || a.protocol || a.exec_path}</span></span>
              {canClearBuiltin() && center(a.platform) && <button type="button" className="ghost" onClick={async () => show((await clearBuiltin(center(a.platform)!)).message)} data-testid="clear-builtin">{t('退出该平台登录')}</button>}
              <button type="button" className="ghost danger" onClick={() => void del(`/api/local-apps/${a.id}`).then(() => { show(t('已移除')); apps.reload(); })}>{t('移除')}</button>
            </div>
          </li>
        ))}
        <ListRow icon="plus" label={t('添加软件')} hint={t('只保存打开 App 用的信息，不保存任何账号')} onClick={() => openAdd()} />
      </GroupList>
      {canClearBuiltin() && (
        <GroupList title={t('内置网页')}>
          <ListRow icon="shield" label={t('清除全部内置网页数据')} hint={t('退出所有平台在本软件内的网页登录（Cookie 与网页存储）')} onClick={async () => { if (window.confirm(t('确定退出所有平台的内置网页登录？'))) show((await clearAllBuiltin()).message); }} />
        </GroupList>
      )}
      <p className="px-1 text-[13px] text-muted">{t('“添加软件”只能打开 App、官方网页版或调用系统分享，不会自动操作其他 App 或网页。')} <button type="button" className="ghost" onClick={() => go('publish')}>{t('去发布')} ›</button></p>
    </div>
  );
}

function AgentSub({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [ov, setOv] = useState<Record<string, AssistantOverride>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [toast, show] = useToast();
  useEffect(() => { void getAssistantOverrides().then(setOv); }, []);
  useStoreChange(['kv:assistants'], () => void getAssistantOverrides().then(setOv));
  const a = ASSISTANTS.find((x) => x.platform === open);
  return (
    <div className="page page-narrow">
      {toast}
      {!a ? (
        <>
          <GroupList title={t('写作助手（每个平台一套写法）')}>
            {ASSISTANTS.map((x) => <ListRow key={x.platform} icon="agent" label={x.description.replace(/^把选题/, '').slice(0, 24) || x.name} hint={ov[x.platform] ? t('已自定义') : t('默认写法')} onClick={() => setOpen(x.platform)} />)}
          </GroupList>
          <GroupList title={t('硬边界（不可修改）')}>
            {HARD_BOUNDARIES.map((b) => <li key={b}><div className="list-row static"><span className="row-ico"><Icon name="shield" size={18} /></span><span className="row-text"><span className="row-hint !text-[14px] !text-fg-2">{b}</span></span></div></li>)}
          </GroupList>
        </>
      ) : (
        <AssistantEdit key={a.platform} a={a} ov={ov[a.platform]} go={go} onBack={() => setOpen(null)} onSaved={async (o) => { await setAssistantOverride(a.platform, o); setOv(await getAssistantOverrides()); show(o ? t('已保存') : t('已恢复默认')); }} />
      )}
    </div>
  );
}

function AssistantEdit({ a, ov, go, onBack, onSaved }: { a: (typeof ASSISTANTS)[number]; ov?: AssistantOverride; go: (to: string) => void; onBack: () => void; onSaved: (o: AssistantOverride | null) => Promise<void> }) {
  const { t } = useT();
  const [body, setBody] = useState(ov?.body ?? a.body);
  const [pick, setPick] = useState<Pick>({ providerId: ov?.providerId ?? null, model: ov?.model ?? null });
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center gap-2"><button type="button" className="ghost !px-1" aria-label={t('返回')} onClick={onBack}><Icon name="arrowLeft" size={18} /></button><h2 className="grow">{a.description}</h2></div>
      <label className="field !m-0"><span>{t('写作指令')}</span><textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="flex flex-col gap-1"><span className="text-[14px] font-medium text-fg">{t('这个助手用的模型')}</span><ModelPicker value={pick} onChange={setPick} go={go} /></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="primary" onClick={() => void onSaved({ body: body.trim() === a.body.trim() ? undefined : body, providerId: pick.providerId, model: pick.model })}>{t('保存')}</button>
        <button type="button" onClick={() => { setBody(a.body); setPick({ providerId: null, model: null }); void onSaved(null); }}>{t('恢复默认')}</button>
      </div>
    </section>
  );
}

function PrefsSub({ theme, setTheme, lang, setLang }: { theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
  const { t } = useT();
  const [prefs, setP] = useState<Prefs | null>(null);
  useEffect(() => { void getPrefs().then(setP); }, []);
  useStoreChange(['kv:prefs'], () => void getPrefs().then(setP));
  const seg = <T extends string>(val: T, opts: [T, string][], on: (v: T) => void, label: string) => (
    <div className="seg" role="group" aria-label={label}>{opts.map(([v, l]) => <button key={v} type="button" aria-pressed={val === v} onClick={() => on(v)}>{t(l)}</button>)}</div>
  );
  return (
    <div className="page page-narrow">
      <GroupList title={t('外观')}>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('主题')}</span></span>{seg(theme, [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], setTheme, t('主题'))}</div></li>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('语言')}</span></span>{seg(lang, [['zh', '中文'], ['en', 'English']], setLang, t('语言'))}</div></li>
      </GroupList>
      <GroupList title={t('工作台')}>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('同时保活的平台数')}</span><span className="row-hint">{t('超过后最久没用的平台会休眠，切回时按上次地址重新打开')}</span></span>
          <div className="seg" role="group" aria-label={t('同时保活的平台数')}>{Array.from({ length: KEEP_ALIVE_MAX - KEEP_ALIVE_MIN + 1 }, (_, i) => i + KEEP_ALIVE_MIN).map((n) => <button key={n} type="button" aria-pressed={(prefs?.keepAlive ?? 4) === n} onClick={async () => setP(await setPrefs({ keepAlive: n }))}>{n}</button>)}</div></div></li>
        <li><label className="list-row cursor-pointer"><input type="checkbox" checked={!!prefs?.bindSessions} onChange={async () => setP(await setPrefs({ bindSessions: !prefs?.bindSessions }))} /><span className="row-text"><span className="row-label">{t('平台↔会话绑定')}</span><span className="row-hint">{t('打开某平台时，Agent 面板自动切到该平台的会话')}</span></span></label></li>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('Agent 面板停靠')}</span></span>{seg(prefs?.agentDock ?? 'right', [['right', '右侧'], ['left', '左侧']], async (v) => setP(await setPrefs({ agentDock: v })), t('Agent 面板停靠'))}</div></li>
      </GroupList>
      <GroupList title={t('公开热点来源（更多数据源在“我的 → 数据源”）')}>
        {HOT_SOURCES.map((s) => (
          <li key={s.id}><label className="list-row cursor-pointer"><input type="checkbox" checked={!!prefs?.hotSources.includes(s.id)} onChange={async () => { if (!prefs) return; const on = prefs.hotSources.includes(s.id); setP(await setPrefs({ hotSources: on ? prefs.hotSources.filter((x) => x !== s.id) : [...prefs.hotSources, s.id] })); }} aria-label={s.label} /><span className="row-text"><span className="row-label">{s.label}</span><span className="row-hint">{s.kind === 'rss' ? t('官方 RSS') : t('公开榜单（先检查 robots.txt）')}</span></span></label></li>
        ))}
      </GroupList>
    </div>
  );
}

function BackupSub() {
  const { t } = useT();
  const [withKeys, setWithKeys] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const exportNow = async () => {
    setErr(null);
    try {
      const data = await get(`/api/backup/export${withKeys ? '?keys=1' : ''}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `content-agent-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setMsg(withKeys ? t('已导出（含 Key，请妥善保管文件）') : t('已导出（不含 Key）'));
    } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e))); }
  };
  const importFile = async (f: File) => {
    setErr(null);
    try { const r = await post<{ restored?: number }>('/api/backup/import', JSON.parse(await f.text())); setMsg(`${t('已恢复')} ${r.restored ?? ''} ${t('条记录')}`); }
    catch (e) { setErr(e instanceof ApiError ? e : new ApiError('import_failed', t('文件读不出来'), t('请选择本应用导出的 .json 备份文件'))); }
  };
  return (
    <div className="page page-narrow flex flex-col gap-4">
      <p className="m-0 text-[15px] text-fg-2">{t('数据只存在这台设备上。换手机或清理数据前，先导出一份。')}</p>
      <GroupList title={t('导出')}>
        <li><label className="list-row cursor-pointer"><input type="checkbox" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} aria-label={t('同时导出 API Key')} /><span className="row-text"><span className="row-label">{t('同时导出 API Key')}</span><span className="row-hint">{t('默认不包含；包含时请勿把文件发给别人')}</span></span></label></li>
        <ListRow icon="backup" label={t('导出备份文件')} onClick={() => void exportNow()} testId="export" />
      </GroupList>
      <GroupList title={t('恢复')}>
        <li><label className="list-row cursor-pointer"><span className="row-ico"><Icon name="upload" size={18} /></span><span className="row-text"><span className="row-label">{t('从备份文件恢复')}</span><span className="row-hint">{t('会替换当前的草稿、选题、软件与数据')}</span></span><input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} /></label></li>
      </GroupList>
      {msg && <p className="ok-line m-0" role="status"><Icon name="check" size={16} />{msg}</p>}
      <ErrorNext error={err} />
    </div>
  );
}

function LogsSub() {
  const { t } = useT();
  const [logs, setLogs] = useState<{ id: number; level: string; message: string; created_at?: string; at?: string }[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = () => { get<{ logs: any[] }>('/api/logs').then((r) => setLogs(r.logs)).catch((e) => setErr(e)); };
  useEffect(load, []);
  return (
    <div className="page page-narrow flex flex-col gap-3">
      <ErrorNext error={err} action={t('重新加载')} onAction={load} />
      {logs && !logs.length && <div className="card !p-0"><EmptyState icon="tasks" title={t('还没有记录')} why={t('生成、读取热点、添加软件后，这里会记下结果和失败原因。')} /></div>}
      {logs && logs.length > 0 && (
        <ul className="item-list">
          {logs.map((l, i) => (
            <li key={l.id ?? i}>
              <span className={`status-dot ${l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : 'ok'}`} aria-label={l.level} />
              <span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{l.message}</span><span className="item-meta">{(l.created_at ?? l.at ?? '').replace('T', ' ').slice(0, 19)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 连接自己的服务器（可选）：填地址与口令 → 测试连接 → 连上后数据走服务端；否则继续本机模式。 */
function ServerSub() {
  const { t } = useT();
  const [addr, setAddr] = useState(localStorage.getItem('ca.server') ?? '');
  const [token, setToken] = useState(localStorage.getItem('ca.token') ?? '');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(apiMode() === 'server' ? t('已连接服务器') : null);
  const [err, setErr] = useState<{ message: string; advice?: string } | null>(null);
  const test = async () => {
    setBusy(true); setErr(null); setOk(null);
    const base = addr.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//.test(base)) { setErr({ message: t('地址不对'), advice: t('以 http:// 或 https:// 开头，例如 http://192.168.1.10:8787') }); setBusy(false); return; }
    if (/154\.8\.183\.93/.test(base)) { setErr({ message: t('不能使用这个地址'), advice: t('该服务器不在允许范围内') }); setBusy(false); return; }
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(`${base}/api/health`, { headers: token ? { 'x-access-token': token } : {}, signal: ctl.signal });
      clearTimeout(tm);
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) throw Object.assign(new Error(t('口令不对')), { advice: t('填服务器 .env 里的 CA_ACCESS_TOKEN') });
      if (!r.ok || !j.ok) throw Object.assign(new Error(`${t('服务器返回')} ${r.status}`), { advice: t('确认地址指向内容运营助手的服务端') });
      // 健康检查不需要口令；再读一个需要口令的接口，确认口令正确
      const r2 = await fetch(`${base}/api/notifications`, { headers: token ? { 'x-access-token': token } : {} });
      if (r2.status === 401) throw Object.assign(new Error(t('口令不对')), { advice: t('填服务器 .env 里的 CA_ACCESS_TOKEN') });
      localStorage.setItem('ca.server', base); localStorage.setItem('ca.token', token); localStorage.setItem('ca.mode', 'server');
      setOk(`${t('已连接服务器')}（${t('版本')} ${j.version ?? '?'}）`);
    } catch (e) {
      const x = e as Error & { advice?: string };
      setErr(x.advice ? { message: x.message, advice: x.advice } : { message: t('连不上服务器'), advice: t('检查地址、端口和网络；手机和服务器需要能互相访问') });
    } finally { setBusy(false); }
  };
  const disconnect = () => { localStorage.setItem('ca.mode', 'local'); setOk(null); };
  return (
    <div className="page page-narrow flex flex-col gap-3">
      <p className="m-0 text-[15px] text-fg-2">{t('不连服务器也能完整使用。连上自己的服务器后，可以用配音、配图、合成视频等重活。')}</p>
      <div className="card flex flex-col gap-1">
        <label className="field"><span>{t('服务器地址')}</span><input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="http://192.168.1.10:8787" spellCheck={false} data-testid="server-addr" /></label>
        <label className="field"><span>{t('访问口令（没有可不填）')}</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
        <button type="button" className="primary !min-h-12" onClick={() => void test()} disabled={busy} data-testid="server-test">{busy ? <Busy label={t('正在测试…')} /> : t('测试连接')}</button>
        {ok && <p className="ok-line m-0 mt-2" role="status" data-testid="server-ok"><Icon name="check" size={18} />{ok}</p>}
        {err && <div className="mt-2"><Problem title={err.message} advice={err.advice} /></div>}
        {apiMode() === 'server' && <button type="button" className="mt-2" onClick={disconnect}>{t('断开，回到本机模式')}</button>}
      </div>
    </div>
  );
}
