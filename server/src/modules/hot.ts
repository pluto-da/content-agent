import type { DB } from '../db.js';
import { parseJson } from '../db.js';
import type { SecretVault } from '../crypto.js';
import type { HostRateLimiter, HttpClient } from '../http.js';
import { checkRobots } from '../sources/web.js';
import { parseFeed } from '../sources/rss.js';
import type { ModelHub } from '../models/hub.js';
import { extractJson } from '../models/util.js';
import type { AgentFiles } from './agentfiles.js';
import type { Skill } from '../skills/loader.js';
import { systemPrompt } from './content.js';

export interface HotEntry { title: string; rank?: number; heat?: string; url?: string }
export type HotStatus = 'ok' | 'not_configured' | 'robots_disallow' | 'needs_official_api' | 'network_error' | 'parse_error';

/** 解析器抛出该错误时，按其中的状态如实标注（例如接口需要签名/登录态，只能走官方接口）。 */
export class HotStatusError extends Error {
  constructor(public readonly status: HotStatus, message: string) {
    super(message);
    this.name = 'HotStatusError';
  }
}

const DOUYIN_NEEDS_OFFICIAL = '抖音网页热榜接口对普通程序请求返回空内容（需要网页签名参数/登录态才返回数据）。本项目不伪造签名、不伪装浏览器，请改用“抖音热榜（开放平台官方接口）”，在密钥库填写 douyin.client_key 与 douyin.client_secret（或 douyin.client_token）';

/** 抖音网页热榜：robots.txt 未对通用 UA 限制该路径；空响应/非 JSON 视为需要官方接口。 */
export function parseDouyinWeb(text: string): HotEntry[] {
  const body = text.replace(/^\uFEFF/, '').trim();
  if (!body) throw new HotStatusError('needs_official_api', DOUYIN_NEEDS_OFFICIAL);
  if (!body.startsWith('{') && !body.startsWith('[')) throw new HotStatusError('needs_official_api', `返回的不是 JSON（可能是验证页）。${DOUYIN_NEEDS_OFFICIAL}`);
  let j: { status_code?: number; status_msg?: string; data?: { word_list?: { word?: string; hot_value?: number }[] } };
  try {
    j = JSON.parse(body) as typeof j;
  } catch {
    throw new Error('返回内容不是完整的 JSON');
  }
  const list = j.data?.word_list ?? [];
  if (!list.length) {
    if (j.status_code) throw new HotStatusError('needs_official_api', `接口返回 status_code=${j.status_code}${j.status_msg ? `（${j.status_msg}）` : ''}。${DOUYIN_NEEDS_OFFICIAL}`);
    throw new Error('页面无可解析的热榜数据（可能需要前端渲染或已变更）');
  }
  return list.filter((x) => x.word).map((x, i) => ({ title: x.word!, rank: i + 1, heat: String(x.hot_value ?? '') }));
}

/** 抖音开放平台“获取实时热点词”：GET https://open.douyin.com/hotsearch/sentences/，头 access-token 为 client_token。 */
export function parseDouyinOpen(text: string): HotEntry[] {
  const j = JSON.parse(text) as { data?: { error_code?: number; description?: string; list?: { sentence?: string; hot_level?: number }[] }; extra?: { error_code?: number; description?: string } };
  const code = j.data?.error_code || j.extra?.error_code;
  if (code) throw new HotStatusError('network_error', `抖音开放平台返回错误 ${code}：${j.data?.description || j.extra?.description || ''}（请确认已申请 hotsearch 权限且 client_token 有效）`);
  return (j.data?.list ?? []).filter((x) => x.sentence).map((x, i) => ({ title: x.sentence!, rank: i + 1, heat: String(x.hot_level ?? ''), url: `https://www.douyin.com/search/${encodeURIComponent(x.sentence!)}` }));
}

const clientTokenCache = new Map<string, { token: string; exp: number }>();
export function clearDouyinTokenCache(): void { clientTokenCache.clear(); }

