import * as T from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/** 分段式标签（Radix Tabs）：浅灰底槽 + 选中白底，超出时横向滚动而不截断文字。 */
export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-ctl bg-surface-2 p-0.5 [scrollbar-width:none]', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-8 min-h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] border border-transparent bg-transparent px-3 text-[13px] font-medium text-muted transition-colors duration-150 hover:text-fg data-[state=active]:border-line data-[state=active]:bg-surface data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
}
