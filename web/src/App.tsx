import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get } from './api';
import { LangContext, translate, type Lang } from './i18n';
import { deviceClass, runtime, type Device } from './runtime';
import { Overview, Hot, Library, Topics } from './pages/content';
import { Review, CreatorCenters, Analytics } from './pages/publish';
import { AgentFiles, Improve, Plugins, Tasks } from './pages/system';
import { Settings, type Theme } from './pages/settings';

export const NAV: { id: string; label: string; icon: string; plugin?: string }[] = [
  { id: 'overview', label: '总览', icon: '◎' },
  { id: 'hot', label: '热点', icon: '▲' },
  { id: 'library', label: '内容库', icon: '▤' },
  { id: 'topics', label: '选题', icon: '✦' },
  { id: 'review', label: '审核', icon: '✓' },
  { id: 'creator', label: '创作中心', icon: '▣' },
  { id: 'analytics', label: '复盘', icon: '▥' },
  { id: 'agent', label: '系统文件', icon: '❖' },
  { id: 'improve', label: '改进与评测', icon: '↻' },
  { id: 'plugins', label: '插件管理', icon: '⚙' },
  { id: 'tasks', label: '任务与日志', icon: '☰' },
  { id: 'settings', label: '设置', icon: '⚒' },
];
const PHONE_TABS = ['overview', 'hot', 'topics', 'review', 'settings'];

/** 全局错误边界：渲染异常时给出可恢复的提示，而不是白屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div className="alert error" role="alert" style={{ margin: 24 }}>
        <strong>页面出错：{this.state.error.message}</strong>
        <div><button onClick={() => this.setState({ error: null })}>重试</button></div>
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

export function App() {
  const width = useWidth();
  const online = useOnline();
  const device: Device = deviceClass(width, runtime());
  const [page, setPage] = useState(() => (location.hash.slice(1) || 'overview'));
  const [center, setCenter] = useState('douyin');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ca.theme') as Theme) || 'system');
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ca.lang') as Lang) || 'zh');
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(0);
  const t = useMemo(() => (k: string) => translate(lang, k), [lang]);

  useEffect(() => { localStorage.setItem('ca.theme', theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { localStorage.setItem('ca.lang', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);
  useEffect(() => { location.hash = page; window.scrollTo?.(0, 0); document.getElementById('main')?.focus(); }, [page]);
  useEffect(() => {
    const load = () => get('/api/notifications').then((n) => setPending(n.pendingDrafts)).catch(() => {});
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  const go = (p: string) => { setPage(p); setMenu(false); };
  const openCenter = (id: string) => { setCenter(id); go('creator'); };
  const isPhone = device === 'phone';
  const title = NAV.find((n) => n.id === page)?.label ?? '';

  const body = (() => {
    switch (page) {
      case 'hot': return <Hot device={device} go={go} />;
      case 'library': return <Library go={go} />;
      case 'topics': return <Topics device={device} go={go} />;
      case 'review': return <Review openCenter={openCenter} />;
      case 'creator': return <CreatorCenters active={center} setActive={setCenter} />;
      case 'analytics': return <Analytics />;
      case 'agent': return <AgentFiles />;
      case 'improve': return <Improve />;
      case 'plugins': return <Plugins device={device} />;
      case 'tasks': return <Tasks />;
      case 'settings': return <Settings theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
      default: return <Overview go={go} />;
    }
  })();

  const navList = (
    <ul>
      {NAV.map((n) => (
        <li key={n.id}>
          <a href={`#${n.id}`} aria-current={page === n.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(n.id); }}>
            <span aria-hidden="true" className="ico">{n.icon}</span>{t(n.label)}
            {n.id === 'review' && pending > 0 && <span className="pill" aria-label={`${pending} 篇待审`}>{pending}</span>}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <LangContext.Provider value={{ lang, t }}>
      <a className="skip" href="#main">跳到主要内容</a>
      <div className={`shell ${device}`}>
        {!isPhone && (
          <nav className={`side ${device === 'tablet' && !menu ? 'collapsed' : ''}`} aria-label="主导航">
            <div className="brand">
              {device === 'tablet' && <button className="icon-btn" aria-label="展开/收起导航" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>}
              <span>内容运营助手</span>
            </div>
            {navList}
          </nav>
        )}
        {isPhone && menu && (
          <div className="drawer" role="dialog" aria-modal="true" aria-label="全部功能">
            <button className="icon-btn" aria-label="关闭" onClick={() => setMenu(false)}>✕</button>
            <nav aria-label="全部功能">{navList}</nav>
          </div>
        )}
        <div className="content">
          <header className="topbar">
            {isPhone && <button className="icon-btn" aria-label="全部功能" onClick={() => setMenu(true)}>☰</button>}
            <h1>{t(title)}</h1>
            <div className="row">
              {!online && <span className="badge warn" role="status">{t('离线')}</span>}
              <span className="badge neutral small" title="发布永远由你本人完成">{t('发布由你本人完成')}</span>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            <ErrorBoundary key={page}>{body}</ErrorBoundary>
          </main>
        </div>
        {isPhone && (
          <nav className="bottom" aria-label="快捷导航">
            {PHONE_TABS.map((id) => {
              const n = NAV.find((x) => x.id === id)!;
              return (
                <a key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>
                  <span aria-hidden="true">{n.icon}</span><small>{t(n.label)}</small>
                  {id === 'review' && pending > 0 && <span className="pill">{pending}</span>}
                </a>
              );
            })}
          </nav>
        )}
      </div>
    </LangContext.Provider>
  );
}