/** 获取抖音 client_token：优先用密钥库里的 douyin.client_token；否则用 client_key/secret 调官方 /oauth/client_token/（2 小时有效，缓存）。 */
export async function douyinClientToken(deps: HotDeps): Promise<string> {
  const direct = deps.vault.get('douyin.client_token');
  if (direct) return direct;
  const key = deps.vault.get('douyin.client_key');
  const secret = deps.vault.get('douyin.client_secret');
  if (!key || !secret) throw new HotStatusError('not_configured', '未配置：缺少 douyin.client_key / douyin.client_secret（或 douyin.client_token）');
  const c = clientTokenCache.get(key);
  if (c && c.exp > Date.now()) return c.token;
  const res = await deps.http('https://open.douyin.com/oauth/client_token/', {
    method: 'POST', timeoutMs: 15000, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_key: key, client_secret: secret, grant_type: 'client_credential' }),
  });
  let j: { data?: { access_token?: string; expires_in?: number | string; error_code?: number | string; description?: string } };
  try { j = JSON.parse(res.text) as typeof j; } catch { throw new HotStatusError('network_error', `获取 client_token 失败：返回 ${res.status}`); }
  if (!j.data?.access_token) throw new HotStatusError('not_configured', `获取 client_token 失败：${j.data?.error_code ?? res.status} ${j.data?.description ?? ''}`.trim());
  clientTokenCache.set(key, { token: j.data.access_token, exp: Date.now() + (Number(j.data.expires_in ?? 7200) - 300) * 1000 });
  return j.data.access_token;
}
export interface HotBoardResult { board: string; label: string; status: HotStatus; message?: string; items: HotEntry[]; fromCache: boolean; fetchedAt: string }

interface BoardDef {
  id: string;
  label: string;
  url: string | ((vault: SecretVault, cfg: Record<string, string>) => string);
  needsSecret?: string;
  /** 官方接口：自定义“是否已配置”判断（代替 needsSecret） */
  configured?: (vault: SecretVault) => boolean;
  /** 官方接口：异步生成鉴权头（如先换取 client_token） */
  auth?: (deps: HotDeps) => Promise<Record<string, string>>;
  proxy?: boolean;
  headers?: (vault: SecretVault) => Record<string, string>;
  parse: (text: string) => HotEntry[];
}

/** 公开热榜与官方接口。所有访问先检查 robots.txt，被禁止则如实标注，不绕过。 */
export const BOARDS: BoardDef[] = [
  {
    id: 'baidu', label: '百度热搜', url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime',
    parse(text) {
      const j = JSON.parse(text) as { data?: { cards?: { content?: { content?: { word?: string; url?: string; hotScore?: string; index?: number }[] }[] }[] } };
      const list = j.data?.cards?.[0]?.content?.flatMap((c) => c.content ?? []) ?? [];
      return list.filter((x) => x.word).map((x, i) => ({ title: x.word!, rank: i + 1, heat: x.hotScore, url: x.url }));
    },
  },
  {
    id: 'weibo', label: '微博热搜', url: 'https://weibo.com/ajax/side/hotSearch',
    parse(text) {
      const j = JSON.parse(text) as { data?: { realtime?: { word?: string; num?: number }[] } };
      return (j.data?.realtime ?? []).filter((x) => x.word).map((x, i) => ({ title: x.word!, rank: i + 1, heat: String(x.num ?? ''), url: `https://s.weibo.com/weibo?q=${encodeURIComponent('#' + x.word + '#')}` }));
    },
  },
  {
    id: 'zhihu', label: '知乎热榜', url: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50',
    parse(text) {
      const j = JSON.parse(text) as { data?: { target?: { title?: string; id?: number }; detail_text?: string }[] };
      return (j.data ?? []).filter((x) => x.target?.title).map((x, i) => ({ title: x.target!.title!, rank: i + 1, heat: x.detail_text, url: `https://www.zhihu.com/question/${x.target!.id}` }));
    },
  },
  {
    id: 'douyin', label: '抖音热榜（公开网页）', url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/',
    parse: parseDouyinWeb,
  },
  {
    id: 'douyin_open', label: '抖音热榜（开放平台官方接口）', url: 'https://open.douyin.com/hotsearch/sentences/',
    configured: (v) => v.has('douyin.client_token') || (v.has('douyin.client_key') && v.has('douyin.client_secret')),
    auth: async (deps) => ({ 'access-token': await douyinClientToken(deps), 'content-type': 'application/json' }),
    parse: parseDouyinOpen,
  },
  {
    id: 'bilibili', label: 'B 站热门', url: 'https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1',
    parse(text) {
      const j = JSON.parse(text) as { data?: { list?: { title?: string; bvid?: string; stat?: { view?: number } }[] } };
      return (j.data?.list ?? []).filter((x) => x.title).map((x, i) => ({ title: x.title!, rank: i + 1, heat: String(x.stat?.view ?? ''), url: `https://www.bilibili.com/video/${x.bvid}` }));
    },
  },
  {
    id: 'x_trends', label: 'X 趋势（官方 API）', needsSecret: 'x.bearer', proxy: true,
    url: (_v, cfg) => `https://api.x.com/2/trends/by/woeid/${encodeURIComponent(cfg.woeid || '1')}?max_trends=30`,
    headers: (v) => ({ authorization: `Bearer ${v.get('x.bearer') ?? ''}` }),
    parse(text) {
      const j = JSON.parse(text) as { data?: { trend_name?: string; tweet_count?: number }[] };
      return (j.data ?? []).filter((x) => x.trend_name).map((x, i) => ({ title: x.trend_name!, rank: i + 1, heat: String(x.tweet_count ?? ''), url: `https://x.com/search?q=${encodeURIComponent(x.trend_name!)}` }));
    },
  },
  {
    id: 'google_trends', label: 'Google Trends（官方 RSS）', proxy: true,
    url: (_v, cfg) => `https://trends.google.com/trending/rss?geo=${encodeURIComponent(cfg.geo || 'US')}`,
    parse(text) {
      return parseFeed(text).map((x, i) => ({ title: x.title, rank: i + 1, url: x.url }));
    },
  },
];

