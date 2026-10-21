import type { SourceAdapter, SourceContext } from './types.js';
import { errorResult, missingSecrets, notConfigured } from './types.js';
import type { HttpClient } from '../http.js';

/* ---------------- 微信公众号（官方接口） ---------------- */

const WX_API = 'https://api.weixin.qq.com';
const tokenCache = new Map<string, { token: string; exp: number }>();

/** 获取稳定版 access_token（POST /cgi-bin/stable_token）。需在微信开发者平台把出口 IP 加入白名单。 */
export async function wechatAccessToken(appid: string, secret: string, http: HttpClient): Promise<string> {
  const c = tokenCache.get(appid);
  if (c && c.exp > Date.now() + 60_000) return c.token;
  const res = await http(`${WX_API}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid, secret }),
  });
  const json = JSON.parse(res.text) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!json.access_token) throw new Error(`获取 access_token 失败：${json.errcode ?? res.status} ${json.errmsg ?? ''}`.trim());
  tokenCache.set(appid, { token: json.access_token, exp: Date.now() + (json.expires_in ?? 7200) * 1000 });
  return json.access_token;
}

export function clearWechatTokenCache(): void {
  tokenCache.clear();
}

export const wechatAdapter: SourceAdapter = {
  kind: 'wechat_mp',
  label: '微信公众号（官方接口：本人已发布文章）',
  requiredSecrets: ['wechat.appid', 'wechat.secret'],
  configFields: [{ key: 'count', label: '每次获取篇数', placeholder: '10' }],
  async fetch(config, ctx: SourceContext) {
    const missing = missingSecrets(this, ctx.vault);
    if (missing.length) return notConfigured(missing);
    try {
      const token = await wechatAccessToken(ctx.vault.get('wechat.appid')!, ctx.vault.get('wechat.secret')!, ctx.http);
      const res = await ctx.http(`${WX_API}/cgi-bin/freepublish/batchget?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offset: 0, count: Math.min(Number(config.count ?? 10) || 10, 20), no_content: 1 }),
      });
      const json = JSON.parse(res.text) as {
        errcode?: number;
        errmsg?: string;
        item?: { update_time?: number; content?: { news_item?: { title?: string; url?: string; digest?: string }[] } }[];
      };
      if (json.errcode) return { status: 'error', items: [], message: `公众号接口错误 ${json.errcode} ${json.errmsg ?? ''}` };
      const items = (json.item ?? []).flatMap((it) =>
        (it.content?.news_item ?? []).map((n) => ({
          title: n.title ?? '',
          url: n.url,
          summary: n.digest,
          publishedAt: it.update_time ? new Date(it.update_time * 1000).toISOString() : undefined,
        })),
      );
      return { status: 'ok', items };
    } catch (e) {
      return errorResult(e);
    }
  },
};

/* ---------------- X API v2（官方，按量计费） ---------------- */

export const xAdapter: SourceAdapter = {
  kind: 'x_api',
  label: 'X API v2（近 7 天公开帖子搜索）',
  requiredSecrets: ['x.bearer'],
  configFields: [{ key: 'query', label: '搜索词', placeholder: 'AI lang:zh -is:retweet' }],
  async fetch(config, ctx) {
    const missing = missingSecrets(this, ctx.vault);
    if (missing.length) return notConfigured(missing);
    const query = String(config.query ?? '').trim();
    if (!query) return { status: 'error', items: [], message: '未填写搜索词' };
    try {
      const url = `https://api.x.com/2/tweets/search/recent?max_results=10&tweet.fields=created_at,author_id&query=${encodeURIComponent(query)}`;
      const res = await ctx.http(url, { headers: { authorization: `Bearer ${ctx.vault.get('x.bearer')!}` }, proxy: ctx.proxy });
      if (res.status >= 400) return { status: 'error', items: [], message: `X API 返回 ${res.status}: ${res.text.slice(0, 160)}` };
      const json = JSON.parse(res.text) as { data?: { id: string; text: string; created_at?: string }[] };
      return {
        status: 'ok',
        items: (json.data ?? []).map((t) => ({ title: t.text.slice(0, 80), summary: t.text, url: `https://x.com/i/status/${t.id}`, publishedAt: t.created_at })),
      };
    } catch (e) {
      return errorResult(e);
    }
  },
};

/* ---------------- 抖音开放平台（官方，需用户授权与能力审批） ---------------- */

export const douyinAdapter: SourceAdapter = {
  kind: 'douyin_open',
  label: '抖音开放平台（本人授权账号的视频列表）',
  requiredSecrets: ['douyin.access_token', 'douyin.open_id'],
  configFields: [{ key: 'count', label: '每次获取条数', placeholder: '10' }],
  async fetch(config, ctx) {
    const missing = missingSecrets(this, ctx.vault);
    if (missing.length) return notConfigured(missing);
    try {
      const count = Math.min(Number(config.count ?? 10) || 10, 20);
      const url = `https://open.douyin.com/video/list/?open_id=${encodeURIComponent(ctx.vault.get('douyin.open_id')!)}&cursor=0&count=${count}`;
      const res = await ctx.http(url, { headers: { 'access-token': ctx.vault.get('douyin.access_token')!, 'content-type': 'application/json' } });
      const json = JSON.parse(res.text) as {
        data?: { error_code?: number; description?: string; list?: { title?: string; share_url?: string; create_time?: number; statistics?: Record<string, number> }[] };
      };
      if (json.data?.error_code) return { status: 'error', items: [], message: `抖音接口错误 ${json.data.error_code} ${json.data.description ?? ''}` };
      return {
        status: 'ok',
        items: (json.data?.list ?? []).map((v) => ({
          title: v.title ?? '(无标题)',
          url: v.share_url,
          publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : undefined,
          extra: { statistics: v.statistics },
        })),
      };
    } catch (e) {
      return errorResult(e);
    }
  },
};
