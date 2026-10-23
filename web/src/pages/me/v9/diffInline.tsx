import { useMemo } from 'react';
import { diffLines, applyChanged } from '@content-agent/shared';

/** 改动对比（只显示改动行及前后 2 行上下文）。成长记录与 Agent 设定共用。 */
export function DiffInline({ a, b }: { a: string; b: string }) {
  const d = useMemo(() => diffLines(a, b), [a, b]);
  const n = applyChanged(d);
  return (
    <div data-testid="diff">
      <p className="m-0 text-[13px] text-muted">+{n.added} / -{n.removed}</p>
      <pre className="v9-diff">{d.filter((_, i) => d.slice(Math.max(0, i - 2), i + 3).some((y) => y.op !== ' ')).map((x, i) => <span key={i} className={x.op === '+' ? 'add' : x.op === '-' ? 'del' : ''}>{`${x.op} ${x.line}\n`}</span>)}</pre>
    </div>
  );
}
