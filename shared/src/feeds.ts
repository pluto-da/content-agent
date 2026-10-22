import { XMLParser } from 'fast-xml-parser';

export interface FeedItem { title: string; url: string; summary?: string; publishedAt?: string }
export interface HotItem { title: string; rank: number; heat?: string; url?: string }

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true });

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
}
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** 解析 RSS 2.0 / Atom / RDF，输出统一条目（服务端信息源与本机热点共用）。 */
export function parseFeed(xml: string): FeedItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = parser.parse(xml) as Record<string, any>;
  const out: FeedItem[] = [];
  if (doc.rss?.channel) {
    for (const it of toArray(doc.rss.channel.item) as Record<string, unknown>[]) {
      out.push({ title: stripHtml(text(it.title)), url: text(it.link) || text(it.guid), summary: stripHtml(text(it.description)).slice(0, 500), publishedAt: text(it.pubDate) || text(it['dc:date']) || undefined });
    }
  } else if (doc.feed) {
    for (const e of toArray(doc.feed.entry) as Record<string, unknown>[]) {
      const links = toArray(e.link as Record<string, string> | Record<string, string>[] | undefined);
      const link = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
      out.push({ title: stripHtml(text(e.title)), url: link?.['@_href'] ?? '', summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 500), publishedAt: text(e.published) || text(e.updated) || undefined });
    }
  } else if (doc['rdf:RDF']) {
    for (const it of toArray(doc['rdf:RDF'].item) as Record<string, unknown>[]) {
      out.push({ title: stripHtml(text(it.title)), url: text(it.link), summary: stripHtml(text(it.description)).slice(0, 500), publishedAt: text(it['dc:date']) || undefined });
    }
  } else {
    throw new Error('无法识别的订阅格式（不是 RSS/Atom/RDF）');
  }
  return out.filter((i) => i.title);
}

/** 百度热搜公开榜单（top.baidu.com/api/board）。 */
export function parseBaiduHot(textBody: string): HotItem[] {
  const j = JSON.parse(textBody) as { data?: { cards?: { content?: { content?: { word?: string; url?: string; hotScore?: string }[] }[] }[] } };
  const list = j.data?.cards?.[0]?.content?.flatMap((c) => c.content ?? []) ?? [];
  return list.filter((x) => x.word).map((x, i) => ({ title: x.word!, rank: i + 1, heat: x.hotScore, url: x.url }));
}
