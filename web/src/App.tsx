import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiMode, get } from './api';
import { LangContext, translate, type Lang } from './i18n';
import { Icon } from './icons';
import { Loading, prefersReducedMotion } from './ui';
import { BOTTOM_ITEMS, MAIN_NAV, ME_NAV, NAV, SIDEBAR_ITEMS, layoutOf, type NavItem } from './nav';
import { normalize, parseHash, toHash, type Route } from './route';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { Drawer, DrawerContent, DrawerItem } from './components/ui/drawer';
import { Tip, TooltipProvider } from './components/ui/tooltip';
import { cn } from './components/ui/utils';
import { AddAppButton } from './components/AddAppButton';
import { AddAppSheet } from './components/AddAppSheet';
import { AddAppContext } from './components/addAppContext';
import { Home } from './pages/home';
import { useLocalApps } from './format';
import { getModels, getPrefs } from './local/store';
import type { Theme } from './state';

// 页面级懒加载：首页随主包，其余按需加载（首屏轻量，借鉴 NextChat）。
const Topics = lazy(() => import('./pages/topics').then((m) => ({ default: m.Topics })));
const Write = lazy(() => import('./pages/write').then((m) => ({ default: m.Write })));
const Publish = lazy(() => import('./pages/publish').then((m) => ({ default: m.Publish })));
const Results = lazy(() => import('./pages/results').then((m) => ({ default: m.Results })));
const Me = lazy(() => import('./pages/me').then((m) => ({ default: m.Me })));
const Onboarding = lazy(() => import('./pages/onboarding').then((m) => ({ default: m.Onboarding })));

export { NAV } from './nav';

/** 全局错误边界：渲染异常时给出原因 + 下一步按钮，而不是白屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div className="problem" role="alert" style={{ margin: 24 }}>
        <Icon name="error" size={18} className="problem-ico" />
        <div className="grow">
          <strong>页面出错了</strong>
          <p>{this.state.error.message}</p>
          <div className="problem-a"><button type="button" className="primary" onClick={() => this.setState({ error: null })}>重试</button><button type="button" onClick={() => { location.hash = 'home'; this.setState({ error: null }); }}>回到首页</button></div>
        </div>
      </div>
    );
    return this.props.children;
  }
}

function useWidth(): number {
  const [w, setW] = useState(typeof window === 'undefined' ? 1280 : window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 命令面板：⌘K / Ctrl+K；旧名称（今天、灵感、创作、复盘、平台、偏好、设置…）作为别名也能搜到。 */
