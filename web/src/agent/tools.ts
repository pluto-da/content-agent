/**
 * Agent 工具（0.8.0，定义只有一份）：OpenAI function calling 定义 + 本机执行器 + 卡片数据。
 * 权限分级：L0 只读 / 本机计算，直接执行；L1 打开页面、复制、写本机草稿，直接执行但卡片可见可撤销；
 * L2 修改 / 覆盖本机已有数据，执行前出确认卡（允许 / 拒绝 / 记住此类）；L3 对外写入（发布、评论、私信……）——不存在这样的工具。
 */
import { charLen, checkCompliance, cleanAndGroup, riskOf, runStructured, scoreOf, snapshotOf, trendOf, type JsonSchema, type RawHot } from '@content-agent/shared';
import { assistantOf } from '../data/assistants';
import { PATROL_STOPS } from '../data/hotSources';
import { CENTERS, center, centerOfWrite, detectPlatform, publishUrlOfWrite, WRITE_PLATFORMS, writePlatform } from '../data/platforms';
import { collectHot, type HotFetchResult } from '../hot/collect';
import { db, type Row } from '../local/db';
import { generateDraft, limitWarnings, reviseDraft } from '../local/generate';
import { costOf, type ProviderConfig } from '../local/llm';
import { addUsage, getAssistantOverrides, getPrefs } from '../local/store';
import { copyText } from '../runtime';
import { chatAgent } from './model';
import { applyProfilePatch, bus, getProfile, lastUnfinishedTask, listInbox, markInboxUsed, type CardData } from './store';

