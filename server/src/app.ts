import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { openDb, getSetting, setSetting, type DB } from './db.js';
import { loadMasterKey, SecretVault } from './crypto.js';
import { defaultHttp, HostRateLimiter, isPublicHttpUrl, type HttpClient } from './http.js';
import { Logger } from './logger.js';
import { TaskQueue } from './queue.js';
import { HARD_BOUNDARIES, ALLOWED_TOOLS } from './boundaries.js';
import { ModelHub, type Routes } from './models/hub.js';
import { CAPABILITIES, CAPABILITY_LABELS, NotConfiguredError } from './models/types.js';
import { loadSkills, missingCapabilities } from './skills/loader.js';
import { AgentFiles } from './modules/agentfiles.js';
import { ADAPTERS, addSource, listSources, recentRuns, runSource, sourceStatus, Scheduler } from './sources/index.js';
import type { SourceContext } from './sources/types.js';
import { listItems } from './modules/library.js';
import { PLATFORMS, isPlatform, generateTopics, listTopics, rewrite, listDrafts, getDraft, editDraft, setDraftStatus, draftEdits, replyDraft, type Deps, type DraftStatus } from './modules/content.js';
import { CREATOR_CENTERS, handoffCard, markCopied, pushWechatDraft } from './modules/handoff.js';
import { importCsv, summarize } from './modules/analytics.js';
import { BOARDS, fetchAllBoards, mergeLatest, matchKeywords, clusterHots, researchCluster, lastRuns } from './modules/hot.js';
import { PLUGINS, enabledFor, type Device, type EnabledMap } from './modules/plugins.js';
import { exportBackup, importBackup } from './modules/backup.js';
import { abTest, loadBenchmark } from './modules/evals.js';

export interface AppOptions {
  dataDir: string;
  agentDefaultsDir: string;
  webDist?: string;
  http?: HttpClient;
  accessToken?: string;
  rateLimitMs?: number;
  logEcho?: boolean;
  pollMs?: number;
}

export interface AppContext {
  db: DB; vault: SecretVault; hub: ModelHub; agent: AgentFiles; queue: TaskQueue; logger: Logger; limiter: HostRateLimiter; http: HttpClient; deps: Deps; sourceCtx: () => SourceContext; scheduler: Scheduler;
}

/** 统一错误：错误码 + 中文说明 + 建议动作。 */
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly advice = '') {
    super(message);
  }
}

