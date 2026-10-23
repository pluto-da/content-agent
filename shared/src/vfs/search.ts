/** 关键词检索（8.6）：中文按字 bigram + 英文词，BM25 打分；日志类按时间衰减（半衰期 30 天），USER / MEMORY / preferences 不衰减。向量检索为实验开关（search.vector）。 */
export interface Doc { path: string; text: string; updated?: string }
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const low = s.toLowerCase();
  for (const w of low.match(/[a-z0-9]+/g) ?? []) out.push(w);
  const cjk = low.replace(/[^\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean);
  for (const seg of cjk) { if (seg.length === 1) out.push(seg); for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2)); }
  return out;
}
export interface Hit { path: string; score: number; snippet: string }
export function bm25Search(docs: Doc[], query: string, o: { k?: number; now?: Date; dirs?: string[] } = {}): Hit[] {
  const pool = o.dirs?.length ? docs.filter((d) => o.dirs!.some((x) => d.path.startsWith(x))) : docs;
  const q = [...new Set(tokenize(query))];
  if (!q.length || !pool.length) return [];
  const toks = pool.map((d) => tokenize(d.text));
  const avg = toks.reduce((s, t) => s + t.length, 0) / pool.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = pool.length, k1 = 1.2, b = 0.75;
  const now = (o.now ?? new Date()).getTime();
  const hits: Hit[] = [];
  pool.forEach((d, i) => {
    const t = toks[i]!;
    const tf = new Map<string, number>(); for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) { const f = tf.get(w) ?? 0; if (!f) continue; const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5)); score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg))); }
    if (score <= 0) return;
    if (/^memory\/daily\/|^sessions\//.test(d.path) && d.updated) score *= 0.5 ** ((now - Date.parse(d.updated)) / (30 * 864e5));
    const idx = q.map((w) => d.text.toLowerCase().indexOf(w)).filter((x) => x >= 0).sort((a, b2) => a - b2)[0] ?? 0;
    hits.push({ path: d.path, score, snippet: d.text.slice(Math.max(0, idx - 30), idx + 60).replace(/\s+/g, ' ') });
  });
  return hits.sort((a, b2) => b2.score - a.score).slice(0, o.k ?? 10);
}
