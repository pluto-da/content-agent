/**
 * 内置工具（6.19 + 8.13 + 0.8 工具中可本机实现的部分）：工具定义只有一份，服务（模型调用、媒体库、草稿、提醒、记忆、收益、VFS、热点）由调用方注入。
 * web 端注入 IndexedDB 实现；评测注入内存实现。没有任何对外写入工具（注册表强制）。
 */
import { evolutionRisk } from '../evolution/index.js';
import { ToolRegistry, type ToolOutput, type ToolSpec, type Source } from './tools.js';
import { callError, type CallError } from '../models/errors.js';
import type { CallResult } from '../models/runner.js';
import type { RoleRequest, MediaOut } from '../models/adapters/types.js';
import type { RoleId } from '../models/roles.js';
import { parseWhenZh, shDateTime } from '../core/time.js';
import { roleLabel } from '../models/roles.js';
import { t } from '../core/i18n.js';

export interface MediaRef { id: string; kind: 'image' | 'audio' | 'video'; mime: string; model: string; aiLabel: { explicit: boolean; implicit: boolean } }
export interface DraftRef { id: string; platform: string; title: string; body: string; image_prompts?: string[]; revenueHypothesis?: { path: string; funnelLayer: string; metric: string; window: string; control?: string } }
export interface ToolServices {
  call(role: RoleId, req: RoleRequest, o: { runId: string; toolCallId: string; conversationId: number; signal: AbortSignal; override?: { accountId: string; modelEntryId: string; model: string }; task?: string }): Promise<CallResult>;
  estimate(role: RoleId, est: { chars?: number; images?: number; seconds?: number }): number | null;
  configured(role: RoleId): boolean;
  saveMedia(items: MediaOut[], meta: { role: RoleId; model: string; prompt: string; vendor?: string }): Promise<MediaRef[]>;
  getMedia(id: string): Promise<{ dataUrl: string; mime: string } | null>;
  writeDraft(input: { platform: string; topic: string; userText: string; signal: AbortSignal }): Promise<DraftRef | CallError>;
  listDrafts(): Promise<DraftRef[]>;
  deleteDrafts(ids: string[]): Promise<number>;
  hot(platforms?: string[]): Promise<{ items: { id: string; title: string; url?: string; source: string }[]; unavailable: { platform: string; reason: string }[] }>;
  addReminder(r: { text: string; at?: string; rrule?: string; link?: string }): Promise<{ id: string }>;
  cancelReminder(idOrText: string): Promise<number>;
  proposeMemory(text: string, o: { condition?: string }): Promise<{ ok: boolean; reason?: string; path?: string }>;
  forgetMemory(query: string): Promise<{ removed: number; verifyHits: number }>;
  revenueSummary(): Promise<{ total: number; count: number; text: string }>;
  modelsStatus(): Promise<Record<string, { configured: boolean; model?: string; healthy?: boolean }>>;
  proposeSystemFile(target: string, after: string, reason: string): Promise<{ ok: boolean; id?: string; errors?: string[]; auto?: boolean }>;
  pollVideo(jobId: string, signal: AbortSignal): Promise<CallResult>;
  search(query: string, scope: string, k: number): Promise<{ mode: 'keyword' | 'vector'; hits: { id: string; title: string; score: number }[] }>;
  now(): Date;
}

const fail = (e: CallError): ToolOutput => ({ ok: false, error: e });
const notConfigured = (role: RoleId): ToolOutput => ({ ok: false, error: callError('role_not_configured', { role }), card: { type: 'not_configured', data: { role, roleName: roleLabel(role), deepLink: `#me/models/${role}`, text: t('err.role_not_configured', { roleName: roleLabel(role) }) } } });
const modelOf = (r: Extract<CallResult, { ok: true }>) => ({ model: r.target.model, respondedModel: r.respondedModel && r.respondedModel !== r.target.model ? r.respondedModel : undefined });

