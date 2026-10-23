/**
 * 关键词检索（8.6）：中文按字 bigram + 英文词，BM25 打分；日志类按时间衰减（半衰期 30 天），USER / MEMORY / preferences 不衰减。
 * 0.11.0 混合检索（search.vector，beta）：BM25 + 向量召回，倒数排名融合（RRF）。向量来自已接的 embed 角色；没接时用本机轻量嵌入
 * localEmbed（哈希 n-gram + 内容运营领域同义词表，不是语义模型，只补“近义词 / 换说法 / 错一两个字”这类关键词漏召回）。
 */
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

/* ---------------- 0.11.0：本机轻量嵌入 + 混合检索 ---------------- */
/** 内容运营领域同义词组（每组映射到同一个概念特征；只收常见口语说法，宁缺毋滥）。 */
export const CONCEPTS: string[][] = [
  ['涨粉', '增粉', '粉丝增长', '加粉', '吸粉', '关注量', '新增关注'],
  ['封面', '首图', '头图', '缩略图', '主图'],
  ['口播', '配音稿', '念稿', '口述', '旁白'],
  ['标题', '题目', '起标题'],
  ['发布时间', '发帖时间', '几点发', '发布时段', '更新时间'],
  ['阅读', '浏览', '播放', '曝光', '流量'],
  ['点赞', '获赞'],
  ['收藏', '收藏率'],
  ['评论', '留言', '评论区'],
  ['转化', '成交', '下单', '变现', '带货'],
  ['收入', '收益', '赚钱', '营收'],
  ['受众', '目标人群', '用户画像', '粉丝画像', '人群'],
  ['宝妈', '妈妈', '带娃', '母婴'],
  ['大学生', '学生党'],
  ['上班族', '打工人', '白领'],
  ['违禁词', '敏感词', '禁用词', '限流词'],
  ['限流', '降权', '没流量'],
  ['复盘', '回顾', '总结数据'],
  ['选题', '话题', '题材', '内容方向'],
  ['小红书', '红书', 'xhs'],
  ['抖音', 'douyin'],
  ['视频号', '微信视频'],
  ['公众号', '微信文章', '推文'],
  ['闲鱼', '二手', '鱼小铺'],
  ['护肤', '保湿', '面霜'],
  ['穿搭', '搭配', 'ootd'],
  ['语气', '口吻', '调性'],
  ['价格', '多少钱', '定价'],
  ['优惠', '折扣', '打折', '满减'],
];
const CONCEPT_OF = new Map<string, number>();
CONCEPTS.forEach((g, i) => g.forEach((w) => CONCEPT_OF.set(w.toLowerCase(), i)));
const CONCEPT_WORDS = [...CONCEPT_OF.keys()].sort((a, b) => b.length - a.length);
function fnv(s: string): number { let x = 0x811c9dc5; for (const ch of s) { x ^= ch.codePointAt(0)!; x = Math.imul(x, 0x01000193) >>> 0; } return x; }
/** 特征：中文字 1/2/3-gram、英文词与字母 3-gram、领域概念（权重 2.5）；对数词频，L2 归一。确定性、无依赖、离线可用。 */
export function localEmbed(text: string, dims = 512): number[] {
  const v = new Float64Array(dims);
  const low = text.toLowerCase();
  const tf = new Map<string, number>();
  const bump = (f: string, w: number) => tf.set(f, (tf.get(f) ?? 0) + w);
  for (const w of low.match(/[a-z0-9]+/g) ?? []) { bump(`w:${w}`, 1); for (let i = 0; i + 3 <= w.length; i++) bump(`c3:${w.slice(i, i + 3)}`, 0.5); }
  for (const seg of low.replace(/[^\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < seg.length; i++) { bump(`u:${seg[i]}`, 0.3); if (i + 2 <= seg.length) bump(`b:${seg.slice(i, i + 2)}`, 1); if (i + 3 <= seg.length) bump(`t:${seg.slice(i, i + 3)}`, 0.7); }
  }
  for (const w of CONCEPT_WORDS) { let k = low.indexOf(w), n = 0; while (k >= 0) { n++; k = low.indexOf(w, k + w.length); } if (n) bump(`k:${CONCEPT_OF.get(w)}`, 2.5 * n); }
  for (const [f, c] of tf) { const h = fnv(f); v[h % dims]! += (h & 0x80000000 ? -1 : 1) * (c > 0 ? 1 + Math.log(c) : 0); }
  let norm = 0; for (const x of v) norm += x * x; norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}
export function cosine(a: number[], b: number[]): number { let s = 0, na = 0, nb = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { s += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; } return na && nb ? s / Math.sqrt(na * nb) : 0; }
export type Embedder = (texts: string[]) => Promise<number[][]>;
export const localEmbedder: Embedder = async (t) => t.map((x) => localEmbed(x));
export interface HybridHit extends Hit { bm25Rank?: number; vectorRank?: number; vector?: number }
/**
 * 混合检索：BM25 前 k×4 与向量前 k×4 用 RRF（k0=60）融合；向量 = embed(文档) · embed(查询) 余弦。
 * embed 失败（未接、超时、额度）时退回纯 BM25，mode 写 'keyword-fallback'，调用方如实告诉用户。
 */
export async function hybridSearch(docs: Doc[], query: string, o: { k?: number; now?: Date; dirs?: string[]; embed?: Embedder; vectorOnly?: boolean } = {}): Promise<{ mode: 'hybrid' | 'vector' | 'keyword-fallback'; embedder: 'local' | 'model'; hits: HybridHit[] }> {
  const k = o.k ?? 10;
  const pool = o.dirs?.length ? docs.filter((d) => o.dirs!.some((x) => d.path.startsWith(x))) : docs;
  const kw = bm25Search(pool, query, { k: k * 4, now: o.now });
  const embed = o.embed ?? localEmbedder;
  let vecs: number[][];
  try { vecs = await embed([query, ...pool.map((d) => d.text)]); if (vecs.length !== pool.length + 1) throw new Error('向量数量不对'); }
  catch { return { mode: 'keyword-fallback', embedder: o.embed ? 'model' : 'local', hits: kw.slice(0, k) }; }
  const q = vecs[0]!;
  const vr = pool.map((d, i) => ({ d, s: cosine(q, vecs[i + 1]!) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k * 4);
  const fused = new Map<string, HybridHit>();
  const K0 = 60;
  if (!o.vectorOnly) kw.forEach((h, i) => { fused.set(h.path, { ...h, score: 1 / (K0 + i + 1), bm25Rank: i + 1 }); });
  vr.forEach((x, i) => { const cur = fused.get(x.d.path); const add = 1 / (K0 + i + 1); if (cur) { cur.score += add; cur.vectorRank = i + 1; cur.vector = x.s; } else fused.set(x.d.path, { path: x.d.path, score: add, snippet: x.d.text.slice(0, 90).replace(/\s+/g, ' '), vectorRank: i + 1, vector: x.s }); });
  return { mode: o.vectorOnly ? 'vector' : 'hybrid', embedder: o.embed ? 'model' : 'local', hits: [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k) };
}
