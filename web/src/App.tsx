import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get } from './api';
import { LangContext, translate, type Lang } from './i18n';
import { Icon } from './icons';
import { deviceClass, runtime, type Device } from './runtime';
import { prefersReducedMotion } from './ui';
import { Overview, Hot, Library, Topics, Status } from './pages/content';
import { Review, CreatorCenters, Analytics } from './pages/publish';
import { AgentFiles, Improve, Plugins, Tasks } from './pages/system';
import { Settings, type Theme } from './pages/settings';

export type NavGroup = 'make' | 'publish' | 'system';
export const NAV: { id: string; label: string; icon: string; group: NavGroup; desc: string; plugin?: string }[] = [
  { id: 'overview', label: '总览', icon: 'overview', group: 'make', desc: '今日待审、热点与关键指标' },
  { id: 'hot', label: '热点', icon: 'hot', group: 'make', desc: '公开热榜采集、跨榜合并与聚类' },
  { id: 'library', label: '内容库', icon: 'library', group: 'make', desc: '信息源与已采集内容' },
  { id: 'topics', label: '选题', icon: 'topics', group: 'make', desc: '候选选题与多平台改写' },
  { id: 'review', label: '审核', icon: 'review', group: 'publish', desc: '人工审核草稿与发布交接' },
  { id: 'creator', label: '创作中心', icon: 'creator', group: 'publish', desc: '官方创作后台与本地应用' },
  { id: 'analytics', label: '复盘', icon: 'analytics', group: 'publish', desc: '导入数据、生成复盘与回复草稿' },
  { id: 'status', label: '运行状态', icon: 'activity', group: 'system', desc: '成本、模型能力、流水线、最近任务与硬边界' },
  { id: 'agent', label: '系统文件', icon: 'agent', group: 'system', desc: 'soul、规则、skills 与记忆' },
  { id: 'improve', label: '改进与评测', icon: 'improve', group: 'system', desc: 'Skills 状态、A/B 评测与改进日志' },
  { id: 'plugins', label: '插件管理', icon: 'plugins', group: 'system', desc: '按终端启用平台模块与本地应用' },
  { id: 'tasks', label: '任务与日志', icon: 'tasks', group: 'system', desc: '任务队列与结构化日志' },
  { id: 'settings', label: '设置', icon: 'settings', group: 'system', desc: '主题、连接、密钥、模型与备份' },
];
const GROUPS: [NavGroup, string][] = [['make', '内容生产'], ['publish', '发布与复盘'], ['system', '系统']];
const PHONE_TABS = ['overview', 'hot', 'topics', 'review'];

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

