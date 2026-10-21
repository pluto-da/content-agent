import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { parseFeed, rssAdapter } from '../src/sources/rss.js';
import { parseRobots, isAllowedByRobots, extractFromHtml, webAdapter, clearRobotsCache, checkRobots } from '../src/sources/web.js';
import { wechatAdapter, xAdapter, douyinAdapter, clearWechatTokenCache } from '../src/sources/official.js';
import { SecretVault, loadMasterKey } from '../src/crypto.js';
import { HostRateLimiter } from '../src/http.js';
import { openDb } from '../src/db.js';
import { addSource, listSources, runSource, sourceStatus, Scheduler, recentRuns } from '../src/sources/index.js';
import { TaskQueue } from '../src/queue.js';
import { Logger } from '../src/logger.js';
import { fakeHttp, tmp } from './helpers.js';

const RSS = `<?xml version="1.0"?><rss><channel><item><title>A &amp; B</title><link>https://x.com/1</link><description>&lt;p&gt;hi&lt;/p&gt;</description><pubDate>Mon</pubDate></item><item><title>C</title><guid>https://x.com/2</guid></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link rel="alternate" href="https://y.com/a"/><updated>2026</updated><summary>s</summary></entry></feed>`;

function vault() {
  const d = tmp();
  return new SecretVault(join(d, 's.json'), loadMasterKey(join(d, 'k'), 'p'));
}
const limiter = new HostRateLimiter(0);

beforeEach(() => { clearRobotsCache(); clearWechatTokenCache(); });

describe('RSS', () => {
  it('解析 RSS 与 Atom、RDF', () => {
    expect(parseFeed(RSS)).toEqual([
      { title: 'A & B', url: 'https://x.com/1', summary: 'hi', publishedAt: 'Mon' },
      { title: 'C', url: 'https://x.com/2', summary: '', publishedAt: undefined },
    ]);
    expect(parseFeed(ATOM)[0]).toMatchObject({ title: 'T', url: 'https://y.com/a' });
    expect(parseFeed('<rdf:RDF><item><title>R</title><link>https://r</link></item></rdf:RDF>')[0]!.title).toBe('R');
    expect(() => parseFeed('<html></html>')).toThrow('无法识别');
  });
  it('适配器：成功、非公网、HTTP 错误', async () => {
    const http = fakeHttp([(u) => (u === 'https://feed.com/rss' ? { text: RSS } : u === 'https://bad.com/rss' ? { status: 500, text: '' } : undefined)]);
    const ctx = { http, vault: vault(), limiter };
    expect((await rssAdapter.fetch({ url: 'https://feed.com/rss' }, ctx)).items).toHaveLength(2);
    expect((await rssAdapter.fetch({ url: 'http://127.0.0.1/rss' }, ctx)).status).toBe('error');
    expect((await rssAdapter.fetch({ url: 'https://bad.com/rss' }, ctx)).message).toContain('500');
  });
});

