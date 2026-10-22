/**
 * 超级工作台外壳（0.8.0）：左 = 平台侧栏，中 = 平台网页（内嵌浏览器）或 Agent 全宽对话，旁 = Agent 面板。
 * 四种布局（修订 R2）：
 *  - 电脑 ≥1280：侧栏 72 / 200（可展开）+ 主区 + Agent 右栏 380（320–560 可拖，⌘J 收起，按平台记宽度）；
 *  - 平板横屏 768–1279：侧栏 64 图标栏 + 主区 + Agent 右栏 340；
 *  - 平板竖屏：侧栏 64 + Agent 底部抽屉（收起 56 / 半屏 50% / 全屏 92%）；
 *  - 手机 <768：顶栏 48（☰ 平台抽屉 · 标题 · ⋯）+ 全屏主区 + 右下 Agent 按钮 → 半屏 / 全屏抽屉；左缘右滑打开平台抽屉。
 * 首页即 Agent（#agent）；#p/<平台> 主区打开该平台。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { cn } from '../components/ui/utils';
import { Drawer, DrawerContent, DrawerItem } from '../components/ui/drawer';
import type { Route } from '../route';
import { CENTERS, center } from '../data/platforms';
import { getPrefs, setPrefs, type Prefs } from '../local/store';
import { browserHost, BrowserHostNative, overlayManager } from '../browser/browserHost';
import { launchLocalApp, type LocalAppEntry } from '../native';
import { appOs, openExternal } from '../runtime';
import { canSplitScreen, currentEnv, openSplit } from '../builtin';
import { addInbox, bus, createConversation, type InboxDraft } from '../agent/store';
import { badges as computeBadges, markOpened } from '../agent/overview';
import { useLocalApps } from '../format';
import { useAddApp } from '../components/addAppContext';
import { AgentPanel, useAgent } from './AgentPanel';
import { BrowserArea, type BrowserTarget, type PatrolState } from './BrowserArea';
import { Sidebar, type SideItem } from './Sidebar';

export type ShellLayout = 'phone' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';
export function shellLayoutOf(w: number, h: number): ShellLayout {
  if (w < 768) return 'phone';
  if (w < 1280) return h > w ? 'tablet-portrait' : 'tablet-landscape';
  return 'desktop';
}

/** 自定义网站地址校验：必须 https，且不得是本 App 自身或局域网 / 本机地址。 */
export function validCustomUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/.test(h) || h.endsWith('.local') || h === location.hostname) return null;
  return u.toString();
}

