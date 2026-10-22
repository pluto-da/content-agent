import { parseFeed as sharedParseFeed } from '@content-agent/shared';
import type { RawItem, SourceAdapter } from './types.js';
import { errorResult } from './types.js';
import { isPublicHttpUrl } from '../http.js';

/** 0.6.0 起 RSS/Atom/RDF 解析移到共用模块 @content-agent/shared（本机热点同用）。 */
export function parseFeed(xml: string): RawItem[] {
  return sharedParseFeed(xml);
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
