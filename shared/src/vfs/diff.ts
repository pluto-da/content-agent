/** 按行的统一 diff（LCS），用于系统文件改动对比、提案 diff、成长记录。 */
export function diffLines(a: string, b: string): { op: ' ' | '-' | '+'; line: string }[] {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [...A.map((line) => ({ op: '-' as const, line })), ...B.map((line) => ({ op: '+' as const, line }))];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { op: ' ' | '-' | '+'; line: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ op: ' ', line: A[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: '-', line: A[i++]! });
    else out.push({ op: '+', line: B[j++]! });
  }
  while (i < n) out.push({ op: '-', line: A[i++]! });
  while (j < m) out.push({ op: '+', line: B[j++]! });
  return out;
}
export function unifiedDiff(a: string, b: string, nameA = 'a', nameB = 'b', ctx = 3): string {
  const d = diffLines(a, b);
  if (d.every((x) => x.op === ' ')) return '';
  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  let k = 0;
  while (k < d.length) {
    if (d[k]!.op === ' ') { k++; continue; }
    const start = Math.max(0, k - ctx);
    let end = k;
    while (end < d.length && (d[end]!.op !== ' ' || d.slice(end, end + ctx * 2).some((x) => x.op !== ' '))) end++;
    end = Math.min(d.length, end + ctx);
    out.push('@@');
    for (const x of d.slice(start, end)) out.push(`${x.op}${x.line}`);
    k = end;
  }
  return out.join('\n');
}
export function applyChanged(d: { op: string }[]): { added: number; removed: number } { return { added: d.filter((x) => x.op === '+').length, removed: d.filter((x) => x.op === '-').length }; }
