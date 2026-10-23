import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { startReminderScheduler } from './v9/reminders';
import { apiMode } from './api';
import { LangContext, translate, type Lang } from './i18n';
import { Icon } from './icons';
import { Loading, prefersReducedMotion } from './ui';
import { NAV, layoutOf, type NavItem } from './nav';
import { normalize, parseHash, toHash, type Route } from './route';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { TooltipProvider } from './components/ui/tooltip';
import { cn } from './components/ui/utils';
import { AddAppSheet } from './components/AddAppSheet';
import { AddAppContext } from './components/addAppContext';
import { Workbench, shellLayoutOf } from './shell/Workbench';
import { CENTERS } from './data/platforms';
import { useLocalApps } from './format';
import { getModels, getPrefs } from './local/store';
import type { Theme } from './state';

// 页面级懒加载：首页随主包，其余按需加载（首屏轻量，借鉴 NextChat）。
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
          <div className="problem-a"><button type="button" className="primary" onClick={() => this.setState({ error: null })}>重试</button><button type="button" onClick={() => { location.hash = 'agent'; this.setState({ error: null }); }}>回到首页</button></div>
        </div>
      </div>
    );
    return this.props.children;
  }
}

function useSize(): { w: number; h: number } {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setW({ w: window.innerWidth, h: window.innerHeight });
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
  const all: NavItem[] = [...NAV, ...CENTERS.map((c) => ({ id: `p/${c.id}`, label: c.label, icon: 'globe', desc: `在主区打开 ${c.label}`, keywords: c.id }))];
  const items = all.filter((n) => !q || `${n.label}${t(n.label)}${n.id}${n.desc}${n.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase()));
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

export function App() {
  const size = useSize();
  const online = useOnline();
  const lay = layoutOf(size.w);
  const shell = shellLayoutOf(size.w, size.h);
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ca.theme') as Theme) || 'system');
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ca.lang') as Lang) || 'zh');
  const [cmdk, setCmdk] = useState(false);
  // 添加软件（全局 Sheet，登记手机上的官方 App）
  const [addOpen, setAddOpen] = useState(false);
  const [addInitial, setAddInitial] = useState<string | undefined>(undefined);
  const [appsVersion, setAppsVersion] = useState(0);
  const apps = useLocalApps(appsVersion);
  const appCount = apps.data?.apps?.length ?? 0;
  const openAdd = useCallback((platform?: string) => { setAddInitial(platform); setAddOpen(true); }, []);
  const addCtx = useMemo(() => ({ open: openAdd, count: appCount, version: appsVersion }), [openAdd, appCount, appsVersion]);
  const t = useMemo(() => (k: string) => translate(lang, k), [lang]);

  useEffect(() => {
    localStorage.setItem('ca.theme', theme);
    const root = document.documentElement;
    if (!prefersReducedMotion()) { root.classList.add('theme-switching'); setTimeout(() => root.classList.remove('theme-switching'), 240); }
    root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => { localStorage.setItem('ca.lang', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);

  // 旧 hash 兼容：0.7.0 六页、0.5.0、#settings/*、0.2.x 地址替换为 0.8.0 地址（不新增历史记录）。
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
  }, []);

  // 首次打开（本机没有任何模型配置、也没走过引导）→ 进入首启引导。
  useEffect(() => {
    if (apiMode() === 'server') return;
    void Promise.all([getModels(), getPrefs()]).then(([m, p]) => {
      if (!m.providers.length && !p.onboarded && !location.hash.slice(1).startsWith('me')) go('onboarding');
    }).catch(() => {});
  }, [go]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((x) => !x); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => { document.title = '超级工作台'; }, []);
  // 0.9.0 本机提醒：App 打开期间每 30 秒检查一次；只发本机通知，不执行任何动作（ADR-009）
  useEffect(() => (import.meta.env.MODE === 'test' ? undefined : startReminderScheduler()), []);

  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  const isPhone = lay === 'phone';
  const meSubItem = route.space === 'me' && route.sub ? NAV.find((n) => n.id === `me/${route.sub}`) : null;
  const back = route.space === 'me' && route.sub ? () => go(route.sub === 'models' && route.id ? 'me/models' : 'me') : null;

  const tools = (
    <div className="flex shrink-0 items-center gap-1">
      {!online && <span className="badge warn" role="status"><Icon name="wifiOff" size={14} /> {t('离线')}</span>}
      <Button variant="ghost" size="icon-lg" aria-label={t('快速跳转')} onClick={() => setCmdk(true)}><Icon name="search" size={18} /></Button>
      <Button variant="ghost" size="icon-lg" aria-label={t(dark ? '切换到浅色' : '切换到深色')} onClick={() => setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={18} /></Button>
    </div>
  );

  const meContent = route.space === 'me' ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="app-top sticky top-0 z-20 flex shrink-0 items-center gap-2 bg-canvas px-2 sm:px-6" style={{ minHeight: isPhone ? 48 : 64 }} data-testid="topbar">
        {back ? <Button variant="ghost" size="icon-lg" aria-label={t('返回')} onClick={back}><Icon name="arrowLeft" size={20} /></Button> : null}
        <div className="min-w-0 flex-1">
          <h1 className={isPhone ? 'truncate text-[18px]' : 'truncate text-[20px]'}>{t(meSubItem?.label ?? '我的')}</h1>
          {!isPhone && <p className="m-0 truncate text-[13px] text-muted">{t(meSubItem?.desc ?? '模型、平台与软件、数据源、规则、设置')}</p>}
        </div>
        {!isPhone && tools}
      </header>
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto pb-[calc(24px+var(--sa-bottom))] outline-none">
        <ErrorBoundary key={route.sub}>
          <Suspense fallback={<div className="page"><Loading show lines={5} /></div>}>
            <div key={`${route.sub}/${route.id ?? ''}`} className="anim-page">
            <Me sub={route.sub} id={route.id} go={go} lay={lay} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  ) : undefined;

  return (
    <LangContext.Provider value={{ lang, t }}>
      <AddAppContext.Provider value={addCtx}>
        <TooltipProvider delayDuration={200}>
          <a className="skip" href="#main">跳到主要内容</a>
          <div className={cn('shell app-root', lay)}>
            {route.space === 'onboarding' ? (
              <ErrorBoundary><Suspense fallback={<div className="page"><Loading show lines={5} /></div>}><Onboarding go={go} /></Suspense></ErrorBoundary>
            ) : (
              <ErrorBoundary>
                <Workbench route={route} go={go} lay={shell} header={tools} meContent={meContent} />
              </ErrorBoundary>
            )}
          </div>
          <AddAppSheet open={addOpen} onOpenChange={setAddOpen} lay={lay} data={apps.data} initial={addInitial} onSaved={() => setAppsVersion((v) => v + 1)} />
          <CommandPalette open={cmdk} onClose={() => setCmdk(false)} go={go} t={t} />
        </TooltipProvider>
      </AddAppContext.Provider>
    </LangContext.Provider>
  );
}
