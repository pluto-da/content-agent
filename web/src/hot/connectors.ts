/**
 * 可插拔数据源（0.8.0，修订 R1-a / R1-b）。每个连接器：testConnection() 与 fetchHot()，凭证从本机加密存储读取。
 * 只调用各服务**公开文档里写明**的接口；没有公开 API 的服务（千瓜、新红）不实现，界面标“暂不支持”。
 * 请求在 App 里经 CapacitorHttp 原生发出；网页版多数服务不允许跨域，会如实说明。
 */
import { classifyThrown, type RawHot } from '@content-agent/shared';
import { CONNECTORS, DOUYIN_OPEN } from '../data/hotSources';
import { readCred, setCredCheck } from '../local/secure';
import { runtime } from '../runtime';

export interface ConnResult { ok: boolean; reason?: string; ms?: number }
export interface Connector {
  id: string;
  label: string;
  route: 'a' | 'b';
  secretKeys: string[];
  test(cred: Record<string, string>): Promise<ConnResult>;
  fetchHot?(cred: Record<string, string>): Promise<RawHot[]>;
}

async function http(url: string, init: RequestInit, timeoutMs = 12000): Promise<{ status: number; json: any; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, json, text };
  } catch (e) {
    const f = classifyThrown(e, { web: runtime() !== 'capacitor', timedOut: ctl.signal.aborted, offline: typeof navigator !== 'undefined' && navigator.onLine === false });
    throw new Error(f.kind === 'cors' ? '网页版不能直接连接这个服务（跨域），请用 App' : f.kind === 'timeout' ? '网络超时' : f.reason, { cause: e });
  } finally { clearTimeout(t); }
}
const now = () => new Date().toISOString();

/** 今日热榜（榜眼数据）：https://www.tophubdata.com/documentation —— Authorization: <Key>；/nodes、/hot。 */
export const tophub: Connector = {
  id: 'tophub', label: '今日热榜', route: 'a', secretKeys: ['apiKey'],
  async test(c) {
    const t0 = Date.now();
    const r = await http('https://api.tophubdata.com/nodes?p=1', { headers: { Authorization: c.apiKey ?? '' } });
    if (r.status === 401 || r.json?.error === true && /Unauthorized|100201/.test(r.text)) return { ok: false, reason: 'Key 不对或已失效' };
    if (r.status >= 400 || r.json?.error === true) return { ok: false, reason: /100300|InsufficientFunds/.test(r.text) ? '账户余额不足' : `服务返回 ${r.status}` };
    return { ok: true, ms: Date.now() - t0 };
  },
  async fetchHot(c) {
    const r = await http('https://api.tophubdata.com/hot', { headers: { Authorization: c.apiKey ?? '' } });
    if (r.status >= 400 || r.json?.error === true) throw new Error(/100300/.test(r.text) ? '今日热榜账户余额不足' : `今日热榜返回 ${r.status}`);
    const list = (r.json?.data?.items ?? r.json?.data ?? []) as Record<string, any>[];
    return (Array.isArray(list) ? list : []).slice(0, 100).map((x, i) => ({
      title: String(x.title ?? ''), url: typeof x.url === 'string' ? x.url : undefined, rank: i + 1, heat: x.extra ?? x.hot,
      source: `今日热榜${x.node_name ? `·${x.node_name}` : ''}`, route: 'a', platform: '综合', fetchedAt: now(),
    })).filter((x) => x.title);
  },
};

