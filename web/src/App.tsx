import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { get } from './api';
import { LangContext, translate, type Lang } from './i18n';
import { Icon } from './icons';
import { deviceClass, runtime, type Device } from './runtime';
import { Loading, prefersReducedMotion } from './ui';
import { NAV, NAV_GROUPS, NEW_ACTIONS, SIDEBAR_ITEMS, WORK_NAV, layoutOf, type NavItem } from './nav';
import { normalize, parseHash, toHash, type Route } from './route';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { Drawer, DrawerContent, DrawerItem } from './components/ui/drawer';
import { Tip, TooltipProvider } from './components/ui/tooltip';
import { cn } from './components/ui/utils';
import { AddAppButton } from './components/AddAppButton';
import { AddAppSheet } from './components/AddAppSheet';
import { AddAppContext } from './components/addAppContext';
import { Today } from './pages/today';
import { useLocalApps } from './format';
import type { Theme } from './pages/settings';

// 页面级懒加载：今天页随主包，其余 7 页按需加载（主包 < 400 kB）。
const Inspire = lazy(() => import('./pages/inspire').then((m) => ({ default: m.Inspire })));
const Create = lazy(() => import('./pages/create').then((m) => ({ default: m.Create })));
const Analytics = lazy(() => import('./pages/publish').then((m) => ({ default: m.Analytics })));
const PlatformsPage = lazy(() => import('./pages/platforms').then((m) => ({ default: m.PlatformsPage })));
const ModelsPage = lazy(() => import('./pages/models').then((m) => ({ default: m.ModelsPage })));
const AgentPage = lazy(() => import('./pages/agent').then((m) => ({ default: m.AgentPage })));
const PrefsPage = lazy(() => import('./pages/prefs').then((m) => ({ default: m.PrefsPage })));

export { NAV } from './nav';

