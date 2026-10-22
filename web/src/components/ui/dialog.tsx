import * as D from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from './utils';

export const Dialog = D.Root;
export const DialogTitle = D.Title;
export const DialogDescription = D.Description;

/** 弹窗内容（Radix Dialog）：居中偏上，12px 圆角，浮层阴影。 */
export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[80] bg-black/32 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <D.Content
        className={cn('ca-dialog fixed left-1/2 top-[12vh] z-[81] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-card bg-surface text-fg shadow-pop outline-none', className)}
        {...props}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}
