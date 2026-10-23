/**
 * 收益数据层（8.13）：收入只接受两种来源凭据（用户表单提交事件 id / 官方导出文件名 + sha256），凭据不可复用；
 * 归因四种：direct / allocated（“分摊估计”）/ user_tagged / unattributed；漏斗五层；按收益排序（无收入按漏斗层）；回复数字出处来自这里。
 */
import { sha256 } from '../core/hash.js';

export type RevenueType = 'creator_share' | 'ad_deal' | 'commission' | 'paid_content' | 'other';
export type RevenueSource = { kind: 'user_entered'; formEventId: string } | { kind: 'official_export'; fileName: string; sha256: string; row: number };
export interface RevenueRecord { id: string; date: string; platform: string; type: RevenueType; amount: number; basis: 'settled' | 'estimated'; contentIds: string[]; source: RevenueSource; note?: string; createdAt: string }
export interface MetricRecord { contentId: string; platform: string; window: '24h' | '72h' | '7d'; impressions?: number; engagements?: { likes?: number; comments?: number; saves?: number; shares?: number }; follows?: number; conversions?: { clicks?: number; storeVisits?: number; inquiries?: number; paidJoins?: number }; source: RevenueSource; date: string }
export interface Attribution { id: string; revenueId: string; contentId: string | null; method: 'direct' | 'allocated' | 'user_tagged' | 'unattributed'; share: number; confidence: 'high' | 'medium' | 'low'; computedAt: string; ruleVersion: number }
export const METHOD_LABEL: Record<Attribution['method'], string> = { direct: '直接归因', allocated: '分摊估计', user_tagged: '你标注的', unattributed: '未归因' };

export class RevenueError extends Error { constructor(public kind: 'no_source' | 'source_reused' | 'invalid', msg: string) { super(msg); } }
const sourceKey = (s: RevenueSource) => (s.kind === 'user_entered' ? `form:${s.formEventId}` : `file:${s.sha256}:${s.row}`);
/** 写入校验：凭据必须存在且未被复用；金额两位小数、>0；日期 YYYY-MM-DD。Agent 工具层没有直接写金额的参数。 */
export function validateRevenue(r: Omit<RevenueRecord, 'id' | 'createdAt'>, existing: RevenueRecord[]): RevenueRecord {
  if (!r.source || (r.source.kind === 'user_entered' && !r.source.formEventId) || (r.source.kind === 'official_export' && (!r.source.sha256 || !r.source.fileName))) throw new RevenueError('no_source', '收入记录必须来自你在表单里的录入，或你导出的官方文件');
  if (existing.some((x) => sourceKey(x.source) === sourceKey(r.source))) throw new RevenueError('source_reused', '这条凭据已经用过，不能重复写入');
  if (!(r.amount > 0) || Math.round(r.amount * 100) !== r.amount * 100) throw new RevenueError('invalid', '金额需大于 0，最多两位小数');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new RevenueError('invalid', '日期格式应为 YYYY-MM-DD（北京时间）');
  return { ...r, id: `rev-${sha256(sourceKey(r.source)).slice(0, 10)}`, createdAt: new Date().toISOString() };
}