export interface HotDeps { db: DB; vault: SecretVault; http: HttpClient; limiter: HostRateLimiter; proxy?: string; cacheMinutes?: number; cfg?: Record<string, string> }

export function normTitle(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}#]+/gu, '');
}

export async function fetchBoard(deps: HotDeps, def: BoardDef, force = false): Promise<HotBoardResult> {
  const now = new Date().toISOString();
  const cacheMin = deps.cacheMinutes ?? 30;
  const base = { board: def.id, label: def.label };
  if (!force) {
    const last = deps.db.prepare("SELECT * FROM hot_runs WHERE board = ? AND status = 'ok' AND fetched_at >= ? ORDER BY id DESC LIMIT 1").get(def.id, new Date(Date.now() - cacheMin * 60000).toISOString()) as { fetched_at: string } | undefined;
    if (last) {
      const items = deps.db.prepare('SELECT title, rank, heat, url FROM hot_items WHERE board = ? AND fetched_at = ? ORDER BY rank').all(def.id, last.fetched_at) as unknown as HotEntry[];
      return { ...base, status: 'ok', items, fromCache: true, fetchedAt: last.fetched_at, message: `缓存数据（抓取于 ${last.fetched_at}）` };
    }
  }
  const finish = (status: HotStatus, items: HotEntry[], message?: string): HotBoardResult => {
    deps.db.prepare('INSERT INTO hot_runs(board, status, message, count, fetched_at) VALUES(?,?,?,?,?)').run(def.id, status, message ?? null, items.length, now);
    const ins = deps.db.prepare('INSERT INTO hot_items(board, title, norm, rank, heat, url, fetched_at) VALUES(?,?,?,?,?,?,?)');
    for (const it of items) ins.run(def.id, it.title, normTitle(it.title), it.rank ?? null, it.heat ?? null, it.url ?? null, now);
    return { ...base, status, items, fromCache: false, fetchedAt: now, message };
  };
  if (def.needsSecret && !deps.vault.has(def.needsSecret)) return finish('not_configured', [], `未配置：缺少 ${def.needsSecret}`);
  if (def.configured && !def.configured(deps.vault)) return finish('not_configured', [], '未配置：缺少 douyin.client_key / douyin.client_secret（或 douyin.client_token），需在抖音开放平台申请 hotsearch 权限');
  const url = typeof def.url === 'function' ? def.url(deps.vault, deps.cfg ?? {}) : def.url;
  const proxy = def.proxy ? deps.proxy : undefined;
  const official = Boolean(def.needsSecret || def.configured);
  try {
    if (!official) {
      const allowed = await checkRobots(url, deps.http, proxy);
      if (!allowed) return finish('robots_disallow', [], 'robots.txt 不允许通用程序访问该地址，已按规则跳过');
    }
    await deps.limiter.wait(url);
    let headers = def.headers?.(deps.vault) ?? { accept: 'application/json, text/xml, */*' };
    if (def.auth) {
      try { headers = { ...headers, ...(await def.auth(deps)) }; } catch (e) {
        if (e instanceof HotStatusError) return finish(e.status, [], e.message);
        throw e;
      }
    }
    // 只发送诚实的请求：固定的程序 UA，不带 Cookie、不伪造签名参数；gzip/br 由 HTTP 客户端自动解压
    const res = await deps.http(url, { proxy, timeoutMs: 15000, headers });
    if (res.status >= 400) return finish('network_error', [], `返回 ${res.status}`);
    let items: HotEntry[];
    try {
      items = def.parse(res.text).slice(0, 50);
    } catch (e) {
      if (e instanceof HotStatusError) return finish(e.status, [], e.message);
      return finish('parse_error', [], `解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!items.length) return finish('parse_error', [], '返回内容中没有热榜条目');
    return finish('ok', items);
  } catch (e) {
    return finish('network_error', [], e instanceof Error ? e.message : String(e));
  }
}

export async function fetchAllBoards(deps: HotDeps, enabled?: string[], force = false): Promise<HotBoardResult[]> {
  // 启用了抖音网页热榜时，同时尝试官方开放平台接口（未配置密钥则如实显示“未配置”）
  const ids = enabled && enabled.includes('douyin') && !enabled.includes('douyin_open') ? [...enabled, 'douyin_open'] : enabled;
  const defs = BOARDS.filter((b) => !ids || ids.includes(b.id));
  return Promise.all(defs.map((d) => fetchBoard(deps, d, force)));
}

export interface MergedHot { id: number; title: string; boards: { board: string; rank: number | null }[]; score: number }

/** 跨榜单归一合并：同名话题合并，按“出现榜单数 + 排名”打分。 */
export function mergeLatest(db: DB): MergedHot[] {
  const rows = db.prepare(`SELECT h.* FROM hot_items h JOIN (SELECT board, MAX(fetched_at) AS f FROM hot_runs WHERE status = 'ok' GROUP BY board) l ON h.board = l.board AND h.fetched_at = l.f`).all() as {
    id: number; board: string; title: string; norm: string; rank: number | null;
  }[];
  const map = new Map<string, MergedHot>();
  for (const r of rows) {
    const m = map.get(r.norm) ?? { id: r.id, title: r.title, boards: [], score: 0 };
    m.boards.push({ board: r.board, rank: r.rank });
    m.score += 10 + Math.max(0, 51 - (r.rank ?? 50)) / 5;
    map.set(r.norm, m);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

/** 关键词匹配，用于“热点出现”本地通知。 */
export function matchKeywords(hots: MergedHot[], keywords: string[]): MergedHot[] {
  const ks = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (!ks.length) return [];
  return hots.filter((h) => ks.some((k) => h.title.toLowerCase().includes(k)));
}

export interface Cluster { name: string; ids: number[] }

export async function clusterHots(hub: ModelHub, agent: AgentFiles, skill: Skill | undefined, hots: MergedHot[]): Promise<{ clusters: (Cluster & { titles: string[] })[]; provider: string; mock: boolean }> {
  const top = hots.slice(0, 60);
  if (!top.length) throw new Error('没有可聚类的热点，请先采集');
  const r = await hub.chat('hot_cluster', [
    { role: 'system', content: systemPrompt(agent, skill) },
    { role: 'user', content: `[TASK:hot_cluster]\n热点列表：\n${top.map((h) => `- [${h.id}] ${h.title}`).join('\n')}\n请做语义聚类，输出 JSON：{"clusters":[{"name","ids"}]}` },
  ]);
  const out = extractJson<{ clusters: Cluster[] }>(r.content);
  const byId = new Map(top.map((h) => [h.id, h.title]));
  return {
    clusters: (out.clusters ?? []).map((c) => ({ ...c, titles: (c.ids ?? []).map((i) => byId.get(i)).filter((x): x is string => Boolean(x)) })),
    provider: `${r.provider}/${r.model}`,
    mock: r.mock,
  };
}

export interface Research { title: string; background: string; audience: string; angles: { angle: string; platforms: string[] }[]; risks: string[]; action: string }

/** 深度调研：产出选题卡，写入选题库（来源“热点”）。 */
export async function researchCluster(db: DB, hub: ModelHub, agent: AgentFiles, skill: Skill | undefined, name: string, titles: string[]): Promise<{ topicId: number; research: Research }> {
  const r = await hub.chat('hot_research', [
    { role: 'system', content: systemPrompt(agent, skill) },
    { role: 'user', content: `[TASK:hot_research]\n话题簇：${name}\n相关热榜标题：\n${titles.map((t) => `- ${t}`).join('\n')}\n只能依据以上信息，事实需标注“需核实”。输出 JSON：{"title","background","audience","angles":[{"angle","platforms"}],"risks","action"}` },
  ]);
  const research = extractJson<Research>(r.content);
  const platforms = [...new Set((research.angles ?? []).flatMap((a) => a.platforms ?? []))];
  const topicId = Number(
    db.prepare("INSERT INTO topics(title, angle, platforms, reason, risk, item_ids, model, origin, research) VALUES(?,?,?,?,?,'[]',?, 'hot', ?)").run(
      research.title || name, research.angles?.[0]?.angle ?? '', JSON.stringify(platforms), research.background ?? '', (research.risks ?? []).join('；'), `${r.provider}/${r.model}`, JSON.stringify(research),
    ).lastInsertRowid,
  );
  agent.daily(`热点调研：「${name}」→ 选题卡 #${topicId}`);
  return { topicId, research };
}

export function lastRuns(db: DB): unknown[] {
  return (db.prepare('SELECT r.* FROM hot_runs r JOIN (SELECT board, MAX(id) AS m FROM hot_runs GROUP BY board) l ON r.id = l.m').all() as Record<string, unknown>[]).map((r) => ({ ...r, extra: parseJson(r.extra, null) }));
}
