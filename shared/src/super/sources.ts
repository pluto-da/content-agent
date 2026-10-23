/**
 * 1.2.0 自定义软件与数据源（PROMPT-v1.2 第七部分）。
 * - 软件入口：任意 App 或网页，可指定属于哪个平台或“独立工具”（剪映、醒图、Canva、飞书文档…）；能力只有“打开”。
 *   存储不另起：仍写 localApps（AddAppSheet 唯一写入点，冲突审计 A9），本文件只做校验与归类。
 * - 数据源四类：RSS / Atom；守 robots 的公开页（限频，只抓用户指定的 URL）；用户自己的 CSV / Excel 导出（导入映射模板，可按平台保存）；
 *   官方开放接口（用户自己的 Key，安全表单收集、本机加密；这里只存 secretRef，绝不存 Key）。
 * - 每个数据源可授权给子 Agent 使用（grants = 子 Agent id 白名单）。
 */
import { XMLParser } from 'fast-xml-parser';
import { findSecrets } from '../core/redact.js';
import { parseRobots, isAllowedByRobots } from '../robots.js';

export interface AppEntry { id: string; label: string; platformId: string | null; standalone: boolean; url?: string; android?: string; ios?: string; capabilities: ['open'] }
export const KNOWN_TOOLS: Omit<AppEntry, 'capabilities'>[] = [
  { id: 'jianying', label: '剪映', platformId: null, standalone: true, url: 'https://www.capcut.cn/', android: 'com.lemon.lv', ios: 'jianying://' },
  { id: 'xingtu', label: '醒图', platformId: null, standalone: true, android: 'com.xt.retouch' },
  { id: 'canva', label: 'Canva 可画', platformId: null, standalone: true, url: 'https://www.canva.cn/' },
  { id: 'feishu-docs', label: '飞书文档', platformId: null, standalone: true, url: 'https://docs.feishu.cn/' },
];
export function validateAppEntry(a: AppEntry, platforms: string[] = []): string[] {
  const e: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(a.id)) e.push(`id 不合法：${a.id}`);
  if (!a.label.trim()) e.push('缺少名称');
  if (!a.url && !a.android && !a.ios) e.push('至少填一个：网址、Android 包名或 iOS Scheme');
  if (a.url && !/^https:\/\//.test(a.url)) e.push('网址需为 https');
  if (a.android && !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(a.android)) e.push('Android 包名格式不对');
  if (a.ios && !/^[a-z][a-z0-9+.-]*:\/\/$/i.test(a.ios)) e.push('iOS Scheme 需形如 xxx://');
  if (a.platformId && !platforms.includes(a.platformId)) e.push(`没有这个平台：${a.platformId}`);
  if (a.platformId && a.standalone) e.push('“属于某个平台”和“独立工具”只能选一个');
  if ((a.capabilities as string[]).some((c) => c !== 'open')) e.push('软件入口只能“打开”，没有其他能力');
  return e;
}

