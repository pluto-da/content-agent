import { createHash } from 'node:crypto';
import type { DB } from '../db.js';
import { parseJson } from '../db.js';
import type { RawItem } from '../sources/types.js';

const TRACKING = /^(utm_|spm$|from$|ref$|share|fbclid$|gclid$|scene$|clicktime$|enterid$|isappinstalled$|wfr$|xsec_)/i;

/** 规范化链接：统一协议与小写主机、去掉追踪参数与片段、去掉末尾斜杠、参数排序。 */
export function normalizeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  let s = u.toString();
  if (u.pathname === '/' && !u.search) s = s.replace(/\/$/, '');
  return s;
}

/** 标题指纹：去掉空白、标点、大小写后取哈希。 */
export function titleFingerprint(title: string): string {
  const norm = title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

export const DEFAULT_TAG_RULES: Record<string, string[]> = {
  AI: ['ai', '人工智能', '大模型', 'gpt', 'llm', '智能体', 'agent', 'deepseek', '千问'],
  科技: ['芯片', '手机', '苹果', '华为', '发布会', '科技', '机器人'],
  财经: ['股', '基金', '利率', '经济', '财报', '融资', '市场'],
  教育: ['考研', '高考', '学校', '教育', '学生', '大学'],
  生活: ['美食', '旅行', '穿搭', '家居', '健康', '运动'],
  电商: ['闲鱼', '二手', '淘宝', '直播带货', '电商', '618', '双11'],
};

export function autoTags(text: string, rules: Record<string, string[]> = DEFAULT_TAG_RULES): string[] {
  const lower = text.toLowerCase();
  return Object.entries(rules)
    .filter(([, kws]) => kws.some((k) => lower.includes(k.toLowerCase())))
    .map(([tag]) => tag);
}

export interface IngestStats { fetched: number; inserted: number; duplicates: number }

export function ingest(db: DB, sourceId: number | null, items: RawItem[], rules?: Record<string, string[]>): IngestStats {
  let inserted = 0;
  let duplicates = 0;
  const byUrl = db.prepare('SELECT id FROM items WHERE url_norm = ?');
  const byFp = db.prepare('SELECT id FROM items WHERE title_fp = ?');
  const touch = db.prepare("UPDATE items SET last_seen = datetime('now') WHERE id = ?");
  const ins = db.prepare('INSERT INTO items(source_id, url, url_norm, title, title_fp, summary, published_at, tags) VALUES(?,?,?,?,?,?,?,?)');
  for (const it of items) {
    const title = it.title.trim();
    if (!title) continue;
    const urlNorm = normalizeUrl(it.url);
    const fp = titleFingerprint(title);
    const existing = (urlNorm ? (byUrl.get(urlNorm) as { id: number } | undefined) : undefined) ?? (byFp.get(fp) as { id: number } | undefined);
    if (existing) {
      touch.run(existing.id);
      duplicates++;
      continue;
    }
    const tags = autoTags(`${title} ${it.summary ?? ''}`, rules);
    ins.run(sourceId, it.url ?? null, urlNorm, title, fp, it.summary ?? null, it.publishedAt ?? null, JSON.stringify(tags));
    inserted++;
  }
  return { fetched: items.length, inserted, duplicates };
}

export interface ItemRow { id: number; source_id: number | null; url: string | null; title: string; summary: string | null; published_at: string | null; tags: string[]; first_seen: string }

export function listItems(db: DB, q: { search?: string; tag?: string; sourceId?: number; limit?: number; offset?: number } = {}): ItemRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.search) {
    where.push('(title LIKE ? OR summary LIKE ?)');
    args.push(`%${q.search}%`, `%${q.search}%`);
  }
  if (q.tag) {
    where.push('tags LIKE ?');
    args.push(`%"${q.tag}"%`);
  }
  if (q.sourceId) {
    where.push('source_id = ?');
    args.push(q.sourceId);
  }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
  args.push(Math.min(q.limit ?? 50, 500), q.offset ?? 0);
  return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as ItemRow), tags: parseJson<string[]>(r.tags, []) }));
}

export function getItems(db: DB, ids: number[]): ItemRow[] {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as ItemRow), tags: parseJson<string[]>(r.tags, []) }));
}