/** 新榜数据 API：https://api.newrank.cn/ —— POST 表单 + Key 请求头。榜单接口路径由用户按自己的套餐文档填写（不预设、不编造）。 */
export const newrank: Connector = {
  id: 'newrank', label: '新榜', route: 'a', secretKeys: ['apiKey'],
  async test(c) {
    const t0 = Date.now();
    const r = await http('https://api.newrank.cn/api/sync/weixin/account/search', { method: 'POST', headers: { Key: c.apiKey ?? '', 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: 'keyword=%E6%96%B0%E6%A6%9C&page=1&size=1' });
    const code = Number(r.json?.code);
    if (code === 1103 || code === 1101 || code === 1102 || /Key/.test(String(r.json?.msg ?? '')) && code !== 0) return { ok: false, reason: `Key 无效（${r.json?.msg ?? r.status}）` };
    if (r.status >= 400) return { ok: false, reason: `服务返回 ${r.status}` };
    return { ok: true, ms: Date.now() - t0 };
  },
  async fetchHot(c) {
    const path = (c.path ?? '').trim();
    if (!/^\/api\/sync\/[a-z0-9/_-]+$/i.test(path)) throw new Error('还没填新榜榜单接口路径（按你的控制台文档填，例如 /api/sync/…）');
    const r = await http(`https://api.newrank.cn${path}`, { method: 'POST', headers: { Key: c.apiKey ?? '', 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: c.params ?? '' });
    if (r.status >= 400 || (r.json?.code !== undefined && Number(r.json.code) !== 0)) throw new Error(`新榜返回：${r.json?.msg ?? r.status}`);
    const list = (Array.isArray(r.json?.data) ? r.json.data : r.json?.data?.list ?? []) as Record<string, any>[];
    return list.slice(0, 50).map((x, i) => ({ title: String(x.title ?? x.name ?? ''), url: x.url ?? x.sourceUrl, rank: i + 1, source: '新榜', route: 'a', platform: 'wechat', fetchedAt: now() })).filter((x) => x.title);
  },
};

/** 抖音开放平台：POST /oauth/client_token/ → GET /hotsearch/sentences/（access-token 请求头）。 */
export const douyinOpen: Connector = {
  id: DOUYIN_OPEN.id, label: '抖音开放平台', route: 'b', secretKeys: ['clientKey', 'clientSecret'],
  async test(c) {
    const t0 = Date.now();
    await douyinToken(c);
    return { ok: true, ms: Date.now() - t0 };
  },
  async fetchHot(c) {
    const token = await douyinToken(c);
    const r = await http('https://open.douyin.com/hotsearch/sentences/', { headers: { 'access-token': token, 'content-type': 'application/json' } });
    const list = (r.json?.data?.list ?? []) as { sentence?: string; hot_level?: number }[];
    if (r.json?.data?.error_code) throw new Error(`抖音开放平台：${r.json.data.description || r.json.data.error_code}`);
    return list.slice(0, 50).map((x, i) => ({ title: String(x.sentence ?? ''), rank: i + 1, heat: x.hot_level, source: '抖音开放平台', route: 'b', platform: 'douyin', fetchedAt: now() })).filter((x) => x.title);
  },
};
async function douyinToken(c: Record<string, string>): Promise<string> {
  const r = await http('https://open.douyin.com/oauth/client_token/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credential', client_key: c.clientKey ?? '', client_secret: c.clientSecret ?? '' }) });
  const tok = r.json?.data?.access_token;
  if (!tok) throw new Error(`client_key / client_secret 不对或应用未开通（${r.json?.data?.description || r.json?.message || r.status}）`);
  return String(tok);
}

export const CONNECTOR_IMPLS: Record<string, Connector> = { tophub, newrank, [douyinOpen.id]: douyinOpen };
export const connectorMeta = (id: string) => CONNECTORS.find((c) => c.id === id);

/** 测试连接并记录结果（只记成功 / 失败与原因，不记 Key）。 */
export async function testConnector(id: string): Promise<ConnResult> {
  const impl = CONNECTOR_IMPLS[id];
  if (!impl) return { ok: false, reason: '暂不支持（没有公开 API）' };
  const cred = await readCred(id);
  if (!cred || impl.secretKeys.some((k) => !cred[k])) return { ok: false, reason: '还没填凭证' };
  let res: ConnResult;
  try { res = await impl.test(cred); } catch (e) { res = { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  await setCredCheck(id, { ok: res.ok, at: now(), reason: res.reason, ms: res.ms });
  return res;
}