describe('robots 与公开网页', () => {
  const robots = `User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: BadBot\nDisallow: /`;
  it('最长匹配优先', () => {
    const g = parseRobots(robots);
    expect(isAllowedByRobots(g, '/news')).toBe(true);
    expect(isAllowedByRobots(g, '/private/x')).toBe(false);
    expect(isAllowedByRobots(g, '/private/ok/1')).toBe(true);
    expect(isAllowedByRobots(g, '/news', 'BadBot/1.0')).toBe(false);
    expect(isAllowedByRobots(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/a.pdf')).toBe(false);
    expect(isAllowedByRobots([], '/x')).toBe(true);
  });
  it('抽取页面条目', () => {
    const html = '<html><head><title>页</title><meta name="description" content="描述"></head><body><ul class="l"><li><a href="/a">新闻A</a></li><li><a href="https://o.com/b">新闻B</a></li><li>无链接</li></ul></body></html>';
    expect(extractFromHtml(html, 'https://s.com/list')).toEqual([{ title: '页', url: 'https://s.com/list', summary: '描述' }]);
    expect(extractFromHtml(html, 'https://s.com/list', '.l li')).toEqual([{ title: '新闻A', url: 'https://s.com/a' }, { title: '新闻B', url: 'https://o.com/b' }]);
  });
  it('robots 禁止时跳过，5xx 保守禁止', async () => {
    const http = fakeHttp([
      (u) => (u === 'https://s.com/robots.txt' ? { text: 'User-agent: *\nDisallow: /private' } : undefined),
      (u) => (u.startsWith('https://s.com/') ? { text: '<title>ok</title>' } : undefined),
      (u) => (u === 'https://e.com/robots.txt' ? { status: 503, text: '' } : undefined),
    ]);
    const ctx = { http, vault: vault(), limiter };
    expect((await webAdapter.fetch({ url: 'https://s.com/private/1' }, ctx)).message).toContain('robots');
    expect((await webAdapter.fetch({ url: 'https://s.com/pub' }, ctx)).items[0]!.title).toBe('ok');
    expect(await checkRobots('https://e.com/x', http)).toBe(false);
    expect(await checkRobots('https://none.com/x', http)).toBe(true);
    expect((await webAdapter.fetch({ url: 'http://10.0.0.1' }, ctx)).status).toBe('error');
  });
});

describe('官方接口适配器', () => {
  it('未配置时返回未配置且不发请求', async () => {
    const http = fakeHttp([]);
    const ctx = { http, vault: vault(), limiter };
    for (const a of [wechatAdapter, xAdapter, douyinAdapter]) {
      const r = await a.fetch({ query: 'x' }, ctx);
      expect(r.status).toBe('not_configured');
      expect(r.items).toEqual([]);
    }
    expect(http.calls).toHaveLength(0);
  });
  it('公众号：取 token 后获取已发布文章', async () => {
    const v = vault();
    v.set('wechat.appid', 'wx1');
    v.set('wechat.secret', 's');
    const http = fakeHttp([
      (u) => (u.includes('stable_token') ? { text: JSON.stringify({ access_token: 'T', expires_in: 7200 }) } : undefined),
      (u) => (u.includes('freepublish/batchget') ? { text: JSON.stringify({ item: [{ update_time: 1700000000, content: { news_item: [{ title: '文', url: 'https://mp/1', digest: 'd' }] } }] }) } : undefined),
    ]);
    const r = await wechatAdapter.fetch({}, { http, vault: v, limiter });
    expect(r.items[0]).toMatchObject({ title: '文', url: 'https://mp/1' });
    const bad = fakeHttp([(u) => (u.includes('stable_token') ? { text: JSON.stringify({ errcode: 40164, errmsg: 'invalid ip' }) } : undefined)]);
    clearWechatTokenCache();
    expect((await wechatAdapter.fetch({}, { http: bad, vault: v, limiter })).message).toContain('40164');
  });
  it('X 与抖音', async () => {
    const v = vault();
    v.set('x.bearer', 'b');
    v.set('douyin.access_token', 'a');
    v.set('douyin.open_id', 'o');
    const http = fakeHttp([
      (u, o) => (u.includes('api.x.com') && o.headers?.authorization === 'Bearer b' ? { text: JSON.stringify({ data: [{ id: '1', text: 'hello world' }] }) } : undefined),
      (u) => (u.includes('open.douyin.com/video/list') ? { text: JSON.stringify({ data: { list: [{ title: '视频', share_url: 'https://d/1', create_time: 1700000000 }] } }) } : undefined),
    ]);
    const ctx = { http, vault: v, limiter };
    expect((await xAdapter.fetch({ query: 'ai' }, ctx)).items[0]!.url).toBe('https://x.com/i/status/1');
    expect((await xAdapter.fetch({ query: '' }, ctx)).status).toBe('error');
    expect((await douyinAdapter.fetch({}, ctx)).items[0]!.title).toBe('视频');
  });
});

describe('信息源注册与调度', () => {
  it('白名单、状态、运行入库、调度', async () => {
    const db = openDb(':memory:');
    const v = vault();
    const http = fakeHttp([(u) => (u === 'https://feed.com/rss' ? { text: RSS } : undefined)]);
    const ctx = { http, vault: v, limiter };
    expect(() => addSource(db, 'scraper', 'x', {})).toThrow('不允许');
    const id = addSource(db, 'rss', 'F', { url: 'https://feed.com/rss' }, 1);
    addSource(db, 'x_api', 'X', { query: 'a' });
    const [rss, x] = listSources(db);
    expect(sourceStatus(x!, ctx)).toEqual({ status: 'not_configured', missing: ['x.bearer'] });
    const q = new TaskQueue(db, new Logger(), 2, async () => {});
    const r = await runSource(db, q, ctx, rss!);
    expect(r.inserted).toBe(2);
    const rx = await runSource(db, q, ctx, x!);
    expect(rx.status).toBe('not_configured');
    expect(recentRuns(db)).toHaveLength(2);
    const sch = new Scheduler(db, q, ctx);
    expect(sch.due(Date.now()).map((s) => s.id)).not.toContain(id);
    expect(sch.due(Date.now() + 3600_000).map((s) => s.id)).toContain(id);
    expect(await sch.tick()).toBe(0);
    sch.start(1_000_000);
    sch.stop();
  });
});