export function createBuiltinTools(s: ToolServices): ToolRegistry {
  const reg = new ToolRegistry();
  const add = (x: ToolSpec) => reg.add(x);
  const media = async (role: RoleId, req: RoleRequest, ctx: Parameters<ToolSpec['run']>[1], prompt: string, task?: string): Promise<ToolOutput> => {
    if (!s.configured(role) && !ctx.modelOverride?.[role]) return notConfigured(role);
    const r = await s.call(role, req, { runId: ctx.runId, toolCallId: ctx.stepId, conversationId: ctx.conversationId, signal: ctx.signal, override: ctx.modelOverride?.[role], ...(task ? { task } : {}) });
    if (!r.ok && r.error.kind === 'role_not_configured') return notConfigured(role);
    if (!r.ok) return { ok: false, error: r.error, card: { type: role === 'video' ? 'video' : role === 'tts' ? 'audio' : 'image', data: { status: 'failed', reason: r.error.reason, advice: r.error.advice, actions: r.error.actions, model: r.target?.model } } };
    if (r.value.type === 'job') return { ok: true, result: { jobId: r.value.jobId, status: r.value.status }, cost: r.cost, ...modelOf(r), card: { type: 'video', data: { status: r.value.status, jobId: r.value.jobId, ...modelOf(r) } } };
    if (r.value.type !== 'media') return fail(callError('format'));
    const refs = await s.saveMedia(r.value.items, { role, model: r.target.model, prompt, vendor: r.account.vendor });
    return { ok: true, result: { media: refs.map((m) => m.id), count: refs.length, model: r.target.model }, count: refs.length, artifacts: refs.map((m) => m.id), cost: r.cost, ...modelOf(r), card: { type: role === 'tts' ? 'audio' : 'image', data: { media: refs, cost: r.cost, note: r.note, ...modelOf(r) } } };
  };
  add({ name: 'draft_write', title: '写稿', description: '按平台把选题写成草稿（含标题、正文、配图提示词与收益假设）', level: 'L1', idempotent: true, role: 'chat', inputSchema: { type: 'object', required: ['platform', 'topic'], properties: { platform: { type: 'string' }, topic: { type: 'string', minLength: 1 } } }, estimateCost: () => s.estimate('chat', { chars: 3000 }),
    async run(a, ctx) { const d = await s.writeDraft({ platform: String(a.platform), topic: String(a.topic), userText: ctx.userText, signal: ctx.signal }); if ('kind' in d) return fail(d); return { ok: true, result: d, card: { type: 'draft', data: { ...d } }, artifacts: [d.id] }; } });
  add({ name: 'image_generate', title: '生图', description: '按提示词出图（AI 生成标识默认开启）', level: 'L1', idempotent: true, role: 'image', media: true, inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string', minLength: 1 }, aspect: { type: 'string' }, purpose: { type: 'string', enum: ['cover', 'illustration'], description: 'cover=封面（按任务路由可用单独的模型）' }, size: { type: 'string' }, n: { type: 'integer', minimum: 1, maximum: 4 }, negative: { type: 'string' } } }, timeoutMs: 120000, estimateCost: (a) => (s.configured('image') ? s.estimate('image', { images: Number(a.n ?? 1) }) : 0),
    run: (a, ctx) => media('image', { role: 'image', prompt: String(a.prompt), aspect: a.aspect as string | undefined, size: a.size as string | undefined, n: Number(a.n ?? 1), negative: a.negative as string | undefined }, ctx, String(a.prompt), a.purpose === 'cover' ? 'cover' : undefined) });
  add({ name: 'image_edit', title: '改图', description: '对素材里的图按指令修改（结果另存，不覆盖原图）', level: 'L1', idempotent: true, role: 'imageEdit', media: true, inputSchema: { type: 'object', required: ['images', 'instruction'], properties: { images: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } }, instruction: { type: 'string', minLength: 1 } } }, timeoutMs: 120000, estimateCost: () => (s.configured('imageEdit') ? s.estimate('imageEdit', { images: 1 }) : 0),
    async run(a, ctx) { const imgs: string[] = []; for (const id of a.images as string[]) { const m = await s.getMedia(id); if (!m) return fail({ ...callError('unknown'), reason: `素材里找不到图片 ${id}` }); imgs.push(m.dataUrl); } return media('imageEdit', { role: 'imageEdit', images: imgs, instruction: String(a.instruction) }, ctx, String(a.instruction)); } });
  add({ name: 'image_understand', title: '看图', description: '看图回答问题（含识字）', level: 'L0', idempotent: true, role: 'vision', inputSchema: { type: 'object', required: ['image', 'question'], properties: { image: { type: 'string' }, question: { type: 'string' }, purpose: { type: 'string', enum: ['ocr', 'understand'], description: 'ocr=只识别图中文字（按任务路由可用单独的模型）' } } },
    async run(a, ctx) { if (!s.configured('vision')) return notConfigured('vision'); const m = await s.getMedia(String(a.image)); const r = await s.call('vision', { role: 'vision', image: m?.dataUrl ?? String(a.image), question: String(a.question) }, { runId: ctx.runId, toolCallId: ctx.stepId, conversationId: ctx.conversationId, signal: ctx.signal, override: ctx.modelOverride?.vision, ...(a.purpose === 'ocr' ? { task: 'ocr' } : {}) }); if (!r.ok) return fail(r.error); return { ok: true, result: { text: r.value.type === 'text' ? r.value.text : '' }, cost: r.cost, ...modelOf(r) }; } });
  add({ name: 'speech_synthesize', title: '配音', description: '把文字合成语音（超长自动分段）', level: 'L1', idempotent: true, role: 'tts', media: true, inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 }, voice: { type: 'string' }, speed: { type: 'number' }, style: { type: 'string' } } }, estimateCost: (a) => (s.configured('tts') ? s.estimate('tts', { chars: String(a.text ?? '').length }) : 0),
    run: (a, ctx) => media('tts', { role: 'tts', text: String(a.text), voice: a.voice as string | undefined, speed: a.speed as number | undefined, style: a.style as string | undefined }, ctx, String(a.text).slice(0, 40)) });
  add({ name: 'speech_transcribe', title: '转写', description: '把录音转成文字（可带时间戳）', level: 'L0', idempotent: true, role: 'asr', inputSchema: { type: 'object', required: ['audio'], properties: { audio: { type: 'string' }, language: { type: 'string' }, timestamps: { type: 'boolean' } } }, estimateCost: () => (s.configured('asr') ? s.estimate('asr', { seconds: 60 }) : 0),
    async run(a, ctx) { if (!s.configured('asr')) return notConfigured('asr'); const m = await s.getMedia(String(a.audio)); if (!m) return fail({ ...callError('unknown'), reason: '素材里找不到这段录音' }); const b64 = m.dataUrl.slice(m.dataUrl.indexOf(',') + 1); const r = await s.call('asr', { role: 'asr', audio: { base64: b64, format: m.mime.split('/')[1] ?? 'wav', mime: m.mime }, language: a.language as string | undefined, timestamps: !!a.timestamps }, { runId: ctx.runId, toolCallId: ctx.stepId, conversationId: ctx.conversationId, signal: ctx.signal }); if (!r.ok) return fail(r.error); const text = r.value.type === 'transcript' ? r.value.text : ''; return { ok: true, result: { text, segments: r.value.type === 'transcript' ? r.value.segments : undefined }, cost: r.cost, card: { type: 'transcript', data: { text, segments: r.value.type === 'transcript' ? r.value.segments : [], ...modelOf(r) } }, ...modelOf(r) }; } });
  add({ name: 'video_generate', title: '生成视频', description: '提交视频生成任务（每次都要大哥确认费用）', level: 'L2', idempotent: false, role: 'video', media: true, inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string', minLength: 1 }, duration: { type: 'number' }, aspect: { type: 'string' }, firstFrame: { type: 'string' } } }, timeoutMs: 30000, estimateCost: (a) => s.estimate('video', { seconds: Number(a.duration ?? 5) }),
    run: (a, ctx) => media('video', { role: 'video', prompt: String(a.prompt), duration: a.duration as number | undefined, aspect: a.aspect as string | undefined }, ctx, String(a.prompt)) });
  add({ name: 'video_status', title: '查视频进度', description: '查询视频任务状态；完成后立即下载入库（链接常 24 小时内失效）', level: 'L0', idempotent: true, inputSchema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } },
    async run(a, ctx) {
      const r = await s.pollVideo(String(a.jobId), ctx.signal);
      if (!r.ok) return fail(r.error);
      if (r.value.type !== 'job') return fail(callError('format'));
      if (r.value.status === 'succeeded' && r.value.items?.length) { const refs = await s.saveMedia(r.value.items, { role: 'video', model: r.target.model, prompt: String(a.jobId), vendor: r.account?.vendor }); return { ok: true, result: { status: 'succeeded', media: refs.map((m) => m.id) }, count: refs.length, artifacts: refs.map((m) => m.id), card: { type: 'video', data: { status: 'succeeded', media: refs, ...modelOf(r) } } }; }
      return { ok: true, result: { status: r.value.status, error: r.value.error }, card: { type: 'video', data: { status: r.value.status, jobId: a.jobId, ...modelOf(r) } } };
    } });
  add({ name: 'reason_deep', title: '深度推理', description: '需要多步推理的问题交给推理模型，返回结论与推理过程', level: 'L0', idempotent: true, role: 'reason', inputSchema: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } }, estimateCost: () => s.estimate('reason', { chars: 2000 }),
    async run(a, ctx) { const r = await s.call('reason', { role: 'reason', messages: [{ role: 'user', content: String(a.question) }], thinking: true }, { runId: ctx.runId, toolCallId: ctx.stepId, conversationId: ctx.conversationId, signal: ctx.signal }); if (!r.ok) return fail(r.error); const v = r.value.type === 'text' ? r.value : { text: '', reasoning: '' }; return { ok: true, result: { conclusion: v.text }, cost: r.cost, card: { type: 'reason', data: { conclusion: v.text, reasoning: v.reasoning, ...modelOf(r) } }, ...modelOf(r) }; } });
  add({ name: 'library_search', title: '检索', description: '在草稿、素材、热点快照里检索（未接向量模型时用关键词检索并说明）', level: 'L0', idempotent: true, inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, scope: { type: 'string' }, topK: { type: 'integer' } } },
    async run(a) { const r = await s.search(String(a.query), String(a.scope ?? 'drafts'), Number(a.topK ?? 5)); return { ok: true, result: r, card: { type: 'search', data: r } }; } });
  add({ name: 'hot_list', title: '看热点', description: '读取已启用的合法热点来源（无合法来源的平台如实标注）', level: 'L0', idempotent: true, inputSchema: { type: 'object', properties: { platforms: { type: 'array', items: { type: 'string' } } } },
    async run(a) { const r = await s.hot(a.platforms as string[] | undefined); const sources: Source[] = r.items.map((x) => ({ id: x.id, title: x.title, url: x.url })); return { ok: true, result: { items: r.items.slice(0, 50), total: r.items.length, unavailable: r.unavailable }, sources, card: { type: 'hot', data: r } }; } });
  add({ name: 'publish_check', title: '发布前检查', description: '字数、标题、标签、AI 标识声明、授权、收益假设（只检查，不发布）', level: 'L0', idempotent: true, inputSchema: { type: 'object', required: ['draftId'], properties: { draftId: { type: 'string' }, mediaIds: { type: 'array', items: { type: 'string' } } } },
    async run(a) {
      const d = (await s.listDrafts()).find((x) => x.id === a.draftId);
      if (!d) return fail({ ...callError('unknown'), reason: '找不到这篇草稿' });
      const items: { ok: boolean; text: string }[] = [
        { ok: [...d.title].length <= (d.platform === 'xiaohongshu' ? 20 : 64), text: `标题 ${[...d.title].length} 字` },
        { ok: !!d.revenueHypothesis, text: d.revenueHypothesis ? '已挂收益假设' : '还没有收益假设（建议补上，不阻断）' },
      ];
      const m = (a.mediaIds as string[] | undefined) ?? [];
      if (m.length) items.push({ ok: true, text: `含 ${m.length} 个 AI 生成媒体：请在平台发布页勾选“AI 生成”声明（由你本人勾选）` }, { ok: true, text: '图片含真实人物或品牌时，请确认已获授权' });
      return { ok: true, result: { items, ready: items.every((i) => i.ok) }, card: { type: 'checklist', data: { items, note: t('agent.publish_ready') } } };
    } });
  add({ name: 'reminder_create', title: '设提醒', description: '创建本机提醒（到点只提醒，不自动执行任何动作）。when 用大哥的原话，如“明早9点”', level: 'L1', idempotent: true, inputSchema: { type: 'object', required: ['text', 'when'], properties: { text: { type: 'string' }, when: { type: 'string' }, link: { type: 'string' } } },
    async run(a) { const w = parseWhenZh(String(a.when), s.now()); if (!w) return fail({ ...callError('unknown'), reason: `没看懂时间“${a.when}”`, advice: '请说具体时间，比如“明早 9 点”' }); const r = await s.addReminder({ text: String(a.text), at: w.at?.toISOString(), rrule: w.rrule, link: a.link as string | undefined }); return { ok: true, result: { id: r.id, when: w.text, at: w.at ? shDateTime(w.at) : undefined }, card: { type: 'reminder', data: { id: r.id, text: a.text, when: w.text } } }; } });
  add({ name: 'reminder_cancel', title: '取消提醒', description: '取消本机提醒', level: 'L1', idempotent: true, inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string' } } }, async run(a) { const n = await s.cancelReminder(String(a.target)); return { ok: true, result: { cancelled: n } }; } });
  add({ name: 'memory_propose', title: '记住偏好', description: '写入长期记忆（低风险：“低风险改进自动生效”开着时校验通过即写入，可在成长记录回滚；关着时等大哥点“记住”）', level: 'L2', idempotent: true, kind: 'memory', lowRisk: () => true, noSubtask: true, inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, condition: { type: 'string' } } },
    async run(a) { const r = await s.proposeMemory(String(a.text), { condition: a.condition as string | undefined }); return r.ok ? { ok: true, result: r, card: { type: 'memory', data: { text: a.text, condition: a.condition, path: r.path } } } : fail({ ...callError('unknown'), reason: r.reason ?? '没有记住' }); } });
  add({ name: 'memory_delete', title: '忘掉', description: '检索并删除相关记忆，删除后再检索验证为 0，并写“不要记住”规则', level: 'L2', idempotent: true, kind: 'delete', noSubtask: true, inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    async run(a) { const r = await s.forgetMemory(String(a.query)); return { ok: true, result: r, card: { type: 'memory', data: { forgotten: r.removed, verifyHits: r.verifyHits } } }; } });
  add({ name: 'drafts_delete', title: '删除草稿', description: '删除草稿（必须确认）', level: 'L2', idempotent: false, kind: 'delete', noSubtask: true, inputSchema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } },
    async run(a) { const ids = a.ids as string[]; const all = ids.includes('*') ? (await s.listDrafts()).map((d) => d.id) : ids; const n = await s.deleteDrafts(all); return { ok: true, result: { deleted: n } }; } });
  add({ name: 'models_status', title: '模型状态', description: '各能力是否已接、默认模型、健康度', level: 'L0', idempotent: true, inputSchema: { type: 'object', properties: {} }, async run() { return { ok: true, result: await s.modelsStatus() }; } });
  add({ name: 'revenue_summary', title: '收益汇总', description: '汇总大哥录入或导入的收入（没有数据就说没有）', level: 'L0', idempotent: true, inputSchema: { type: 'object', properties: {} }, async run() { const r = await s.revenueSummary(); return { ok: true, result: r, card: { type: 'revenue', data: r } }; } });
  add({ name: 'system_file_propose', title: '修订建议', description: '对系统文件或技能提出修订建议（技能 / 记忆 / lesson 属低风险，开关开着时校验通过自动采纳、可回滚；SOUL / AGENTS / SYSTEM / USER 等核心文件生成改动对比，大哥确认后才生效；BOUNDARIES.md 不接受）', level: 'L2', idempotent: true, kind: 'system_file', lowRisk: (a) => evolutionRisk(String(a.target ?? '')) === 'low', noSubtask: true, inputSchema: { type: 'object', required: ['target', 'after', 'reason'], properties: { target: { type: 'string' }, after: { type: 'string' }, reason: { type: 'string' } } },
    async run(a) { const r = await s.proposeSystemFile(String(a.target), String(a.after), String(a.reason)); return r.ok ? { ok: true, result: r, card: { type: 'proposal', data: { id: r.id, target: a.target, auto: !!r.auto } } } : fail({ ...callError('unknown'), reason: `修订建议被拒：${(r.errors ?? []).join('；')}` }); } });
  return reg;
}
