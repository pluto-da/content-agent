import { XMLParser } from 'fast-xml-parser';
import type { RawItem, SourceAdapter } from './types.js';
import { errorResult } from './types.js';
import { isPublicHttpUrl } from '../http.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true });

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** 解析 RSS 2.0 / Atom / RDF，输出统一条目。 */
export function parseFeed(xml: string): RawItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const out: RawItem[] = [];
  if (doc.rss?.channel) {
    for (const it of toArray(doc.rss.channel.item)) {
      out.push({
        title: stripHtml(text(it.title)),
        url: text(it.link) || text(it.guid),
        summary: stripHtml(text(it.description)).slice(0, 500),
        publishedAt: text(it.pubDate) || text(it['dc:date']) || undefined,
      });
    }
  } else if (doc.feed) {
    for (const e of toArray(doc.feed.entry)) {
      const links = toArray(e.link) as Record<string, string>[];
      const link = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
      out.push({
        title: stripHtml(text(e.title)),
        url: link?.['@_href'] ?? '',
        summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 500),
        publishedAt: text(e.published) || text(e.updated) || undefined,
      });
    }
  } else if (doc['rdf:RDF']) {
    for (const it of toArray(doc['rdf:RDF'].item)) {
      out.push({ title: stripHtml(text(it.title)), url: text(it.link), summary: stripHtml(text(it.description)).slice(0, 500), publishedAt: text(it['dc:date']) || undefined });
    }
  } else {
    throw new Error('无法识别的订阅格式（不是 RSS/Atom/RDF）');
  }
  return out.filter((i) => i.title);
}

export const rssAdapter: SourceAdapter = {
  kind: 'rss',
  label: 'RSS / Atom 订阅',
  requiredSecrets: [],
  configFields: [{ key: 'url', label: '订阅地址', placeholder: 'https://www.solidot.org/index.rss' }],
  async fetch(config, ctx) {
    const url = String(config.url ?? '');
    if (!isPublicHttpUrl(url)) return { status: 'error', items: [], message: '订阅地址无效或不是公网地址' };
    try {
      await ctx.limiter.wait(url);
      const res = await ctx.http(url, { proxy: config.useProxy ? ctx.proxy : undefined, timeoutMs: 20000 });
      if (res.status >= 400) return { status: 'error', items: [], message: `订阅源返回 ${res.status}` };
      return { status: 'ok', items: parseFeed(res.text) };
    } catch (e) {
      return errorResult(e);
    }
  },
};
