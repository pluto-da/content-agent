import * as M from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={6} className={cn('z-[70] min-w-56 rounded-card bg-surface p-1 text-fg shadow-pop', className)} {...props} />
    </M.Portal>
  );
}

export function DropdownMenuItem({ icon, children, hint, className, ...props }: ComponentProps<typeof M.Item> & { icon?: ReactNode; hint?: string }) {
  return (
    <M.Item className={cn('flex cursor-pointer items-start gap-2.5 rounded-ctl px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-2', className)} {...props}>
      {icon && <span className="mt-0.5 text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-fg">{children}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </M.Item>
  );
}
