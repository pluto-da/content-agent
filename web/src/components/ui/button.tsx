import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './utils';

/** 按钮（shadcn/ui 风格）。墨色主按钮、平面次按钮、透明幽灵按钮；6px 圆角；按下 0.98。 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl text-sm font-medium select-none cursor-pointer transition-[background-color,border-color,color,transform] duration-150 ease-out-soft active:scale-[.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-line bg-surface text-fg hover:bg-surface-2 hover:border-line-strong',
        primary: 'border border-ink bg-ink text-ink-fg hover:bg-ink-hover hover:border-ink-hover',
        ghost: 'border border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
        danger: 'border border-line bg-surface text-bad hover:bg-bad-soft',
        accent: 'border border-transparent bg-accent-soft text-accent hover:brightness-95',
      },
      size: {
        sm: 'h-8 min-h-8 px-2.5 text-[13px]',
        md: 'h-9 min-h-9 px-3',
        lg: 'h-11 min-h-11 px-4',
        icon: 'h-9 w-9 min-h-9 p-0',
        'icon-lg': 'h-11 w-11 min-h-11 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