export function Workbench({ route, go, lay, header, meContent }: { route: Route; go: (to: string) => void; lay: ShellLayout; header?: ReactNode; meContent?: ReactNode }) {
  const a = useAgent();
  const [prefs, setP] = useState<Prefs | null>(null);
  const [badges, setBadges] = useState<Record<string, { count: number; dot: boolean }>>({});
  const [wide, setWide] = useState(() => localStorage.getItem('ca.v8.sideWide') === '1');
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('ca.v8.panel') !== '0');
  const [sheet, setSheet] = useState<'closed' | 'peek' | 'half' | 'full'>('closed');
  const [phoneSide, setPhoneSide] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState<InboxDraft | null>(null);
  const [patrol, setPatrol] = useState<PatrolState | null>(null);
  const [toast, setToast] = useState('');
  const [startUrl, setStartUrl] = useState<Record<string, string>>({});
  const apps = useLocalApps(useAddApp().version);
  const addApp = useAddApp();
  const reloadPrefs = useCallback(() => void getPrefs().then(setP), []);
  useEffect(reloadPrefs, [reloadPrefs]);
  const refreshBadges = useCallback(() => void computeBadges().then(setBadges), []);
  useEffect(() => { refreshBadges(); const off = bus.on((e) => { if (e.type === 'drafts-changed' || e.type === 'inbox-changed') refreshBadges(); }); const iv = setInterval(refreshBadges, 30000); return () => { off(); clearInterval(iv); }; }, [refreshBadges]);
  useEffect(() => { if (prefs?.keepAlive) browserHost.setLimit(prefs.keepAlive); }, [prefs?.keepAlive]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2400); };

  const items: SideItem[] = useMemo(() => {
    if (!prefs) return [];
    const ids = [...(prefs.platformOrder ?? []).filter((x) => prefs.platforms.includes(x) || prefs.customSites?.some((c) => c.id === x)), ...prefs.platforms, ...(prefs.customSites ?? []).map((c) => c.id)];
    return [...new Set(ids)].map((id) => ({ id, label: center(id)?.label ?? prefs.customSites?.find((c) => c.id === id)?.label ?? id, custom: !center(id) }));
  }, [prefs]);

  const activeId = route.space === 'p' ? route.sub : 'agent';
  const target: BrowserTarget | null = useMemo(() => {
    if (route.space !== 'p') return null;
    if (patrol && route.sub === 'patrol') { const s = patrol.stops[patrol.index]!; return { id: 'patrol', label: `巡视 · ${s.label}`, url: s.url, hosts: patrol.stops.flatMap((x) => x.hosts), patrol: true }; }
    const c = center(route.sub);
    if (c) return { id: c.id, label: c.label, url: c.url, publishUrl: c.publishUrl, hosts: c.hosts };
    const cs = prefs?.customSites?.find((x) => x.id === route.sub);
    if (cs) { const h = new URL(cs.url).hostname; return { id: cs.id, label: cs.label, url: cs.url, hosts: [h], custom: true }; }
    return null;
  }, [route.space, route.sub, prefs, patrol]);

  // 平台 ↔ 会话绑定（默认关）
  useEffect(() => {
    if (!target || target.patrol || !prefs?.bindSessions) return;
    const bound = prefs.sessionBindings?.[target.id];
    if (bound) a.setCid(bound ? Number(bound) : null);
    else void createConversation(`${target.label} 会话`).then(async (c) => { a.setCid(c.id); await setPrefs({ sessionBindings: { ...(prefs.sessionBindings ?? {}), [target.id]: String(c.id) } }); reloadPrefs(); void a.refreshConvs(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, prefs?.bindSessions]);
  useEffect(() => { if (target && !target.patrol) markOpened(target.id); }, [target]);

  // 工具 → 外壳：打开平台 / 开始巡视
  useEffect(() => bus.on((e) => {
    if (e.type === 'open') { setStartUrl((s) => ({ ...s, [e.platform]: e.url })); go(`p/${e.platform}`); if (lay === 'phone' || lay === 'tablet-portrait') setSheet('peek'); }
    else if (e.type === 'patrol') { setPatrol({ stops: e.stops, index: 0 }); go('p/patrol'); if (lay === 'phone' || lay === 'tablet-portrait') setSheet('closed'); }
    else if (e.type === 'inbox-preview') setPreview(e.item);
  }), [go, lay]);

  // 平台 → Agent：原生分享 / 选中文字（安卓）与 Electron 右键菜单
  useEffect(() => {
    const take = async () => {
      if (browserHost.mode !== 'android') return;
      try {
        const r = await BrowserHostNative.takePending();
        const it = r.items[0];
        if (it) setPreview({ kind: it.image ? 'image' : /^https?:\/\//.test(it.text ?? '') ? 'url' : it.channel === 'share' ? 'share' : 'text', text: it.text, title: it.title, image: it.image, url: (it.text ?? '').match(/https?:\/\/\S+/)?.[0], channel: it.channel === 'process_text' ? 'process_text' : 'share', platform: guessPlatform(it.text ?? '') });
      } catch { /* 旧版 App 没有插件 */ }
    };
    void browserHost.init().then(() => { void take(); browserHost.on({ inbox: () => void take() }); });
    const onCtx = (e: Event) => { const d = (e as CustomEvent).detail as { platform: string; text: string; url: string; title: string; channel: 'context_menu' }; setPreview({ kind: 'text', text: d.text, url: d.url, title: d.title, platform: d.platform, channel: 'context_menu' }); };
    const onTest = (e: Event) => setPreview((e as CustomEvent).detail as InboxDraft);
    window.addEventListener('ca:send-to-agent', onCtx);
    window.addEventListener('ca:inbox-preview', onTest);
    return () => { window.removeEventListener('ca:send-to-agent', onCtx); window.removeEventListener('ca:inbox-preview', onTest); };
  }, []);

  // ⌘J / Ctrl+J 收起展开 Agent 面板
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setPanelOpen((x) => { localStorage.setItem('ca.v8.panel', x ? '0' : '1'); return !x; }); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  // 叠加层：手机 / 竖屏抽屉超过 50%、平台抽屉、添加平台、预览 → 收起原生网页
  useEffect(() => (sheet === 'full' || phoneSide || addOpen || preview ? overlayManager.push() : undefined), [sheet, phoneSide, addOpen, preview]);

  const select = (id: string) => {
    setPhoneSide(false);
    if (id === 'agent') { go('agent'); setSheet('closed'); return; }
    if (id === 'me') { go('me'); return; }
    if (patrol && id !== 'patrol') setPatrol(null);
    go(`p/${id}`);
  };
  const entryFor = (id: string): LocalAppEntry | null => {
    const os = appOs() ?? 'android';
    const c = center(id);
    const saved = apps.data?.apps.find((x) => x.platform === id && x.os === os);
    if (saved) return saved;
    if (!c) return null;
    return { platform: id, os, label: c.app, package_name: os === 'android' ? c.android : null, url_scheme: os === 'ios' ? c.ios : null };
  };
  const menu = async (id: string, action: string) => {
    const c = center(id);
    const cs = prefs?.customSites?.find((x) => x.id === id);
    const url = c?.url ?? cs?.url ?? '';
    switch (action) {
      case 'reload': await browserHost.nav(id, 'reload'); break;
      case 'home': setStartUrl((s) => ({ ...s, [id]: url })); go(`p/${id}`); if (browserHost.pool.get(id)) await browserHost.loadUrl(id, url).catch(() => {}); break;
      case 'publish': if (c) { setStartUrl((s) => ({ ...s, [id]: c.publishUrl })); go(`p/${id}`); if (browserHost.pool.get(id)) await browserHost.loadUrl(id, c.publishUrl).catch(() => {}); } break;
      case 'system': await openExternal(browserHost.pool.get(id)?.url ?? url); break;
      case 'app': { const e = entryFor(id); if (e) flash((await launchLocalApp(e)).message); break; }
      case 'split': { const e = entryFor(id); if (e && c) flash((await openSplit(e, c.label)).message); break; }
      case 'badge': { const off = prefs?.badgeOff ?? []; await setPrefs({ badgeOff: off.includes(id) ? off.filter((x) => x !== id) : [...off, id] }); reloadPrefs(); break; }
      case 'logout': { const n = await browserHost.clear(id, c?.hosts ?? (cs ? [new URL(cs.url).hostname] : [])); flash(browserHost.mode === 'web' ? '网页版的登录保存在浏览器里，请在浏览器设置中清除该网站数据' : `已退出${c?.label ?? cs?.label ?? ''}的登录${n ? '' : ''}${c?.hosts.includes('weixin.qq.com') ? '（公众号与视频号共用微信登录，会一起退出）' : ''}`); break; }
      case 'remove': await setPrefs({ platforms: (prefs?.platforms ?? []).filter((x) => x !== id), customSites: (prefs?.customSites ?? []).filter((x) => x.id !== id), platformOrder: (prefs?.platformOrder ?? []).filter((x) => x !== id) }); browserHost.pool.remove(id); reloadPrefs(); if (activeId === id) go('agent'); break;
    }
  };

  const sendFromPage = (s: { platform: string; url: string; title: string }) => setPreview({ kind: 'url', platform: s.platform === 'patrol' ? patrol?.stops[patrol.index]?.platform : s.platform, url: s.url, title: s.title, channel: s.platform === 'patrol' ? 'patrol' : 'toolbar' });
  const isPhone = lay === 'phone';
  const sheetMode = lay === 'phone' || lay === 'tablet-portrait';
  const sideVariant = isPhone ? 'drawer' : lay === 'desktop' && wide ? 'wide' : 'rail';
  const [panelW, setPanelW] = useState(380);
  useEffect(() => { const k = `ca.v8.panelW.${target?.id ?? 'agent'}`; const v = Number(localStorage.getItem(k)); setPanelW(v >= 320 && v <= 560 ? v : lay === 'desktop' ? 380 : 340); }, [target?.id, lay]);
  const dragging = useRef(false);

  const sidebar = (
    <Sidebar
      items={items} active={activeId === 'patrol' ? 'agent' : route.space === 'me' ? 'me' : activeId} badges={badges} badgeOff={prefs?.badgeOff ?? []}
      variant={sideVariant} onSelect={select} onAdd={() => { setPhoneSide(false); setAddOpen(true); }}
      onReorder={async (ids) => { await setPrefs({ platformOrder: ids }); reloadPrefs(); }} onMenu={(id, act) => void menu(id, act)}
      onToggleWide={lay === 'desktop' ? () => setWide((w) => { localStorage.setItem('ca.v8.sideWide', w ? '0' : '1'); return !w; }) : undefined}
      splitAvailable={canSplitScreen(currentEnv(), { os: 'android', package_name: 'x' })}
    />
  );
  const agentFull = <AgentPanel a={a} variant="full" lay={isPhone ? 'phone' : lay === 'desktop' ? 'desktop' : 'tablet'} go={go} onOpenPlatform={(p) => select(p)} route={route} />;
  const browser = target ? (
    <BrowserArea target={target} startUrl={startUrl[target.id]} onSend={sendFromPage} onMenu={(act) => void menu(target.id, act)} patrol={target.patrol ? patrol : null}
      onPatrol={(x) => { if (x === 'end') { setPatrol(null); go('agent'); } else setPatrol((p) => (p ? { ...p, index: Math.min(p.stops.length - 1, p.index + 1) } : p)); }} />
  ) : (
    <div className="flex flex-1 items-center justify-center text-muted" data-testid="unknown-platform">这个平台不在工作台里。<button type="button" className="ml-2" onClick={() => setAddOpen(true)}>添加平台</button></div>
  );

  const sidePanel = route.space === 'p' && !sheetMode && (
    panelOpen ? (
      <div className="relative flex shrink-0 border-l border-line" style={{ width: panelW }} data-testid="agent-side">
        <div role="separator" aria-orientation="vertical" aria-label="拖动调整 Agent 面板宽度" className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
          onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!dragging.current) return; const w = Math.min(560, Math.max(320, window.innerWidth - e.clientX)); setPanelW(w); }}
          onPointerUp={() => { dragging.current = false; localStorage.setItem(`ca.v8.panelW.${target?.id ?? 'agent'}`, String(panelW)); }} />
        <AgentPanel a={a} variant="panel" lay="phone" go={go} onOpenPlatform={select} onCollapse={() => { setPanelOpen(false); localStorage.setItem('ca.v8.panel', '0'); }} route={{ sub: '', id: null }} />
      </div>
    ) : (
      <div className="flex w-2 shrink-0 flex-col items-center justify-center border-l border-line bg-side" data-testid="agent-handle">
        <button type="button" aria-label="展开 Agent 面板" className="!fixed right-2 bottom-6 z-20 !min-h-11 !rounded-full !px-4 !text-[14px] shadow-pop" onClick={() => { setPanelOpen(true); localStorage.setItem('ca.v8.panel', '1'); }}><Icon name="bot" size={16} /> Agent</button>
      </div>
    )
  );

  // 底部抽屉（手机 / 平板竖屏）
  const sheetH = sheet === 'full' ? '92dvh' : sheet === 'half' ? '50dvh' : '56px';
  const sheetEl = sheetMode && route.space === 'p' && sheet !== 'closed' && (
    <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-[16px] border-t border-line bg-canvas shadow-pop transition-[height] duration-200 motion-reduce:transition-none" style={{ height: sheet === 'peek' ? 'auto' : sheetH, left: isPhone ? 0 : 72 }} data-testid="agent-sheet" data-snap={sheet}>
      <button type="button" aria-label={sheet === 'full' ? '缩小' : '展开'} className="!mx-auto !min-h-11 !w-full !rounded-none !border-0 !bg-transparent !p-0" onClick={() => setSheet((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'half'))}><span className="mx-auto block h-1 w-9 rounded-full bg-line-strong" /></button>
      {sheet === 'peek' ? (
        <div className="flex items-center gap-2 px-3 pb-[calc(8px+var(--sa-bottom))]">
          <button type="button" className="!min-h-11 min-w-0 flex-1 !justify-start !rounded-full !px-4 !text-[15px] !font-normal !text-muted" onClick={() => setSheet('half')} data-testid="sheet-peek">问 Agent…</button>
          <button type="button" aria-label="关闭" className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => setSheet('closed')}><Icon name="close" size={18} /></button>
        </div>
      ) : (
        <AgentPanel a={a} variant="sheet" lay="phone" go={go} onOpenPlatform={select} route={{ sub: '', id: null }} onBackToWeb={() => setSheet('closed')} onCollapse={() => setSheet(sheet === 'full' ? 'half' : 'peek')} />
      )}
    </div>
  );

  const phoneTop = isPhone && (
    <header className="flex shrink-0 items-center gap-1 border-b border-line bg-canvas px-1 safe-top" style={{ height: 'calc(48px + var(--sa-top))' }} data-testid="phone-top">
      <button type="button" aria-label="打开平台侧栏" data-testid="open-side" className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => setPhoneSide(true)}><Icon name="menu" size={20} /></button>
      <h1 className="min-w-0 flex-1 truncate text-center text-[16px]">{route.space === 'me' ? '我的' : route.space === 'p' ? target?.label ?? '' : a.convs.find((c) => c.id === a.cid)?.title ?? '超级工作台'}</h1>
      {header}
    </header>
  );

  return (
    <div className={cn('workbench flex h-dvh min-h-0 w-full overflow-hidden bg-canvas', lay)} data-testid="workbench" data-layout={lay}>
      {!isPhone && sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col"
        onTouchStart={(e) => { if (isPhone && e.touches[0]!.clientX < 16) (e.currentTarget as HTMLElement).dataset.edge = String(e.touches[0]!.clientX); }}
        onTouchMove={(e) => { const el = e.currentTarget as HTMLElement; if (isPhone && el.dataset.edge && e.touches[0]!.clientX - Number(el.dataset.edge) > 60) { delete el.dataset.edge; setPhoneSide(true); } }}>
        {phoneTop}
        <div className="flex min-h-0 flex-1">
          {prefs?.agentDock === 'left' && sidePanel}
          {route.space === 'p' ? browser : route.space === 'me' && meContent ? meContent : agentFull}
          {prefs?.agentDock !== 'left' && sidePanel}
        </div>
      </div>
      {sheetMode && route.space === 'p' && sheet === 'closed' && (
        <button type="button" aria-label="Agent" data-testid="agent-fab" className="primary !fixed right-4 z-30 !h-14 !min-h-14 !w-14 !rounded-full !p-0 shadow-pop" style={{ bottom: `calc(${patrol ? 72 : 16}px + var(--sa-bottom))` }} onClick={() => setSheet('half')}>
          <Icon name="bot" size={22} />{a.running && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent" />}
        </button>
      )}
      {sheetEl}
      {isPhone && phoneSide && (
        <div className="fixed inset-0 z-50" data-testid="side-drawer">
          <button type="button" aria-label="关闭平台侧栏" className="absolute inset-0 !min-h-0 !rounded-none !border-0 !bg-black/30 !p-0" onClick={() => setPhoneSide(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-side shadow-pop safe-top">{sidebar}</div>
        </div>
      )}
      <AddPlatformSheet open={addOpen} onOpenChange={setAddOpen} prefs={prefs} onSaved={() => { reloadPrefs(); refreshBadges(); }} onRegisterApp={(p) => { setAddOpen(false); addApp.open(p); }} />
      <SendPreview item={preview} onClose={() => setPreview(null)} onSend={async (d, toChat) => { setPreview(null); const it = await addInbox(d); flash(toChat ? '已发送到当前会话' : '已存进素材箱'); if (toChat) { if (sheetMode && route.space === 'p') setSheet('half'); void a.send(`【素材 #${it.id}${d.platform ? ` · ${center(d.platform)?.label ?? d.platform}` : ''}】${d.title ?? ''} ${d.url ?? ''}\n${d.text ?? ''}${d.note ? `\n说明：${d.note}` : ''}`.trim()); } }} />
      {toast && <div role="status" className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[14px] text-ink-fg shadow-pop" data-testid="toast">{toast}</div>}
    </div>
  );
}

function guessPlatform(text: string): string | undefined {
  const rules: [RegExp, string][] = [[/xhslink|xiaohongshu/, 'xiaohongshu'], [/douyin|iesdouyin/, 'douyin'], [/zhihu/, 'zhihu'], [/bilibili|b23\.tv/, 'bilibili'], [/kuaishou|kwai/, 'kuaishou'], [/weibo/, 'weibo'], [/weixin|mp\.weixin/, 'wechat_mp']];
  for (const [re, id] of rules) if (re.test(text)) return id;
  return undefined;
}

/** “发给 Agent”预览抽屉：显示将要发送的内容 + 可选补一句说明 + 发送到当前会话 / 只存进素材箱。 */
export function SendPreview({ item, onClose, onSend }: { item: InboxDraft | null; onClose: () => void; onSend: (d: InboxDraft, toChat: boolean) => void }) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [item]);
  return (
    <Drawer open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent title="发给 Agent" description="确认后才会发送；只发送下面这些内容，不读取页面">
        {item && (
          <div className="px-2 pb-2" data-testid="send-preview">
            <div className="rounded-[12px] border border-line bg-surface p-3 text-[14px]">
              {item.platform && <p className="m-0 text-[12px] text-muted">{center(item.platform)?.label ?? item.platform} · {item.channel === 'share' ? '系统分享' : item.channel === 'process_text' ? '选中文字' : item.channel === 'patrol' ? '热点巡视' : item.channel === 'context_menu' ? '右键菜单' : '工具栏'}</p>}
              {item.title && <p className="m-0 font-medium text-fg">{item.title}</p>}
              {item.url && <p className="m-0 break-all text-[13px] text-muted">{item.url}</p>}
              {item.text && item.text !== item.url && <p className="m-0 mt-1 line-clamp-6 whitespace-pre-wrap">{item.text}</p>}
              {item.image && <img src={item.image} alt="分享的图片" className="mt-2 max-h-40 rounded-md" />}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="补一句说明（可选）" aria-label="补一句说明" className="!mt-2 !min-h-10 w-full !text-[14px]" />
            <div className="mt-3 flex gap-2">
              <button type="button" className="primary flex-1" data-testid="preview-send" onClick={() => onSend({ ...item, note: note.trim() || undefined }, true)}>发送到当前会话</button>
              <button type="button" className="flex-1" data-testid="preview-save" onClick={() => onSend({ ...item, note: note.trim() || undefined }, false)}>只存进素材箱</button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** 添加到工作台：勾选平台或填自定义网站（https、非局域网），可再登记官方 App。 */
function AddPlatformSheet({ open, onOpenChange, prefs, onSaved, onRegisterApp }: { open: boolean; onOpenChange: (o: boolean) => void; prefs: Prefs | null; onSaved: () => void; onRegisterApp: (p: string) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const has = (id: string) => !!prefs?.platforms.includes(id);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="添加到工作台" description="勾选的平台会出现在侧栏；自定义网站只能打开，不参与热点与发布工具">
        <div data-testid="add-platform">
          {CENTERS.map((c) => (
            <DrawerItem key={c.id} label={`${has(c.id) ? '✓ ' : ''}${c.label}`} hint={has(c.id) ? '已在工作台（点按移除）' : c.url.replace('https://', '')} onClick={async () => {
              const p = prefs?.platforms ?? [];
              await setPrefs({ platforms: has(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id] });
              onSaved();
            }} />
          ))}
          <DrawerItem label="登记手机上的官方 App" hint="用于“打开官方 App / 分屏”" onClick={() => onRegisterApp(prefs?.platforms[0] ?? 'xiaohongshu')} />
          <form className="mx-2 mt-3 flex flex-col gap-2 rounded-[12px] border border-line p-3" onSubmit={async (e) => {
            e.preventDefault();
            const u = validCustomUrl(url);
            if (!name.trim() || !u) { setErr('名称必填；地址必须是 https，且不能是局域网或本机地址'); return; }
            const id = `site-${Date.now().toString(36)}`;
            await setPrefs({ customSites: [...(prefs?.customSites ?? []), { id, label: name.trim().slice(0, 8), url: u }] });
            setName(''); setUrl(''); setErr(''); onSaved();
          }}>
            <strong className="text-[14px]">自定义网站</strong>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" aria-label="自定义网站名称" className="!min-h-10 !text-[14px]" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="自定义网站地址" className="!min-h-10 !text-[14px]" />
            {err && <p className="m-0 text-[13px] text-bad" role="alert">{err}</p>}
            <button type="submit" className="!min-h-10">添加</button>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
