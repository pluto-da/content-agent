import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get } from './api';
import { LangContext, translate, type Lang } from './i18n';
import { Icon } from './icons';
import { deviceClass, runtime, type Device } from './runtime';
import { prefersReducedMotion } from './ui';
import { NAV, NEW_ACTIONS, SETTINGS_NAV, SPACE_NAV, layoutOf, type Layout } from './nav';
import { normalize, parseHash, toHash, type Route } from './route';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { Drawer, DrawerContent, DrawerItem } from './components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown';
import { Tip, TooltipProvider } from './components/ui/tooltip';
import { cn } from './components/ui/utils';
import { Today } from './pages/today';
import { Inspire } from './pages/inspire';
import { Create } from './pages/create';
import { Analytics } from './pages/publish';
import { SettingsCenter } from './pages/settings-center';
import type { Theme } from './pages/settings';

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

/** 命令面板：⌘K / Ctrl+K 快速跳转（Radix Dialog）。 */
function CommandPalette({ open, onClose, go, t }: { open: boolean; onClose: () => void; go: (p: string) => void; t: (k: string) => string }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const items = NAV.filter((n) => !q || `${n.label}${t(n.label)}${n.id}${n.desc}${n.group}`.toLowerCase().includes(q.toLowerCase()));
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
              <span className="min-w-0 flex-1 truncate">{t(n.label)}<small className="text-[13px] text-muted"> · {t(n.group === 'space' ? n.desc : n.group)}</small></span>
              <Icon name="arrowRight" size={14} className={cn('text-muted opacity-0', i === idx && 'opacity-100')} />
            </li>
          ))}
          {!items.length && <li className="py-6 text-center text-muted">{t('暂无数据')}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** “＋新建”菜单的内容（桌面下拉 / 手机抽屉共用）。 */
function NewMenu({ lay, go, t, open, setOpen, trigger }: { lay: Layout; go: (p: string) => void; t: (k: string) => string; open: boolean; setOpen: (o: boolean) => void; trigger?: ReactNode }) {
  if (lay === 'phone') return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent title={t('新建')} description={t('从哪里开始？发布始终由你本人完成。')}>
        {NEW_ACTIONS.map((a) => <DrawerItem key={a.to} icon={<Icon name={a.icon} size={18} />} label={t(a.label)} hint={t(a.hint)} onClick={() => { setOpen(false); go(a.to); }} />)}
      </DrawerContent>
    </Drawer>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={lay === 'tablet' ? 'right' : 'bottom'}>
        {NEW_ACTIONS.map((a) => <DropdownMenuItem key={a.to} icon={<Icon name={a.icon} size={16} />} hint={t(a.hint)} onSelect={() => go(a.to)}>{t(a.label)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function App() {
  const width = useWidth();
  const online = useOnline();
  const device: Device = deviceClass(width, runtime());
  const lay = layoutOf(width);
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ca.theme') as Theme) || 'system');
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ca.lang') as Lang) || 'zh');
  const [cmdk, setCmdk] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [center, setCenter] = useState('douyin');
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

  // 旧 hash 兼容：首次进入时把 #review、#status 等替换为新地址（不新增历史记录）。
  useEffect(() => {
    const raw = location.hash.slice(1);
    const norm = toHash(parseHash(raw));
    if (raw && raw !== norm) history.replaceState(null, '', `#${norm}`);
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((target: string) => {
    const h = normalize(target);
    setRoute(parseHash(h));
    if (location.hash.slice(1) !== h) location.hash = h;
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

  // 手机全屏详情：草稿详情、设置分组。
  const phoneDetail = isPhone && ((route.space === 'create' && route.sub === 'drafts' && !!route.id) || (route.space === 'settings' && !!route.sub));
  const spaceItem = SPACE_NAV.find((s) => s.id === route.space);
  const sectionItem = SETTINGS_NAV.find((s) => s.section === route.sub);
  const title = route.space === 'settings' ? (isPhone && sectionItem ? sectionItem.label : '设置') : (spaceItem?.label ?? '');
  const subtitle = route.space === 'settings' ? (sectionItem?.desc ?? '运行状态、系统文件、插件、任务与偏好') : (spaceItem?.desc ?? '');
  const back = phoneDetail ? () => go(route.space === 'settings' ? 'settings' : 'create/drafts') : null;
  const backTitle = route.space === 'create' && route.id ? `${t('草稿')} #${route.id}` : t(title);

  const body = (() => {
    switch (route.space) {
      case 'inspire': return <Inspire tab={route.sub} go={go} device={device} lay={lay} />;
      case 'create': return <Create route={route} go={go} lay={lay} openCenter={openCenter} center={route.id && route.sub === 'publish' ? route.id : center} setCenter={(id) => { setCenter(id); go(`create/publish/${id}`); }} />;
      case 'analytics': return <div className="page"><Analytics /></div>;
      case 'settings': return <SettingsCenter section={route.sub} go={go} lay={lay} device={device} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
      default: return <Today go={go} lay={lay} />;
    }
  })();

  const navActive = (id: string) => route.space === id;
  const pill = (n: number, cls?: string) => n > 0 ? <span className={cn('ml-auto inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-surface-3 px-1.5 text-[12px] font-medium tabular-nums text-fg', cls)} aria-label={`${n} 篇待审`}>{n}</span> : null;

  const sideLink = (n: { id: string; label: string; icon: string }, rail: boolean) => {
    const a = (
      <a
        href={`#${n.id}`} aria-current={navActive(n.id) ? 'page' : undefined} aria-label={rail ? t(n.label) : undefined}
        onClick={(e) => { e.preventDefault(); go(n.id); }}
        className={cn(
          'relative flex items-center gap-2 rounded-ctl text-sm text-side-fg no-underline transition-colors duration-150 hover:bg-side-active hover:text-fg hover:no-underline',
          rail ? 'h-11 w-11 justify-center' : 'h-8 px-2',
          navActive(n.id) && 'bg-side-active font-medium text-fg',
        )}
      >
        <Icon name={n.icon} size={rail ? 20 : 16} />
        {!rail && <span className="truncate">{t(n.label)}</span>}
        {n.id === 'create' && (rail
          ? (pending > 0 && <span className="absolute right-1 top-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[11px] font-medium leading-none text-ink-fg" aria-label={`${pending} 篇待审`}>{pending}</span>)
          : pill(pending))}
      </a>
    );
    return <li key={n.id}>{rail ? <Tip label={t(n.label)}>{a}</Tip> : a}</li>;
  };

  const sidebar = lay !== 'phone' && (() => {
    const rail = lay === 'tablet';
    const newBtn = (
      <Button variant="default" size={rail ? 'icon-lg' : 'sm'} className={cn(rail ? '' : 'w-full justify-start')} aria-label={t('新建')}>
        <Icon name="plus" size={16} />{!rail && t('新建')}
      </Button>
    );
    return (
      <nav aria-label="主导航" className={cn('app-side sticky top-0 flex h-dvh shrink-0 flex-col gap-1 bg-side', rail ? 'w-16 items-center px-2 py-3' : 'w-[212px] px-3 py-3')}>
        <div className={cn('flex min-h-11 items-center gap-2', rail ? 'justify-center' : 'px-1 pb-1')}>
          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-ctl bg-ink text-ink-fg"><Icon name="topics" size={14} strokeWidth={1.75} /></span>
          {!rail && <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-sm font-semibold tracking-[-0.01em] text-fg">{t('内容运营助手')}</span><small className="text-[12px] text-muted">Content Agent</small></span>}
        </div>
        {rail
          ? <Tip label={`${t('快速跳转')} ⌘K`}><Button variant="ghost" size="icon-lg" aria-label={t('快速跳转')} onClick={() => setCmdk(true)}><Icon name="search" size={20} /></Button></Tip>
          : (
            <button onClick={() => setCmdk(true)} aria-label={t('快速跳转')} className="!mb-1 !h-8 !min-h-8 w-full !justify-start gap-2 !border-line !bg-transparent !px-2 text-[13px] !font-normal !text-muted hover:!text-fg-2">
              <Icon name="search" size={16} /><span className="flex-1 text-left">{t('搜索或跳转')}</span><kbd>⌘K</kbd>
            </button>
          )}
        <div className={cn(rail ? '' : 'mb-2 w-full')}>
          <NewMenu lay={lay} go={go} t={t} open={newOpen} setOpen={setNewOpen} trigger={rail ? <span><Tip label={t('新建')}>{newBtn}</Tip></span> : newBtn} />
        </div>
        <ul className={cn('m-0 flex list-none flex-col gap-0.5 p-0', rail && 'items-center')}>{SPACE_NAV.map((n) => sideLink(n, rail))}</ul>
        <div className="mt-auto w-full">
          <ul className={cn('m-0 flex list-none flex-col gap-0.5 p-0', rail && 'items-center')}>{sideLink({ id: 'settings', label: '设置', icon: 'settings' }, rail)}</ul>
          {!rail && <p className="m-0 truncate px-2 pt-3 text-[12px] text-muted">{t('发布由你本人完成')}</p>}
        </div>
      </nav>
    );
  })();

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
        {!isPhone && <Button variant="ghost" size="icon" aria-label={t('快速跳转')} title="⌘K" onClick={() => setCmdk(true)}><Icon name="command" size={16} /></Button>}
        <Button variant="ghost" size={isPhone ? 'icon-lg' : 'icon'} aria-label={t(dark ? '切换到浅色' : '切换到深色')} title={t(dark ? '切换到浅色' : '切换到深色')} onClick={toggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} size={isPhone ? 20 : 16} />
        </Button>
        {isPhone && route.space !== 'settings' && <Button variant="ghost" size="icon-lg" aria-label={t('设置')} onClick={() => go('settings')}><Icon name="settings" size={20} /></Button>}
      </div>
    </header>
  );

  const bottomTab = (id: string, label: string, icon: string) => (
    <a
      key={id} href={`#${id}`} aria-current={navActive(id) ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(id); }}
      className={cn('relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-ctl text-muted no-underline hover:no-underline active:scale-[.98]', navActive(id) && 'font-medium text-accent')}
    >
      <Icon name={icon} size={22} />
      <small className="text-[12px] leading-tight">{t(label)}</small>
      {id === 'create' && pending > 0 && <span className="absolute left-[calc(50%+6px)] top-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1.5 text-[12px] font-medium text-ink-fg" aria-label={`${pending} 篇待审`}>{pending}</span>}
    </a>
  );

  return (
    <LangContext.Provider value={{ lang, t }}>
      <TooltipProvider delayDuration={200}>
        <a className="skip" href="#main">跳到主要内容</a>
        <div className={cn('shell', lay, 'flex min-h-dvh bg-canvas', !isPhone && 'h-dvh overflow-hidden')}>
          {sidebar}
          <div className="flex min-w-0 flex-1 flex-col">
            {topbar}
            <main
              id="main" tabIndex={-1}
              className={cn('flex min-h-0 flex-1 flex-col outline-none', !isPhone && 'overflow-y-auto', isPhone && (phoneDetail ? 'pb-[calc(84px+env(safe-area-inset-bottom))]' : 'pb-[calc(92px+env(safe-area-inset-bottom))]'))}
            >
              <ErrorBoundary key={route.space}>{body}</ErrorBoundary>
            </main>
          </div>
          {isPhone && !phoneDetail && (
            <nav aria-label="快捷导航" className="app-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-center bg-surface/90 px-2 pb-[calc(4px+env(safe-area-inset-bottom))] pt-1 shadow-bar backdrop-blur-md">
              {bottomTab('today', '今天', 'today')}
              {bottomTab('inspire', '灵感', 'inspire')}
              <div className="flex justify-center">
                <button
                  type="button" aria-label={t('新建')} aria-haspopup="dialog" onClick={() => setNewOpen(true)}
                  className="!h-12 !min-h-12 !w-12 !rounded-full !border-ink !bg-ink !p-0 !text-ink-fg shadow-pop"
                >
                  <Icon name="plus" size={22} strokeWidth={1.75} />
                </button>
              </div>
              {bottomTab('create', '创作', 'create')}
              {bottomTab('analytics', '复盘', 'analytics')}
            </nav>
          )}
          {isPhone && <NewMenu lay={lay} go={go} t={t} open={newOpen} setOpen={setNewOpen} />}
        </div>
        <CommandPalette open={cmdk} onClose={() => setCmdk(false)} go={go} t={t} />
      </TooltipProvider>
    </LangContext.Provider>
  );
}
