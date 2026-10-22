/**
 * 热点清洗、粗合并与评分（0.8.0，本机与服务端共用）。
 * 规则：去广告 / 置顶 / 纯数字 / 过短标题；全半角统一；normTitle 去重；字符 bigram 相似度 ≥ 0.6 先粗合并。
 * 评分：score = 覆盖来源数 × 0.35 + 最高排名倒数 × 0.25 + 新鲜度 × 0.2 + 相关度 × 0.2（相关度由模型给 0–1，缺省 0.5）。
 * 趋势：与昨日快照比较 —— 新出现 → new，排名上升 ≥ 5 → up，其余 flat。
 */

export interface RawHot { id?: string; title: string; url?: string; source: string; route?: string; platform?: string; rank?: number; heat?: string | number; fetchedAt?: string }
export interface HotGroup { key: string; title: string; members: RawHot[]; sources: string[]; bestRank: number }

/** 全角 → 半角（字母数字与常用标点）。 */
export function toHalfWidth(s: string): string {
  return s.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

export function normTitle(s: string): string {
  return toHalfWidth(s).toLowerCase().replace(/[\s\p{P}\p{S}#]+/gu, '');
}

const JUNK = /(广告|推广|置顶|赞助|^\s*AD\s*$|直播预告)/i;
export function isJunkTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (JUNK.test(t)) return true;
  if (/^[\d\s.,:%+\-#]+$/.test(t)) return true;
  return [...normTitle(t)].length < 4;
}

function bigrams(s: string): Set<string> {
  const a = [...normTitle(s)];
  const out = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) out.add(a[i]! + a[i + 1]!);
  if (a.length === 1) out.add(a[0]!);
  return out;
}

/** 字符 bigram 的 Dice 系数（0–1）。 */
export function bigramSimilarity(a: string, b: string): number {
  const x = bigrams(a); const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  return (2 * inter) / (x.size + y.size);
}

/** 清洗 + 去重 + 粗合并。返回分组（每组一个代表标题）。 */
export function cleanAndGroup(items: RawHot[], threshold = 0.6): HotGroup[] {
  const groups: HotGroup[] = [];
  const byNorm = new Map<string, HotGroup>();
  for (const it of items) {
    const title = toHalfWidth(it.title).replace(/\s+/g, ' ').trim();
    if (isJunkTitle(title)) continue;
    const key = normTitle(title);
    let g = byNorm.get(key);
    if (!g) g = groups.find((x) => bigramSimilarity(x.title, title) >= threshold);
    const rank = it.rank ?? 50;
    if (!g) {
      g = { key, title, members: [], sources: [], bestRank: rank };
      groups.push(g);
    }
    byNorm.set(key, g);
    g.members.push({ ...it, title });
    if (!g.sources.includes(it.source)) g.sources.push(it.source);
    g.bestRank = Math.min(g.bestRank, rank);
  }
  return groups;
}

export interface ScoreInput { sources: number; totalSources: number; bestRank: number; freshness?: number; relevance?: number }
/** 0–1 分。覆盖来源按已启用来源数归一；排名倒数 1/rank；新鲜度 0–1（缺省 1 = 今天）；相关度 0–1（缺省 0.5）。 */
export function scoreOf(i: ScoreInput): number {
  const cover = i.totalSources > 0 ? Math.min(1, i.sources / Math.max(1, Math.min(i.totalSources, 4))) : 0;
  const rank = 1 / Math.max(1, i.bestRank);
  const s = cover * 0.35 + rank * 0.25 + (i.freshness ?? 1) * 0.2 + (i.relevance ?? 0.5) * 0.2;
  return Math.round(s * 1000) / 1000;
}

export type Trend = 'up' | 'flat' | 'new';
/** 昨日快照：normTitle → 最好排名。 */
export function trendOf(title: string, rank: number, yesterday: Record<string, number> | null | undefined): Trend {
  if (!yesterday) return 'new';
  const key = normTitle(title);
  let prev = yesterday[key];
  if (prev === undefined) {
    for (const [k, r] of Object.entries(yesterday)) if (bigramSimilarity(k, key) >= 0.6) { prev = r; break; }
  }
  if (prev === undefined) return 'new';
  return prev - rank >= 5 ? 'up' : 'flat';
}

/** 生成快照（只存 normTitle → 最好排名，保持精简）。 */
export function snapshotOf(groups: HotGroup[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of groups) out[g.key] = Math.min(out[g.key] ?? Infinity, g.bestRank);
  return out;
}

/** 风险词（时政、医疗、金融、未证实消息）→ 提示“谨慎 / 建议不写”。 */
export function riskOf(title: string): 'ok' | 'caution' | 'avoid' {
  if (/(谣言|网传|未经证实|爆料|内幕)/.test(title)) return 'avoid';
  if (/(疫苗|药|治疗|癌|股票|基金|理财|币|外交|政府|官员|选举|战争|军)/.test(title)) return 'caution';
  return 'ok';
}
