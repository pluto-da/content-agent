/**
 * 平台侧栏（0.8.0）：已登记平台（图标 + 名称 + 角标）+ 底部固定 ＋添加平台 / Agent / 我的。
 * 角标：数字 = 该平台“已通过、待发布”的草稿数；靛蓝圆点 = 今天有新热点或有来自该平台的未处理素材。不代表平台里的未读消息（本软件不读取平台页面）。
 * 平板 / 电脑：常驻图标栏（修订 R2）；手机：左侧抽屉（顶栏 ☰ 或左缘右滑）。长按 / 右键出菜单；长按 300ms 进入排序态（拖动手柄 ≡ + 完成）。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { cn } from '../components/ui/utils';
import { Drawer, DrawerContent, DrawerItem } from '../components/ui/drawer';
import { CENTERS } from '../data/platforms';
import { overlayManager } from '../browser/browserHost';
import { tr } from '../i18n';

export interface SideItem { id: string; label: string; custom?: boolean }
export interface SidebarProps {
  items: SideItem[];
  active: string; // 平台 id | 'agent' | 'me'
  badges: Record<string, { count: number; dot: boolean }>;
  badgeOff: string[];
  variant: 'rail' | 'wide' | 'drawer';
  onSelect: (id: string) => void;
  onAdd: () => void;
  onReorder: (ids: string[]) => void;
  onMenu: (id: string, action: string) => void;
  onToggleWide?: () => void;
  splitAvailable?: boolean;
}

const MONO: Record<string, string> = { xiaohongshu: '红', douyin: '抖', channels: '视', wechat_mp: '公', zhihu: '知', bilibili: 'B', kuaishou: '快', xianyu: '闲', x: 'X' };

export function PlatformGlyph({ id, label, size = 28 }: { id: string; label: string; size?: number }) {
  return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-[8px] border border-line bg-surface text-[13px] font-semibold text-fg" style={{ width: size, height: size }}>{MONO[id] ?? label.slice(0, 1)}</span>;
}

export function Sidebar(p: SidebarProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<string[]>(p.items.map((i) => i.id));
  const [help, setHelp] = useState(false);
  useEffect(() => setOrder(p.items.map((i) => i.id)), [p.items]);
  useEffect(() => (menuFor || help ? overlayManager.push() : undefined), [menuFor, help]);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  // 排序态在图标栏里放不下上移 / 下移按钮（44px 触控），临时展开为宽侧栏，点“完成”后恢复
  const variant = sorting && p.variant === 'rail' ? 'wide' : p.variant;
  const wide = variant !== 'rail';
  const byId = (id: string) => p.items.find((i) => i.id === id);
  const move = (id: string, d: number) => setOrder((o) => { const i = o.indexOf(id); const j = i + d; if (i < 0 || j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const drag = useRef<string | null>(null);

  const row = (id: string) => {
    const it = byId(id);
    if (!it) return null;
    const b = p.badges[id];
    const off = p.badgeOff.includes(id);
    const isActive = p.active === id;
    return (
      <li key={id} draggable={!sorting && variant === 'wide'} onDragStart={() => { drag.current = id; }} onDragOver={(e) => e.preventDefault()} onDrop={() => { const from = drag.current; if (from && from !== id) { const o = order.filter((x) => x !== from); o.splice(o.indexOf(id), 0, from); setOrder(o); p.onReorder(o); } drag.current = null; }}>
        <div className={cn('relative flex items-center', sorting && 'gap-1')}>
          <button
            type="button" data-testid={`side-${id}`} aria-current={isActive ? 'page' : undefined}
            aria-label={`${it.label}${b?.count && !off ? `（${b.count} 篇待发布）` : ''}`}
            className={cn('side-item relative !flex !min-h-11 !border-0 !font-normal !text-side-fg', wide ? 'w-full !justify-start gap-3 !rounded-[10px] !px-2 !text-[15px]' : 'h-14 w-14 !flex-col !justify-center gap-0.5 !rounded-[10px] !p-0 !text-[11px]', isActive ? '!bg-side-active !text-fg' : '!bg-transparent')}
            onClick={() => { if (long.current) { long.current = false; return; } if (!sorting) p.onSelect(id); }}
            onContextMenu={(e) => { e.preventDefault(); setMenuFor(id); }}
            onPointerDown={() => { long.current = false; press.current = setTimeout(() => { long.current = true; setMenuFor(id); }, 450); }}
            onPointerUp={() => { if (press.current) clearTimeout(press.current); }}
            onPointerLeave={() => { if (press.current) clearTimeout(press.current); }}
          >
            {isActive && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" />}
            <PlatformGlyph id={id} label={it.label} size={wide ? 28 : 26} />
            <span className={cn('truncate', wide ? 'min-w-0 flex-1 text-left' : 'max-w-[52px] leading-tight')}>{it.label}</span>
            {!sorting && !off && b?.count ? <span key={`c${b.count}`} data-testid={`badge-${id}`} className={cn('anim-pop inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[12px] font-medium text-ink-fg', !wide && 'absolute right-1 top-1')}>{b.count}</span>
              : !sorting && !off && b?.dot ? <span data-testid={`dot-${id}`} aria-label={tr('ui.new_trends_or_assets')} className={cn('anim-pop h-1.5 w-1.5 rounded-full bg-accent', !wide && 'absolute right-2 top-2')} /> : null}
          </button>
          {sorting && (
            <span className="flex shrink-0 flex-row">
              <button type="button" aria-label={`上移 ${it.label}`} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => move(id, -1)}><Icon name="chevronUp" size={14} /></button>
              <button type="button" aria-label={`下移 ${it.label}`} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => move(id, 1)}><Icon name="chevronDown" size={14} /></button>
            </span>
          )}
        </div>
      </li>
    );
  };

  const fixed = (id: 'agent' | 'me', label: string, icon: string) => (
    <button type="button" data-testid={`side-${id}`} aria-current={p.active === id ? 'page' : undefined} aria-label={label}
      className={cn('relative !flex !min-h-11 !border-0 !font-normal !text-side-fg', wide ? 'w-full !justify-start gap-3 !rounded-[10px] !px-2 !text-[15px]' : 'h-14 w-14 !flex-col !justify-center gap-0.5 !rounded-[10px] !p-0 !text-[11px]', p.active === id ? '!bg-side-active !text-fg' : '!bg-transparent')}
      onClick={() => p.onSelect(id)}>
      {p.active === id && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" />}
      <span className="grid h-7 w-7 place-items-center"><Icon name={icon} size={20} /></span><span className={cn(wide && 'flex-1 text-left')}>{label}</span>
    </button>
  );

  const it = menuFor ? byId(menuFor) : null;
  const known = it && CENTERS.some((c) => c.id === it.id);
  return (
    <nav aria-label={tr('ui.platform_sidebar')} data-testid="sidebar" data-variant={variant} className={cn('app-side flex h-full shrink-0 flex-col bg-side', variant === 'rail' ? 'w-[72px] items-center px-2' : variant === 'wide' ? 'w-[200px] px-2' : 'w-full px-2')}>
      <div className={cn('flex min-h-14 shrink-0 items-center gap-2', variant === 'rail' ? 'justify-center' : 'px-1')}>
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-ink text-ink-fg"><Icon name="bot" size={16} /></span>
        {wide && <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg" data-testid="brand">{tr('ui.super_workbench')}</span>}
        {p.onToggleWide && p.variant !== 'drawer' && <button type="button" aria-label={wide ? '收起侧栏' : '展开侧栏'} className="!min-h-9 !min-w-9 !border-0 !bg-transparent !p-0" onClick={p.onToggleWide}><Icon name={wide ? 'collapse' : 'sidebar'} size={16} /></button>}
      </div>
      <div className={cn('flex items-center', wide ? 'justify-between px-2' : 'justify-center')}>
        {wide && <span className="text-[12px] text-muted">{tr('ui.platforms')}</span>}
        <button type="button" aria-label={tr('ui.about_badges')} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0 !text-[12px] !text-muted" onClick={() => setHelp(true)}>?</button>
      </div>
      <ul className={cn('m-0 flex min-h-0 flex-1 list-none flex-col gap-1 overflow-y-auto p-0', !wide && 'items-center')} aria-label={tr('ui.platforms_registered')} data-testid="platform-list">
        {order.map(row)}
        {!order.length && wide && <li className="px-2 py-3 text-[13px] text-muted">{tr('ui.no_platforms_yet_tap_add')}</li>}
      </ul>
      {sorting && <button type="button" className="primary !my-2 !min-h-10 w-full" data-testid="sort-done" onClick={() => { setSorting(false); p.onReorder(order); }}>{tr('ui.done_2')}</button>}
      <div className={cn('flex shrink-0 flex-col gap-1 border-t border-line pt-2 pb-[calc(8px+var(--sa-bottom))]', !wide && 'items-center')}>
        <button type="button" data-testid="side-add" aria-label={tr('ui.add_platform')} className={cn('!flex !min-h-11 !border-0 !bg-transparent !font-normal !text-side-fg', wide ? 'w-full !justify-start gap-3 !px-2 !text-[15px]' : 'min-h-12 w-14 !flex-col !justify-center !whitespace-normal !p-0 !py-1 !text-[11px]')} onClick={p.onAdd}>
          <span className="grid h-7 w-7 place-items-center rounded-[8px] border border-dashed border-line-strong"><Icon name="plus" size={16} /></span><span className={cn(wide ? 'flex-1 text-left' : 'text-center leading-tight')}>{tr('ui.add_platform')}</span>
        </button>
        {fixed('agent', 'Agent', 'bot')}
        {fixed('me', tr('ui.me'), 'user')}
      </div>

      <Drawer open={!!menuFor} onOpenChange={(o) => { if (!o) setMenuFor(null); }}>
        <DrawerContent title={it?.label ?? ''}>
          {(['reload:重新加载', 'home:回到首页', ...(known ? ['publish:打开发布页'] : []), 'system:在系统浏览器打开', ...(known ? ['app:打开官方 App'] : []), ...(known && p.splitAvailable ? ['split:分屏打开官方 App'] : []), `badge:${p.badgeOff.includes(menuFor ?? '') ? '打开角标' : '关闭角标'}`, 'sort:排序', 'logout:退出该平台登录', 'remove:从侧栏移除'] as string[]).map((x) => {
            const [k, l] = x.split(':') as [string, string];
            return <DrawerItem key={k} label={l} tone={k === 'remove' || k === 'logout' ? 'danger' : undefined} onClick={() => { const id = menuFor!; setMenuFor(null); if (k === 'sort') setSorting(true); else p.onMenu(id, k); }} />;
          })}
        </DrawerContent>
      </Drawer>
      <Drawer open={help} onOpenChange={setHelp}>
        <DrawerContent title={tr('ui.what_do_badges_mean')} description="角标只显示超级工作台自己知道的状态">
          <div className="px-2 pb-2 text-[14px] leading-relaxed text-fg-2" data-testid="badge-help">
            <p>{tr('ui.number_drafts_approved_waiting_to')}</p>
            <p>{tr('ui.indigo_dot_that_platforms_lawful')}</p>
            <p>{tr('ui.badges_dont_mean_unread_platform')}</p>
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