export const SECRET_NAMES = [
  'wechat.appid', 'wechat.secret', 'wechat.thumb_media_id', 'x.bearer', 'douyin.access_token', 'douyin.open_id',
  'model.dashscope.key', 'model.deepseek.key', 'model.zhipu.key', 'model.ark.key', 'model.minimax.key', 'model.kimi.key',
  'model.openai.key', 'model.anthropic.key', 'model.gemini.key', 'model.elevenlabs.key',
];

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self'; frame-src https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const db = openDb(join(opts.dataDir, 'content-agent.db'));
  const vault = new SecretVault(join(opts.dataDir, 'secrets.enc.json'), loadMasterKey(join(opts.dataDir, 'master.key')));
  const http = opts.http ?? defaultHttp;
  const logger = new Logger(join(opts.dataDir, 'logs', 'app.jsonl'), 1000, opts.logEcho ?? false);
  const queue = new TaskQueue(db, logger, 3);
  const limiter = new HostRateLimiter(opts.rateLimitMs ?? getSetting<number>(db, 'crawl.minIntervalMs', 5000));
  const hub = new ModelHub(db, vault, http, { pollMs: opts.pollMs });
  const agent = new AgentFiles(db, join(opts.dataDir, 'agent'));
  agent.init(opts.agentDefaultsDir);
  const skills = () => loadSkills(join(agent.dir, 'skills')).skills;
  const deps: Deps = { db, hub, agent, skills, mediaDir: join(opts.dataDir, 'media') };
  const sourceCtx = (): SourceContext => ({ http, vault, limiter, proxy: getSetting<string>(db, 'proxy.url', '') || undefined });
  const scheduler = new Scheduler(db, queue, sourceCtx());
  const ctx: AppContext = { db, vault, hub, agent, queue, logger, limiter, http, deps, sourceCtx, scheduler };

  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  const token = opts.accessToken ?? process.env.CA_ACCESS_TOKEN ?? '';

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });
  app.addHook('onRequest', async (req, reply) => {
    if (!token || !req.url.startsWith('/api/') || req.url === '/api/health') return;
    const got = String(req.headers['x-access-token'] ?? '');
    const ok = got.length === token.length && timingSafeEqual(Buffer.from(got), Buffer.from(token));
    if (!ok) return reply.code(401).send({ error: { code: 'unauthorized', message: '需要访问口令', advice: '在设置中填写访问口令' } });
  });
  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, advice: err.advice } });
    if (err instanceof NotConfiguredError) return reply.code(409).send({ error: { code: 'not_configured', message: err.message, advice: '到“设置 → 模型”选择提供方并填写密钥' } });
    const msg = e.message ?? String(err);
    const notConf = /^未配置/.test(msg);
    logger.error('http', '请求失败', { error: msg });
    return reply.code(notConf ? 409 : (e.statusCode ?? 500)).send({ error: { code: notConf ? 'not_configured' : 'internal', message: msg, advice: notConf ? '到“设置”填写对应密钥' : '查看“任务与日志”页了解详情' } });
  });

  const device = (q: unknown): Device => {
    const d = (q as { device?: string })?.device;
    return d === 'phone' || d === 'tablet' || d === 'desktop' ? d : 'web';
  };

  /* ---------- 基础 ---------- */
  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }));
  app.get('/api/boundaries', async () => ({ boundaries: HARD_BOUNDARIES, tools: ALLOWED_TOOLS }));

  /* ---------- 设置与密钥 ---------- */
  app.get('/api/settings', async () => ({
    proxy: getSetting<string>(db, 'proxy.url', ''),
    crawlMinIntervalMs: getSetting<number>(db, 'crawl.minIntervalMs', 5000),
    hotKeywords: getSetting<string[]>(db, 'hot.keywords', []),
    hotGeo: getSetting<string>(db, 'hot.geo', 'US'),
    xWoeid: getSetting<string>(db, 'hot.woeid', '1'),
    secrets: vault.describe(SECRET_NAMES),
  }));
  app.put('/api/settings', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.proxy === 'string') {
      if (b.proxy && !/^(https?|socks5?):\/\/[^\s]+$/.test(b.proxy)) throw new AppError('bad_proxy', '代理地址格式不正确', 400, '例如 http://127.0.0.1:7890');
      setSetting(db, 'proxy.url', b.proxy);
    }
    if (b.crawlMinIntervalMs !== undefined) setSetting(db, 'crawl.minIntervalMs', Math.max(1000, num(b.crawlMinIntervalMs, 5000)));
    if (Array.isArray(b.hotKeywords)) setSetting(db, 'hot.keywords', b.hotKeywords.map(String).slice(0, 50));
    if (typeof b.hotGeo === 'string') setSetting(db, 'hot.geo', b.hotGeo.slice(0, 5));
    if (typeof b.xWoeid === 'string') setSetting(db, 'hot.woeid', b.xWoeid.replace(/\D/g, '') || '1');
    return { ok: true };
  });
  app.put('/api/secrets/:name', async (req) => {
    const { name } = req.params as { name: string };
    if (!SECRET_NAMES.includes(name)) throw new AppError('bad_secret', '未知的密钥名');
    const value = String(((req.body ?? {}) as { value?: string }).value ?? '');
    vault.set(name, value.trim());
    logger.info('settings', value ? '密钥已更新' : '密钥已清除', { name });
    return { ok: true, ...vault.describe([name])[name] };
  });

  /* ---------- 模型能力层 ---------- */
  app.get('/api/models', async () => ({
    capabilities: CAPABILITIES.map((c) => ({ id: c, label: CAPABILITY_LABELS[c] })),
    providers: hub.providers().map((p) => ({ ...p, ready: hub.providerReady(p) })),
    routes: hub.routes(),
    prices: hub.prices(),
    status: hub.status(),
  }));
  app.put('/api/models/routes', async (req) => {
    hub.setRoutes(((req.body ?? {}) as { routes?: Routes }).routes ?? {});
    return { ok: true, status: hub.status() };
  });
  app.put('/api/models/providers/:id', async (req) => {
    const { id } = req.params as { id: string };
    const p = hub.providers().find((x) => x.id === id);
    if (!p) throw new AppError('not_found', '提供方不存在', 404);
    const b = (req.body ?? {}) as { baseURL?: string; useProxy?: boolean; models?: Record<string, string> };
    if (b.baseURL !== undefined) {
      const ok = p.local ? /^https?:\/\//.test(b.baseURL) : isPublicHttpUrl(b.baseURL.replace('{WorkspaceId}', 'x'));
      if (!ok) throw new AppError('bad_url', '基础地址不合法', 400, p.local ? '本地提供方需以 http:// 开头' : '必须是公网 https 地址');
    }
    const all = getSetting<Record<string, unknown>>(db, 'models.providers', {});
    all[id] = { ...(all[id] as object | undefined), ...b };
    setSetting(db, 'models.providers', all);
    return { ok: true };
  });
  app.put('/api/models/prices', async (req) => {
    setSetting(db, 'models.prices', ((req.body ?? {}) as { prices?: unknown }).prices ?? {});
    return { ok: true };
  });
  app.put('/api/models/comfyui-workflow', async (req) => {
    const wf = String(((req.body ?? {}) as { workflow?: string }).workflow ?? '');
    if (wf) {
      try { JSON.parse(wf.replaceAll('{{prompt}}', 'x')); } catch { throw new AppError('bad_workflow', '工作流不是有效 JSON'); }
    }
    setSetting(db, 'models.comfyui.workflow', wf);
    return { ok: true };
  });
  app.get('/api/models/costs', async (req) => hub.costSummary(num((req.query as { days?: string }).days, 30)));
  app.post('/api/models/test/:cap', async (req) => {
    const { cap } = req.params as { cap: string };
    switch (cap) {
      case 'llm': { const r = await hub.chat('test', [{ role: 'user', content: '回复“连接正常”四个字' }]); return { ok: true, provider: r.provider, model: r.model, sample: r.content.slice(0, 100), mock: r.mock }; }
      case 'embedding': { const r = await hub.embed('test', ['测试']); return { ok: true, provider: r.provider, dims: r.vectors[0]?.length ?? 0, mock: r.mock }; }
      case 'image': { const r = await hub.image('test', '一只简笔画小猫'); return { ok: true, provider: r.provider, count: r.images.length, mock: r.mock }; }
      case 'tts': { const r = await hub.tts('test', '测试'); return { ok: true, provider: r.provider, bytes: r.audio.length, mock: r.mock }; }
      default: throw new AppError('unsupported', '该能力请在实际流程中测试');
    }
  });

  /* ---------- 信息源与采集 ---------- */
  app.get('/api/sources', async () => ({
    adapters: Object.values(ADAPTERS).map((a) => ({ kind: a.kind, label: a.label, requiredSecrets: a.requiredSecrets, configFields: a.configFields })),
    sources: listSources(db).map((s) => ({ ...s, ...sourceStatus(s, sourceCtx()) })),
    runs: recentRuns(db, 30),
  }));
  app.post('/api/sources', async (req) => {
    const b = (req.body ?? {}) as { kind?: string; name?: string; config?: Record<string, unknown>; intervalMin?: number };
    try {
      return { id: addSource(db, String(b.kind), String(b.name || b.kind), b.config ?? {}, num(b.intervalMin, 60)) };
    } catch (e) {
      throw new AppError('bad_source', (e as Error).message);
    }
  });
  app.delete('/api/sources/:id', async (req) => {
    db.prepare('DELETE FROM sources WHERE id = ?').run(num((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post('/api/sources/:id/run', async (req) => {
    const s = listSources(db).find((x) => x.id === num((req.params as { id: string }).id));
    if (!s) throw new AppError('not_found', '信息源不存在', 404);
    const r = await runSource(db, queue, sourceCtx(), s);
    return { status: r.status, message: r.message, fetched: r.items.length, inserted: r.inserted ?? 0 };
  });

  /* ---------- 内容库 ---------- */
  app.get('/api/items', async (req) => {
    const q = req.query as Record<string, string>;
    return { items: listItems(db, { search: q.search, tag: q.tag, sourceId: q.sourceId ? num(q.sourceId) : undefined, limit: num(q.limit, 50), offset: num(q.offset, 0) }) };
  });
  app.post('/api/items/semantic-search', async (req) => {
    const b = (req.body ?? {}) as { query?: string };
    const items = listItems(db, { limit: 200 });
    if (!items.length || !b.query) return { items: [] };
    const r = await hub.rerank('library_search', b.query, items.map((i) => `${i.title} ${i.summary ?? ''}`));
    return { items: r.scores.slice(0, 20).map((s) => ({ ...items[s.index], score: s.score })), provider: r.provider, mock: r.mock };
  });

  /* ---------- 选题 ---------- */
  app.get('/api/topics', async (req) => ({ topics: listTopics(db, (req.query as { status?: string }).status) }));
  app.post('/api/topics/generate', async (req) => {
    let ids = ((req.body ?? {}) as { itemIds?: number[] }).itemIds ?? [];
    if (!ids.length) ids = listItems(db, { limit: 15 }).map((i) => i.id);
    const r = await queue.run({ kind: 'topics', label: '生成选题', retries: 1 }, () => generateTopics(deps, ids));
    if (!r.ok) throw new Error(r.error);
    return { topicIds: r.result };
  });
  app.post('/api/topics/:id/dismiss', async (req) => {
    db.prepare("UPDATE topics SET status = 'dismissed' WHERE id = ?").run(num((req.params as { id: string }).id));
    return { ok: true };
  });

  /* ---------- 改写 ---------- */
  app.get('/api/platforms', async (req) => {
    const enabled = enabledFor(getSetting<EnabledMap>(db, 'plugins.enabled', {}), device(req.query));
    const plats = PLUGINS.filter((p) => enabled.includes(p.id)).flatMap((p) => p.platforms ?? []);
    const sk = skills();
    return {
      platforms: Object.entries(PLATFORMS).filter(([k]) => plats.includes(k)).map(([id, v]) => {
        const s = sk.find((x) => x.name === v.skill);
        return { id, ...v, models: s?.models ?? [], missing: s ? missingCapabilities(s, (c) => hub.isConfigured(c)) : ['llm'] };
      }),
    };
  });
  app.post('/api/rewrite', async (req) => {
    const b = (req.body ?? {}) as { topicId?: number; platforms?: string[] };
    const plats = (b.platforms ?? []).filter(isPlatform);
    if (!b.topicId || !plats.length) throw new AppError('bad_request', '需要选题与至少一个平台');
    const results = [];
    for (const p of plats) {
      const r = await queue.run({ kind: 'rewrite', label: `改写：${PLATFORMS[p].label}`, retries: 1, timeoutMs: 600000 }, () => rewrite(deps, num(b.topicId), p));
      results.push({ platform: p, ok: r.ok, error: r.error, ...(r.result ?? {}) });
    }
    return { results };
  });

  /* ---------- 审核 ---------- */
  app.get('/api/drafts', async (req) => ({ drafts: listDrafts(db, (req.query as { status?: string }).status) }));
  app.get('/api/drafts/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = getDraft(db, id);
    if (!d) throw new AppError('not_found', '草稿不存在', 404);
    return { draft: d, edits: draftEdits(db, id) };
  });
  app.put('/api/drafts/:id', async (req) => {
    const b = (req.body ?? {}) as { body?: string; title?: string; note?: string };
    if (typeof b.body !== 'string' || !b.body.trim()) throw new AppError('bad_request', '正文不能为空');
    editDraft(db, num((req.params as { id: string }).id), b.body, b.title, b.note);
    return { ok: true };
  });
  app.post('/api/drafts/:id/status', async (req) => {
    const to = String(((req.body ?? {}) as { status?: string }).status) as DraftStatus;
    if (!['pending', 'approved', 'rejected'].includes(to)) throw new AppError('bad_request', '非法状态');
    try { setDraftStatus(db, num((req.params as { id: string }).id), to); } catch (e) { throw new AppError('bad_transition', (e as Error).message); }
    return { ok: true };
  });

  /* ---------- 交接 ---------- */
  app.get('/api/drafts/:id/handoff', async (req) => handoffCard(db, vault, num((req.params as { id: string }).id)));
  app.post('/api/drafts/:id/handoff/copy', async (req) => {
    try { markCopied(db, agent, num((req.params as { id: string }).id)); } catch (e) { throw new AppError('handoff_failed', (e as Error).message); }
    return { ok: true, lastStep: '请在官方 App 或创作中心粘贴并由你本人点击发布' };
  });
  app.post('/api/drafts/:id/handoff/wechat-draft', async (req) => {
    const id = num((req.params as { id: string }).id);
    const r = await queue.run({ kind: 'handoff', label: `推送公众号草稿 #${id}`, retries: 1 }, () => pushWechatDraft(db, vault, http, agent, id));
    if (!r.ok) throw new Error(r.error);
    return { ok: true, ...r.result, lastStep: '已进入公众号草稿箱，请在公众号后台预览并由你本人点击发布' };
  });
  app.get('/api/creator-centers', async () => ({ centers: CREATOR_CENTERS }));

  /* ---------- 回复草稿 ---------- */
  app.post('/api/replies/draft', async (req) => {
    const b = (req.body ?? {}) as { comment?: string; context?: string };
    if (!b.comment) throw new AppError('bad_request', '请粘贴评论或私信内容');
    const r = await replyDraft(deps, b.comment.slice(0, 2000), (b.context ?? '').slice(0, 2000));
    return { ...r, notice: '仅为草稿：请确认后由你本人在 App 中发送' };
  });

  /* ---------- 热点 ---------- */
  app.get('/api/hot', async () => {
    const merged = mergeLatest(db);
    return { boards: BOARDS.map((b) => ({ id: b.id, label: b.label })), runs: lastRuns(db), merged: merged.slice(0, 100), matched: matchKeywords(merged, getSetting<string[]>(db, 'hot.keywords', [])) };
  });
  app.post('/api/hot/fetch', async (req) => {
    const b = (req.body ?? {}) as { force?: boolean; device?: string };
    const enabledPlugins = enabledFor(getSetting<EnabledMap>(db, 'plugins.enabled', {}), device(b));
    const boards = PLUGINS.filter((p) => enabledPlugins.includes(p.id)).flatMap((p) => p.hotBoards ?? []);
    const r = await queue.run({ kind: 'hot', label: '采集热榜', retries: 0, timeoutMs: 120000 }, () =>
      fetchAllBoards({ db, vault, http, limiter, proxy: getSetting<string>(db, 'proxy.url', '') || undefined, cfg: { geo: getSetting(db, 'hot.geo', 'US'), woeid: getSetting(db, 'hot.woeid', '1') } }, boards, Boolean(b.force)),
    );
    if (!r.ok) throw new Error(r.error);
    return { results: r.result!.map((x) => ({ ...x, items: x.items.slice(0, 20) })) };
  });
  app.post('/api/hot/cluster', async () => {
    const r = await queue.run({ kind: 'hot', label: '热点聚类', retries: 1 }, () => clusterHots(hub, agent, skills().find((s) => s.name === 'hot-research'), mergeLatest(db)));
    if (!r.ok) throw new Error(r.error);
    return r.result;
  });
  app.post('/api/hot/research', async (req) => {
    const b = (req.body ?? {}) as { name?: string; titles?: string[] };
    if (!b.name) throw new AppError('bad_request', '需要话题簇名称');
    const r = await queue.run({ kind: 'hot', label: `热点调研：${b.name}`, retries: 1 }, () => researchCluster(db, hub, agent, skills().find((s) => s.name === 'hot-research'), b.name!, (b.titles ?? [b.name!]).slice(0, 20)));
    if (!r.ok) throw new Error(r.error);
    return r.result;
  });

  /* ---------- 复盘 ---------- */
  app.post('/api/analytics/import', async (req) => {
    const b = (req.body ?? {}) as { csv?: string; platform?: string };
    if (!b.csv) throw new AppError('bad_request', '请上传 CSV');
    try { return importCsv(db, b.csv, String(b.platform ?? 'unknown')); } catch (e) { throw new AppError('bad_csv', (e as Error).message); }
  });
  app.get('/api/analytics/summary', async (req) => summarize(db, (req.query as { batch?: string }).batch));
  app.post('/api/analytics/review', async (req) => {
    const s = summarize(db, ((req.body ?? {}) as { batch?: string }).batch);
    if (!s.count) throw new AppError('no_data', '没有数据');
    const r = await hub.chat('review', [
      { role: 'system', content: 'You are a careful analyst. 只依据给定数据，注明样本量与不确定性；不要编造。' },
      { role: 'user', content: `[TASK:review_metrics]\n${JSON.stringify(s)}` },
    ]);
    agent.daily(`数据复盘：${s.count} 条样本`);
    return { summary: s, review: r.content, provider: `${r.provider}/${r.model}`, mock: r.mock };
  });

  /* ---------- 系统文件、记忆、改进日志 ---------- */
  app.get('/api/agent/files', async () => ({ files: agent.listEditable(), memory: agent.listMemory(), approval: agent.approvalRequired() }));
  app.get('/api/agent/file', async (req) => {
    const p = String((req.query as { path?: string }).path ?? '');
    try { return { path: p, content: agent.read(p), history: agent.history(p).map(({ content: _c, ...rest }) => rest) }; } catch (e) { throw new AppError('bad_path', (e as Error).message); }
  });
  app.put('/api/agent/file', async (req) => {
    const b = (req.body ?? {}) as { path?: string; content?: string; reason?: string; expected?: string };
    if (!b.path || typeof b.content !== 'string') throw new AppError('bad_request', '需要路径与内容');
    if (b.path.startsWith('skills/')) {
      try { (await import('./skills/loader.js')).parseSkill(b.content, b.path); } catch (e) { throw new AppError('bad_skill', `skill 校验失败：${(e as Error).message}`); }
    }
    try { return { version: agent.write(b.path, b.content, b.reason ?? '', b.expected ?? '') }; } catch (e) { throw new AppError('bad_path', (e as Error).message); }
  });
  app.get('/api/agent/memory', async (req) => {
    const p = String((req.query as { path?: string }).path ?? '');
    if (!p.startsWith('memory/')) throw new AppError('bad_path', '只能读取 memory 目录');
    const full = normalize(join(agent.dir, p));
    if (relative(agent.dir, full).startsWith('..') || !existsSync(full)) throw new AppError('not_found', '文件不存在', 404);
    return { path: p, content: readFileSync(full, 'utf8') };
  });
  app.get('/api/versions', async () => ({ versions: agent.allHistory(300) }));
  app.get('/api/versions/:id', async (req) => {
    const v = agent.version(num((req.params as { id: string }).id));
    if (!v) throw new AppError('not_found', '版本不存在', 404);
    return { version: v };
  });
  app.post('/api/versions/:id/rollback', async (req) => {
    try { return { version: agent.rollback(num((req.params as { id: string }).id), ((req.body ?? {}) as { reason?: string }).reason ?? '') }; } catch (e) { throw new AppError('rollback_failed', (e as Error).message); }
  });
  app.get('/api/improvement-log', async () => ({ content: existsSync(join(agent.dir, 'improvement-log.md')) ? readFileSync(join(agent.dir, 'improvement-log.md'), 'utf8') : '' }));
  app.get('/api/skills', async () => {
    const { skills: list, errors } = loadSkills(join(agent.dir, 'skills'));
    return { skills: list.map(({ body: _b, ...s }) => ({ ...s, missing: missingCapabilities(s as never, (c) => hub.isConfigured(c)) })), errors };
  });
  app.get('/api/evals/benchmark', async () => ({ cases: loadBenchmark(join(agent.dir, 'evals', 'benchmark.json')) }));
  app.post('/api/evals/ab', async (req) => {
    const b = (req.body ?? {}) as { a?: number; b?: number };
    const r = await queue.run({ kind: 'eval', label: `A/B 评测 #${b.a} vs #${b.b}`, retries: 0, timeoutMs: 600000 }, () => abTest(hub, agent, join(agent.dir, 'evals', 'benchmark.json'), num(b.a), num(b.b)));
    if (!r.ok) throw new AppError('eval_failed', r.error ?? '评测失败');
    return r.result;
  });

  /* ---------- 插件 ---------- */
  app.get('/api/plugins', async (req) => {
    const map = getSetting<EnabledMap>(db, 'plugins.enabled', {});
    const d = device(req.query);
    return { device: d, plugins: PLUGINS, enabled: enabledFor(map, d) };
  });
  app.put('/api/plugins', async (req) => {
    const b = (req.body ?? {}) as { device?: string; enabled?: string[] };
    const d = device(b);
    const valid = (b.enabled ?? []).filter((id) => PLUGINS.some((p) => p.id === id));
    const map = getSetting<EnabledMap>(db, 'plugins.enabled', {});
    map[d] = valid;
    setSetting(db, 'plugins.enabled', map);
    return { ok: true, device: d, enabled: valid };
  });

  /* ---------- 任务、日志、通知 ---------- */
  app.get('/api/tasks', async (req) => ({ stats: queue.stats(), tasks: queue.list(num((req.query as { limit?: string }).limit, 100)) }));
  app.get('/api/logs', async (req) => ({ logs: logger.recent(num((req.query as { limit?: string }).limit, 200), (req.query as { level?: 'info' | 'warn' | 'error' }).level) }));
  app.get('/api/notifications', async () => {
    const pending = (db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE status = 'pending'").get() as { n: number }).n;
    const matched = matchKeywords(mergeLatest(db), getSetting<string[]>(db, 'hot.keywords', []));
    return { pendingDrafts: pending, hotMatches: matched.slice(0, 10).map((m) => m.title) };
  });

  /* ---------- 备份 ---------- */
  app.get('/api/backup/export', async (_req, reply: FastifyReply) => {
    reply.header('content-disposition', `attachment; filename="content-agent-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return exportBackup(db, agent);
  });
  app.post('/api/backup/import', async (req) => {
    try { return importBackup(db, agent, req.body, join(opts.dataDir, 'backups')); } catch (e) { throw new AppError('import_failed', (e as Error).message); }
  });

  /* ---------- 媒体文件 ---------- */
  app.get('/api/media/:draft/:name', async (req, reply) => {
    const { draft, name } = req.params as { draft: string; name: string };
    if (!/^\d+$/.test(draft) || !/^[\w.-]+$/.test(name)) throw new AppError('bad_path', '非法路径');
    const p = join(deps.mediaDir, draft, name);
    if (!existsSync(p)) throw new AppError('not_found', '文件不存在', 404);
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.mp3') ? 'audio/mpeg' : name.endsWith('.srt') ? 'text/plain; charset=utf-8' : 'application/octet-stream';
    return reply.type(type).send(readFileSync(p));
  });

  /* ---------- 前端静态文件 ---------- */
  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: '接口不存在' } });
      return reply.type('text/html').send(readFileSync(join(opts.webDist!, 'index.html')));
    });
  }

  logger.info('app', '启动完成', { boundaries: HARD_BOUNDARIES.length });
  return { app, ctx };
}