export type Level = 'L0' | 'L1' | 'L2';
export interface ToolCtx { conversationId: number; cfg: ProviderConfig | null; signal?: AbortSignal; userText?: string }
export interface ToolOut { result: unknown; card?: Omit<CardData, 'tool' | 'status' | 'ms'>; refs?: Record<string, unknown> }
export interface ToolSpec {
  name: string; label: string; level: Level; description: string; parameters: JsonSchema;
  /** 只能由用户在卡片上点击触发（Agent 调用时拒绝） */
  userOnly?: boolean;
  /** L2：是否需要确认（可按参数判断，例如“覆盖已有数据”才需要） */
  needsConfirm?: (args: Record<string, any>) => Promise<boolean>;
  run(args: Record<string, any>, ctx: ToolCtx): Promise<ToolOut>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const WRITE_IDS = WRITE_PLATFORMS.map((p) => p.id);

/** 用户说的平台名 / 中心 id → 写作平台 id。 */
export function toWritePlatform(p: string): string {
  if (WRITE_IDS.includes(p)) return p;
  const c = CENTERS.find((x) => x.id === p || x.label === p);
  if (c) return WRITE_PLATFORMS.find((w) => w.center === c.id)?.id ?? 'xiaohongshu';
  return detectPlatform(p) ?? 'xiaohongshu';
}
async function draftOf(id: unknown): Promise<Row> {
  const d = await db.get('drafts', Number(id));
  if (!d) throw new ToolError('草稿不存在', '先用 draft_write 写一篇');
  return d;
}
export class ToolError extends Error { constructor(public reason: string, public advice = '') { super(reason); } }

/* ---------- 发布前质量门禁（publish_check 与写作标准共用一套规则） ---------- */
export interface Check { id: string; label: string; pass: boolean; detail: string; fix?: string; blocking: boolean }
export async function standardOf(platform: string): Promise<{ titleMax?: number; bodyMax?: number; tagsMax: number; must: string[]; avoid: string[] }> {
  const a = assistantOf(platform);
  const props = ((a?.schema as Record<string, any> | undefined)?.properties ?? {}) as Record<string, any>;
  const prof = await getProfile();
  const def: Record<string, { titleMax?: number; bodyMax?: number }> = { xiaohongshu: { titleMax: 20, bodyMax: 1000 }, douyin_script: { bodyMax: 600 }, x_post: { bodyMax: 280 } };
  return {
    titleMax: props.title?.maxLength ?? def[platform]?.titleMax,
    bodyMax: props.body?.maxLength ?? def[platform]?.bodyMax,
    tagsMax: platform === 'xiaohongshu' ? 10 : 8,
    must: ['开头三句给出结论或钩子', '信息有来源，不编造数据'],
    avoid: [...prof.style.banned, ...prof.redlines],
  };
}
export async function runChecks(d: Row, platform: string): Promise<{ checks: Check[]; blocking: boolean }> {
  const title = String(d.title ?? ''); const body = String(d.body ?? ''); const tags = (d.tags as string[]) ?? [];
  const st = await standardOf(platform);
  const prof = await getProfile();
  const text = `${title}\n${body}`;
  const checks: Check[] = [];
  const lim = limitWarnings(platform, title, body);
  checks.push({ id: 'body', label: '正文字数', pass: !st.bodyMax || charLen(body) <= st.bodyMax, detail: st.bodyMax ? `${charLen(body)} / ${st.bodyMax}` : `${charLen(body)} 字`, fix: '压缩到上限以内', blocking: true });
  checks.push({ id: 'title', label: '标题长度', pass: !st.titleMax || charLen(title) <= st.titleMax, detail: st.titleMax ? `${charLen(title)} / ${st.titleMax}` : `${charLen(title)} 字`, fix: '缩短标题', blocking: true });
  if (lim.length && checks.every((c) => c.pass)) checks.push({ id: 'schema', label: '平台格式', pass: false, detail: lim.join('；'), fix: '按平台规则重排', blocking: true });
  checks.push({ id: 'tags', label: '标签数量', pass: tags.length <= st.tagsMax, detail: `${tags.length} 个（上限 ${st.tagsMax}）`, fix: '删掉多余标签', blocking: false });
  const comp = checkCompliance(text).filter((c) => c.level === 'warn');
  checks.push({ id: 'compliance', label: '敏感词与合规', pass: comp.length === 0, detail: comp.length ? comp.map((c) => `${c.match}：${c.advice}`).join('；') : '未发现', fix: '按提示改写', blocking: true });
  const unverified = /(网传|据说|听说|内部消息|未经证实)/.exec(text);
  checks.push({ id: 'facts', label: '版权与未证实信息', pass: !unverified, detail: unverified ? `出现“${unverified[0]}”，请核实来源` : '未发现', fix: '删除或注明来源', blocking: false });
  const red = [...prof.redlines, ...prof.style.banned].filter((w) => w && text.includes(w));
  checks.push({ id: 'redline', label: '偏好红线', pass: red.length === 0, detail: red.length ? `命中：${red.join('、')}` : prof.redlines.length ? '无' : '画像里还没设红线', fix: '删掉命中的表达', blocking: true });
  // 0.9.0 第十部分合规 + C48：AI 生成声明、授权、引用出处、收益假设（提醒项，不阻断；声明由你本人在平台勾选）
  checks.push(...complianceV9(d, text));
  if (platform === 'xiaohongshu') checks.push({ id: 'images', label: '配图', pass: true, detail: `建议 ${((d.image_prompts as string[]) ?? []).length || 3} 张图（发布时由你上传）`, blocking: false });
  return { checks, blocking: checks.some((c) => !c.pass && c.blocking) };
}

export function complianceV9(d: Row, text: string): Check[] {
  const out: Check[] = [];
  const media = [...((d.images as unknown[]) ?? []), ...((d.media as unknown[]) ?? []), ...((d.media_ids as unknown[]) ?? [])];
  const aiMedia = media.length > 0 || d.aigc === true;
  out.push({ id: 'aigc', label: 'AI 生成声明', pass: !aiMedia, detail: aiMedia ? `含 ${media.length || 1} 个 AI 生成的图片 / 音频 / 视频：请在平台发布页勾选“AI 生成”声明（由你本人勾选）` : '没有 AI 生成的媒体', fix: '发布时在平台勾选 AI 生成声明', blocking: false });
  const prompts = `${text}\n${((d.image_prompts as string[]) ?? []).join('\n')}`;
  const person = /(明星|真人|名人|某某|肖像|代言|logo|LOGO|商标|品牌方)/.exec(prompts);
  if (person) out.push({ id: 'authorization', label: '肖像与品牌授权', pass: false, detail: `出现“${person[0]}”：图片含真实人物或品牌时需要授权`, fix: '确认已获授权，或换成不含真实人物 / 品牌的画面', blocking: false });
  if (d.voiceClone === true) out.push({ id: 'voice_clone', label: '声音授权', pass: d.voiceCloneConsent === true, detail: d.voiceCloneConsent === true ? '已确认授权' : '配音用了复刻音色，必须先确认声音本人授权', fix: '确认授权后再发布', blocking: d.voiceCloneConsent !== true });
  const quoted = [...text.matchAll(/[“"「]([^”"」]{20,})[”"」]/g)].reduce((n, m) => n + [...m[1]!].length, 0);
  if (quoted > 150) out.push({ id: 'quote', label: '引用出处', pass: false, detail: `引用他人文字约 ${quoted} 字，超过合理范围时要注明出处`, fix: '注明作者与来源，或改为转述', blocking: false });
  const rh = String(d.revenueHypothesis ?? d.revenue_hypothesis ?? '').trim();
  out.push({ id: 'revenue_hypothesis', label: '收益假设', pass: !!rh, detail: rh || '这篇还没写收益假设（它预计推动漏斗哪一层、怎么检验）', fix: '补一句：这篇预计带来什么（曝光 / 收藏 / 关注 / 转化）以及怎么检验', blocking: false });
  return out;
}

/* ---------- 热点分析 ---------- */
const ANALYSIS_SCHEMA: JsonSchema = obj({
  clusters: { type: 'array', minItems: 1, maxItems: 10, items: obj({
    title: { type: 'string', maxLength: 30 }, members: { type: 'array', items: { type: 'integer' } }, relevance: { type: 'number' }, why: { type: 'string' },
    angles: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
    perPlatform: { type: 'object' },
  }, ['title', 'members', 'angles', 'perPlatform']) },
}, ['clusters']);

export interface Cluster { id: string; title: string; members: { title: string; source: string; route?: string; url?: string }[]; sources: string[]; score: number; trend: 'up' | 'flat' | 'new'; why: string; angles: string[]; risk: 'ok' | 'caution' | 'avoid'; perPlatform: Record<string, { titles: string[]; format?: string; risk?: string }> }

async function analyze(items: RawHot[], platforms: string[], depth: 'quick' | 'deep', ctx: ToolCtx): Promise<{ clusters: Cluster[]; usedModel: boolean; usage?: { input: number; output: number } }> {
  const groups = cleanAndGroup(items).sort((a, b) => b.sources.length - a.sources.length || a.bestRank - b.bestRank);
  const totalSources = new Set(items.map((i) => i.source)).size;
  const yesterdayRow = (await db.all('hot_snapshots')).filter((r) => r.date !== today()).sort((a, b) => b.id - a.id)[0];
  const yesterday = (yesterdayRow?.ranks as Record<string, number>) ?? null;
  const top = groups.slice(0, 60);
  const wps = platforms.map(toWritePlatform);
  let clusters: Cluster[];
  let usedModel = false;
  let usage: { input: number; output: number } | undefined;
  if (depth === 'deep' && ctx.cfg && top.length) {
    const prof = await getProfile();
    const list = top.map((g, i) => `${i}. ${g.title}（${g.sources.join('、')}）`).join('\n');
    const sys = `你是内容策划。把热点标题聚成 6–10 个话题簇，只输出 JSON：{"clusters":[{"title":"≤12字话题名","members":[序号],"relevance":0到1（与用户账号的相关度）,"why":"一句话为什么值得写","angles":["2-3个可写角度：信息差/个人经验/清单/反常识"],"perPlatform":{"平台id":{"titles":["3个标题，小红书≤20字"],"format":"建议形式","risk":"风险提示或空"}}}]}。平台 id 用：${wps.join('、')}。不得编造标题里没有的事实。`;
    const user = `账号画像：${prof.positioning || '未填'}；受众：${prof.audience || '未填'}\n热点列表：\n${list}`;
    try {
      const s = await runStructured<{ clusters: { title: string; members: number[]; relevance?: number; why?: string; angles: string[]; perPlatform: Record<string, { titles?: string[]; format?: string; risk?: string }> }[] }, { content: string; usage: { input: number; output: number } }>(async (msgs) => {
        const r = await chatAgent(ctx.cfg!, msgs.map((m) => ({ role: m.role, content: m.content })), { stream: false, maxTokens: 4096, signal: ctx.signal, timeoutMs: 120000 });
        usage = { input: (usage?.input ?? 0) + r.usage.input, output: (usage?.output ?? 0) + r.usage.output };
        return { content: r.content, usage: r.usage };
      }, [{ role: 'system', content: sys }, { role: 'user', content: user }], ANALYSIS_SCHEMA);
      clusters = s.data.clusters.map((c, i) => {
        const mem = c.members.map((k) => top[k]).filter(Boolean) as typeof top;
        const best = Math.min(...mem.map((m) => m.bestRank), 50);
        const srcs = [...new Set(mem.flatMap((m) => m.sources))];
        return {
          id: `c${i + 1}`, title: c.title, members: mem.flatMap((m) => m.members).slice(0, 8).map((x) => ({ title: x.title, source: x.source, route: x.route, url: x.url })), sources: srcs,
          score: scoreOf({ sources: srcs.length, totalSources, bestRank: best, relevance: typeof c.relevance === 'number' ? c.relevance : 0.5 }),
          trend: trendOf(mem[0]?.title ?? c.title, best, yesterday), why: c.why ?? '', angles: c.angles.slice(0, 3), risk: riskOf(c.title + mem.map((m) => m.title).join('')),
          perPlatform: Object.fromEntries(Object.entries(c.perPlatform ?? {}).map(([k, v]) => [toWritePlatform(k), { titles: (v.titles ?? []).slice(0, 3), format: v.format, risk: v.risk }])),
        };
      });
      usedModel = true;
      if (usage && ctx.cfg) await addUsage(costOf(ctx.cfg.id, ctx.cfg.model, usage), usage);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      clusters = quickClusters(top, wps, totalSources, yesterday);
    }
  } else clusters = quickClusters(top, wps, totalSources, yesterday);
  clusters.sort((a, b) => b.score - a.score);
  await db.insert('hot_snapshots', { date: today(), ranks: snapshotOf(groups) });
  const snaps = (await db.all('hot_snapshots')).sort((a, b) => b.id - a.id);
  for (const s of snaps.slice(14)) await db.del('hot_snapshots', s.id); // 保留 14 份
  return { clusters, usedModel, usage };
}
function quickClusters(top: ReturnType<typeof cleanAndGroup>, wps: string[], totalSources: number, yesterday: Record<string, number> | null): Cluster[] {
  return top.slice(0, 8).map((g, i) => ({
    id: `c${i + 1}`, title: g.title.slice(0, 30), members: g.members.slice(0, 5).map((x) => ({ title: x.title, source: x.source, route: x.route, url: x.url })), sources: g.sources,
    score: scoreOf({ sources: g.sources.length, totalSources, bestRank: g.bestRank }), trend: trendOf(g.title, g.bestRank, yesterday), why: `${g.sources.length} 个来源同时出现`,
    angles: ['信息差：把来龙去脉讲清楚', '个人经验：和我有什么关系'], risk: riskOf(g.title),
    perPlatform: Object.fromEntries(wps.map((p) => [p, { titles: [g.title.slice(0, 18)] }])),
  }));
}
const today = () => new Date().toISOString().slice(0, 10);

function draftCard(d: Row, extra: Record<string, unknown> = {}) {
  const platform = String(d.platform);
  return { type: 'draft', data: { id: d.id, platform, platformLabel: writePlatform(platform).label, title: d.title, body: d.body, tags: d.tags, status: d.status, warnings: limitWarnings(platform, String(d.title ?? ''), String(d.body ?? '')), ...extra } };
}

/* ---------- 工具清单 ---------- */
export const TOOLS: ToolSpec[] = [
  {
    name: 'hot_fetch', label: '拉取热点', level: 'L0',
    description: '并行拉取用户已连接 / 启用的合法热点来源（数据服务、官方接口、分享进来的素材、公开新闻 RSS 与榜单），返回条目与每个来源的状态。不读取任何平台页面。',
    parameters: obj({ sources: { type: 'array', items: { type: 'string' }, description: '可选，来源 id；缺省 = 全部已启用' }, force: { type: 'boolean', description: '忽略 30 分钟缓存' } }),
    async run(a) {
      const r: HotFetchResult = await collectHot({ sources: a.sources, force: !!a.force });
      await db.setKV('hot.lastFetch', r);
      if (!r.items.length) throw new ToolError(`所有来源都没有读到热点（${r.sources.filter((s) => !s.ok).map((s) => `${s.label}：${s.reason}`).join('；') || '没有启用的来源'}）`, '粘贴几条你看到的热点，或点“热点巡视”自己翻看后发给我');
      return {
        result: { count: r.items.length, sources: r.sources.map((s) => ({ id: s.id, label: s.label, route: s.route, ok: s.ok, count: s.count, reason: s.reason })), gaps: r.gaps.map((g) => g.hint), sample: r.items.slice(0, 40).map((i) => `${i.title}（${i.source}）`) },
        card: { type: 'hot', data: r }, refs: { itemCount: r.items.length },
      };
    },
  },
  {
    name: 'hot_analyze', label: '深度分析', level: 'L0',
    description: '对最近一次 hot_fetch 的条目（可加素材箱条目）做清洗、去重、聚类、评分、趋势、可写角度与各平台选题建议。',
    parameters: obj({ platforms: { type: 'array', items: { type: 'string' }, description: '目标平台，如 ["xiaohongshu","douyin_script"]' }, depth: str('quick 或 deep', { enum: ['quick', 'deep'] }), extra: { type: 'array', items: { type: 'integer' }, description: '可选，素材箱条目 id' } }, ['platforms']),
    async run(a, ctx) {
      const last = await db.getKV<HotFetchResult>('hot.lastFetch');
      const items: RawHot[] = [...(last?.items ?? [])];
      if (Array.isArray(a.extra) && a.extra.length) {
        const inbox = (await listInbox()).filter((i) => a.extra.includes(i.id));
        items.push(...inbox.map((i) => ({ title: String(i.title || i.text || i.url).slice(0, 80), url: i.url, source: '素材箱', route: 'c', platform: i.platform ?? '用户', rank: 1 })));
        await markInboxUsed(inbox.map((i) => i.id));
      }
      if (!items.length) throw new ToolError('还没有可分析的热点', '先拉取热点，或粘贴几条你看到的热点');
      const platforms = (Array.isArray(a.platforms) && a.platforms.length ? a.platforms : ['xiaohongshu']).map(String);
      const r = await analyze(items, platforms, a.depth === 'quick' ? 'quick' : 'deep', ctx);
      await db.setKV('hot.lastAnalysis', r.clusters);
      return {
        result: { clusters: r.clusters.slice(0, 8).map((c) => ({ id: c.id, title: c.title, score: c.score, trend: c.trend, sources: c.sources, angles: c.angles, risk: c.risk, perPlatform: c.perPlatform })), usedModel: r.usedModel },
        card: { type: 'analysis', data: { clusters: r.clusters, platforms: platforms.map(toWritePlatform), usedModel: r.usedModel } }, refs: { clusterIds: r.clusters.map((c) => c.id) },
      };
    },
  },
  {
    name: 'hot_patrol', label: '热点巡视', level: 'L1',
    description: '把各平台官方热榜 / 发现页排成队列，在内置浏览器依次打开给用户本人翻看（底部浮条：下一个 / 发给 Agent / 结束）。Agent 不读取页面。',
    parameters: obj({ stops: { type: 'array', items: { type: 'string' }, description: '可选：weibo、xiaohongshu、douyin、zhihu、bilibili、kuaishou、trendinsight、baidu' } }),
    async run(a) {
      const ids: string[] = Array.isArray(a.stops) && a.stops.length ? a.stops : PATROL_STOPS.map((s) => s.id);
      const stops = PATROL_STOPS.filter((s) => ids.includes(s.id));
      if (!stops.length) throw new ToolError('没有可巡视的页面', '换几个平台试试');
      bus.emit({ type: 'patrol', stops });
      return { result: { opened: true, queue: stops.map((s) => s.label), note: '已在内置浏览器开始巡视，由用户本人翻看；用户点“发给 Agent”的内容会进入素材箱' }, card: { type: 'patrol', data: { stops } } };
    },
  },
  {
    name: 'inbox_list', label: '查看素材', level: 'L0', description: '列出用户主动“发给 Agent”或分享进来的素材（网址、文字、图片说明）。',
    parameters: obj({ since: str('ISO 时间，可选'), platform: str('平台 id，可选') }),
    async run(a) {
      const items = await listInbox({ since: a.since, platform: a.platform });
      return { result: items.slice(0, 30).map((i) => ({ id: i.id, kind: i.kind, platform: i.platform, title: i.title, url: i.url, text: i.text?.slice(0, 500), note: i.note, used: i.used })), card: { type: 'inbox', data: { items: items.slice(0, 10) } } };
    },
  },
  {
    name: 'platform_list', label: '平台列表', level: 'L0', description: '用户放进工作台的平台及是否登记了官方 App。',
    parameters: obj({}),
    async run() {
      const prefs = await getPrefs();
      const apps = await db.all('apps');
      return { result: prefs.platforms.map((p) => ({ id: p, label: center(p)?.label ?? p, app: apps.some((x) => x.platform === p) })) };
    },
  },
  {
    name: 'skill_route', label: '选择写作助手', level: 'L0', description: '按任务与平台选择写作助手（用户自定义优先，其次内置平台助手，找不到用通用规则）。',
    parameters: obj({ task: str('任务'), platform: str('写作平台 id') }, ['task']),
    async run(a) { return { result: await routeSkill(toWritePlatform(String(a.platform ?? detectPlatform(String(a.task)) ?? 'xiaohongshu'))) }; },
  },
  {
    name: 'draft_write', label: '写草稿', level: 'L1',
    description: '按画像、平台限制与写作助手写一篇草稿（先定本篇标准，再写），保存为待审草稿。',
    parameters: obj({ topic: str('选题'), platform: str('写作平台 id'), angle: str('角度，可选'), sources: { type: 'array', items: { type: 'string' }, description: '参考标题或链接，可选' } }, ['topic', 'platform']),
    async run(a, ctx) {
      const platform = toWritePlatform(String(a.platform));
      const route = await routeSkill(platform);
      const st = await standardOf(platform);
      const idea = [String(a.topic), a.angle ? `角度：${a.angle}` : '', Array.isArray(a.sources) && a.sources.length ? `参考：${a.sources.slice(0, 5).join('；')}` : '',
        `本篇标准：${st.titleMax ? `标题≤${st.titleMax}字；` : ''}${st.bodyMax ? `正文≤${st.bodyMax}字；` : ''}${st.must.join('；')}${st.avoid.length ? `；避免：${st.avoid.join('、')}` : ''}`].filter(Boolean).join('\n');
      const r = await generateDraft(idea, platform, ctx.cfg ? { providerId: ctx.cfg.id, model: ctx.cfg.model } : undefined);
      await db.update('drafts', r.draft.id, { idea: String(a.topic), angle: a.angle ?? '', standard: st, assistant: route.name });
      bus.emit({ type: 'drafts-changed' });
      const d = await draftOf(r.draft.id);
      return {
        result: { draftId: d.id, platform, title: d.title, bodyChars: charLen(String(d.body ?? '')), limit: st.bodyMax, warnings: r.warnings },
        card: draftCard(d, { assistant: route.name, assistantNote: route.reason, standard: st, ms: r.ms, cost: r.cost }), refs: { draftId: d.id },
      };
    },
  },
  {
    name: 'draft_revise', label: '改写草稿', level: 'L1', description: '按一句话要求改写草稿（覆盖前自动保存上一版，可撤销）。',
    parameters: obj({ draftId: { type: 'integer' }, instruction: str('修改要求') }, ['draftId', 'instruction']),
    async run(a, ctx) {
      const d = await draftOf(a.draftId);
      const versions = [...((d.versions as unknown[]) ?? []), { title: d.title, body: d.body, tags: d.tags, at: new Date().toISOString() }].slice(-5);
      await db.update('drafts', d.id, { versions });
      const r = await reviseDraft({ ...d, versions }, String(a.instruction), ctx.cfg ? { providerId: ctx.cfg.id, model: ctx.cfg.model } : undefined);
      bus.emit({ type: 'drafts-changed' });
      return { result: { draftId: d.id, title: r.draft.title, bodyChars: charLen(String(r.draft.body ?? '')) }, card: draftCard(r.draft, { previous: versions.at(-1) }), refs: { draftId: d.id } };
    },
  },
  {
    name: 'draft_format', label: '按平台格式化', level: 'L1', description: '把草稿按目标平台规则重排（标题长度、标签、分段、口播分句、表情）。目标平台不同则另存一篇新草稿。',
    parameters: obj({ draftId: { type: 'integer' }, platform: str('目标写作平台 id') }, ['draftId', 'platform']),
    async run(a, ctx) {
      const d = await draftOf(a.draftId);
      const platform = toWritePlatform(String(a.platform));
      const pick = ctx.cfg ? { providerId: ctx.cfg.id, model: ctx.cfg.model } : undefined;
      if (platform === d.platform) {
        const r = await reviseDraft(d, `按${writePlatform(platform).label}的格式规则重排：标题长度、标签、分段、表情，内容不变`, pick);
        return { result: { draftId: d.id }, card: draftCard(r.draft), refs: { draftId: d.id } };
      }
      const r = await generateDraft(`${String(d.title ?? '')}\n改写自已有草稿：${String(d.body ?? '').slice(0, 1500)}`, platform, pick);
      bus.emit({ type: 'drafts-changed' });
      return { result: { draftId: r.draft.id, platform }, card: draftCard(r.draft), refs: { draftId: r.draft.id } };
    },
  },
  {
    name: 'browser_open', label: '打开平台页面', level: 'L1', description: '在侧栏 / 主区打开某平台的首页、发布页，或该平台官方域名内的具体网址（只允许 https 且属于该平台白名单）。',
    parameters: obj({ platform: str('平台 id，如 xiaohongshu、douyin'), page: str('home | publish | url', { enum: ['home', 'publish', 'url'] }), url: str('page=url 时的网址') }, ['platform', 'page']),
    async run(a) {
      const c = center(String(a.platform)) ?? center(centerOfWrite(toWritePlatform(String(a.platform))).id);
      if (!c) throw new ToolError('不认识这个平台', '用 xiaohongshu、douyin、zhihu 等平台 id');
      let url = a.page === 'publish' ? c.publishUrl : c.url;
      if (a.page === 'url') {
        let u: URL;
        try { u = new URL(String(a.url)); } catch { throw new ToolError('网址格式不对'); }
        if (u.protocol !== 'https:' || !c.hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return { result: { opened: false, reason: '网址不属于该平台官方域名，已拒绝' }, card: { type: 'open', data: { opened: false, label: c.label, reason: '网址不属于该平台官方域名' } } };
        url = u.toString();
      }
      bus.emit({ type: 'open', platform: c.id, url, label: c.label, hosts: c.hosts });
      return { result: { opened: true, platform: c.id, url }, card: { type: 'open', data: { opened: true, label: c.label, page: a.page, url } } };
    },
  },
  {
    name: 'clipboard_copy', label: '复制', level: 'L1', description: '把草稿全文或一段文字复制到剪贴板。',
    parameters: obj({ draftId: { type: 'integer' }, text: str('要复制的文字') }),
    async run(a) {
      const text = a.draftId ? fullText(await draftOf(a.draftId)) : String(a.text ?? '');
      const copied = await copyText(text);
      return { result: { copied }, card: { type: 'note', data: { text: copied ? '已复制到剪贴板' : '复制失败，请手动长按复制' } } };
    },
  },
  {
    name: 'publish_check', label: '发布前检查', level: 'L0', description: '发布前质量门禁：字数、标题、标签、敏感词与合规、未证实信息、画像偏好红线、平台限制、配图。有阻断项时不能去发布。',
    parameters: obj({ draftId: { type: 'integer' }, platform: str('写作平台 id，可选，缺省用草稿的平台') }, ['draftId']),
    async run(a) {
      const d = await draftOf(a.draftId);
      const platform = toWritePlatform(String(a.platform ?? d.platform));
      const r = await runChecks(d, platform);
      await db.update('drafts', d.id, { last_check: { platform, blocking: r.blocking, at: new Date().toISOString() } });
      return { result: { blocking: r.blocking, failed: r.checks.filter((c) => !c.pass).map((c) => `${c.label}：${c.detail}`) }, card: { type: 'check', data: { draftId: d.id, platform, ...r } } };
    },
  },
  {
    name: 'publish_prepare', label: '准备发布', level: 'L1', description: '复制文案并在主区打开该平台发布页，给出“粘贴 → 检查 → 由你本人点击发布”三步。前置：最近一次 publish_check 无阻断项，否则返回 needs_check。',
    parameters: obj({ draftId: { type: 'integer' }, platform: str('写作平台 id，可选') }, ['draftId']),
    async run(a) {
      const d = await draftOf(a.draftId);
      const platform = toWritePlatform(String(a.platform ?? d.platform));
      const lc = d.last_check as { platform: string; blocking: boolean } | undefined;
      if (!lc || lc.blocking || lc.platform !== platform) return { result: { needs_check: true, reason: lc?.blocking ? '上次检查有阻断项' : '还没做发布前检查' } };
      const c = centerOfWrite(platform);
      const copied = await copyText(fullText(d));
      const url = publishUrlOfWrite(platform);
      bus.emit({ type: 'open', platform: c.id, url, label: c.label, hosts: c.hosts });
      const steps = ['在发布框里长按粘贴', '检查文字、上传配图', '由你本人点击发布'];
      return { result: { copied, opened: true, steps }, card: { type: 'publish', data: { draftId: d.id, platform, label: c.label, copied, url, steps } } };
    },
  },
  {
    name: 'publish_mark', label: '标记已发布', level: 'L2', userOnly: true, description: '把草稿标记为已发布（只能由用户在发布卡上点“我已发布”触发）。',
    parameters: obj({ draftId: { type: 'integer' }, platform: str('写作平台 id'), url: str('发布后的链接，可选') }, ['draftId']),
    async run(a) {
      const d = await draftOf(a.draftId);
      const u = await db.update('drafts', d.id, { status: 'handed_off', published_url: a.url ?? '', published_at: new Date().toISOString() });
      bus.emit({ type: 'drafts-changed' });
      return { result: { status: u.status } };
    },
  },
  {
    name: 'metrics_record', label: '录入数据', level: 'L2',
    description: '记录一篇已发布内容的数据。只能填用户在对话里明确说出的数字；没有数字时返回录入表单由用户填写。覆盖已有数据前需用户确认。',
    parameters: obj({ draftId: { type: 'integer' }, views: { type: 'integer' }, likes: { type: 'integer' }, comments: { type: 'integer' }, collects: { type: 'integer' }, shares: { type: 'integer' } }, ['draftId']),
    needsConfirm: async (a) => (await db.all('metrics')).some((m) => m.draft_id === Number(a.draftId)) && ['views', 'likes', 'comments', 'collects', 'shares'].some((k) => typeof a[k] === 'number'),
    async run(a) {
      const d = await draftOf(a.draftId);
      const vals = Object.fromEntries(['views', 'likes', 'comments', 'collects', 'shares'].filter((k) => typeof a[k] === 'number').map((k) => [k, a[k]]));
      if (!Object.keys(vals).length) return { result: { form: true }, card: { type: 'metrics-form', data: { draftId: d.id, title: d.title, prefill: {} } } };
      const exist = (await db.all('metrics')).find((m) => m.draft_id === d.id);
      const row = exist ? await db.update('metrics', exist.id, vals) : await db.insert('metrics', { draft_id: d.id, platform: d.platform, ...vals });
      return { result: { saved: true, metric: vals }, card: { type: 'metrics-form', data: { draftId: d.id, title: d.title, prefill: vals, saved: true, metricId: row.id } } };
    },
  },
  {
    name: 'metrics_import', label: '导入数据', level: 'L2', userOnly: true, description: '导入平台官方导出的 CSV（由用户在输入框“＋导入”选择文件后触发）。',
    parameters: obj({ fileId: str('文件 id') }, ['fileId']),
    async run() { throw new ToolError('请点输入框的“＋ → 导入数据”选择平台导出的 CSV 文件'); },
  },
  {
    name: 'metrics_summary', label: '数据复盘', level: 'L0', description: '汇总已录入的数据：总量、趋势、最好与最差的 3 篇、复盘建议。',
    parameters: obj({ range: str('7d | 30d | all', { enum: ['7d', '30d', 'all'] }), platform: str('写作平台 id，可选') }),
    async run(a) {
      const days = a.range === '7d' ? 7 : a.range === '30d' ? 30 : 36500;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const drafts = await db.all('drafts');
      const rows = (await db.all('metrics')).filter((m) => String(m.updated_at ?? m.created_at) >= since).map((m) => ({ ...m, draft: drafts.find((d) => d.id === m.draft_id) }) as Row & { draft?: Row }).filter((m) => !a.platform || m.draft?.platform === toWritePlatform(String(a.platform)));
      const score = (m: Row) => Number(m.views ?? 0) + 10 * Number(m.likes ?? 0) + 20 * Number(m.collects ?? 0) + 30 * Number(m.comments ?? 0);
      const sorted = [...rows].sort((x, y) => score(y) - score(x));
      const sum = (k: string) => rows.reduce((s, m) => s + Number(m[k] ?? 0), 0);
      const totals = { posts: rows.length, views: sum('views'), likes: sum('likes'), comments: sum('comments'), collects: sum('collects'), shares: sum('shares') };
      const pick = (m: (typeof rows)[number]) => ({ draftId: m.draft_id, title: String(m.draft?.title ?? `#${m.draft_id}`), views: Number(m.views ?? 0), likes: Number(m.likes ?? 0) });
      const tips = rows.length ? ['把表现最好的那篇的开头结构复用到下一篇', '表现最差的几篇看标题是否缺少具体数字或人群', '同一话题换平台再发一次，比较差异'] : ['还没有数据：发布后点“录入数据”，或从平台导出 CSV 导入'];
      return { result: { totals, best: sorted.slice(0, 3).map(pick), worst: sorted.slice(-3).reverse().map(pick), tips }, card: { type: 'metrics', data: { totals, best: sorted.slice(0, 3).map(pick), worst: sorted.slice(-3).reverse().map(pick), series: rows.map((m) => ({ t: String(m.updated_at ?? m.created_at).slice(5, 10), v: Number(m.views ?? 0) })).slice(-14), tips, range: a.range ?? 'all' } } };
    },
  },
  {
    name: 'profile_read', label: '读取画像', level: 'L0', description: '读取账号画像（定位、受众、风格、平台限制、偏好红线、历史表现）。',
    parameters: obj({}), async run() { return { result: await getProfile() }; },
  },
  {
    name: 'profile_update', label: '更新画像', level: 'L2', description: '提议修改账号画像（只能改画像字段）。用户在画像更新卡上点“采纳”才写入。',
    parameters: obj({ patch: { type: 'object', description: 'positioning / audience / style / platforms / redlines / performance' }, reason: str('理由') }, ['patch', 'reason']),
    async run(a) {
      const cur = await getProfile();
      const { next, diff } = applyProfilePatch(cur, (a.patch ?? {}) as Record<string, unknown>);
      if (!diff.length) return { result: { changed: false } };
      return { result: { proposed: true, fields: diff.map((d) => d.field), note: '等待用户采纳' }, card: { type: 'profile', data: { diff, next, reason: a.reason, adopted: false } } };
    },
  },
  {
    name: 'task_resume', label: '接着上次', level: 'L0', description: '读取最近一次未完成的多步任务的检查点与剩余步骤，从最后一个完成的步骤往下继续，已完成的步骤不要重复。',
    parameters: obj({ taskId: { type: 'integer' } }),
    async run(a, ctx) {
      const t = a.taskId ? ((await db.get('tasks', Number(a.taskId))) as unknown as Awaited<ReturnType<typeof lastUnfinishedTask>>) : await lastUnfinishedTask(ctx.conversationId) ?? await lastUnfinishedTask();
      if (!t) return { result: { none: true }, card: { type: 'progress', data: { none: true } } };
      return { result: { taskId: t.id, goal: t.goal, done: t.steps.filter((s) => s.status === 'done').map((s) => ({ tool: s.tool, summary: s.summary, refs: s.refs })), failed: t.steps.filter((s) => s.status === 'failed').map((s) => s.summary), next: t.next }, card: { type: 'progress', data: t } };
    },
  },
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);
export const TOOL_DEFS = TOOLS.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
/** 不存在任何 L3（对外写入）工具：单测断言这个集合为空。 */
export const EXTERNAL_WRITE_TOOLS = TOOLS.filter((t) => /publish(?!_check|_prepare|_mark)|post|comment|like|follow|message|dm/i.test(t.name) && !t.userOnly);

export function fullText(d: Row): string {
  const tags = ((d.tags as string[]) ?? []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  return [d.title, d.body, tags].filter(Boolean).join('\n\n');
}

export async function routeSkill(platform: string): Promise<{ assistantId: string; name: string; skill: string; reason: string }> {
  const ov = (await getAssistantOverrides())[platform];
  const a = assistantOf(platform);
  if (ov?.body?.trim()) return { assistantId: platform, name: `${a?.name ?? writePlatform(platform).label}（你自定义的）`, skill: writePlatform(platform).skill, reason: '用户自定义的写作助手优先' };
  if (a) return { assistantId: platform, name: a.name, skill: writePlatform(platform).skill, reason: '内置平台写作助手' };
  return { assistantId: 'generic', name: '通用写作规则', skill: 'generic', reason: '没有专门的助手，已用通用规则' };
}
