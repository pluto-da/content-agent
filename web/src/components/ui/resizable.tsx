import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './utils';
import { tr } from '../../i18n';

/** 可拖宽的双栏：左栏宽度保存在本机。键盘可用 ←/→ 调整。 */
export function ResizableSplit({ storageKey, initial = 340, min = 260, max = 560, left, right, className }: {
  storageKey: string; initial?: number; min?: number; max?: number; left: ReactNode; right: ReactNode; className?: string;
}) {
  const [w, setW] = useState(() => {
    const v = Number(localStorage.getItem(storageKey));
    return Number.isFinite(v) && v >= min && v <= max ? v : initial;
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => { localStorage.setItem(storageKey, String(Math.round(w))); }, [storageKey, w]);
  const clamp = useCallback((x: number) => Math.min(max, Math.max(min, x)), [min, max]);
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1', className)}>
      <div className="flex min-h-0 shrink-0 flex-col" style={{ width: w }}>{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={tr('ui.drag_to_resize_the_list')}
        aria-valuenow={Math.round(w)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none"
        onPointerDown={(e) => { drag.current = { x: e.clientX, w }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setW(clamp(drag.current.w + e.clientX - drag.current.x)); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => setW(initial)}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') setW((x) => clamp(x - 16)); else if (e.key === 'ArrowRight') setW((x) => clamp(x + 16)); }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-line-strong group-focus-visible:bg-accent group-active:bg-accent" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}
