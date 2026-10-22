/**
 * 本机热点读取：官方 RSS（白名单渠道）+ 公开榜单（先查 robots.txt，被禁止就如实标注、不绕过）。
 * App 内经 CapacitorHttp 原生请求；网页里多数来源不允许跨域，会如实说明原因。解析逻辑与服务端共用（@content-agent/shared）。
 */
import { classifyThrown, isAllowedByRobots, parseBaiduHot, parseFeed, parseRobots } from '@content-agent/shared';
import { runtime } from '../runtime';
import { PUBLIC_SOURCES } from '../data/hotSources';

export interface HotSource { id: string; label: string; kind: 'rss' | 'board'; url: string }
/** 0.8.0：来源表统一在 data/hotSources.ts（修订 R1-d）。 */
export const HOT_SOURCES: HotSource[] = PUBLIC_SOURCES.map((s) => ({ id: s.id, label: s.kind === 'rss' ? `${s.label}（RSS）` : s.label, kind: s.kind, url: s.url }));

export interface HotEntry { title: string; url?: string; source: string; rank: number }
export interface SourceResult { id: string; label: string; ok: boolean; count: number; reason?: string }

async function get(url: string, timeoutMs = 12000): Promise<{ status: number; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    const f = classifyThrown(e, { web: runtime() !== 'capacitor', timedOut: ctl.signal.aborted, offline: typeof navigator !== 'undefined' && navigator.onLine === false });
    const reason = f.kind === 'cors' ? '网页版不能直接读取这个来源（跨域）' : f.kind === 'timeout' ? '网络超时' : f.reason;
    throw new Error(reason, { cause: e });
  } finally { clearTimeout(t); }
}

async function robotsOk(url: string): Promise<boolean> {
  const u = new URL(url);
  try {
    const r = await get(`${u.origin}/robots.txt`, 8000);
    if (r.status >= 400) return true;
    return isAllowedByRobots(parseRobots(r.text), u.pathname + u.search, 'ContentAgent');
  } catch { return true; } // robots 读不到时按“未禁止”处理，与服务端一致
}

export async function fetchHot(ids: string[]): Promise<{ items: HotEntry[]; sources: SourceResult[] }> {
  const items: HotEntry[] = [];
  const sources: SourceResult[] = [];
  await Promise.all(HOT_SOURCES.filter((s) => ids.includes(s.id)).map(async (s) => {
    try {
      if (s.kind === 'board' && !(await robotsOk(s.url))) { sources.push({ id: s.id, label: s.label, ok: false, count: 0, reason: 'robots.txt 不允许读取，已跳过' }); return; }
      const r = await get(s.url);
      if (r.status >= 400) throw new Error(`来源返回 ${r.status}`);
      const list = s.kind === 'rss' ? parseFeed(r.text).map((x, i) => ({ title: x.title, url: x.url, rank: i + 1 })) : parseBaiduHot(r.text);
      list.slice(0, 20).forEach((x) => items.push({ title: x.title, url: x.url, rank: x.rank, source: s.label }));
      sources.push({ id: s.id, label: s.label, ok: true, count: Math.min(20, list.length) });
    } catch (e) {
      sources.push({ id: s.id, label: s.label, ok: false, count: 0, reason: e instanceof Error ? e.message : String(e) });
    }
  }));
  return { items, sources };
}

/** 读不到热点时的示例选题（引导用，明确标注“示例”）。 */
export const SAMPLE_IDEAS = ['通勤时间怎么利用', '第一次带父母出国旅行要准备什么', '30 天早睡计划的真实记录'];