/* ---------- 官方导出导入（CSV；列映射由用户确认；同一 hash 再导入提示“已导入过”） ---------- */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
export interface ColumnMap { date: string; amount: string; platform?: string; contentId?: string; type?: string; fixedPlatform?: string; basis?: 'settled' | 'estimated' }
export interface ImportPreview { fileHash: string; duplicateFile: boolean; headers: string[]; rows: Omit<RevenueRecord, 'id' | 'createdAt'>[]; errors: { row: number; message: string }[]; sample: string[][] }
export function previewImport(fileName: string, text: string, map: ColumnMap, imported: string[]): ImportPreview {
  const hash = sha256(text);
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const headers = rows[0] ?? [];
  const col = (n?: string) => (n ? headers.indexOf(n) : -1);
  const out: ImportPreview['rows'] = []; const errors: ImportPreview['errors'] = [];
  rows.slice(1).forEach((r, i) => {
    const date = (r[col(map.date)] ?? '').trim().replace(/\//g, '-').slice(0, 10);
    const amount = Number((r[col(map.amount)] ?? '').replace(/[,¥￥\s]/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0)) { errors.push({ row: i + 2, message: '日期或金额无法识别，已跳过' }); return; }
    const contentId = col(map.contentId) >= 0 ? (r[col(map.contentId)] ?? '').trim() : '';
    out.push({ date, amount: Math.round(amount * 100) / 100, platform: map.fixedPlatform ?? (r[col(map.platform)] ?? '').trim() ?? 'unknown', type: (map.type ? (r[col(map.type)] as RevenueType) : 'creator_share') || 'creator_share', basis: map.basis ?? 'settled', contentIds: contentId ? [contentId] : [], source: { kind: 'official_export', fileName, sha256: hash, row: i + 2 } });
  });
  return { fileHash: hash, duplicateFile: imported.includes(hash), headers, rows: out, errors, sample: rows.slice(0, 21) };
}

/* ---------- 归因 ---------- */
export function computeAttribution(revenue: RevenueRecord[], o: { tags?: Record<string, string[]>; candidates?: (r: RevenueRecord) => { contentId: string; weight: number }[]; now?: Date } = {}): Attribution[] {
  const at = (o.now ?? new Date()).toISOString();
  const out: Attribution[] = [];
  for (const r of revenue) {
    const tagged = o.tags?.[r.id];
    if (r.contentIds.length === 1) out.push({ id: `${r.id}:${r.contentIds[0]}`, revenueId: r.id, contentId: r.contentIds[0]!, method: 'direct', share: 1, confidence: 'high', computedAt: at, ruleVersion: 1 });
    else if (tagged?.length) for (const c of tagged) out.push({ id: `${r.id}:${c}`, revenueId: r.id, contentId: c, method: 'user_tagged', share: 1 / tagged.length, confidence: 'medium', computedAt: at, ruleVersion: 1 });
    else {
      const cands = r.contentIds.length > 1 ? r.contentIds.map((contentId) => ({ contentId, weight: 1 })) : o.candidates?.(r) ?? [];
      const total = cands.reduce((s, c) => s + c.weight, 0);
      if (cands.length && total > 0) for (const c of cands) out.push({ id: `${r.id}:${c.contentId}`, revenueId: r.id, contentId: c.contentId, method: 'allocated', share: c.weight / total, confidence: 'low', computedAt: at, ruleVersion: 1 });
      else out.push({ id: `${r.id}:none`, revenueId: r.id, contentId: null, method: 'unattributed', share: 1, confidence: 'low', computedAt: at, ruleVersion: 1 });
    }
  }
  return out;
}
export interface RevenueSummary { total: number; byMethod: Record<Attribution['method'], number>; byContent: { contentId: string; amount: number; methods: string[] }[]; byPlatform: Record<string, number>; count: number }
export function summarize(revenue: RevenueRecord[], attr: Attribution[], range?: { from?: string; to?: string }): RevenueSummary {
  const inRange = revenue.filter((r) => (!range?.from || r.date >= range.from) && (!range?.to || r.date <= range.to));
  const ids = new Set(inRange.map((r) => r.id));
  const byMethod = { direct: 0, allocated: 0, user_tagged: 0, unattributed: 0 } as Record<Attribution['method'], number>;
  const byContent = new Map<string, { amount: number; methods: Set<string> }>();
  for (const a of attr.filter((x) => ids.has(x.revenueId))) {
    const r = inRange.find((x) => x.id === a.revenueId)!;
    const amt = Math.round(r.amount * a.share * 100) / 100;
    byMethod[a.method] += amt;
    if (a.contentId) { const c = byContent.get(a.contentId) ?? { amount: 0, methods: new Set() }; c.amount += amt; c.methods.add(METHOD_LABEL[a.method]); byContent.set(a.contentId, c); }
  }
  const byPlatform: Record<string, number> = {};
  for (const r of inRange) byPlatform[r.platform] = Math.round(((byPlatform[r.platform] ?? 0) + r.amount) * 100) / 100;
  return { total: Math.round(inRange.reduce((s, r) => s + r.amount, 0) * 100) / 100, byMethod, byContent: [...byContent].map(([contentId, v]) => ({ contentId, amount: Math.round(v.amount * 100) / 100, methods: [...v.methods] })).sort((a, b) => b.amount - a.amount), byPlatform, count: inRange.length };
}
/* ---------- 漏斗五层 ---------- */
export const FUNNEL = ['曝光', '互动', '关注', '转化', '收入'] as const;
export function funnel(metrics: MetricRecord[], revenue: RevenueRecord[], contentId?: string): { layer: typeof FUNNEL[number]; value: number }[] {
  const ms = metrics.filter((m) => !contentId || m.contentId === contentId);
  const sum = (f: (m: MetricRecord) => number) => ms.reduce((s, m) => s + f(m), 0);
  const eng = (m: MetricRecord) => (m.engagements?.likes ?? 0) + (m.engagements?.comments ?? 0) + (m.engagements?.saves ?? 0) + (m.engagements?.shares ?? 0);
  const conv = (m: MetricRecord) => (m.conversions?.clicks ?? 0) + (m.conversions?.storeVisits ?? 0) + (m.conversions?.inquiries ?? 0) + (m.conversions?.paidJoins ?? 0);
  const rev = revenue.filter((r) => !contentId || r.contentIds.includes(contentId)).reduce((s, r) => s + r.amount, 0);
  return [{ layer: '曝光', value: sum((m) => m.impressions ?? 0) }, { layer: '互动', value: sum(eng) }, { layer: '关注', value: sum((m) => m.follows ?? 0) }, { layer: '转化', value: sum(conv) }, { layer: '收入', value: Math.round(rev * 100) / 100 }];
}
/** 复盘排序：有收入按收入；没有收入按漏斗层（转化 > 关注 > 互动 > 曝光）。 */
export function rankContents(contentIds: string[], metrics: MetricRecord[], revenue: RevenueRecord[], attr: Attribution[]): { contentId: string; by: 'revenue' | 'funnel'; value: number }[] {
  const s = summarize(revenue, attr);
  if (s.total > 0) return contentIds.map((c) => ({ contentId: c, by: 'revenue' as const, value: s.byContent.find((x) => x.contentId === c)?.amount ?? 0 })).sort((a, b) => b.value - a.value);
  const key = (c: string) => { const f = funnel(metrics, [], c); return f[3]!.value * 1e9 + f[2]!.value * 1e6 + f[1]!.value * 1e3 + f[0]!.value / 1e3; };
  return contentIds.map((c) => ({ contentId: c, by: 'funnel' as const, value: key(c) })).sort((a, b) => b.value - a.value);
}
/** 回复数字出处：收入金额、汇总、按内容 / 平台金额都算有出处。 */
export function knownNumbers(revenue: RevenueRecord[], attr: Attribution[], metrics: MetricRecord[] = []): number[] {
  const s = summarize(revenue, attr);
  const nums = new Set<number>([s.total, ...revenue.map((r) => r.amount), ...s.byContent.map((c) => c.amount), ...Object.values(s.byPlatform), ...Object.values(s.byMethod)]);
  for (const m of metrics) for (const v of [m.impressions, m.follows, m.engagements?.likes, m.engagements?.comments, m.engagements?.saves, m.engagements?.shares]) if (typeof v === 'number') nums.add(v);
  return [...nums].filter((x) => x > 0);
}
/** 变现路径：超过 recheckDays 天未核实 → 标“需重新核实”。 */
export function monetizationStatus(checkedAt: string, now = new Date(), recheckDays = 30): { stale: boolean; label: string } {
  const days = (now.getTime() - Date.parse(checkedAt)) / 864e5;
  return { stale: days > recheckDays, label: days > recheckDays ? `上次核实 ${checkedAt.slice(0, 10)}，需重新核实` : `上次核实 ${checkedAt.slice(0, 10)}，以当天官方页为准` };
}