/** 全局错误边界：渲染异常时给出可恢复的提示，而不是白屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div className="alert error" role="alert" style={{ margin: 24 }}>
        <Icon name="alert" size={16} />
        <div>
          <strong>页面出错：{this.state.error.message}</strong>
          <div style={{ marginTop: 8 }}><button onClick={() => this.setState({ error: null })}>重试</button></div>
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

/** 命令面板：⌘K / Ctrl+K，搜索 8 个页面与它们的标签；旧名称（设置、密钥、插件…）作为别名也能搜到。 */
function CommandPalette({ open, onClose, go, t }: { open: boolean; onClose: () => void; go: (p: string) => void; t: (k: string) => string }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const items = NAV.filter((n) => !q || `${n.label}${t(n.label)}${n.id}${n.desc}${n.group}${n.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase()));
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
            autoFocus value={q} placeholder={t('搜索页面…')} aria-label={t('快速跳转')} aria-controls="cmdk-list" aria-activedescendant={items[idx] ? `cmdk-${items[idx]!.id.replace('/', '-')}` : undefined}
            className="!min-h-12 !border-0 !bg-transparent !p-0 text-base !shadow-none"
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter' && items[idx]) pick(items[idx]!.id);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmdk-list" role="listbox" aria-label={t('页面')} className="m-0 max-h-[50vh] list-none overflow-y-auto p-2">
          {items.map((n, i) => (
            <li
              key={n.id} id={`cmdk-${n.id.replace('/', '-')}`} role="option" aria-selected={i === idx}
              className={cn('flex min-h-10 cursor-pointer items-center gap-3 rounded-ctl px-2 py-2 text-sm text-fg', i === idx && 'bg-surface-2')}
              onMouseEnter={() => setIdx(i)} onClick={() => pick(n.id)}
            >
              <span className={cn('text-muted', i === idx && 'text-fg')}><Icon name={n.icon} size={16} /></span>
              <span className="min-w-0 flex-1 truncate">{t(n.label)}<small className="text-[13px] text-muted"> · {n.id.includes('/') ? t(n.group) : t(n.desc)}</small></span>
              <Icon name="arrowRight" size={14} className={cn('text-muted opacity-0', i === idx && 'opacity-100')} />
            </li>
          ))}
          {!items.length && <li className="py-6 text-center text-muted">{t('暂无数据')}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

const HINT_KEY = 'ca.v5.hint';

export function App() {
  const width = useWidth();
  const online = useOnline();
  const device: Device = deviceClass(width, runtime());
  const lay = layoutOf(width);
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ca.theme') as Theme) || 'system');
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ca.lang') as Lang) || 'zh');
  const [cmdk, setCmdk] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [center, setCenter] = useState('douyin');
  const [hint, setHint] = useState(() => !localStorage.getItem(HINT_KEY));
  // 侧栏：平板默认折叠为 64px 图标栏，电脑默认展开 232px；用户的选择分别保存在本机。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('ca.side.collapsed') ?? '{}'); } catch { return {}; }
  });
  const rail = lay === 'tablet' ? collapsed.tablet !== false : lay === 'desktop' ? collapsed.desktop === true : false;
  const toggleRail = () => {
    const next = { ...collapsed, [lay]: !rail };
    setCollapsed(next);
    localStorage.setItem('ca.side.collapsed', JSON.stringify(next));
  };
  // 添加软件（全局 Sheet）
  const [addOpen, setAddOpen] = useState(false);
  const [addInitial, setAddInitial] = useState<string | undefined>(undefined);
  const [appsVersion, setAppsVersion] = useState(0);
  const apps = useLocalApps(appsVersion);
  const appCount = apps.data?.apps?.length ?? 0;
  const openAdd = useCallback((platform?: string) => { setMoreOpen(false); setFabOpen(false); setAddInitial(platform); setAddOpen(true); }, []);
  const addCtx = useMemo(() => ({ open: openAdd, count: appCount, version: appsVersion }), [openAdd, appCount, appsVersion]);

  const t = useMemo(() => (k: string) => translate(lang, k), [lang]);
  const firstTheme = useRef(true);

  useEffect(() => {
    localStorage.setItem('ca.theme', theme);
    const root = document.documentElement;
    if (!firstTheme.current && !prefersReducedMotion()) {
      root.classList.add('theme-switching');
      const tm = setTimeout(() => root.classList.remove('theme-switching'), 240);
      root.dataset.theme = theme;
      return () => clearTimeout(tm);
    }
    firstTheme.current = false;
    root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => { localStorage.setItem('ca.lang', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);

  // 旧 hash 兼容：首次进入时把 #settings/*、#review、#status 等替换为新地址（不新增历史记录）。
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
    setMoreOpen(false);
    window.scrollTo?.(0, 0);
  }, []);

  useEffect(() => {
    const load = () => get('/api/notifications').then((n) => setPending(Number(n?.pendingDrafts) || 0)).catch(() => {});
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((x) => !x); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const openCenter = (id: string) => { setCenter(id); go(`create/publish/${id}`); };
  const isPhone = lay === 'phone';
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  const toggleTheme = () => setTheme(dark ? 'light' : 'dark');
  const dismissHint = () => { localStorage.setItem(HINT_KEY, '1'); setHint(false); };

  // 手机全屏详情：草稿详情（编辑器全屏时隐藏右下“＋”）。
  const phoneDetail = isPhone && route.space === 'create' && route.sub === 'drafts' && !!route.id;
  const item = SIDEBAR_ITEMS.find((s) => s.id === route.space);
  const title = item?.label ?? '';
  const subtitle = item?.desc ?? '';
  const back = phoneDetail ? () => go('create/drafts') : null;
  const backTitle = route.id ? `${t('草稿')} #${route.id}` : t(title);

  const body = (() => {
    switch (route.space) {
      case 'inspire': return <Inspire tab={route.sub} go={go} device={device} lay={lay} />;
      case 'create': return <Create route={route} go={go} lay={lay} openCenter={openCenter} center={route.id && route.sub === 'publish' ? route.id : center} setCenter={(id) => { setCenter(id); go(`create/publish/${id}`); }} />;
      case 'analytics': return <div className="page"><Analytics /></div>;
      case 'platforms': return <PlatformsPage go={go} lay={lay} device={device} />;
      case 'models': return <ModelsPage tab={route.sub} go={go} lay={lay} />;
      case 'agent': return <AgentPage tab={route.sub} go={go} lay={lay} />;
      case 'prefs': return <PrefsPage tab={route.sub} id={route.id} go={go} lay={lay} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
      default: return <Today go={go} lay={lay} />;
    }
  })();

  const navActive = (id: string) => route.space === id;
  const pendingBadge = (railMode: boolean) => pending > 0 && (railMode
    ? <span className="absolute right-1 top-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[11px] font-medium leading-none text-ink-fg" aria-hidden="true">{pending}</span>
    : <span className="ml-auto inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-surface-3 px-1.5 text-[12px] font-medium tabular-nums text-fg" aria-hidden="true">{pending}</span>);

  /** 侧栏的一项：36px 高、16px 图标；当前项浅灰底 + 墨色文字（不用强调色色块）。 */
  const sideLink = (n: NavItem, railMode: boolean) => {
    const label = n.id === 'create' && pending > 0 ? `${t(n.label)}（${pending} ${t('篇待审')}）` : t(n.label);
    const a = (
      <a
        href={`#${n.id}`} aria-current={navActive(n.id) ? 'page' : undefined} aria-label={railMode || (n.id === 'create' && pending > 0) ? label : undefined}
        onClick={(e) => { e.preventDefault(); go(n.id); }}
        className={cn(
          'relative flex items-center gap-2 rounded-ctl text-sm text-side-fg no-underline transition-colors duration-150 hover:bg-side-active hover:text-fg hover:no-underline',
          railMode ? 'h-10 w-10 justify-center' : isPhone ? 'h-11 px-3' : 'h-9 px-2',
          navActive(n.id) && 'bg-side-active font-medium text-fg',
        )}
      >
        <Icon name={n.icon} size={16} />
        {!railMode && <span className="truncate">{t(n.label)}</span>}
        {n.id === 'create' && pendingBadge(railMode)}
      </a>
    );
    return <li key={n.id}>{railMode ? <Tip label={t(n.label)}>{a}</Tip> : a}</li>;
  };

  /** 两组 8 项，无二级菜单。 */
  const navGroups = (railMode: boolean) => NAV_GROUPS.map((g, gi) => (
    <div key={g.title} className={cn(gi > 0 && (railMode ? 'mt-3 border-t border-line pt-3' : 'mt-5'))} role="group" aria-label={t(g.title)}>
      {!railMode && <div className={cn('pb-1 text-[12px] font-medium text-muted', isPhone ? 'px-3' : 'px-2')}>{t(g.title)}</div>}
      <ul className={cn('m-0 flex list-none flex-col gap-0.5 p-0', railMode && 'items-center')}>{g.items.map((n) => sideLink(n, railMode))}</ul>
    </div>
  ));

  const sidebar = !isPhone && (
    <nav aria-label="主导航" data-rail={rail ? 'true' : 'false'} className={cn('app-side sticky top-0 flex h-dvh shrink-0 flex-col overflow-y-auto bg-side transition-[width] duration-200', rail ? 'w-16 items-center px-2' : 'w-[232px] px-3')}>
      <div className={cn('flex min-h-14 shrink-0 items-center gap-2 pt-1', rail ? 'flex-col justify-center pt-3' : 'px-1')}>
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-ctl bg-ink text-ink-fg"><Icon name="topics" size={14} strokeWidth={1.75} /></span>
        {!rail && <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className="truncate text-sm font-semibold tracking-[-0.01em] text-fg">{t('内容运营助手')}</span><small className="text-[12px] text-muted">Content Agent</small></span>}
        <Tip label={rail ? t('展开侧栏') : t('收起侧栏')}>
          <Button variant="ghost" size="icon" aria-label={rail ? t('展开侧栏') : t('收起侧栏')} aria-expanded={!rail} onClick={toggleRail}><Icon name={rail ? 'sidebar' : 'collapse'} size={16} /></Button>
        </Tip>
      </div>
      {rail
        ? <Tip label={`${t('快速跳转')} ⌘K`}><Button variant="ghost" size="icon" className="mb-2" aria-label={t('快速跳转')} onClick={() => setCmdk(true)}><Icon name="search" size={16} /></Button></Tip>
        : (
          <button onClick={() => setCmdk(true)} aria-label={t('快速跳转')} className="!mb-3 !h-8 !min-h-8 w-full shrink-0 !justify-start gap-2 !border-line !bg-transparent !px-2 text-[13px] !font-normal !text-muted hover:!text-fg-2">
            <Icon name="search" size={16} /><span className="flex-1 text-left">{t('搜索或跳转')}</span><kbd>⌘K</kbd>
          </button>
        )}
      <div className={cn('flex-1', rail && 'flex w-full flex-col items-center')}>{navGroups(rail)}</div>
      {/* 悬浮“添加软件”：sticky 置底，发丝线 + 12px 与上方导航隔开；上方预留按钮高度的空白，避免遮挡 */}
      <div className={cn('add-app-dock sticky bottom-0 z-10 mt-4 w-full shrink-0 border-t border-line bg-side pb-3 pt-3', rail && 'flex justify-center')}>
        <AddAppButton variant={rail ? 'rail' : 'side'} />
      </div>
    </nav>
  );

  const topbar = (
    <header className={cn('sticky top-0 z-20 flex shrink-0 items-center gap-2 bg-canvas', isPhone ? 'min-h-14 px-2 pt-[max(0px,env(safe-area-inset-top))]' : 'h-14 px-6')}>
      {back
        ? <Button variant="ghost" size="icon-lg" aria-label={t('返回')} onClick={back}><Icon name="arrowLeft" size={20} /></Button>
        : isPhone && <span className="w-2" />}
      <div className="min-w-0 flex-1">
        <h1 className={cn('truncate', isPhone ? 'text-base' : 'text-[18px]')}>{back ? backTitle : t(title)}</h1>
        {!isPhone && subtitle && <p className="m-0 truncate text-[13px] text-muted">{t(subtitle)}</p>}
      </div>
      <div className="topbar-actions flex shrink-0 items-center gap-1">
        {!online && <span className="badge warn" role="status"><Icon name="wifiOff" size={14} /> {t('离线')}</span>}
        {isPhone && <Button variant="ghost" size="icon-lg" aria-label={t('快速跳转')} onClick={() => setCmdk(true)}><Icon name="search" size={20} /></Button>}
        <Button variant="ghost" size={isPhone ? 'icon-lg' : 'icon'} aria-label={t(dark ? '切换到浅色' : '切换到深色')} title={t(dark ? '切换到浅色' : '切换到深色')} onClick={toggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} size={isPhone ? 20 : 16} />
        </Button>
      </div>
    </header>
  );

  const bottomTab = (n: NavItem) => (
    <a
      key={n.id} href={`#${n.id}`} aria-current={navActive(n.id) ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(n.id); }}
      className={cn('relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-ctl text-muted no-underline hover:no-underline active:scale-[.98]', navActive(n.id) && 'font-medium text-fg')}
    >
      <Icon name={n.icon} size={22} />
      <small className="text-[12px] leading-tight">{t(n.label)}</small>
      {n.id === 'create' && pending > 0 && <span className="absolute left-[calc(50%+6px)] top-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1.5 text-[12px] font-medium text-ink-fg" aria-label={`${pending} 篇待审`}>{pending}</span>}
    </a>
  );
  const deskActive = ['platforms', 'models', 'agent', 'prefs'].includes(route.space);

  /** 手机“更多”：从左侧滑出的抽屉 = 手机版侧栏，列全 8 项，底部固定“添加软件”。 */
  const moreDrawer = isPhone && (
    <D.Root open={moreOpen} onOpenChange={setMoreOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[70] bg-black/32" />
        <D.Content aria-describedby={undefined} className="sheet-left fixed inset-y-0 left-0 z-[71] flex w-[min(300px,86vw)] flex-col bg-side text-fg shadow-pop outline-none">
          <div className="flex min-h-14 items-center gap-2 px-4 pt-[max(0px,env(safe-area-inset-top))]">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-ctl bg-ink text-ink-fg"><Icon name="topics" size={14} strokeWidth={1.75} /></span>
            <D.Title className="m-0 flex-1 text-sm font-semibold">{t('内容运营助手')}</D.Title>
            <D.Close asChild><Button variant="ghost" size="icon-lg" aria-label={t('关闭')}><Icon name="close" size={18} /></Button></D.Close>
          </div>
          <nav aria-label={t('全部页面')} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{navGroups(false)}</nav>
          <div className="add-app-dock sticky bottom-0 border-t border-line bg-side px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
            <AddAppButton variant="drawer" />
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );

  return (
    <LangContext.Provider value={{ lang, t }}>
      <AddAppContext.Provider value={addCtx}>
        <TooltipProvider delayDuration={200}>
          <a className="skip" href="#main">跳到主要内容</a>
          <div className={cn('shell', lay, 'flex min-h-dvh bg-canvas', !isPhone && 'h-dvh overflow-hidden')}>
            {sidebar}
            <div className="flex min-w-0 flex-1 flex-col">
              {topbar}
              <main
                id="main" tabIndex={-1}
                className={cn('flex min-h-0 flex-1 flex-col outline-none', !isPhone && 'overflow-y-auto', isPhone && (phoneDetail ? 'pb-[calc(84px+env(safe-area-inset-bottom))]' : 'pb-[calc(56px+88px+env(safe-area-inset-bottom))]'))}
              >
                {hint && (
                  <div role="status" className={cn('mb-3 flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-[13px] text-fg-2', isPhone ? 'mx-4' : 'mx-6')}>
                    <Icon name="info" size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">{t('设置已经并入侧栏的平台、模型、Agent、偏好四页')}</span>
                    <Button size="sm" variant="ghost" onClick={dismissHint} aria-label={t('知道了，不再提示')}>{t('知道了')}</Button>
                  </div>
                )}
                <ErrorBoundary key={route.space}>
                  <Suspense fallback={<div className="page"><Loading show lines={5} /></div>}>{body}</Suspense>
                </ErrorBoundary>
              </main>
            </div>
            {isPhone && !phoneDetail && (
              <>
                <button
                  type="button" aria-label={t('新建或添加软件')} aria-haspopup="dialog" onClick={() => setFabOpen(true)} data-testid="fab"
                  className="add-app-fab !fixed right-4 z-30 !h-14 !min-h-14 !w-14 !rounded-full !p-0 bottom-[calc(56px+16px+env(safe-area-inset-bottom))]"
                >
                  <Icon name="plus" size={24} strokeWidth={1.75} />
                </button>
                <nav aria-label="快捷导航" className="app-bottom fixed inset-x-0 bottom-0 z-30 grid h-[calc(56px+env(safe-area-inset-bottom))] grid-cols-5 items-start bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] pt-0.5 shadow-bar backdrop-blur-md">
                  {WORK_NAV.map(bottomTab)}
                  <button
                    type="button" aria-label={t('更多')} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}
                    className={cn('!flex !h-[52px] !min-h-[52px] !flex-col !items-center !justify-center !gap-0.5 !border-0 !bg-transparent !p-0 !font-normal text-muted', deskActive && '!font-medium !text-fg')}
                  >
                    <Icon name="menu" size={22} />
                    <small className="text-[12px] leading-tight">{t('更多')}</small>
                  </button>
                </nav>
              </>
            )}
            {moreDrawer}
            {isPhone && (
              <Drawer open={fabOpen} onOpenChange={setFabOpen}>
                <DrawerContent title={t('新建')} description={t('从哪里开始？发布始终由你本人完成。')}>
                  <DrawerItem icon={<Icon name="plus" size={18} />} label={t('添加软件')} hint={t('登记手机或电脑上的官方 App，之后一键打开或分享草稿')} tone="primary" onClick={() => openAdd()} />
                  {NEW_ACTIONS.map((a) => <DrawerItem key={a.to} icon={<Icon name={a.icon} size={18} />} label={t(a.label)} hint={t(a.hint)} onClick={() => { setFabOpen(false); go(a.to); }} />)}
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
