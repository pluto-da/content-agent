import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown';

export interface MoreItem { label: string; onSelect: () => void; hint?: string; icon?: string; disabled?: boolean; danger?: boolean }

/** “⋯”菜单：一屏一个主动作、最多两个可见次按钮，其余收进这里（Linear 式）。 */
export function MoreMenu({ items, label, size = 'icon', children }: { items: MoreItem[]; label?: string; size?: 'icon' | 'icon-lg'; children?: ReactNode }) {
  const { t } = useT();
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={size} className="more-btn" aria-label={label ?? t('更多操作')} title={label ?? t('更多操作')}>{children ?? <Icon name="more" size={16} />}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((it) => (
          <DropdownMenuItem key={it.label} disabled={it.disabled} hint={it.hint} icon={it.icon ? <Icon name={it.icon} size={16} /> : undefined}
            className={it.danger ? 'text-bad' : undefined} onSelect={it.onSelect}>{it.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 页面标题区：标题 + 一句说明 + 最多一个主按钮（加可选“⋯”）；标签条放在下面一行。 */
export function PageHead({ title, desc, action, more }: { title?: string; desc?: string; action?: ReactNode; more?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 pb-3">
      <div className="min-w-0 flex-1">
        {title && <h2 className="m-0 text-base">{title}</h2>}
        {desc && <p className="m-0 text-[13px] text-muted">{desc}</p>}
      </div>
      {action}{more}
    </div>
  );
}
