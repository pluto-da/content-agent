import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, CSP, type AppContext } from '../src/app.js';
import { CAPABILITIES } from '../src/models/types.js';
import { clearRobotsCache } from '../src/sources/web.js';
import { AGENT_DEFAULTS, fakeHttp, tmp } from './helpers.js';
import { parseSkill, loadSkills, missingCapabilities, parseFrontMatter } from '../src/skills/loader.js';
import { validateManifest, PLUGINS, enabledFor, enabledPlatforms, enabledHotBoards } from '../src/modules/plugins.js';
import { isAllowedCreatorUrl, xIntentUrl } from '../src/modules/handoff.js';
import { judge } from '../src/modules/evals.js';
import { normTitle, matchKeywords } from '../src/modules/hot.js';

const RSS = `<rss><channel><item><title>大模型价格战再升级</title><link>https://n.com/1</link></item><item><title>县城电商新玩法</title><link>https://n.com/2</link></item></channel></rss>`;
const http = fakeHttp([
  (u) => (u === 'https://n.com/rss' ? { text: RSS } : undefined),
  (u) => (u.startsWith('https://top.baidu.com/robots.txt') ? { status: 404, text: '' } : undefined),
  (u) => (u.startsWith('https://top.baidu.com/api/board') ? { text: JSON.stringify({ data: { cards: [{ content: [{ content: [{ word: '大模型降价', hotScore: '100' }, { word: '秋收', hotScore: '90' }] }] }] } }) } : undefined),
  (u) => (u === 'https://weibo.com/robots.txt' ? { text: 'User-agent: *\nDisallow: /' } : undefined),
  (u) => (u.endsWith('/robots.txt') ? { status: 404, text: '' } : undefined),
  (u) => (u.includes('douyin.com/aweme') ? { text: '' } : undefined),
  (u) => (u.includes('bilibili') ? { status: 412, text: '' } : undefined),
  (u) => (u.includes('zhihu') ? { text: JSON.stringify({ data: [] }) } : undefined),
  (u) => (u.includes('trends.google.com') ? { text: '<rss><channel><item><title>AI</title><link>https://g/1</link></item></channel></rss>' } : undefined),
  (u) => (u.includes('stable_token') ? { text: JSON.stringify({ access_token: 'T' }) } : undefined),
  (u) => (u.includes('draft/add') ? { text: JSON.stringify({ media_id: 'MID' }) } : undefined),
]);

let app: FastifyInstance;
let ctx: AppContext;
const dataDir = tmp('ca-app-');
const req = async (method: string, url: string, payload?: unknown, headers?: Record<string, string>) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as never, headers });
  return { status: r.statusCode, body: r.json() as Record<string, any>, headers: r.headers };
};

beforeAll(async () => {
  clearRobotsCache();
  ({ app, ctx } = await buildApp({ dataDir, agentDefaultsDir: AGENT_DEFAULTS, http, rateLimitMs: 0 }));
});
afterAll(async () => { await app.close(); });