/** 命令面板：⌘K / Ctrl+K 快速跳转页面。 */
function CommandPalette({ open, onClose, go, t }: { open: boolean; onClose: () => void; go: (p: string) => void; t: (k: string) => string }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = NAV.filter((n) => !q || `${n.label}${t(n.label)}${n.id}${n.desc}`.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const pick = (id: string) => { onClose(); go(id); };
  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t('快速跳转')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Icon name="search" size={16} />
          <input
            ref={input} value={q} placeholder={t('搜索页面…')} aria-label={t('快速跳转')} aria-controls="cmdk-list" aria-activedescendant={items[idx] ? `cmdk-${items[idx]!.id}` : undefined}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter' && items[idx]) pick(items[idx]!.id);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmdk-list" className="cmdk-list" role="listbox" aria-label={t('页面')}>
          {items.map((n, i) => (
            <li key={n.id} id={`cmdk-${n.id}`} role="option" aria-selected={i === idx} className={i === idx ? 'active' : ''} onMouseEnter={() => setIdx(i)} onClick={() => pick(n.id)}>
              <span className="cmdk-ico"><Icon name={n.icon} size={16} /></span>
              <span className="grow">{t(n.label)}<small className="muted"> · {t(n.desc)}</small></span>
              <Icon name="arrowRight" size={14} className="cmdk-go" />
            </li>
          ))}
          {!items.length && <li className="muted cmdk-empty">{t('暂无数据')}</li>}
        </ul>
      </div>
    </div>
  );
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
  const [cmdk, setCmdk] = useState(false);
  const [pending, setPending] = useState(0);
  const t = useMemo(() => (k: string) => translate(lang, k), [lang]);
  const firstTheme = useRef(true);

  useEffect(() => {
    localStorage.setItem('ca.theme', theme);
    const root = document.documentElement;
    // 切换主题：短暂为颜色属性开启 200ms 过渡（首次渲染与减少动态效果时跳过）。
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
  useEffect(() => { location.hash = page; window.scrollTo?.(0, 0); document.getElementById('main')?.focus({ preventScroll: true }); }, [page]);
  useEffect(() => {
    const load = () => get('/api/notifications').then((n) => setPending(n.pendingDrafts)).catch(() => {});
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((x) => !x); }
      else if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const go = (p: string) => { setPage(p); setMenu(false); };
  const openCenter = (id: string) => { setCenter(id); go('creator'); };
  const isPhone = device === 'phone';
  const isTablet = device === 'tablet';
  const cur = NAV.find((n) => n.id === page);
  const title = cur?.label ?? '';
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  const toggleTheme = () => setTheme(dark ? 'light' : 'dark');

  const body = (() => {
    switch (page) {
      case 'hot': return <Hot device={device} go={go} />;
      case 'library': return <Library go={go} />;
      case 'topics': return <Topics device={device} go={go} />;
      case 'review': return <Review openCenter={openCenter} />;
      case 'creator': return <CreatorCenters active={center} setActive={setCenter} />;
      case 'analytics': return <Analytics />;
      case 'status': return <Status go={go} />;
      case 'agent': return <AgentFiles />;
      case 'improve': return <Improve />;
      case 'plugins': return <Plugins device={device} />;
      case 'tasks': return <Tasks />;
      case 'settings': return <Settings theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
      default: return <Overview go={go} />;
    }
  })();

  const navLink = (n: (typeof NAV)[number]) => (
    <li key={n.id}>
      <a href={`#${n.id}`} aria-current={page === n.id ? 'page' : undefined} data-tip={t(n.label)} onClick={(e) => { e.preventDefault(); go(n.id); }}>
        <span aria-hidden="true" className="ico"><Icon name={n.icon} size={16} /></span>
        <span className="label">{t(n.label)}</span>
        {n.id === 'review' && pending > 0 && <span className="pill" aria-label={`${pending} 篇待审`}>{pending}</span>}
      </a>
    </li>
  );
  const navList = (
    <div className="nav-groups">
      {GROUPS.map(([g, label]) => (
        <div key={g} className="nav-group">
          <div className="nav-group-label">{t(label)}</div>
          <ul>{NAV.filter((n) => n.group === g).map(navLink)}</ul>
        </div>
      ))}
    </div>
  );

  const themeBtn = (
    <button className="icon-btn ghost" aria-label={t(dark ? '切换到浅色' : '切换到深色')} title={t(dark ? '切换到浅色' : '切换到深色')} onClick={toggleTheme}>
      <span className="theme-ico" key={dark ? 'd' : 'l'}><Icon name={dark ? 'sun' : 'moon'} size={16} /></span>
    </button>
  );

  const collapsed = isTablet && !menu;
  return (
    <LangContext.Provider value={{ lang, t }}>
      <a className="skip" href="#main">跳到主要内容</a>
      <div className={`shell ${device}`}>
        {!isPhone && (
          <>
            {isTablet && menu && <div className="scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
            <nav className={`side ${collapsed ? 'collapsed' : ''} ${isTablet && menu ? 'overlay' : ''}`} aria-label="主导航">
              <div className="brand">
                <span className="logo" aria-hidden="true"><Icon name="topics" size={14} strokeWidth={1.75} /></span>
                <span className="brand-name label">{t('内容运营助手')}<small>Content Agent</small></span>
                {isTablet && <button className="icon-btn ghost rail-toggle" aria-label="展开/收起导航" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="sidebar" size={16} /></button>}
              </div>
              <button className="search-btn" onClick={() => setCmdk(true)} aria-label={t('快速跳转')} data-tip={t('快速跳转')}>
                <Icon name="search" size={16} /><span className="label grow">{t('搜索或跳转')}</span><kbd className="label">⌘K</kbd>
              </button>
              {navList}
              <div className="side-foot">
                <span className="label muted small">{t('发布由你本人完成')}</span>
              </div>
            </nav>
          </>
        )}
        {isPhone && (
          <div className={`sheet-wrap ${menu ? 'open' : ''}`} aria-hidden={!menu}>
            <div className="scrim" onClick={() => setMenu(false)} />
            {menu && (
              <div className="drawer sheet" role="dialog" aria-modal="true" aria-label="全部功能">
                <div className="sheet-h">
                  <span className="sheet-grip" aria-hidden="true" />
                  <strong>{t('全部功能')}</strong>
                  <button className="icon-btn ghost" aria-label="关闭" onClick={() => setMenu(false)}><Icon name="close" size={16} /></button>
                </div>
                <nav aria-label="全部功能">{navList}</nav>
              </div>
            )}
          </div>
        )}
        <div className="content">
          <header className="topbar">
            {isPhone && <button className="icon-btn ghost" aria-label="全部功能" onClick={() => setMenu(true)}><Icon name="menu" size={20} /></button>}
            <div className="topbar-title grow">
              <h1>{t(title)}</h1>
              {cur && !isPhone && <p className="topbar-sub">{t(cur.desc)}</p>}
            </div>
            <div className="row topbar-actions">
              {!online && <span className="badge warn" role="status"><Icon name="wifiOff" size={14} /> {t('离线')}</span>}
              {!isPhone && <button className="icon-btn ghost" aria-label={t('快速跳转')} title="⌘K" onClick={() => setCmdk(true)}><Icon name="command" size={16} /></button>}
              {themeBtn}
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            <div key={page}>
              <ErrorBoundary key={page}>{body}</ErrorBoundary>
            </div>
          </main>
        </div>
        {isPhone && (
          <nav className="bottom" aria-label="快捷导航">
            {PHONE_TABS.map((id) => {
              const n = NAV.find((x) => x.id === id)!;
              return (
                <a key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>
                  <span aria-hidden="true" className="tab-ico"><Icon name={n.icon} size={20} /></span><small>{t(n.label)}</small>
                  {id === 'review' && pending > 0 && <span className="pill">{pending}</span>}
                </a>
              );
            })}
            <button className={`tab-more ${!PHONE_TABS.includes(page) ? 'current' : ''}`} aria-label={t('更多')} aria-haspopup="dialog" onClick={() => setMenu(true)}>
              <span aria-hidden="true" className="tab-ico"><Icon name="more" size={20} /></span><small>{t('更多')}</small>
            </button>
          </nav>
        )}
      </div>
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} go={go} t={t} />
    </LangContext.Provider>
  );
}
