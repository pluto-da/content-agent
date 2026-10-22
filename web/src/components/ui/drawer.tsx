import type { ComponentProps, ReactNode } from 'react';
import { Drawer as Vaul } from 'vaul';
import { cn } from './utils';

/** 手机底部抽屉（vaul）：可下滑关闭，带把手；阴影只给浮层。 */
export const Drawer = Vaul.Root;
export const DrawerTrigger = Vaul.Trigger;
export const DrawerClose = Vaul.Close;

export function DrawerContent({ className, children, title, description, ...props }: ComponentProps<typeof Vaul.Content> & { title: string; description?: string }) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-50 bg-black/32" />
      <Vaul.Content
        className={cn('fixed inset-x-0 bottom-0 z-50 flex max-h-[86dvh] flex-col rounded-t-card bg-surface text-fg shadow-pop outline-none', className)}
        {...props}
      >
        <div aria-hidden="true" className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
        <div className="px-4 pt-2 pb-1">
          <Vaul.Title className="text-base font-semibold text-fg">{title}</Vaul.Title>
          {description ? <Vaul.Description className="mt-0.5 text-[13px] text-muted">{description}</Vaul.Description> : <Vaul.Description className="sr-only">{title}</Vaul.Description>}
        </div>
        <div className="overflow-y-auto px-2 pb-[calc(12px+env(safe-area-inset-bottom))]">{children}</div>
      </Vaul.Content>
    </Vaul.Portal>
  );
}

/** 抽屉中的一行操作：44px 高，图标 + 文字 + 说明。 */
export function DrawerItem({ icon, label, hint, onClick, tone, disabled }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; tone?: 'danger' | 'primary'; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-ctl border-0 bg-transparent px-3 py-2 text-left text-[15px] font-normal text-fg hover:bg-surface-2 disabled:opacity-45',
        tone === 'danger' && 'text-bad',
        tone === 'primary' && 'font-medium',
      )}
    >
      {icon && <span className="grid w-5 place-items-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-[12px] leading-snug text-muted">{hint}</span>}
      </span>
    </button>
  );
}