/* ---------------- 数据源 ---------------- */
export type DataSourceKind = 'rss' | 'public_page' | 'csv' | 'official_api';
export const DATA_SOURCE_TEXT: Record<DataSourceKind, string> = { rss: 'RSS / Atom', public_page: '公开页（守 robots，限频）', csv: '我的 CSV / Excel 导出', official_api: '官方开放接口（我自己的 Key）' };
export interface DataSource {
  id: string; kind: DataSourceKind; label: string; url?: string; platformId?: string;
  /** 公开页：两次抓取的最短间隔（分钟，≥30）；RSS 默认 30。 */
  minIntervalMin?: number; lastFetchedAt?: string;
  /** CSV / Excel：列名 → 字段的映射（可按平台保存为模板）。 */
  mapping?: Record<string, MetricField>;
  /** 官方接口：只存安全存储里的引用（secret:xxx），Key 本体不进 VFS / 备份 / 日志。 */
  secretRef?: string; hasKey?: boolean;
  grants: string[]; enabled: boolean;
}
export const MIN_PAGE_INTERVAL_MIN = 30;
export function validateDataSource(d: DataSource): string[] {
  const e: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(d.id)) e.push(`id 不合法：${d.id}`);
  if (!d.label.trim()) e.push('缺少名称');
  if (findSecrets(JSON.stringify(d)).length) e.push('数据源配置里不能直接写 Key；官方接口的 Key 请用安全表单保存（只存引用）');
  if (d.kind === 'rss' || d.kind === 'public_page' || d.kind === 'official_api') { if (!d.url || !/^https:\/\//.test(d.url)) e.push('需要 https 地址'); }
  if (d.kind === 'public_page') {
    if (d.url && /[*?]|\{|\}/.test(new URL(d.url).pathname)) e.push('公开页只抓你指定的那一个 URL，不能用通配符或批量');
    if ((d.minIntervalMin ?? 0) < MIN_PAGE_INTERVAL_MIN) e.push(`公开页限频：两次抓取至少间隔 ${MIN_PAGE_INTERVAL_MIN} 分钟`);
    if (d.url && /(login|passport|signin|account|creator|backend|admin|私信|message)/i.test(d.url)) e.push('不抓登录后页面或后台页面');
  }
  if (d.kind === 'csv' && (!d.mapping || !Object.keys(d.mapping).length)) e.push('CSV / Excel 需要列映射（可从模板开始）');
  if (d.kind === 'official_api' && !d.secretRef) e.push('官方接口需要你自己的 Key（安全表单保存，这里只存引用）');
  if (d.secretRef && !/^secret:[\w.-]+$/.test(d.secretRef)) e.push('secretRef 只能是 secret:<id> 形式的引用');
  return e;
}
/** 公开页抓取前检查：robots 允许 + 限频到时；不允许就不抓。 */
export function canFetchPublicPage(d: DataSource, robotsTxt: string | null, now = Date.now()): { ok: boolean; why: string } {
  if (d.kind !== 'public_page' || !d.url) return { ok: false, why: '不是公开页数据源' };
  if (robotsTxt === null) return { ok: false, why: '读不到 robots.txt，按不允许处理' };
  const u = new URL(d.url);
  if (!isAllowedByRobots(parseRobots(robotsTxt), u.pathname + u.search)) return { ok: false, why: 'robots.txt 不允许抓取这个页面' };
  const last = d.lastFetchedAt ? Date.parse(d.lastFetchedAt) : 0;
  const gap = Math.max(MIN_PAGE_INTERVAL_MIN, d.minIntervalMin ?? MIN_PAGE_INTERVAL_MIN) * 60000;
  if (last && now - last < gap) return { ok: false, why: `限频：还要等 ${Math.ceil((gap - (now - last)) / 60000)} 分钟` };
  return { ok: true, why: '允许' };
}
/** 授权：子 Agent 只能用 grants 里有它、且在它 AGENT.md dataSources 白名单里的数据源（两边都要有：父级授予 ∩ 子级声明）。 */
export function canUseDataSource(agent: { id: string; dataSources: string[] }, d: DataSource): boolean {
  return d.enabled && d.grants.includes(agent.id) && agent.dataSources.includes(d.id);
}
export function grantDataSource(d: DataSource, agentId: string, on: boolean): DataSource {
  const g = new Set(d.grants); if (on) g.add(agentId); else g.delete(agentId);
  return { ...d, grants: [...g] };
}

/* ---------------- CSV / Excel 导入映射 ---------------- */
export type MetricField = 'date' | 'title' | 'views' | 'likes' | 'collects' | 'comments' | 'shares' | 'followers' | 'revenue' | 'ignore';
export const MAPPING_TEMPLATES: Record<string, Record<string, MetricField>> = {
  generic: { 日期: 'date', 发布时间: 'date', 标题: 'title', 阅读: 'views', 播放: 'views', 曝光: 'views', 点赞: 'likes', 收藏: 'collects', 评论: 'comments', 分享: 'shares', 转发: 'shares', 涨粉: 'followers', 新增粉丝: 'followers', 收入: 'revenue' },
  xiaohongshu: { 笔记标题: 'title', 发布时间: 'date', 观看量: 'views', 点赞: 'likes', 收藏: 'collects', 评论: 'comments', 分享: 'shares', 涨粉: 'followers' },
  douyin: { 作品名称: 'title', 发布时间: 'date', 播放量: 'views', 点赞量: 'likes', 评论量: 'comments', 分享量: 'shares', 收藏量: 'collects', 粉丝增量: 'followers' },
  bilibili: { 稿件标题: 'title', 发布时间: 'date', 播放: 'views', 点赞: 'likes', 收藏: 'collects', 评论: 'comments', 分享: 'shares', 涨粉: 'followers' },
  youtube: { 'Video title': 'title', 'Video publish time': 'date', Views: 'views', Likes: 'likes', Comments: 'comments', Shares: 'shares', 'Subscribers gained': 'followers', 'Estimated revenue (USD)': 'revenue' },
};
/** 按表头自动套模板：每列先看平台模板，再看通用模板；没认出的列标 ignore（由用户在映射里改）。 */
export function guessMapping(headers: string[], platform = 'generic'): Record<string, MetricField> {
  const t = { ...MAPPING_TEMPLATES.generic, ...(MAPPING_TEMPLATES[platform] ?? {}) };
  return Object.fromEntries(headers.map((h) => [h, t[h.trim()] ?? 'ignore']));
}
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const s = text.replace(/^\uFEFF/, '');
  const sep = (s.split('\n')[0] ?? '').includes('\t') && !(s.split('\n')[0] ?? '').includes(',') ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; } else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
