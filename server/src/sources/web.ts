import * as cheerio from 'cheerio';
import type { RawItem, SourceAdapter } from './types.js';
import { errorResult } from './types.js';
import { isPublicHttpUrl, USER_AGENT, type HttpClient } from '../http.js';

interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

/** 极简 robots.txt 解析：支持 User-agent / Allow / Disallow，最长匹配优先。 */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (field === 'allow' && value) cur.allow.push(value);
      if (field === 'disallow' && value) cur.disallow.push(value);
    }
  }
  return groups;
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

export function isAllowedByRobots(groups: RobotsGroup[], path: string, agent = 'contentagent'): boolean {
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const group = specific ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const r of group.allow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: true };
  for (const r of group.disallow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: false };
  return best.allow;
}

const robotsCache = new Map<string, { at: number; groups: RobotsGroup[] }>();

export async function checkRobots(url: string, http: HttpClient, proxy?: string): Promise<boolean> {
  const u = new URL(url);
  const key = u.origin;
  const cached = robotsCache.get(key);
  let groups: RobotsGroup[];
  if (cached && Date.now() - cached.at < 3600_000) {
    groups = cached.groups;
  } else {
    try {
      const res = await http(`${u.origin}/robots.txt`, { proxy, timeoutMs: 10000, maxBytes: 512 * 1024 });
      // 4xx 视为无限制；5xx 视为全部禁止（保守）
      if (res.status >= 500) groups = [{ agents: ['*'], allow: [], disallow: ['/'] }];
      else if (res.status >= 400) groups = [];
      else groups = parseRobots(res.text);
    } catch {
      groups = [{ agents: ['*'], allow: [], disallow: ['/'] }];
    }
    robotsCache.set(key, { at: Date.now(), groups });
  }
  return isAllowedByRobots(groups, u.pathname + u.search, USER_AGENT);
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}

/** 从公开页面抽取条目：按 CSS 选择器取链接列表；未给选择器时只取页面标题与描述。 */
export function extractFromHtml(html: string, pageUrl: string, selector?: string): RawItem[] {
  const $ = cheerio.load(html);
  if (!selector) {
    const title = $('meta[property="og:title"]').attr('content') || $('title').first().text();
    const summary = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    return title ? [{ title: title.trim(), url: pageUrl, summary: summary.trim() }] : [];
  }
  const out: RawItem[] = [];
  $(selector).each((_, el) => {
    const a = $(el).is('a') ? $(el) : $(el).find('a').first();
    const href = a.attr('href');
    const title = (a.text() || $(el).text()).replace(/\s+/g, ' ').trim();
    if (!href || !title) return;
    try {
      out.push({ title, url: new URL(href, pageUrl).toString() });
    } catch {
      /* 忽略无效链接 */
    }
  });
  return out.slice(0, 100);
}

export const webAdapter: SourceAdapter = {
  kind: 'web',
  label: '公开网页（遵守 robots 并限速）',
  requiredSecrets: [],
  configFields: [
    { key: 'url', label: '页面地址', placeholder: 'https://example.com/news' },
    { key: 'selector', label: '列表选择器（可选）', placeholder: '.news-list li a' },
  ],
  async fetch(config, ctx) {
    const url = String(config.url ?? '');
    if (!isPublicHttpUrl(url)) return { status: 'error', items: [], message: '页面地址无效或不是公网地址' };
    try {
      const proxy = config.useProxy ? ctx.proxy : undefined;
      const allowed = await checkRobots(url, ctx.http, proxy);
      if (!allowed) return { status: 'error', items: [], message: 'robots.txt 不允许抓取该路径，已跳过' };
      await ctx.limiter.wait(url);
      const res = await ctx.http(url, { proxy, timeoutMs: 20000 });
      if (res.status >= 400) return { status: 'error', items: [], message: `页面返回 ${res.status}` };
      const sel = typeof config.selector === 'string' && config.selector.trim() ? config.selector.trim() : undefined;
      return { status: 'ok', items: extractFromHtml(res.text, url, sel) };
    } catch (e) {
      return errorResult(e);
    }
  },
};