function CommandPalette({ open, onClose, go, t }: { open: boolean; onClose: () => void; go: (p: string) => void; t: (k: string) => string }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const items = NAV.filter((n) => !q || `${n.label}${t(n.label)}${n.id}${n.desc}${n.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { if (open) { setQ(''); setIdx(0); } }, [open]);
  const pick = (id: string) => { onClose(); go(id); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-label={t('快速跳转')}>
        <DialogTitle className="sr-only">{t('快速跳转')}</DialogTitle>
        <DialogDescription className="sr-only">{t('搜索页面…')}</DialogDescription>
        <div className="flex items-center gap-2 border-b border-line px-4 text-muted">
          <Icon name="search" size={16} />
          <input
            autoFocus value={q} placeholder={t('搜索页面…')} aria-label={t('快速跳转')} aria-controls="cmdk-list"
            className="!min-h-12 !border-0 !bg-transparent !p-0 text-base !shadow-none"
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter' && items[idx]) pick(items[idx]!.id);
            }}
          />
        </div>
        <ul id="cmdk-list" role="listbox" aria-label={t('页面')} className="m-0 max-h-[50vh] list-none overflow-y-auto p-2">
          {items.map((n, i) => (
            <li key={n.id} role="option" aria-selected={i === idx} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-[15px] text-fg', i === idx && 'bg-surface-2')} onMouseEnter={() => setIdx(i)} onClick={() => pick(n.id)}>
              <span className="text-muted"><Icon name={n.icon} size={16} /></span>
              <span className="min-w-0 flex-1 truncate">{t(n.label)}<small className="text-[13px] text-muted"> · {t(n.desc)}</small></span>
            </li>
          ))}
          {!items.length && <li className="py-6 text-center text-muted">{t('没有找到')}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

const V6_HINT = 'ca.v6.hint';

export function App() {
  const width = useWidth();
  const online = useOnline();
  const lay = layoutOf(width);
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ca.theme') as Theme) || 'system');
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ca.lang') as Lang) || 'zh');
  const [cmdk, setCmdk] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [hint, setHint] = useState(() => !!localStorage.getItem('ca.v5.hint') && !localStorage.getItem(V6_HINT));
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ca.side.collapsed6') === '1');
  // 添加软件（全局 Sheet）
  const [addOpen, setAddOpen] = useState(false);
  const [addInitial, setAddInitial] = useState<string | undefined>(undefined);
  const [appsVersion, setAppsVersion] = useState(0);
  const apps = useLocalApps(appsVersion);
  const appCount = apps.data?.apps?.length ?? 0;
  const openAdd = useCallback((platform?: string) => { setFabOpen(false); setAddInitial(platform); setAddOpen(true); }, []);
  const addCtx = useMemo(() => ({ open: openAdd, count: appCount, version: appsVersion }), [openAdd, appCount, appsVersion]);
  const t = useMemo(() => (k: string) => translate(lang, k), [lang]);

  useEffect(() => {
    localStorage.setItem('ca.theme', theme);
    const root = document.documentElement;
    if (!prefersReducedMotion()) { root.classList.add('theme-switching'); setTimeout(() => root.classList.remove('theme-switching'), 240); }
    root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => { localStorage.setItem('ca.lang', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);

  // 旧 hash 兼容：首次进入把 0.5.0 / #settings/* / 0.2.x 地址替换为新地址（不新增历史记录）。
  useEffect(() => {
    const raw = location.hash.slice(1);
    const norm = toHash(parseHash(raw));
    if (raw && raw !== norm) history.replaceState(null, '', `#${norm}`);
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((target: string) => {
    const h = toHash(parseHash(normalize(target)));
    setRoute(parseHash(h));
    if (location.hash.slice(1) !== h) location.hash = h;
    window.scrollTo?.(0, 0);
  }, []);

  // 首次打开（本机没有任何模型配置、也没走过引导）→ 进入首启引导。
  useEffect(() => {
    if (apiMode() === 'server') return;
    void Promise.all([getModels(), getPrefs()]).then(([m, p]) => {
      if (!m.providers.length && !p.onboarded && !location.hash.slice(1).startsWith('me')) go('onboarding');
    }).catch(() => {});
  }, [go]);

  useEffect(() => {
    const load = () => get('/api/notifications').then((n) => setPending(Number(n?.pendingDrafts) || 0)).catch(() => {});
    load();
    const iv = setInterval(load, 30000);
    window.addEventListener('hashchange', load);
    return () => { clearInterval(iv); window.removeEventListener('hashchange', load); };
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((x) => !x); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const isPhone = lay === 'phone';
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  const toggleRail = () => { setCollapsed((c) => { localStorage.setItem('ca.side.collapsed6', c ? '0' : '1'); return !c; }); };
  const rail = !isPhone && collapsed;

  const meSubItem = route.space === 'me' && route.sub ? NAV.find((n) => n.id === `me/${route.sub}`) : null;
  const item = meSubItem ?? SIDEBAR_ITEMS.find((s) => s.id === route.space);
  const phoneDetail = isPhone && ((route.space === 'write' && !!route.id) || (route.space === 'me' && route.sub === 'models' && !!route.id));
  const back = route.space === 'me' && route.sub ? () => go(route.sub === 'models' && route.id ? 'me/models' : 'me') : null;

  if (route.space === 'onboarding') {
    return (
      <LangContext.Provider value={{ lang, t }}>
        <AddAppContext.Provider value={addCtx}>
          <TooltipProvider delayDuration={200}>
            <div className={cn('shell app-root', lay)}>
              <ErrorBoundary><Suspense fallback={<div className="page"><Loading show lines={5} /></div>}><Onboarding go={go} /></Suspense></ErrorBoundary>
            </div>
            <AddAppSheet open={addOpen} onOpenChange={setAddOpen} lay={lay} data={apps.data} initial={addInitial} onSaved={() => setAppsVersion((v) => v + 1)} />
          </TooltipProvider>
        </AddAppContext.Provider>
      </LangContext.Provider>
    );
  }

  const body = (() => {
    switch (route.space) {
      case 'topics': return <Topics go={go} />;
      case 'write': return <Write filter={route.sub} id={route.id} go={go} lay={lay} />;
      case 'publish': return <Publish go={go} />;
      case 'results': return <Results go={go} />;
      case 'me': return <Me sub={route.sub} id={route.id} go={go} lay={lay} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
      default: return <Home go={go} />;
    }
  })();

  const navActive = (id: string) => route.space === id;
  const sideLink = (n: NavItem) => {
    const label = n.id === 'write' && pending > 0 ? `${t(n.label)}（${pending} ${t('篇待审核')}）` : t(n.label);
    const a = (
      <a
        href={`#${n.id}`} aria-current={navActive(n.id) ? 'page' : undefined} aria-label={rail || (n.id === 'write' && pending > 0) ? label : undefined}
        onClick={(e) => { e.preventDefault(); go(n.id); }}
        className={cn('relative flex items-center gap-3 rounded-[10px] text-[15px] text-side-fg no-underline transition-colors duration-150 hover:bg-side-active hover:text-fg hover:no-underline', rail ? 'h-11 w-11 justify-center' : 'h-11 px-3', navActive(n.id) && 'bg-side-active font-medium text-fg')}
      >
        <Icon name={n.icon} size={18} strokeWidth={navActive(n.id) ? 2 : 1.5} />
        {!rail && <span className="truncate">{t(n.label)}</span>}
        {n.id === 'write' && pending > 0 && (rail
          ? <span className="absolute right-0.5 top-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[13px] font-medium leading-none text-ink-fg" aria-hidden="true">{pending}</span>
          : <span className="ml-auto inline-grid h-5 min-w-5 place-items-center rounded-full bg-surface-3 px-1.5 text-[13px] font-medium tabular-nums text-fg" aria-hidden="true">{pending}</span>)}
      </a>
    );
    return <li key={n.id}>{rail ? <Tip label={t(n.label)}>{a}</Tip> : a}</li>;
  };

  const sidebar = !isPhone && (
    <nav aria-label="主导航" data-rail={rail ? 'true' : 'false'} className={cn('app-side sticky top-0 flex h-dvh shrink-0 flex-col overflow-y-auto bg-side safe-top transition-[width] duration-200', rail ? 'w-[68px] items-center px-2' : 'w-[240px] px-3')}>
      <div className={cn('flex min-h-16 shrink-0 items-center gap-2', rail ? 'flex-col justify-center pt-3' : 'px-1')} data-testid="side-brand">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-ink text-ink-fg"><Icon name="topics" size={16} strokeWidth={1.75} /></span>
        {!rail && <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className="truncate text-[15px] font-semibold text-fg">{t('内容运营助手')}</span><small className="text-[13px] text-muted">{apiMode() === 'server' ? t('已连接服务器') : t('本机模式')}</small></span>}
        <Tip label={rail ? t('展开侧栏') : t('收起侧栏')}><Button variant="ghost" size="icon-lg" aria-label={rail ? t('展开侧栏') : t('收起侧栏')} aria-expanded={!rail} onClick={toggleRail}><Icon name={rail ? 'sidebar' : 'collapse'} size={18} /></Button></Tip>
      </div>
      {rail
        ? <Tip label={`${t('快速跳转')} ⌘K`}><Button variant="ghost" size="icon-lg" className="mb-2" aria-label={t('快速跳转')} onClick={() => setCmdk(true)}><Icon name="search" size={18} /></Button></Tip>
        : <button type="button" onClick={() => setCmdk(true)} aria-label={t('快速跳转')} className="!mb-3 !h-10 !min-h-10 w-full shrink-0 !justify-start gap-2 !border-line !bg-transparent !px-3 text-[14px] !font-normal !text-muted"><Icon name="search" size={16} /><span className="flex-1 text-left">{t('搜索或跳转')}</span><kbd>⌘K</kbd></button>}
      <div className={cn('flex-1', rail && 'flex w-full flex-col items-center')}>
        <ul className={cn('m-0 flex list-none flex-col gap-1 p-0', rail && 'items-center')} aria-label={t('主线')}>{MAIN_NAV.map(sideLink)}</ul>
        <div className={cn('my-3 border-t border-line', rail ? 'w-8' : 'mx-1')} role="separator" />
        <ul className={cn('m-0 flex list-none flex-col gap-1 p-0', rail && 'items-center')}>{sideLink(ME_NAV)}</ul>
      </div>
      <div className={cn('add-app-dock sticky bottom-0 z-10 mt-4 w-full shrink-0 border-t border-line bg-side pt-3 pb-[calc(12px+var(--sa-bottom))]', rail && 'flex justify-center')}>
        <AddAppButton variant={rail ? 'rail' : 'side'} />
      </div>
    </nav>
  );

  const topbar = (
    <header className="app-top sticky top-0 z-20 shrink-0 bg-canvas safe-top" data-testid="topbar">
      <div className={cn('flex items-center gap-2', isPhone ? 'min-h-14 px-2' : 'min-h-16 px-6')}>
        {back ? <Button variant="ghost" size="icon-lg" aria-label={t('返回')} onClick={back}><Icon name="arrowLeft" size={20} /></Button> : isPhone && <span className="w-2" />}
        <div className="min-w-0 flex-1">
          <h1 className={cn('truncate', isPhone ? 'text-[18px]' : 'text-[20px]')}>{t(item?.label ?? '')}</h1>
          {!isPhone && item?.desc && <p className="m-0 truncate text-[13px] text-muted">{t(item.desc)}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!online && <span className="badge warn" role="status"><Icon name="wifiOff" size={14} /> {t('离线')}</span>}
          {isPhone && <Button variant="ghost" size="icon-lg" aria-label={t('快速跳转')} onClick={() => setCmdk(true)}><Icon name="search" size={20} /></Button>}
          <Button variant="ghost" size="icon-lg" aria-label={t(dark ? '切换到浅色' : '切换到深色')} onClick={() => setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={isPhone ? 20 : 18} /></Button>
        </div>
      </div>
    </header>
  );

  const bottomTab = (n: NavItem) => (
    <a key={n.id} href={`#${n.id}`} aria-current={navActive(n.id) ? 'page' : undefined} aria-label={t(n.label)} onClick={(e) => { e.preventDefault(); go(n.id); }}
      className={cn('relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-muted no-underline hover:no-underline', navActive(n.id) && 'font-medium text-fg')}>
      <Icon name={n.icon} size={24} strokeWidth={navActive(n.id) ? 2.25 : 1.5} />
      <small className="text-[13px] leading-tight">{t(n.label)}</small>
      {n.id === 'write' && pending > 0 && <span className="absolute left-[calc(50%+6px)] top-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1.5 text-[13px] font-medium text-ink-fg" aria-hidden="true">{pending}</span>}
    </a>
  );

  return (
    <LangContext.Provider value={{ lang, t }}>
      <AddAppContext.Provider value={addCtx}>
        <TooltipProvider delayDuration={200}>
          <a className="skip" href="#main">跳到主要内容</a>
          <div className={cn('shell app-root', lay, 'flex min-h-dvh bg-canvas', !isPhone && 'h-dvh overflow-hidden')}>
            {sidebar}
            <div className="flex min-w-0 flex-1 flex-col">
              {topbar}
              <main id="main" tabIndex={-1} className={cn('flex min-h-0 flex-1 flex-col outline-none', !isPhone && 'overflow-y-auto', isPhone && (phoneDetail ? 'pb-[calc(24px+var(--sa-bottom))]' : 'pb-[calc(64px+88px+var(--sa-bottom))]'))}>
                {hint && (
                  <div role="status" className={cn('mb-3 flex items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3 text-[14px] text-fg-2', isPhone ? 'mx-4' : 'mx-6')}>
                    <Icon name="info" size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">{t('0.6.0 起导航改成了动作：首页、找选题、写内容、去发布、看效果；设置都在“我的”。')}</span>
                    <Button size="sm" variant="ghost" onClick={() => { localStorage.setItem(V6_HINT, '1'); setHint(false); }}>{t('知道了')}</Button>
                  </div>
                )}
                <ErrorBoundary key={route.space + route.sub}>
                  <Suspense fallback={<div className="page"><Loading show lines={5} /></div>}>{body}</Suspense>
                </ErrorBoundary>
              </main>
            </div>
            {isPhone && !phoneDetail && (
              <>
                <button type="button" aria-label={t('新写一篇或添加软件')} aria-haspopup="dialog" onClick={() => setFabOpen(true)} data-testid="fab"
                  className="add-app-fab !fixed right-4 z-30 !h-14 !min-h-14 !w-14 !rounded-full !p-0 bottom-[calc(64px+16px+var(--sa-bottom))]">
                  <Icon name="plus" size={24} strokeWidth={1.75} />
                </button>
                <nav aria-label="快捷导航" className="app-bottom fixed inset-x-0 bottom-0 z-30 grid h-[calc(64px+var(--sa-bottom))] grid-cols-5 items-start border-t border-line bg-surface px-2 pb-[var(--sa-bottom)] pt-1" data-testid="bottom-nav">
                  {BOTTOM_ITEMS.map(bottomTab)}
                </nav>
              </>
            )}
            {isPhone && (
              <Drawer open={fabOpen} onOpenChange={setFabOpen}>
                <DrawerContent title={t('新建')} description={t('发布始终由你本人完成。')}>
                  <DrawerItem icon={<Icon name="create" size={18} />} label={t('新写一篇')} hint={t('输入一个想法，助手帮你写')} tone="primary" onClick={() => { setFabOpen(false); go('write/new'); }} />
                  <DrawerItem icon={<Icon name="plus" size={18} />} label={t('添加软件')} hint={t('把手机上的官方 App 加进来，发布时一键打开')} onClick={() => openAdd()} />
                </DrawerContent>
              </Drawer>
            )}
          </div>
          <AddAppSheet open={addOpen} onOpenChange={setAddOpen} lay={lay} data={apps.data} initial={addInitial} onSaved={() => setAppsVersion((v) => v + 1)} />
          <CommandPalette open={cmdk} onClose={() => setCmdk(false)} go={go} t={t} />
        </TooltipProvider>
      </AddAppContext.Provider>
    </LangContext.Provider>
  );
}