/** 解 zip（支持 stored 与 deflate；deflate 用平台自带的 DecompressionStream，浏览器与 Node 22 都有）。 */
export async function unzipAny(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1; for (let i = data.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 zip / xlsx 文件');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目录损坏');
    const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true); const nlen = dv.getUint16(p + 28, true); const xlen = dv.getUint16(p + 30, true); const clen = dv.getUint16(p + 32, true); const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nlen));
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = data.slice(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) { const ds = new DecompressionStream('deflate-raw'); const buf = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer(); out.set(name, new Uint8Array(buf)); }
    else throw new Error(`不支持的压缩方式 ${method}：${name}`);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
/** 读 .xlsx 第一张表（用户自己从创作者后台导出的 Excel）：解 zip → sharedStrings + sheet1。 */
export async function parseXlsx(data: Uint8Array): Promise<string[][]> {
  const files = new Map([...(await unzipAny(data))].map(([k, v]) => [k, new TextDecoder().decode(v)]));
  const xp = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: (n) => ['si', 'row', 'c', 'r'].includes(n) });
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const si of (xp.parse(ss)?.sst?.si ?? []) as Record<string, unknown>[]) {
    const t = si.t; const rs = si.r as { t?: unknown }[] | undefined;
    const txt = (v: unknown): string => (typeof v === 'object' && v ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v ?? ''));
    shared.push(t !== undefined ? txt(t) : (rs ?? []).map((r) => txt(r.t)).join(''));
  }
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('Excel 里没有工作表');
  const rows = (xp.parse(files.get(sheetName)!)?.worksheet?.sheetData?.row ?? []) as { c?: Record<string, unknown>[] }[];
  const col = (ref: string) => { const m = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A'; let n = 0; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return rows.map((r) => {
    const out: string[] = [];
    for (const c of r.c ?? []) {
      const v = c.v !== undefined ? String(c.v) : c.is ? String(((c.is as Record<string, unknown>).t as unknown) ?? '') : '';
      out[col(String(c['@r'] ?? 'A1'))] = c['@t'] === 's' ? shared[Number(v)] ?? '' : v;
    }
    return Array.from(out, (x) => x ?? '');
  }).filter((r) => r.some((x) => x !== ''));
}
export interface ImportedRow { date?: string; title?: string; views?: number; likes?: number; collects?: number; comments?: number; shares?: number; followers?: number; revenue?: number }
/** 应用映射：只填表格里有的数字，空格与非数字跳过（不补 0、不推算）。 */
export function applyMapping(rows: string[][], mapping: Record<string, MetricField>): { rows: ImportedRow[]; skipped: number; unmapped: string[] } {
  const [head = [], ...body] = rows;
  const unmapped = head.filter((h) => (mapping[h] ?? 'ignore') === 'ignore');
  let skipped = 0;
  const out = body.map((r) => {
    const o: ImportedRow = {};
    head.forEach((h, i) => {
      const f = mapping[h]; const v = (r[i] ?? '').trim();
      if (!f || f === 'ignore' || v === '') return;
      if (f === 'date' || f === 'title') { (o as Record<string, string>)[f] = v; return; }
      const n = Number(v.replace(/[,，\s]/g, '').replace(/万$/, 'e4').replace(/w$/i, 'e4'));
      if (Number.isFinite(n)) (o as Record<string, number>)[f] = n; else skipped++;
    });
    return o;
  }).filter((o) => Object.keys(o).length);
  return { rows: out, skipped, unmapped };
}
