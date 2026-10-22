/**
 * 内嵌浏览器区（0.8.0）：HTML 工具栏（后退 / 前进 / 刷新·停止 / 域名 + 锁 / 发给 Agent / ⋯）+ 2px 进度条 + 占位矩形 [data-browser-slot]。
 * 安卓 / Electron 的原生视图按占位矩形摆放（ResizeObserver + resize + rAF 合并）；网页版不能内嵌 → 平台卡片 + 新标签页打开。
 * 热点巡视（修订 R1-e）：底部浮条“下一个 / 发给 Agent / 结束”，由用户本人翻看，Agent 不读页面。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { Drawer, DrawerContent, DrawerItem } from '../components/ui/drawer';
import { browserHost, overlayManager, type LoadError, type NavState } from '../browser/browserHost';
import { copyText, openExternal } from '../runtime';
import { PlatformGlyph } from './Sidebar';

export interface BrowserTarget { id: string; label: string; url: string; publishUrl?: string; hosts: string[]; custom?: boolean; patrol?: boolean }
export interface PatrolState { stops: { id: string; label: string; url: string; hosts: string[]; platform: string }[]; index: number }

const HINT_KEY = 'ca.v8.browserHint';
const domainOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

export function BrowserArea({ target, startUrl, onSend, onMenu, patrol, onPatrol }: {
  target: BrowserTarget; startUrl?: string;
  onSend: (s: { platform: string; url: string; title: string }) => void;
  onMenu: (action: string) => void;
  patrol?: PatrolState | null;
  onPatrol?: (a: 'next' | 'end') => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<NavState>({ platform: target.id, url: startUrl ?? target.url, title: target.label, canGoBack: false, canGoForward: false, progress: 0 });
  const [err, setErr] = useState<LoadError | null>(null);
  const [scheme, setScheme] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [hint, setHint] = useState(() => !localStorage.getItem(HINT_KEY));
  const [menu, setMenu] = useState(false);
  const [covered, setCovered] = useState(overlayManager.count() > 0);
  const [copied, setCopied] = useState(false);
  const native = browserHost.mode !== 'web' && browserHost.available;

  // 激活平台（保活 / 休眠恢复由池决定）
  useEffect(() => {
    setErr(null); setScheme(null);
    const entry = browserHost.pool.get(target.id);
    setSt({ platform: target.id, url: entry?.url ?? startUrl ?? target.url, title: entry?.title ?? target.label, canGoBack: !!entry?.canGoBack, canGoForward: !!entry?.canGoForward, progress: 0 });
    void browserHost.activate(target.id, startUrl ?? target.url, target.hosts).then(async () => {
      if (startUrl && browserHost.pool.get(target.id)?.url !== startUrl) await browserHost.loadUrl(target.id, startUrl).catch(() => {});
    });
    const off = browserHost.on({
      nav: (s) => { if (s.platform === target.id) { setSt(s); if (s.progress >= 100) setErr(null); } },
      error: (e) => { if (e.platform === target.id) setErr(e); },
      scheme: (e) => { if (e.platform === target.id) setScheme(e.url); },
      restored: (p) => { if (p === target.id) { setRestored(true); setTimeout(() => setRestored(false), 1000); } },
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切换平台 / 起始地址时重新激活
  }, [target.id, target.url, startUrl, target.hosts]);

  // 离开浏览器区：隐藏全部原生视图
  useEffect(() => () => { void browserHost.hideAll(); }, []);
  useEffect(() => overlayManager.subscribe((n) => setCovered(n > 0)), []);
  useEffect(() => (menu ? overlayManager.push() : undefined), [menu]);

  // 占位矩形 → 原生视图位置（扣掉工具栏与安全区：矩形本身就在工具栏下方、安全区之内）
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    let raf = 0;
    const sync = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const r = el.getBoundingClientRect(); void browserHost.setFrame({ x: r.left, y: r.top, width: r.width, height: r.height }); }); };
    sync();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('resize', sync); window.removeEventListener('orientationchange', sync); };
  }, [target.id]);

  const send = () => onSend({ platform: target.id, url: st.url || target.url, title: st.title || target.label });
  useEffect(() => { const f = () => send(); window.addEventListener('ca:send-current-page', f); return () => window.removeEventListener('ca:send-current-page', f); });
  const loading = st.progress > 0 && st.progress < 100;
  const tb = (label: string, icon: string, onClick: () => void, disabled = false, testId?: string) => (
    <button type="button" aria-label={label} title={label} data-testid={testId} disabled={disabled} onClick={onClick} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0 disabled:opacity-40"><Icon name={icon} size={18} /></button>
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" data-testid="browser-area" data-platform={target.id}>
      <div className="relative flex h-11 shrink-0 items-center gap-0.5 border-b border-line bg-canvas px-1" data-testid="browser-toolbar">
        {tb('后退', 'arrowLeft', () => void browserHost.nav(target.id, 'back'), !st.canGoBack)}
        {tb('前进', 'arrowRight', () => void browserHost.nav(target.id, 'forward'), !st.canGoForward)}
        {loading ? tb('停止', 'close', () => void browserHost.nav(target.id, 'stop')) : tb('刷新', 'reload', () => void browserHost.nav(target.id, 'reload'))}
        <button type="button" className="!min-h-9 min-w-0 flex-1 !justify-start gap-1 !rounded-full !border-0 !bg-surface-2 !px-3 !text-[13px] !font-normal !text-fg-2" aria-label="复制完整网址" data-testid="address" onClick={async () => { setCopied(await copyText(st.url || target.url)); setTimeout(() => setCopied(false), 1200); }}>
          <Icon name="lock" size={13} className="shrink-0 text-muted" /><span className="truncate">{copied ? '已复制网址' : domainOf(st.url || target.url)}</span>
        </button>
        <button type="button" data-testid="send-to-agent" className="!min-h-9 shrink-0 !rounded-full !px-3 !text-[13px]" onClick={send}><Icon name="send" size={14} /> 发给 Agent</button>
        {tb('更多', 'more', () => setMenu(true))}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-accent transition-[width] duration-150" style={{ width: loading ? `${st.progress}%` : 0 }} />
      </div>
      {hint && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 text-[13px] text-fg-2" role="note" data-testid="browser-hint">
          <Icon name="shield" size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">在这里你本人登录、浏览、发布。超级工作台不会读取或操作这个页面。</span>
          <button type="button" className="!min-h-8 !px-2 !text-[13px]" onClick={() => { localStorage.setItem(HINT_KEY, '1'); setHint(false); }}>知道了</button>
        </div>
      )}
      {scheme && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 text-[13px]" role="status">
          <span className="min-w-0 flex-1">页面想打开官方 App</span>
          <button type="button" className="!min-h-8 !px-2 !text-[13px]" onClick={() => { onMenu('app'); setScheme(null); }}>打开</button>
          <button type="button" className="!min-h-8 !px-2 !text-[13px]" onClick={() => setScheme(null)}>忽略</button>
        </div>
      )}
      <div ref={slot} data-browser-slot className="relative min-h-0 flex-1" data-testid="browser-slot">
        {!native ? (
          <div className="mx-auto flex h-full max-w-[420px] flex-col items-center justify-center gap-3 px-6 text-center" data-testid="web-fallback">
            <PlatformGlyph id={target.id} label={target.label} size={44} />
            <h2 className="text-[18px]">{target.label}</h2>
            <p className="m-0 text-[14px] text-muted">网页版不能内嵌平台页面（官方站点禁止被嵌入）。</p>
            <button type="button" className="primary" onClick={() => void openExternal(st.url || target.url)}>在新标签页打开</button>
            <p className="m-0 text-[13px] text-muted">用 App 获得完整工作台：平台页面与 Agent 同屏、切换不丢页面。</p>
          </div>
        ) : covered ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted" data-testid="browser-covered"><PlatformGlyph id={target.id} label={target.label} size={36} /><span className="text-[13px]">网页已暂时收起</span></div>
        ) : err ? (
          <div className="mx-auto flex h-full max-w-[420px] flex-col items-center justify-center gap-2 px-6 text-center" role="alert" data-testid="browser-error">
            <Icon name="error" size={22} className="text-bad" />
            <p className="m-0 text-fg">{errText(err)}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <button type="button" className="primary" onClick={() => { setErr(null); void browserHost.nav(target.id, 'reload'); }}>重试</button>
              <button type="button" onClick={() => void openExternal(st.url || target.url)}>在系统浏览器打开</button>
              {!target.custom && !target.patrol && <button type="button" onClick={() => onMenu('app')}>打开官方 App</button>}
            </div>
          </div>
        ) : null}
        {restored && <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-[13px] text-ink-fg" role="status" data-testid="restored">已恢复</div>}
      </div>
      {patrol && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-2 pb-[calc(8px+var(--sa-bottom))]" data-testid="patrol-bar" role="toolbar" aria-label="热点巡视">
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">巡视 {patrol.index + 1}/{patrol.stops.length} · {patrol.stops[patrol.index]?.label}</span>
          <button type="button" className="!min-h-10 !px-3 !text-[14px]" disabled={patrol.index >= patrol.stops.length - 1} onClick={() => onPatrol?.('next')} data-testid="patrol-next">下一个</button>
          <button type="button" className="primary !min-h-10 !px-3 !text-[14px]" onClick={send} data-testid="patrol-send">发给 Agent</button>
          <button type="button" className="!min-h-10 !px-3 !text-[14px]" onClick={() => onPatrol?.('end')} data-testid="patrol-end">结束</button>
        </div>
      )}
      <Drawer open={menu} onOpenChange={setMenu}>
        <DrawerContent title={target.label}>
          <DrawerItem label="回到首页" onClick={() => { setMenu(false); void browserHost.loadUrl(target.id, target.url); }} />
          {target.publishUrl && <DrawerItem label="打开发布页" onClick={() => { setMenu(false); void browserHost.loadUrl(target.id, target.publishUrl!); }} />}
          <DrawerItem label="在系统浏览器打开" onClick={() => { setMenu(false); void openExternal(st.url || target.url); }} />
          {!target.custom && !target.patrol && <DrawerItem label="打开官方 App" onClick={() => { setMenu(false); onMenu('app'); }} />}
          <DrawerItem label="复制网址" onClick={() => { setMenu(false); void copyText(st.url || target.url); }} />
          {!target.patrol && <DrawerItem label="退出该平台登录" tone="danger" onClick={() => { setMenu(false); onMenu('logout'); }} />}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export function errText(e: LoadError): string {
  if (e.kind === 'ssl') return '证书有问题，为了安全没有打开这个页面';
  if (e.kind === 'network') return '网络连接失败，检查网络后重试';
  if (e.kind === 'blocked') return '这个地址不在该平台的官方域名内，已拦截';
  if (e.status === 403 || e.status === 451) return `平台拒绝了内置浏览器的访问（${e.status}）。可以改用系统浏览器或官方 App`;
  if (e.status === 429) return '访问太频繁，平台暂时限制了，请稍后再试';
  if ((e.status ?? 0) >= 500) return `平台服务出错（${e.status}），稍后再试`;
  return `页面打不开${e.status ? `（${e.status}）` : ''}`;
}
