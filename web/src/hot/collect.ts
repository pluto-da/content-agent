/**
 * hot_fetch 的实现（0.8.0，修订 R1 五路并行）：
 *  a 已连接的第三方数据服务；b 已填凭证的平台官方接口；c 素材箱里今天“分享进来 / 选中发来”的条目；
 *  d 用户启用的公开 RSS 与公开榜单（先查 robots，每源 12 秒超时，30 分钟本机缓存）；
 *  e 热点巡视不在这里读取（Agent 不读页面），只返回“可以巡视的页面”供 Agent 建议用户开始巡视。
 * 每条结果都带 source（来源名）与 route（路数），卡片上逐条标注。
 */
import type { RawHot } from '@content-agent/shared';
import { CONNECTORS, DOUYIN_OPEN, NO_PUBLIC_SOURCE_HINT, PATROL_STOPS, PUBLIC_SOURCES, type Route } from '../data/hotSources';
import { db } from '../local/db';
import { fetchHot } from '../local/hot';
import { isConnected, listCreds, readCred } from '../local/secure';
import { getPrefs } from '../local/store';
import { CONNECTOR_IMPLS } from './connectors';

export interface SourceStatus { id: string; label: string; route: Route; platform: string; ok: boolean; count: number; reason?: string; kind: 'connector' | 'official' | 'share' | 'public' }
export interface HotFetchResult { items: (RawHot & { id: string })[]; sources: SourceStatus[]; gaps: { platform: string; hint: string }[]; patrol: { id: string; label: string }[]; cached: boolean }

const CACHE_KEY = 'hot.cache';
const CACHE_MIN = 30;

export async function collectHot(opts: { sources?: string[]; force?: boolean } = {}): Promise<HotFetchResult> {
  const prefs = await getPrefs();
  if (!opts.force && !opts.sources) {
    const c = await db.getKV<{ at: number; data: HotFetchResult }>(CACHE_KEY);
    if (c && Date.now() - c.at < CACHE_MIN * 60000) {
      // 素材箱（c 路）每次重新合并，保证刚分享进来的条目能用
      const shares = await inboxHot();
      return { ...c.data, items: [...c.data.items.filter((i) => i.route !== 'c'), ...shares.items], sources: [...c.data.sources.filter((s) => s.route !== 'c'), shares.status], cached: true };
    }
  }
  const want = (id: string) => !opts.sources || opts.sources.includes(id);
  const creds = await listCreds();
  const tasks: Promise<{ items: RawHot[]; status: SourceStatus }>[] = [];

  // a + b：连接器
  for (const meta of [...CONNECTORS.filter((c) => c.status !== 'unsupported'), { id: DOUYIN_OPEN.id, label: DOUYIN_OPEN.label }]) {
    const impl = CONNECTOR_IMPLS[meta.id];
    if (!impl?.fetchHot || !want(meta.id)) continue;
    const route = impl.route;
    if (!isConnected(creds[meta.id], impl.secretKeys)) {
      tasks.push(Promise.resolve({ items: [], status: { id: meta.id, label: meta.label, route, platform: route === 'b' ? 'douyin' : '综合', ok: false, count: 0, reason: route === 'b' ? '需官方接口：到“我的 → 数据源”填抖音开放平台凭证' : '未连接：到“我的 → 数据源”填你的 API Key', kind: route === 'b' ? 'official' : 'connector' } }));
      continue;
    }
    tasks.push((async () => {
      try {
        const cred = (await readCred(meta.id)) ?? {};
        const items = await impl.fetchHot!(cred);
        return { items, status: { id: meta.id, label: meta.label, route, platform: route === 'b' ? 'douyin' : '综合', ok: true, count: items.length, kind: route === 'b' ? 'official' : 'connector' } as SourceStatus };
      } catch (e) {
        return { items: [], status: { id: meta.id, label: meta.label, route, platform: '综合', ok: false, count: 0, reason: e instanceof Error ? e.message : String(e), kind: route === 'b' ? 'official' : 'connector' } as SourceStatus };
      }
    })());
  }

  // d：公开来源
  const pubIds = PUBLIC_SOURCES.filter((s) => (opts.sources ? opts.sources.includes(s.id) : prefs.hotSources.includes(s.id))).map((s) => s.id);
  if (pubIds.length) tasks.push((async () => {
    const r = await fetchHot(pubIds);
    const items: RawHot[] = r.items.map((x) => {
      const def = PUBLIC_SOURCES.find((s) => x.source.startsWith(s.label));
      return { title: x.title, url: x.url, rank: x.rank, source: def?.label ?? x.source, route: 'd', platform: def?.platform ?? '综合', fetchedAt: new Date().toISOString() };
    });
    // 多个来源的状态合并为一组返回
    return { items, status: { id: '__public', label: '', route: 'd', platform: '', ok: true, count: 0, kind: 'public' } as SourceStatus, extra: r.sources } as never;
  })());

  // c：素材箱
  tasks.push(inboxHot());

  const settled = await Promise.all(tasks);
  const items: RawHot[] = [];
  const sources: SourceStatus[] = [];
  for (const s of settled as ({ items: RawHot[]; status: SourceStatus; extra?: { id: string; label: string; ok: boolean; count: number; reason?: string }[] })[]) {
    items.push(...s.items);
    if (s.extra) for (const x of s.extra) { const def = PUBLIC_SOURCES.find((p) => p.id === x.id); sources.push({ id: x.id, label: def?.label ?? x.label, route: 'd', platform: def?.platform ?? '综合', ok: x.ok, count: x.count, reason: x.reason, kind: 'public' }); }
    else sources.push(s.status);
  }
  const withIds = items.map((it, i) => ({ ...it, id: `h${i + 1}` }));
  const covered = new Set(withIds.map((i) => i.platform));
  const gaps = Object.entries(NO_PUBLIC_SOURCE_HINT).filter(([p]) => !covered.has(p) && !(p !== 'xiaohongshu' && p !== 'kuaishou' && sources.some((s) => s.id === 'tophub' && s.ok))).map(([platform, hint]) => ({ platform, hint }));
  const result: HotFetchResult = { items: withIds, sources, gaps, patrol: PATROL_STOPS.map((p) => ({ id: p.id, label: p.label })), cached: false };
  if (!opts.sources) await db.setKV(CACHE_KEY, { at: Date.now(), data: result });
  return result;
}

/** c 路：今天的素材（分享进来、选中文字发来、工具栏发来的网址），作为热点候选。 */
async function inboxHot(): Promise<{ items: (RawHot & { id: string })[]; status: SourceStatus }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db.all('inbox')).filter((r) => String(r.created_at ?? '').slice(0, 10) === today);
  const items = rows.map((r) => ({ id: `in${r.id}`, title: String(r.title || r.text || r.url || '').slice(0, 80), url: (r.url as string) || undefined, source: `素材箱${r.platform ? `·${String(r.platform)}` : ''}`, route: 'c', platform: String(r.platform || '用户'), rank: 1, fetchedAt: String(r.created_at) }));
  return { items, status: { id: 'inbox', label: '分享进来 / 发给 Agent', route: 'c', platform: '用户', ok: true, count: items.length, kind: 'share' } };
}
