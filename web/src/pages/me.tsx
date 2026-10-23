import { useEffect, useState } from 'react';
import { useStoreChange } from '../local/useStore';
import { ApiError, apiMode, del, get } from '../api';
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
import { RolesPage } from './me/v9/roles';
import { AgentSettingsPage, MemoryPage, SkillsPage } from './me/v9/agentfiles';
import { RevenuePage, GrowthPage } from './me/v9/revenue';
import { StatusPage, AuditPage, SettingsV9Page, RemindersPage, BackupV9Page } from './me/v9/ops';
import { SourcesPage } from './me/sources';
import { ProfilePage } from './me/profile';
import { StoragePage } from '../v1/StoragePage';
import { KEEP_ALIVE_MAX, KEEP_ALIVE_MIN } from '../browser/pool';
import { ModelPicker, type Pick } from '../components/ModelPicker';
import { useAddApp } from '../components/addAppContext';
import type { Theme } from '../state';

export function Me({ sub, id, go, lay, theme, setTheme, lang, setLang }: { sub: string; id: string | null; go: (to: string) => void; lay: Layout; theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void }) {
  switch (sub) {
    case 'models': return <RolesPage id={id} go={go} lay={lay} />;
    case 'files': return <AgentSettingsPage go={go} />;
    case 'memory': return <MemoryPage />;
    case 'skills': return <SkillsPage go={go} />;
    case 'revenue': return <RevenuePage />;
    case 'growth': return <GrowthPage />;
    case 'reminders': return <RemindersPage />;
    case 'status': return <StatusPage go={go} id={id} />;
    case 'audit': return <AuditPage />;
    case 'settings': return <SettingsV9Page />;
    case 'platforms': return <PlatformsSub go={go} />;
    case 'sources': return <SourcesPage />;
    case 'profile': return <ProfilePage />;
    case 'agent': return <AgentSub go={go} />;
    case 'prefs': return <PrefsSub theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
    case 'backup': return <BackupV9Page />;
    case 'storage': return <StoragePage />;
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
      <section className="group" aria-label={t('ui.todays_usage')}>
        <div className="group-list" style={{ padding: '16px 18px' }} data-testid="usage-card">
          <div className="flex items-baseline justify-between gap-3"><span className="text-[15px] text-fg">{t('ui.todays_usage')}</span><span className="text-[13px] text-muted">{mode === 'server' ? t('ui.connected_to_server') : t('ui.local_mode')}</span></div>
          <div className="mt-2 flex items-baseline gap-4"><span className="text-[28px] font-semibold tabular-nums text-fg">¥{(u?.cost ?? 0).toFixed(3)}</span><span className="text-[14px] text-muted">{u?.calls ?? 0} {t('ui.calls_3')}</span></div>
          <div className="bar mt-3" aria-hidden="true"><span style={{ width: `${Math.min(100, ((u?.cost ?? 0) / 1) * 100)}%` }} /></div>
          <p className="m-0 mt-2 text-[13px] text-muted">{t('ui.the_bar_assumes_1_per')}</p>
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
      <GroupList title={t('ui.platforms_i_publish_on')}>
        {CENTERS.map((c) => {
          const has = reg.some((a) => a.platform === c.id);
          return (
            <li key={c.id}>
              <label className="list-row cursor-pointer">
                <input type="checkbox" checked={!!prefs?.platforms.includes(c.id)} onChange={() => void toggle(c.id)} aria-label={c.label} />
                <span className="row-text"><span className="row-label">{c.label}</span><span className="row-hint">{has ? t('ui.phone_app_registered') : t('ui.phone_app_not_registered_yet')}</span></span>
                {!has && <button type="button" onClick={(e) => { e.preventDefault(); openAdd(c.id); }}>{t('ui.add_app_2')}</button>}
              </label>
            </li>
          );
        })}
      </GroupList>
      <GroupList title={t('ui.registered_apps')}>
        {apps.error && <li className="p-4"><Problem title={apps.error.message} advice={apps.error.advice} action={t('ui.retry')} onAction={apps.reload} /></li>}
        {reg.map((a) => (
          <li key={a.id}>
            <div className="list-row static">
              <span className="row-ico"><Icon name="phone" size={18} /></span>
              <span className="row-text"><span className="row-label">{a.label}</span><span className="row-hint">{OS_LABEL[a.os]} · {a.package_name || a.url_scheme || a.protocol || a.exec_path}</span></span>
              {canClearBuiltin() && center(a.platform) && <button type="button" className="ghost" onClick={async () => show((await clearBuiltin(center(a.platform)!)).message)} data-testid="clear-builtin">{t('ui.log_out_of_this_platform')}</button>}
              <button type="button" className="ghost danger" onClick={() => void del(`/api/local-apps/${a.id}`).then(() => { show(t('ui.removed')); apps.reload(); })}>{t('ui.remove_2')}</button>
            </div>
          </li>
        ))}
        <ListRow icon="plus" label={t('ui.add_app')} hint={t('ui.only_launch_info_is_stored_2')} onClick={() => openAdd()} />
      </GroupList>
      {canClearBuiltin() && (
        <GroupList title={t('ui.built_in_web')}>
          <ListRow icon="shield" label={t('ui.clear_all_built_in_web')} hint={t('ui.log_out_of_all_platforms')} onClick={async () => { if (window.confirm(t('ui.log_out_of_the_built'))) show((await clearAllBuiltin()).message); }} />
        </GroupList>
      )}
      <p className="px-1 text-[13px] text-muted">{t('ui.add_app_only_opens_apps_2')} <button type="button" className="ghost" onClick={() => go('publish')}>{t('ui.go_publish')} ›</button></p>
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
          <GroupList title={t('ui.writing_assistants_one_style_per')}>
            {ASSISTANTS.map((x) => <ListRow key={x.platform} icon="agent" label={x.description.replace(/^把选题/, '').slice(0, 24) || x.name} hint={ov[x.platform] ? t('ui.customized') : t('ui.default_style')} onClick={() => setOpen(x.platform)} />)}
          </GroupList>
          <GroupList title={t('ui.hard_boundaries_not_editable')}>
            {HARD_BOUNDARIES.map((b) => <li key={b}><div className="list-row static"><span className="row-ico"><Icon name="shield" size={18} /></span><span className="row-text"><span className="row-hint !text-[14px] !text-fg-2">{b}</span></span></div></li>)}
          </GroupList>
        </>
      ) : (
        <AssistantEdit key={a.platform} a={a} ov={ov[a.platform]} go={go} onBack={() => setOpen(null)} onSaved={async (o) => { await setAssistantOverride(a.platform, o); setOv(await getAssistantOverrides()); show(o ? t('ui.saved') : t('ui.restored_defaults')); }} />
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
      <div className="flex items-center gap-2"><button type="button" className="ghost !px-1" aria-label={t('ui.back')} onClick={onBack}><Icon name="arrowLeft" size={18} /></button><h2 className="grow">{a.description}</h2></div>
      <label className="field !m-0"><span>{t('ui.writing_instructions')}</span><textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="flex flex-col gap-1"><span className="text-[14px] font-medium text-fg">{t('ui.model_used_by_this_assistant')}</span><ModelPicker value={pick} onChange={setPick} go={go} /></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="primary" onClick={() => void onSaved({ body: body.trim() === a.body.trim() ? undefined : body, providerId: pick.providerId, model: pick.model })}>{t('ui.save')}</button>
        <button type="button" onClick={() => { setBody(a.body); setPick({ providerId: null, model: null }); void onSaved(null); }}>{t('ui.restore_default')}</button>
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
      <GroupList title={t('ui.appearance')}>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('ui.theme')}</span></span>{seg(theme, [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], setTheme, t('ui.theme'))}</div></li>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('ui.language')}</span></span>{seg(lang, [['zh', '中文'], ['en', 'English']], setLang, t('ui.language'))}</div></li>
      </GroupList>
      <GroupList title={t('ui.workspace')}>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('ui.platforms_kept_alive_at_once')}</span><span className="row-hint">{t('ui.beyond_this_the_least_recently')}</span></span>
          <div className="seg" role="group" aria-label={t('ui.platforms_kept_alive_at_once')}>{Array.from({ length: KEEP_ALIVE_MAX - KEEP_ALIVE_MIN + 1 }, (_, i) => i + KEEP_ALIVE_MIN).map((n) => <button key={n} type="button" aria-pressed={(prefs?.keepAlive ?? 4) === n} onClick={async () => setP(await setPrefs({ keepAlive: n }))}>{n}</button>)}</div></div></li>
        <li><label className="list-row cursor-pointer"><input type="checkbox" checked={!!prefs?.bindSessions} onChange={async () => setP(await setPrefs({ bindSessions: !prefs?.bindSessions }))} /><span className="row-text"><span className="row-label">{t('ui.platform_conversation_binding')}</span><span className="row-hint">{t('ui.when_a_platform_opens_the')}</span></span></label></li>
        <li><div className="list-row static flex-wrap"><span className="row-text"><span className="row-label">{t('ui.agent_panel_dock')}</span></span>{seg(prefs?.agentDock ?? 'right', [['right', '右侧'], ['left', '左侧']], async (v) => setP(await setPrefs({ agentDock: v })), t('ui.agent_panel_dock'))}</div></li>
      </GroupList>
      <GroupList title={t('ui.public_trend_sources_more_in')}>
        {HOT_SOURCES.map((s) => (
          <li key={s.id}><label className="list-row cursor-pointer"><input type="checkbox" checked={!!prefs?.hotSources.includes(s.id)} onChange={async () => { if (!prefs) return; const on = prefs.hotSources.includes(s.id); setP(await setPrefs({ hotSources: on ? prefs.hotSources.filter((x) => x !== s.id) : [...prefs.hotSources, s.id] })); }} aria-label={s.label} /><span className="row-text"><span className="row-label">{s.label}</span><span className="row-hint">{s.kind === 'rss' ? t('ui.official_rss') : t('ui.public_boards_robots_txt_checked')}</span></span></label></li>
        ))}
      </GroupList>
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
      <ErrorNext error={err} action={t('ui.reload_2')} onAction={load} />
      {logs && !logs.length && <div className="card !p-0"><EmptyState icon="tasks" title={t('ui.no_records_yet')} why={t('ui.results_and_failure_reasons_of')} /></div>}
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
  const [ok, setOk] = useState<string | null>(apiMode() === 'server' ? t('ui.connected_to_server') : null);
  const [err, setErr] = useState<{ message: string; advice?: string } | null>(null);
  const test = async () => {
    setBusy(true); setErr(null); setOk(null);
    const base = addr.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//.test(base)) { setErr({ message: t('ui.wrong_url'), advice: t('ui.starts_with_http_or_https') }); setBusy(false); return; }
    if (/154\.8\.183\.93/.test(base)) { setErr({ message: t('ui.this_url_cant_be_used'), advice: t('ui.this_server_is_not_allowed') }); setBusy(false); return; }
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(`${base}/api/health`, { headers: token ? { 'x-access-token': token } : {}, signal: ctl.signal });
      clearTimeout(tm);
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) throw Object.assign(new Error(t('ui.wrong_token')), { advice: t('ui.ca_access_token_from_the') });
      if (!r.ok || !j.ok) throw Object.assign(new Error(`${t('ui.server_returned')} ${r.status}`), { advice: t('ui.make_sure_the_url_points') });
      // 健康检查不需要口令；再读一个需要口令的接口，确认口令正确
      const r2 = await fetch(`${base}/api/notifications`, { headers: token ? { 'x-access-token': token } : {} });
      if (r2.status === 401) throw Object.assign(new Error(t('ui.wrong_token')), { advice: t('ui.ca_access_token_from_the') });
      localStorage.setItem('ca.server', base); localStorage.setItem('ca.token', token); localStorage.setItem('ca.mode', 'server');
      setOk(`${t('ui.connected_to_server')}（${t('ui.version')} ${j.version ?? '?'}）`);
    } catch (e) {
      const x = e as Error & { advice?: string };
      setErr(x.advice ? { message: x.message, advice: x.advice } : { message: t('ui.cant_reach_the_server'), advice: t('ui.check_url_port_and_network') });
    } finally { setBusy(false); }
  };
  const disconnect = () => { localStorage.setItem('ca.mode', 'local'); setOk(null); };
  return (
    <div className="page page-narrow flex flex-col gap-3">
      <p className="m-0 text-[15px] text-fg-2">{t('ui.works_fully_without_a_server')}</p>
      <div className="card flex flex-col gap-1">
        <label className="field"><span>{t('ui.server_url_2')}</span><input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="http://192.168.1.10:8787" spellCheck={false} data-testid="server-addr" /></label>
        <label className="field"><span>{t('ui.access_token_optional')}</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
        <button type="button" className="primary !min-h-12" onClick={() => void test()} disabled={busy} data-testid="server-test">{busy ? <Busy label={t('ui.testing')} /> : t('ui.test_connection')}</button>
        {ok && <p className="ok-line m-0 mt-2" role="status" data-testid="server-ok"><Icon name="check" size={18} />{ok}</p>}
        {err && <div className="mt-2"><Problem title={err.message} advice={err.advice} /></div>}
        {apiMode() === 'server' && <button type="button" className="mt-2" onClick={disconnect}>{t('ui.disconnect_and_return_to_local')}</button>}
      </div>
    </div>
  );
}
