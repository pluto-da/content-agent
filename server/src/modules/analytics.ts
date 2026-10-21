import { randomUUID } from 'node:crypto';
import type { DB } from '../db.js';

/** 解析 CSV（支持引号、转义引号、逗号/制表符分隔、BOM）。 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const delim = (src.split('\n')[0] ?? '').includes('\t') && !(src.split('\n')[0] ?? '').includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  title: ['标题', '作品标题', '笔记标题', '文章标题', '作品名称', '内容', 'title'],
  published_at: ['发布时间', '发表时间', '日期', 'publish_time', 'date', 'created_at'],
  views: ['播放', '播放量', '阅读', '阅读量', '浏览量', '曝光', '观看', 'views', 'impressions', 'play_count'],
  likes: ['点赞', '点赞量', '喜欢', 'likes', 'digg_count'],
  comments: ['评论', '评论量', 'comments', 'comment_count'],
  favorites: ['收藏', '收藏量', 'favorites', 'collect_count'],
  shares: ['分享', '分享量', '转发', 'shares', 'share_count'],
};

export function mapColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, idx) => {
    const k = h.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[field] === undefined && aliases.some((a) => k === a.toLowerCase() || k.includes(a.toLowerCase()))) map[field] = idx;
    }
  });
  return map;
}

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.replace(/[,\s]/g, '');
  const m = /^([\d.]+)(万|w|k)?$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? n * (m[2] === 'k' || m[2] === 'K' ? 1000 : 10000) : n;
}

export function importCsv(db: DB, text: string, platform: string): { batch: string; rows: number; columns: Record<string, number> } {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const cols = mapColumns(rows[0]!);
  if (cols.title === undefined) throw new Error('未识别到“标题”列');
  const batch = randomUUID();
  const ins = db.prepare('INSERT INTO metrics(batch, platform, title, published_at, views, likes, comments, favorites, shares, raw) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const r of rows.slice(1)) {
    const g = (f: string) => (cols[f] === undefined ? undefined : r[cols[f]!]);
    ins.run(batch, platform, g('title') ?? '', g('published_at') ?? null, num(g('views')), num(g('likes')), num(g('comments')), num(g('favorites')), num(g('shares')), JSON.stringify(r));
  }
  return { batch, rows: rows.length - 1, columns: cols };
}

export interface Summary { count: number; totals: Record<string, number>; avg: Record<string, number>; top: { title: string; views: number | null; engagement: number }[]; note: string }

export function summarize(db: DB, batch?: string): Summary {
  const rows = (batch ? db.prepare('SELECT * FROM metrics WHERE batch = ?').all(batch) : db.prepare('SELECT * FROM metrics').all()) as Record<string, number | string | null>[];
  const fields = ['views', 'likes', 'comments', 'favorites', 'shares'];
  const totals: Record<string, number> = {};
  for (const f of fields) totals[f] = rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const avg = Object.fromEntries(fields.map((f) => [f, rows.length ? Math.round((totals[f]! / rows.length) * 100) / 100 : 0]));
  const top = rows
    .map((r) => {
      const inter = (Number(r.likes) || 0) + (Number(r.comments) || 0) + (Number(r.favorites) || 0) + (Number(r.shares) || 0);
      const v = r.views === null ? null : Number(r.views);
      return { title: String(r.title), views: v, engagement: v ? Math.round((inter / v) * 10000) / 100 : 0 };
    })
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 5);
  return { count: rows.length, totals, avg, top, note: rows.length < 10 ? '样本量少于 10 条，结论仅为观察，需持续验证' : '' };
}
