/**
 * 端到端演示（mock 模型 + 真实公开 RSS 与公开热榜）：
 * RSS → 内容库 → 选题 → 改写（小红书含配图、抖音含配音与字幕）→ 审核 → 复制交接；
 * 公开热榜 → 聚类 → 调研选题卡 → 改写。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { CAPABILITIES } from '../models/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'ca-e2e-'));
const feed = process.env.E2E_FEED ?? 'https://www.solidot.org/index.rss';

const { app } = await buildApp({ dataDir, agentDefaultsDir: join(root, 'agent'), rateLimitMs: 1500 });
const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, payload: payload as never });
  const body = r.json() as Record<string, any>;
  if (r.statusCode >= 400) throw new Error(`${method} ${url} → ${r.statusCode} ${JSON.stringify(body)}`);
  return body;
};
const log = (...a: unknown[]) => console.log('•', ...a);

const before = await call('GET', '/api/models');
log('模型模块初始状态：', before.status.map((s: any) => `${s.label}=${s.configured ? '已配置' : '未配置'}`).join('，'));
const sources = await call('GET', '/api/sources');
log('未配置的官方适配器：', sources.adapters.filter((a: any) => a.requiredSecrets.length).map((a: any) => a.kind).join('、'));

await call('PUT', '/api/models/routes', { routes: Object.fromEntries(CAPABILITIES.map((c) => [c, { default: { provider: 'mock' } }])) });
log('已为全部 8 个能力模块选择 Mock 提供方（演示用，输出标注“模拟”）');

const { id } = await call('POST', '/api/sources', { kind: 'rss', name: 'Solidot', config: { url: feed } });
const run = await call('POST', `/api/sources/${id}/run`);
log(`RSS 采集：状态 ${run.status}，抓取 ${run.fetched}，新增 ${run.inserted}`);
if (run.status !== 'ok' || !run.inserted) throw new Error('RSS 采集失败：' + run.message);
const run2 = await call('POST', `/api/sources/${id}/run`);
log(`再次采集（去重验证）：抓取 ${run2.fetched}，新增 ${run2.inserted}`);

const items = (await call('GET', '/api/items?limit=5')).items;
const t = await call('POST', '/api/topics/generate', { itemIds: items.map((i: any) => i.id) });
log('选题生成：', t.topicIds.length, '个');
const topicId = t.topicIds[0];

const rw = await call('POST', '/api/rewrite', { topicId, platforms: ['xiaohongshu', 'douyin_script'] });
for (const r of rw.results) log(`改写 ${r.platform}：草稿 #${r.draftId}，流水线 ${r.steps.map((s: any) => `${s.step}${s.ok ? '✓' : '✗'}`).join(' → ')}`);

const draftId = rw.results[0].draftId;
const d = (await call('GET', `/api/drafts/${draftId}`)).draft;
log(`审核：草稿 #${draftId} 素材 ${d.assets.map((a: any) => a.type).join('、')}；合规提示 ${d.compliance.length} 条`);
await call('PUT', `/api/drafts/${draftId}`, { body: d.body + '\n（人工修改一句）', note: 'e2e 编辑' });
await call('POST', `/api/drafts/${draftId}/status`, { status: 'approved' });
const card = await call('GET', `/api/drafts/${draftId}/handoff`);
log(`交接卡：创作中心 ${card.center.label} ${card.center.url}；${card.lastStep}`);
await call('POST', `/api/drafts/${draftId}/handoff/copy`);
const after = (await call('GET', `/api/drafts/${draftId}`)).draft;
log(`交接后状态：${after.status}`);

const dy = (await call('GET', `/api/drafts/${rw.results[1].draftId}`)).draft;
log(`抖音草稿素材：${dy.assets.map((a: any) => `${a.type}:${a.url}`).join('；')}`);

const hot = await call('POST', '/api/hot/fetch', { force: true });
for (const b of hot.results) log(`热榜 ${b.label}：${b.status}${b.message ? '（' + b.message + '）' : ''}，${b.items.length} 条`);
const okBoards = hot.results.filter((b: any) => b.status === 'ok');
if (okBoards.length) {
  const cl = await call('POST', '/api/hot/cluster');
  log('热点聚类：', cl.clusters.length, '簇');
  const c0 = cl.clusters[0];
  const rs = await call('POST', '/api/hot/research', { name: c0.name, titles: c0.titles });
  log(`调研选题卡 #${rs.topicId}：${rs.research.title}`);
  const rw2 = await call('POST', '/api/rewrite', { topicId: rs.topicId, platforms: ['x_post'] });
  log(`热点选题改写 X 帖子：草稿 #${rw2.results[0].draftId}`);
}

const costs = await call('GET', '/api/models/costs');
log('成本统计（mock 单价为 0）：', JSON.stringify(costs.byCapability));
const tasks = await call('GET', '/api/tasks');
log('任务面板：', JSON.stringify(tasks.stats));
log('数据目录：', dataDir);
await app.close();
console.log('E2E_OK');
