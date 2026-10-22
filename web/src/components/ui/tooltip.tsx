import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = T.Provider;

/** 提示（Radix Tooltip）：墨色底，用于平板图标栏。 */
export function Tip({ label, side = 'right', children }: { label: string; side?: 'right' | 'top' | 'bottom' | 'left'; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={8} className="z-[90] rounded-ctl bg-ink px-2 py-1 text-[13px] font-medium text-ink-fg shadow-pop">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