describe('API 全流程（mock 模型）', () => {
  it('健康检查、边界、CSP 头', async () => {
    const r = await req('GET', '/api/health');
    expect(r.body.ok).toBe(true);
    expect(r.headers['content-security-policy']).toBe(CSP);
    expect((await req('GET', '/api/boundaries')).body.boundaries.length).toBeGreaterThan(5);
  });
  it('未配置模型时返回 409 未配置', async () => {
    const r = await req('POST', '/api/models/test/llm');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('not_configured');
  });
  it('设置、密钥（不回显明文）、代理校验', async () => {
    expect((await req('PUT', '/api/settings', { proxy: 'bad' })).status).toBe(400);
    expect((await req('PUT', '/api/settings', { proxy: 'http://127.0.0.1:7890', hotKeywords: ['大模型'], crawlMinIntervalMs: 10, hotGeo: 'CN', xWoeid: 'a1' })).body.ok).toBe(true);
    const s = await req('PUT', '/api/secrets/x.bearer', { value: 'SECRET-TOKEN-1234' });
    expect(s.body.hint).toBe('••••1234');
    expect((await req('PUT', '/api/secrets/evil', { value: 'x' })).status).toBe(400);
    const g = await req('GET', '/api/settings');
    expect(JSON.stringify(g.body)).not.toContain('SECRET-TOKEN');
    await req('PUT', '/api/secrets/x.bearer', { value: '' });
    await req('PUT', '/api/settings', { proxy: '' });
  });
  it('模型设置接口', async () => {
    expect((await req('PUT', '/api/models/routes', { routes: Object.fromEntries(CAPABILITIES.map((c) => [c, { default: { provider: 'mock' } }])) })).body.status.every((s: any) => s.configured)).toBe(true);
    expect((await req('PUT', '/api/models/providers/openai', { baseURL: 'http://127.0.0.1' })).status).toBe(400);
    expect((await req('PUT', '/api/models/providers/ollama', { baseURL: 'http://localhost:11434/v1', models: { llm: 'qwen3' } })).body.ok).toBe(true);
    expect((await req('PUT', '/api/models/providers/none', {})).status).toBe(404);
    expect((await req('PUT', '/api/models/prices', { prices: { mock: { input: 1 } } })).body.ok).toBe(true);
    expect((await req('PUT', '/api/models/comfyui-workflow', { workflow: 'nope' })).status).toBe(400);
    expect((await req('PUT', '/api/models/comfyui-workflow', { workflow: '{"a":"{{prompt}}"}' })).body.ok).toBe(true);
    for (const c of ['llm', 'embedding', 'image', 'tts']) expect((await req('POST', `/api/models/test/${c}`)).body.mock).toBe(true);
    expect((await req('POST', '/api/models/test/video')).status).toBe(400);
    const m = await req('GET', '/api/models');
    expect(m.body.providers.length).toBeGreaterThanOrEqual(13);
  });
  it('信息源 → 内容库 → 选题 → 改写（含配图/配音/字幕）→ 审核 → 交接', async () => {
    expect((await req('POST', '/api/sources', { kind: 'scraper' })).status).toBe(400);
    const { body: { id } } = await req('POST', '/api/sources', { kind: 'rss', name: 'N', config: { url: 'https://n.com/rss' } });
    await req('POST', '/api/sources', { kind: 'wechat_mp', name: 'W' });
    const src = await req('GET', '/api/sources');
    expect(src.body.sources.find((s: any) => s.kind === 'wechat_mp').status).toBe('not_configured');
    expect((await req('POST', `/api/sources/${id}/run`)).body.inserted).toBe(2);
    expect((await req('POST', '/api/sources/999/run')).status).toBe(404);
    expect((await req('GET', '/api/items?search=大模型')).body.items).toHaveLength(1);
    expect((await req('POST', '/api/items/semantic-search', { query: '大模型' })).body.items[0].title).toContain('大模型');
    const t = await req('POST', '/api/topics/generate', {});
    expect(t.body.topicIds.length).toBeGreaterThan(0);
    const topics = await req('GET', '/api/topics');
    expect(topics.body.topics[0].platforms).toContain('xiaohongshu');
    const plats = await req('GET', '/api/platforms?device=phone');
    expect(plats.body.platforms).toHaveLength(8);
    expect((await req('POST', '/api/rewrite', { topicId: t.body.topicIds[0], platforms: [] })).status).toBe(400);
    const rw = await req('POST', '/api/rewrite', { topicId: t.body.topicIds[0], platforms: ['xiaohongshu', 'douyin_script', 'wechat_article'] });
    const [xhs, dy, wx] = rw.body.results;
    expect(xhs.steps.filter((s: any) => s.step.startsWith('配图'))).toHaveLength(3);
    expect(dy.steps.map((s: any) => s.step).slice(0, 3)).toEqual(['文本生成', '配音', '字幕']);
    const d = await req('GET', `/api/drafts/${dy.draftId}`);
    const srt = d.body.draft.assets.find((a: any) => a.type === 'subtitle').url;
    const srtRes = await app.inject({ method: 'GET', url: srt });
    expect(srtRes.body).toContain('-->');
    expect((await app.inject({ method: 'GET', url: '/api/media/1/../../x' })).statusCode).toBeGreaterThanOrEqual(400);
    // 审核
    expect((await req('PUT', `/api/drafts/${xhs.draftId}`, { body: '' })).status).toBe(400);
    await req('PUT', `/api/drafts/${xhs.draftId}`, { body: '改过的正文 全网最低', note: '人工' });
    const edited = await req('GET', `/api/drafts/${xhs.draftId}`);
    expect(edited.body.edits).toHaveLength(1);
    expect(edited.body.draft.compliance.some((c: any) => c.rule === '极限用语')).toBe(true);
    expect((await req('POST', `/api/drafts/${xhs.draftId}/handoff/copy`)).status).toBe(400);
    expect((await req('POST', `/api/drafts/${xhs.draftId}/status`, { status: 'handed_off' })).status).toBe(400);
    await req('POST', `/api/drafts/${xhs.draftId}/status`, { status: 'approved' });
    const card = await req('GET', `/api/drafts/${xhs.draftId}/handoff`);
    expect(card.body.center.url).toBe('https://creator.xiaohongshu.com/');
    expect(card.body.lastStep).toContain('本人');
    expect((await req('POST', `/api/drafts/${xhs.draftId}/handoff/copy`)).body.ok).toBe(true);
    expect((await req('GET', `/api/drafts/${xhs.draftId}`)).body.draft.status).toBe('handed_off');
    // 公众号草稿箱：未配置 → 配置后成功
    await req('POST', `/api/drafts/${wx.draftId}/status`, { status: 'approved' });
    expect((await req('GET', `/api/drafts/${wx.draftId}/handoff`)).body.canPushWechatDraft).toBe(false);
    const fail = await req('POST', `/api/drafts/${wx.draftId}/handoff/wechat-draft`);
    expect(fail.status).toBe(409);
    for (const [k, v] of [['wechat.appid', 'a'], ['wechat.secret', 's'], ['wechat.thumb_media_id', 't']]) await req('PUT', `/api/secrets/${k}`, { value: v });
    const ok = await req('POST', `/api/drafts/${wx.draftId}/handoff/wechat-draft`);
    expect(ok.body.media_id).toBe('MID');
    expect(ok.body.lastStep).toContain('本人');
    expect((await req('GET', '/api/drafts?status=handed_off')).body.drafts).toHaveLength(2);
    expect((await req('GET', '/api/creator-centers')).body.centers).toHaveLength(7);
  });
  it('回复草稿只生成不发送', async () => {
    expect((await req('POST', '/api/replies/draft', {})).status).toBe(400);
    const r = await req('POST', '/api/replies/draft', { comment: '多少钱？' });
    expect(r.body.notice).toContain('本人');
  });
  it('热点：robots 禁止与失败如实标注，缓存，聚类，调研选题卡', async () => {
    const r = await req('POST', '/api/hot/fetch', { force: true });
    const by = Object.fromEntries(r.body.results.map((x: any) => [x.board, x]));
    expect(by.baidu.status).toBe('ok');
    expect(by.weibo.status).toBe('robots_disallow');
    expect(by.douyin.status).toBe('needs_official_api');
    expect(by.bilibili.status).toBe('network_error');
    expect(by.x_trends.status).toBe('not_configured');
    expect(by.google_trends.status).toBe('ok');
    const cached = await req('POST', '/api/hot/fetch', {});
    expect(cached.body.results.find((x: any) => x.board === 'baidu').fromCache).toBe(true);
    const hot = await req('GET', '/api/hot');
    expect(hot.body.matched[0].title).toBe('大模型降价');
    const cl = await req('POST', '/api/hot/cluster');
    expect(cl.body.clusters.length).toBeGreaterThan(0);
    expect((await req('POST', '/api/hot/research', {})).status).toBe(400);
    const rs = await req('POST', '/api/hot/research', { name: cl.body.clusters[0].name, titles: cl.body.clusters[0].titles });
    expect(rs.body.research.angles.length).toBe(3);
    const topics = (await req('GET', '/api/topics')).body.topics;
    expect(topics.find((t: any) => t.id === rs.body.topicId).origin).toBe('hot');
    const n = await req('GET', '/api/notifications');
    expect(n.body.hotMatches).toContain('大模型降价');
    expect(n.body.pendingDrafts).toBeGreaterThan(0);
  });
  it('复盘 CSV', async () => {
    expect((await req('POST', '/api/analytics/import', {})).status).toBe(400);
    expect((await req('POST', '/api/analytics/import', { csv: 'a\n1' })).status).toBe(400);
    const r = await req('POST', '/api/analytics/import', { csv: '标题,播放量,点赞\nA,100,10\n', platform: 'douyin' });
    expect(r.body.rows).toBe(1);
    expect((await req('GET', '/api/analytics/summary')).body.count).toBe(1);
    expect((await req('POST', '/api/analytics/review', {})).body.review).toContain('模拟');
  });
  it('系统文件：编辑、版本、回滚、改进日志、记忆、APPROVAL', async () => {
    const files = await req('GET', '/api/agent/files');
    expect(files.body.files).toEqual(expect.arrayContaining(['soul.md', 'working-method.md', 'USER.md', 'APPROVAL.md', 'skills/xiaohongshu-note.md']));
    expect(files.body.approval).toEqual(expect.arrayContaining(['publish', 'reply', 'wechat_draft']));
    expect(files.body.memory.some((m: any) => m.path.startsWith('memory/daily/'))).toBe(true);
    const wm = await req('GET', '/api/agent/file?path=working-method.md');
    expect(wm.body.content).toContain('第十三条');
    expect((await req('GET', '/api/agent/file?path=../secrets.enc.json')).status).toBe(400);
    const v1 = (await req('GET', '/api/agent/file?path=soul.md')).body.history[0].id;
    const w = await req('PUT', '/api/agent/file', { path: 'soul.md', content: '# 新 soul', reason: '测试' });
    expect(w.body.version.active).toBe(1);
    expect((await req('PUT', '/api/agent/file', { path: 'skills/bad.md', content: '---\nname: bad\ndescription: x\ntools: [auto_click]\n---\nbody' })).status).toBe(400);
    const rb = await req('POST', `/api/versions/${v1}/rollback`, { reason: '回退' });
    expect(rb.body.version.kind).toBe('rollback');
    expect((await req('GET', '/api/agent/file?path=soul.md')).body.content).toContain('soul.md');
    expect((await req('POST', '/api/versions/99999/rollback')).status).toBe(400);
    expect((await req('GET', `/api/versions/${v1}`)).body.version.target).toBe('soul.md');
    expect((await req('GET', '/api/versions')).body.versions.length).toBeGreaterThan(3);
    expect((await req('GET', '/api/improvement-log')).body.content).toContain('回滚');
    const mem = files.body.memory.find((m: any) => m.path.startsWith('memory/daily/'));
    expect((await req('GET', `/api/agent/memory?path=${mem.path}`)).body.content).toContain('改写草稿');
    expect((await req('GET', '/api/agent/memory?path=soul.md')).status).toBe(400);
    expect(ctx.agent.needsApproval('publish')).toBe(true);
    expect(ctx.agent.writeTopic('写作经验', { text: '标题具体更好', kind: 'hypothesis', source: '复盘' })).toContain('memory/topics/');
  });
  it('skills 与 A/B 评测', async () => {
    const s = await req('GET', '/api/skills');
    expect(s.body.skills.length).toBe(15);
    expect(s.body.errors).toEqual([]);
    expect(s.body.skills.find((x: any) => x.name === 'douyin-script').models).toEqual(['llm', 'tts', 'asr']);
    expect((await req('GET', '/api/evals/benchmark')).body.cases.length).toBeGreaterThanOrEqual(7);
    const path = 'skills/xiaohongshu-note.md';
    const orig = (await req('GET', `/api/agent/file?path=${path}`)).body;
    const vA = orig.history[0].id;
    const vB = (await req('PUT', '/api/agent/file', { path, content: orig.content.replace('version: 1', 'version: 2'), reason: '候选版本' })).body.version.id;
    const ab = await req('POST', '/api/evals/ab', { a: vA, b: vB });
    expect(ab.body.A.passRate).toBeTypeOf('number');
    expect(ab.body.cases).toBe(2);
    expect((await req('POST', '/api/evals/ab', { a: vA, b: 1 })).status).toBe(400);
  });
  it('插件管理按终端', async () => {
    const p = await req('GET', '/api/plugins?device=phone');
    expect(p.body.enabled.length).toBe(PLUGINS.length);
    await req('PUT', '/api/plugins', { device: 'phone', enabled: ['xiaohongshu', 'fake'] });
    expect((await req('GET', '/api/plugins?device=phone')).body.enabled).toEqual(['xiaohongshu']);
    expect((await req('GET', '/api/platforms?device=phone')).body.platforms.map((x: any) => x.id)).toEqual(['xiaohongshu']);
    expect((await req('GET', '/api/plugins?device=desktop')).body.enabled.length).toBe(PLUGINS.length);
    await req('PUT', '/api/plugins', { device: 'phone', enabled: PLUGINS.map((x) => x.id) });
  });
  it('任务面板、日志、成本', async () => {
    const t = await req('GET', '/api/tasks');
    expect(t.body.stats.succeeded).toBeGreaterThan(3);
    const l = await req('GET', '/api/logs');
    expect(JSON.stringify(l.body)).not.toContain('SECRET-TOKEN');
    const c = await req('GET', '/api/models/costs?days=7');
    expect(c.body.total).toBeGreaterThan(0);
  });
  it('备份导出（不含密钥）与导入恢复', async () => {
    const ex = await app.inject({ method: 'GET', url: '/api/backup/export' });
    const data = ex.json() as any;
    expect(ex.body).not.toContain('SECRET-TOKEN');
    expect(data.tables.drafts.length).toBeGreaterThan(0);
    expect((await req('POST', '/api/backup/import', { nope: 1 })).status).toBe(400);
    const im = await req('POST', '/api/backup/import', data);
    expect(im.body.restored.drafts).toBe(data.tables.drafts.length);
    expect(existsSync(im.body.autoBackup)).toBe(true);
    expect(readFileSync(join(dataDir, 'secrets.enc.json'), 'utf8')).not.toContain('"a"');
  });
  it('访问口令', async () => {
    const { app: a2 } = await buildApp({ dataDir: tmp('ca-tok-'), agentDefaultsDir: AGENT_DEFAULTS, http, accessToken: 'pw123' });
    expect((await a2.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
    expect((await a2.inject({ method: 'GET', url: '/api/settings', headers: { 'x-access-token': 'pw123' } })).statusCode).toBe(200);
    expect((await a2.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    await a2.close();
  });
});

describe('skill 加载器', () => {
  it('校验字段、工具、能力、禁止关键字', () => {
    expect(() => parseFrontMatter('no header')).toThrow();
    expect(parseSkill('---\nname: a\ndescription: d\ntools: [llm.chat]\nmodels: [llm, image]\n---\nbody', 'a.md').models).toEqual(['llm', 'image']);
    expect(() => parseSkill('---\ndescription: d\n---\nb', 'x')).toThrow('name');
    expect(() => parseSkill('---\nname: a\n---\nb', 'x')).toThrow('description');
    expect(() => parseSkill('---\nname: a\ndescription: d\nmodels: [telepathy]\n---\nb', 'x')).toThrow('未知');
    expect(() => parseSkill('---\nname: a\ndescription: d\n---\nuse human_click', 'x')).toThrow('禁止');
    const sk = parseSkill('---\nname: a\ndescription: d\nmodels: [llm, video]\n---\nb', 'x');
    expect(missingCapabilities(sk, (c) => c === 'llm')).toEqual(['video']);
    expect(loadSkills('/nonexistent').skills).toEqual([]);
    expect(loadSkills(join(AGENT_DEFAULTS, 'skills')).errors).toEqual([]);
  });
});

describe('插件、创作中心、评测判定、热点工具', () => {
  it('插件清单校验', () => {
    for (const p of PLUGINS) expect(validateManifest(p)).toEqual([]);
    expect(validateManifest({ id: 'Bad Id', label: 'x', provides: ['auto_publish' as never], devices: ['web'], description: 'auto_like' })).toHaveLength(3);
    expect(enabledFor({}, 'web').length).toBe(PLUGINS.length);
    expect(enabledPlatforms({ phone: ['x'] }, 'phone')).toEqual(['x_post']);
    expect(enabledHotBoards({ phone: ['hot_cn'] }, 'phone')).toEqual(['baidu', 'weibo', 'zhihu', 'bilibili']);
  });
  it('创作中心域名白名单与 X 意图链接', () => {
    expect(isAllowedCreatorUrl('https://creator.douyin.com/x')).toBe(true);
    expect(isAllowedCreatorUrl('https://evil.com/creator.douyin.com')).toBe(false);
    expect(isAllowedCreatorUrl('http://creator.douyin.com')).toBe(false);
    expect(isAllowedCreatorUrl('nope')).toBe(false);
    expect(xIntentUrl('你好 #AI')).toBe('https://x.com/intent/post?text=%E4%BD%A0%E5%A5%BD%20%23AI');
  });
  it('评测判定', () => {
    expect(judge({ id: '1', platform: 'x', topic: 't', checks: { minLen: 5, maxLen: 10, mustInclude: ['a'], forbid: ['b'], requireTitle: true, noComplianceWarn: true } }, { body: 'b 全网最低价' }).failures).toHaveLength(4);
    expect(judge({ id: '1', platform: 'x', topic: 't', checks: { minLen: 1 } }, { body: 'ok' }).passed).toBe(true);
  });
  it('热点归一与关键词', () => {
    expect(normTitle('#大模型 降价！#')).toBe('大模型降价');
    expect(matchKeywords([{ id: 1, title: 'AI 新闻', boards: [], score: 1 }], [' ai ', ''])).toHaveLength(1);
    expect(matchKeywords([], [])).toEqual([]);
  });
});
