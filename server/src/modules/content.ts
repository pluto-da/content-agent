import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db.js';
import { parseJson } from '../db.js';
import type { ModelHub } from '../models/hub.js';
import { extractJson, toSrt } from '../models/util.js';
import { chatStructured } from '../models/structured.js';
import { validate, type JsonSchema } from '../models/schema.js';
import { schemaFor, systemPrompt } from './prompt.js';
import { confidenceTier, draftVerifySettings, signalsOf, TIER_LABEL, type Tier } from './confidence.js';
import type { Skill } from '../skills/loader.js';
import { missingCapabilities } from '../skills/loader.js';
import type { AgentFiles } from './agentfiles.js';
import { checkCompliance } from './compliance.js';
import { getItems } from './library.js';
import { composeDraftVideo, VIDEO_PLATFORMS } from './video.js';

export const PLATFORMS = {
  xiaohongshu: { label: '小红书图文', skill: 'xiaohongshu-note' },
  douyin_script: { label: '抖音口播脚本', skill: 'douyin-script' },
  channels: { label: '视频号', skill: 'channels-video' },
  wechat_article: { label: '公众号长文', skill: 'wechat-article' },
  xianyu: { label: '闲鱼文案', skill: 'xianyu-listing' },
  x_post: { label: 'X 帖子', skill: 'x-post' },
  zhihu_answer: { label: '知乎回答', skill: 'zhihu-answer' },
  zhihu_article: { label: '知乎专栏文章', skill: 'zhihu-article' },
} as const;
export type Platform = keyof typeof PLATFORMS;
export function isPlatform(p: string): p is Platform {
  return p in PLATFORMS;
}

export interface Deps {
  db: DB;
  hub: ModelHub;
  agent: AgentFiles;
  skills: () => Skill[];
  mediaDir: string;
}

export { systemPrompt } from './prompt.js';

function findSkill(deps: Deps, name: string): Skill {
  const s = deps.skills().find((x) => x.name === name);
  if (!s) throw new Error(`缺少 skill：${name}`);
  return s;
}

/* ---------------- 选题 ---------------- */

interface TopicOut { title: string; angle?: string; platforms?: string[]; score?: number; reason?: string; risk?: string; item_ids?: number[] }

export async function generateTopics(deps: Deps, itemIds: number[]): Promise<number[]> {
  const items = getItems(deps.db, itemIds);
  if (!items.length) throw new Error('没有可用的内容库条目');
  const skill = findSkill(deps, 'topic-selection');
  const list = items.map((i) => `- [${i.id}] ${i.title}${i.summary ? `（${i.summary.slice(0, 80)}）` : ''}`).join('\n');
  const r = await deps.hub.chat('topics', [
    { role: 'system', content: systemPrompt(deps.agent, skill) },
    { role: 'user', content: `[TASK:topics]\n以下是内容库条目：\n${list}\n请输出 JSON：{"topics":[{"title","angle","platforms","score","reason","risk","item_ids"}]}` },
  ]);
  const out = extractJson<{ topics: TopicOut[] }>(r.content);
  const ins = deps.db.prepare("INSERT INTO topics(title, angle, platforms, score, reason, risk, item_ids, model, origin) VALUES(?,?,?,?,?,?,?,?, 'library')");
  const ids = (out.topics ?? []).filter((t) => t.title).map((t) =>
    Number(ins.run(t.title, t.angle ?? '', JSON.stringify((t.platforms ?? []).filter(isPlatform)), t.score ?? null, t.reason ?? '', t.risk ?? '', JSON.stringify(t.item_ids ?? []), `${r.provider}/${r.model}`).lastInsertRowid),
  );
  deps.agent.daily(`生成选题 ${ids.length} 个（模型 ${r.provider}/${r.model}${r.mock ? '，模拟' : ''}）`);
  return ids;
}

export function listTopics(db: DB, status?: string): Record<string, unknown>[] {
  const rows = (status ? db.prepare('SELECT * FROM topics WHERE status = ? ORDER BY id DESC LIMIT 200').all(status) : db.prepare('SELECT * FROM topics ORDER BY id DESC LIMIT 200').all()) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, platforms: parseJson(r.platforms, []), item_ids: parseJson(r.item_ids, []), research: parseJson(r.research, null) }));
}

/* ---------------- 改写流水线（每步落库，可断点续跑） ---------------- */

export interface PipelineStep { step: string; ok: boolean; message?: string; provider?: string; mock?: boolean }
interface RewriteOut { title?: string; body: string; tags?: string[]; image_prompts?: string[]; voiceover?: string }
type Asset = { type: string; url: string; note?: string };
interface StepRow { step: string; status: string; output: string | null; error: string | null; attempts: number }
interface StepOutput { display: PipelineStep[]; assets: Asset[]; data?: unknown }

function saveMedia(deps: Deps, draftId: number, name: string, data: Buffer | string): string {
  const dir = join(deps.mediaDir, String(draftId));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
  return `/api/media/${draftId}/${name}`;
}

/** 写一步结果（ON CONFLICT 更新保持原行顺序，供按顺序重建流水线展示）。 */
function saveStep(db: DB, draftId: number, step: string, ok: boolean | 'skipped', output: StepOutput, error?: string): void {
  db.prepare(`INSERT INTO draft_steps(draft_id, step, status, output, error, attempts) VALUES(?,?,?,?,?,1)
    ON CONFLICT(draft_id, step) DO UPDATE SET status = excluded.status, output = excluded.output, error = excluded.error, attempts = draft_steps.attempts + 1, updated_at = datetime('now')`).run(
    draftId, step, ok === 'skipped' ? 'skipped' : ok ? 'ok' : 'failed', JSON.stringify(output), error ?? null,
  );
}

export function draftSteps(db: DB, draftId: number): (Omit<StepRow, 'output'> & { output: StepOutput | null })[] {
  const rows = db.prepare('SELECT step, status, output, error, attempts FROM draft_steps WHERE draft_id = ? ORDER BY rowid').all(draftId) as unknown as StepRow[];
  return rows.map((r) => ({ ...r, output: parseJson<StepOutput | null>(r.output, null) }));
}

function pipelineOf(db: DB, draftId: number): PipelineStep[] {
  return draftSteps(db, draftId).flatMap((r) => r.output?.display ?? []);
}

function rewriteUserMessage(platform: Platform, topic: Record<string, unknown>, research: unknown, items: { title: string; url?: string | null }[], extra = ''): string {
  return [
    `[TASK:rewrite] [PLATFORM:${platform}]`,
    `选题标题：${String(topic.title)}`,
    `角度：${String(topic.angle ?? '')}`,
    research ? `调研：${JSON.stringify(research)}` : '',
    items.length ? `素材：\n${items.map((i) => `- ${i.title} ${i.url ?? ''}`).join('\n')}` : '',
    extra,
    '请输出 JSON：{"title","body","tags","image_prompts"(可选),"voiceover"(可选)}',
  ].filter(Boolean).join('\n');
}

/** 应用中置信复核结果：只替换合规命中词，避免模型借机改动正文其他部分。 */
function applyReplacements(body: string, reps: { from: string; to: string }[], allowed: Set<string>): string {
  let out = body;
  for (const r of reps) if (r.from && allowed.has(r.from) && typeof r.to === 'string') out = out.split(r.from).join(r.to);
  return out;
}

export async function rewrite(deps: Deps, topicId: number, platform: Platform): Promise<{ draftId: number; steps: PipelineStep[]; confidence?: Tier }> {
  const topic = deps.db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId) as Record<string, unknown> | undefined;
  if (!topic) throw new Error('选题不存在');
  const skill = findSkill(deps, PLATFORMS[platform].skill);
  const items = getItems(deps.db, parseJson<number[]>(topic.item_ids, []));
  const research = parseJson<Record<string, unknown> | null>(topic.research, null);
  const missing = missingCapabilities(skill, (c) => deps.hub.isConfigured(c));
  if (missing.includes('llm')) throw new Error('未配置：文本/对话模型');

  const schema = schemaFor(skill, platform);
  const system = systemPrompt(deps.agent, skill, schema);
  const dv = draftVerifySettings(deps.db);
  const strongTask = `rewrite:${platform}`;
  const s = await chatStructured<RewriteOut>(deps.hub, dv.enabled ? 'draft' : strongTask, [
    { role: 'system', content: system },
    { role: 'user', content: rewriteUserMessage(platform, topic, research, items) },
  ], schema, { name: `rewrite_${platform}` });
  let out = s.data;
  let calls = s.calls;
  let model = `${s.result.provider}/${s.result.model}`;
  const textDisplay: PipelineStep[] = [{
    step: dv.enabled ? '草稿生成' : '文本生成', ok: true, provider: model, mock: s.result.mock,
    message: s.firstPass ? 'Schema 一次通过' : `Schema 修复重试 1 次${s.errors.length ? `，仍有 ${s.errors.length} 处不合规` : ''}`,
  }];

  // 草稿-验证分档（默认关闭）
  let tier: Tier | undefined;
  const verifyDisplay: PipelineStep[] = [];
  if (dv.enabled) {
    const sig = signalsOf(checkCompliance(`${out.title ?? ''}\n${out.body}`), s);
    tier = confidenceTier(sig);
    const why = `合规命中 ${sig.complianceWarns}、Schema ${sig.schemaFirstPass ? '一次通过' : '需修复'}、越界 ${sig.overLength}${sig.schemaValid ? '' : '、修复后仍不合规'}`;
    try {
      if (tier === 'medium') {
        const hits = checkCompliance(`${out.title ?? ''}\n${out.body}`).filter((c) => c.level === 'warn');
        const titleMax = ((schema.properties as Record<string, { maxLength?: number }> | undefined)?.title?.maxLength) ?? 64;
        const v = await chatStructured<{ title?: string; replacements?: { from: string; to: string }[] }>(deps.hub, 'verify', [
          { role: 'system', content: system },
          { role: 'user', content: [
            '[TASK:verify_title] 只复核标题与下列合规命中，不改写正文其他部分。',
            `标题：${out.title ?? ''}`,
            hits.length ? `合规命中：\n${hits.map((h) => `- 命中「${h.match}」（${h.rule}）：${h.advice}`).join('\n')}` : '合规命中：无',
            '请输出 JSON：{"title":"复核后的标题","replacements":[{"from":"命中词","to":"替换为"}]}',
          ].join('\n') },
        ], { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: titleMax }, replacements: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } } } }, { name: 'verify_title' });
        calls += v.calls;
        out = { ...out, title: v.data.title ?? out.title, body: applyReplacements(out.body, v.data.replacements ?? [], new Set(hits.map((h) => h.match))) };
        verifyDisplay.push({ step: '复核（标题+合规）', ok: true, provider: `${v.result.provider}/${v.result.model}`, mock: v.result.mock, message: `${TIER_LABEL[tier]}：${why}` });
      } else if (tier === 'low') {
        const r = await chatStructured<RewriteOut>(deps.hub, strongTask, [
          { role: 'system', content: system },
          { role: 'user', content: rewriteUserMessage(platform, topic, research, items, `上一版草稿置信度低（${why}），请完整重写并满足平台规范。`) },
        ], schema, { name: `rewrite_${platform}` });
        calls += r.calls;
        out = r.data;
        model = `${r.result.provider}/${r.result.model}`;
        verifyDisplay.push({ step: '强模型重写', ok: true, provider: model, mock: r.result.mock, message: `${TIER_LABEL[tier]}：${why}` });
      } else {
        verifyDisplay.push({ step: '置信度分档', ok: true, message: `${TIER_LABEL[tier]}：${why}，直接进待审` });
      }
    } catch (e) {
      verifyDisplay.push({ step: '复核', ok: false, message: `复核失败，保留草稿：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const compliance = checkCompliance(`${out.title ?? ''}\n${out.body}`);
  const draftId = Number(
    deps.db.prepare("INSERT INTO drafts(topic_id, platform, title, body, tags, compliance, model, status, confidence, first_pass, calls) VALUES(?,?,?,?,?,?,?, 'pending',?,?,?)").run(
      topicId, platform, out.title ?? '', out.body, JSON.stringify(out.tags ?? []), JSON.stringify(compliance), model, tier ?? null, s.firstPass ? 1 : 0, calls,
    ).lastInsertRowid,
  );
  saveStep(deps.db, draftId, 'text', true, { display: textDisplay, assets: [], data: { image_prompts: out.image_prompts ?? [], voiceover: out.voiceover ?? '', topicTitle: String(topic.title) } });
  if (verifyDisplay.length) saveStep(deps.db, draftId, 'verify', verifyDisplay.every((x) => x.ok), { display: verifyDisplay, assets: [] });

  const media = await runMediaSteps(deps, draftId, platform, skill, { imagePrompts: out.image_prompts ?? [], voiceover: out.voiceover ?? '', body: out.body, topicTitle: String(topic.title) }, []);
  const steps = pipelineOf(deps.db, draftId);
  deps.db.prepare('UPDATE drafts SET assets = ?, pipeline = ?, calls = calls + ?, min_calls = ? WHERE id = ?').run(JSON.stringify(media.assets), JSON.stringify(steps), media.calls, 1 + media.planned, draftId);
  deps.db.prepare("UPDATE topics SET status = 'adopted' WHERE id = ?").run(topicId);
  deps.agent.daily(`改写草稿 #${draftId}（${PLATFORMS[platform].label}${tier ? `，${TIER_LABEL[tier]}` : ''}），步骤：${steps.map((x) => `${x.step}${x.ok ? '✓' : '✗'}`).join('、')}`);
  return { draftId, steps, ...(tier ? { confidence: tier } : {}) };
}

interface MediaInput { imagePrompts: string[]; voiceover: string; body: string; topicTitle: string }

/**
 * 媒体步骤：配图 1..n → 配音 → 字幕 → 视频合成。已成功（ok）的步骤跳过，只重跑失败/跳过/缺失的步骤。
 * 返回最终资产（已有资产 + 本次新增）、本次模型调用次数、计划的模型调用步数。
 */
async function runMediaSteps(deps: Deps, draftId: number, platform: string, skill: Skill, input: MediaInput, existing: Asset[]): Promise<{ assets: Asset[]; calls: number; planned: number }> {
  const done = new Set(draftSteps(deps.db, draftId).filter((r) => r.status === 'ok').map((r) => r.step));
  const assets = [...existing];
  let calls = 0;
  let planned = 0;
  const fail = (step: string, display: string, msg: string, skipped = false) => saveStep(deps.db, draftId, step, skipped ? 'skipped' : false, { display: [{ step: display, ok: false, message: msg }], assets: [] }, msg);

  if (skill.models.includes('image')) {
    const prompts = (input.imagePrompts.length ? input.imagePrompts : [input.topicTitle]).slice(0, platform === 'wechat_article' ? 1 : 3);
    planned += prompts.length;
    for (const [i, p] of prompts.entries()) {
      const step = `image-${i + 1}`;
      if (done.has(step)) continue;
      if (!deps.hub.isConfigured('image')) { fail(step, `配图 ${i + 1}`, '未配置：图像生成', true); continue; }
      try {
        calls++;
        const img = await deps.hub.image(`rewrite:${platform}`, p);
        const first = img.images[0];
        const url = first?.b64 ? saveMedia(deps, draftId, `image-${i + 1}.png`, Buffer.from(first.b64, 'base64')) : (first?.url ?? '');
        const a = { type: 'image', url, note: p };
        assets.push(a);
        saveStep(deps.db, draftId, step, true, { display: [{ step: `配图 ${i + 1}`, ok: true, provider: img.provider, mock: img.mock }], assets: [a] });
      } catch (e) {
        fail(step, `配图 ${i + 1}`, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (skill.models.includes('tts')) {
    planned += 1 + (skill.models.includes('asr') ? 1 : 0);
    const script = input.voiceover || input.body;
    let audio: { audio: Buffer; mime: string } | undefined;
    if (!done.has('tts')) {
      if (!deps.hub.isConfigured('tts')) fail('tts', '配音', '未配置：语音合成', true);
      else {
        try {
          calls++;
          const r = await deps.hub.tts(`rewrite:${platform}`, script);
          audio = r;
          const a = { type: 'audio', url: saveMedia(deps, draftId, 'voiceover.mp3', r.audio), note: r.mock ? '模拟音频' : undefined };
          assets.push(a);
          saveStep(deps.db, draftId, 'tts', true, { display: [{ step: '配音', ok: true, provider: r.provider, mock: r.mock }], assets: [a] });
        } catch (e) {
          fail('tts', '配音', e instanceof Error ? e.message : String(e));
        }
      }
    }
    if (skill.models.includes('asr') && !done.has('asr')) {
      const hasAudio = audio || done.has('tts');
      if (!hasAudio) fail('asr', '字幕', '等待配音成功后再生成', true);
      else if (!deps.hub.isConfigured('asr')) fail('asr', '字幕', '未配置：语音转写', true);
      else {
        try {
          if (!audio) {
            const p = join(deps.mediaDir, String(draftId), 'voiceover.mp3');
            audio = { audio: readFileSync(p), mime: 'audio/mpeg' };
          }
          calls++;
          const tr = await deps.hub.asr(`rewrite:${platform}`, { data: audio.audio, mime: audio.mime });
          const a = { type: 'subtitle', url: saveMedia(deps, draftId, 'subtitle.srt', toSrt(tr.segments)) };
          assets.push(a);
          saveStep(deps.db, draftId, 'asr', true, { display: [{ step: '字幕', ok: true, provider: tr.provider, mock: tr.mock }], assets: [a] });
        } catch (e) {
          fail('asr', '字幕', e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  // 视频合成：配音 + 字幕 + 配图 → 竖版 MP4（抖音、视频号）
  if (platform in VIDEO_PLATFORMS && !done.has('video') && assets.some((a) => a.type === 'audio')) {
    try {
      const v = await composeDraftVideo(deps, draftId, { platform, script: input.voiceover || input.body, assets: assets.filter((a) => a.type !== 'video'), imagePrompts: input.imagePrompts });
      const added = [...v.added, ...(v.asset ? [v.asset] : [])];
      assets.push(...added);
      saveStep(deps.db, draftId, 'video', !!v.asset, { display: v.steps, assets: added }, v.asset ? undefined : v.steps.find((x) => !x.ok)?.message);
    } catch (e) {
      fail('video', '视频合成', e instanceof Error ? e.message : String(e));
    }
  }
  return { assets, calls, planned };
}

/** 断点续跑：只重跑失败/跳过/缺失的步骤，已成功步骤与其资产保持不变。 */
export async function resumeDraft(deps: Deps, draftId: number): Promise<{ steps: PipelineStep[]; rerun: string[]; assets: Asset[] }> {
  const d = deps.db.prepare('SELECT platform, body, assets FROM drafts WHERE id = ?').get(draftId) as { platform: string; body: string; assets: string } | undefined;
  if (!d) throw new Error('草稿不存在');
  const rows = draftSteps(deps.db, draftId);
  const text = rows.find((r) => r.step === 'text');
  if (!text) throw new Error('该草稿没有分步记录（0.4.0 之前生成），无法续跑；可重新改写');
  const before = new Map(rows.map((r) => [r.step, r.status]));
  const platform = d.platform as Platform;
  const skill = findSkill(deps, PLATFORMS[platform]?.skill ?? '');
  const data = (text.output?.data ?? {}) as { image_prompts?: string[]; voiceover?: string; topicTitle?: string };
  const media = await runMediaSteps(deps, draftId, platform, skill, { imagePrompts: data.image_prompts ?? [], voiceover: data.voiceover ?? '', body: d.body, topicTitle: data.topicTitle ?? '' }, parseJson<Asset[]>(d.assets, []));
  const after = draftSteps(deps.db, draftId);
  const rerun = after.filter((r) => before.get(r.step) !== 'ok' && r.step !== 'text' && r.step !== 'verify').map((r) => r.step);
  const steps = pipelineOf(deps.db, draftId);
  deps.db.prepare("UPDATE drafts SET assets = ?, pipeline = ?, calls = calls + ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(media.assets), JSON.stringify(steps), media.calls, draftId);
  deps.agent.daily(`续跑草稿 #${draftId}：重跑 ${rerun.join('、') || '无'}`);
  return { steps, rerun, assets: media.assets };
}

/* ---------------- 局部重写（只发送选中段 + 前后有界窗口） ---------------- */

export const PARTIAL_WINDOW = { default: 200, max: 800, maxSelection: 2000 } as const;

export async function partialRewrite(deps: Deps, draftId: number, opts: { start: number; end: number; instruction?: string; window?: number }): Promise<{ body: string; text: string; range: { start: number; end: number }; sentChars: number; totalChars: number; warnings: string[]; provider: string; mock: boolean }> {
  const d = deps.db.prepare('SELECT platform, body FROM drafts WHERE id = ?').get(draftId) as { platform: string; body: string } | undefined;
  if (!d) throw new Error('草稿不存在');
  const { start, end } = opts;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > d.body.length || start >= end) throw new Error('选中范围不正确');
  if (end - start > PARTIAL_WINDOW.maxSelection) throw new Error(`选中段过长（上限 ${PARTIAL_WINDOW.maxSelection} 字），请整篇重写`);
  const win = Math.max(0, Math.min(PARTIAL_WINDOW.max, Math.floor(opts.window ?? PARTIAL_WINDOW.default)));
  const before = d.body.slice(Math.max(0, start - win), start);
  const sel = d.body.slice(start, end);
  const after = d.body.slice(end, end + win);
  const platform = d.platform;
  const skill = isPlatform(platform) ? deps.skills().find((x) => x.name === PLATFORMS[platform].skill) : undefined;
  const schema = schemaFor(skill, platform);
  const r = await chatStructured<{ text: string }>(deps.hub, `partial:${platform}`, [
    { role: 'system', content: systemPrompt(deps.agent, skill, schema) },
    { role: 'user', content: [
      `[TASK:partial_rewrite] [PLATFORM:${platform}]`,
      '只改写“选中”部分，与前后文衔接、语气一致；不要输出前后文。',
      `修改要求：${opts.instruction?.trim() || '润色，使表达更清晰'}`,
      `<<<前文>>>\n${before}\n<<</前文>>>`,
      `<<<选中>>>\n${sel}\n<<</选中>>>`,
      `<<<后文>>>\n${after}\n<<</后文>>>`,
      '请输出 JSON：{"text":"改写后的选中段"}',
    ].join('\n') },
  ], { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: Math.max(200, [...sel].length * 3) } } }, { name: 'partial_rewrite' });
  const text = r.data.text;
  const body = d.body.slice(0, start) + text + d.body.slice(end);
  editDraft(deps.db, draftId, body, undefined, `局部重写 [${start}, ${end})`);
  const bodySchema = (schema.properties as Record<string, JsonSchema> | undefined)?.body;
  const warnings = bodySchema ? validate(bodySchema, body, '$.body').map((e) => e.message) : [];
  return { body, text, range: { start, end: start + text.length }, sentChars: before.length + sel.length + after.length, totalChars: d.body.length, warnings, provider: `${r.result.provider}/${r.result.model}`, mock: r.result.mock };
}

/** 为已有草稿（重新）合成视频：小红书等图文草稿可用其配图 + 正文配音生成竖版视频。 */
export async function draftVideo(deps: Deps, draftId: number): Promise<{ steps: PipelineStep[]; assets: unknown[] }> {
  const d = deps.db.prepare('SELECT platform, body, assets, pipeline FROM drafts WHERE id = ?').get(draftId) as { platform: string; body: string; assets: string; pipeline: string } | undefined;
  if (!d) throw new Error('草稿不存在');
  const assets = parseJson<Asset[]>(d.assets, []).filter((a) => a.type !== 'video');
  const v = await composeDraftVideo(deps, draftId, { platform: d.platform, script: d.body, assets, synthesizeVoice: true, generateImages: false });
  const added = [...v.added, ...(v.asset ? [v.asset] : [])];
  const next = [...assets, ...added];
  let steps: PipelineStep[];
  if (draftSteps(deps.db, draftId).length) {
    saveStep(deps.db, draftId, 'video', !!v.asset, { display: v.steps, assets: added });
    steps = pipelineOf(deps.db, draftId);
  } else {
    steps = [...parseJson<PipelineStep[]>(d.pipeline, []).filter((s) => !s.step.startsWith('视频')), ...v.steps];
  }
  deps.db.prepare("UPDATE drafts SET assets = ?, pipeline = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(next), JSON.stringify(steps), draftId);
  return { steps: v.steps, assets: next };
}

/* ---------------- 审核 ---------------- */

export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'handed_off';

export function listDrafts(db: DB, status?: string): Record<string, unknown>[] {
  const rows = (status ? db.prepare('SELECT * FROM drafts WHERE status = ? ORDER BY id DESC LIMIT 200').all(status) : db.prepare('SELECT * FROM drafts ORDER BY id DESC LIMIT 200').all()) as Record<string, unknown>[];
  return rows.map(decodeDraft);
}

export function decodeDraft(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, tags: parseJson(r.tags, []), compliance: parseJson(r.compliance, []), assets: parseJson(r.assets, []), pipeline: parseJson(r.pipeline, []) };
}

export function getDraft(db: DB, id: number): Record<string, unknown> | undefined {
  const r = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? decodeDraft(r) : undefined;
}

export function editDraft(db: DB, id: number, body: string, title?: string, note?: string): void {
  const d = db.prepare('SELECT body FROM drafts WHERE id = ?').get(id) as { body: string } | undefined;
  if (!d) throw new Error('草稿不存在');
  if (d.body !== body) db.prepare('INSERT INTO draft_edits(draft_id, before_body, after_body, note) VALUES(?,?,?,?)').run(id, d.body, body, note ?? null);
  db.prepare("UPDATE drafts SET body = ?, title = COALESCE(?, title), compliance = ?, updated_at = datetime('now') WHERE id = ?").run(
    body, title ?? null, JSON.stringify(checkCompliance(`${title ?? ''}\n${body}`)), id,
  );
}

const TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  pending: ['approved', 'rejected'],
  rejected: ['pending'],
  approved: ['handed_off', 'pending'],
  handed_off: [],
};

export function setDraftStatus(db: DB, id: number, to: DraftStatus): void {
  const d = db.prepare('SELECT status FROM drafts WHERE id = ?').get(id) as { status: DraftStatus } | undefined;
  if (!d) throw new Error('草稿不存在');
  if (!TRANSITIONS[d.status].includes(to)) throw new Error(`不能从 ${d.status} 变为 ${to}`);
  db.prepare("UPDATE drafts SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, id);
}

export function draftEdits(db: DB, id: number): unknown[] {
  return db.prepare('SELECT * FROM draft_edits WHERE draft_id = ? ORDER BY id DESC').all(id);
}

/* ---------------- 回复草稿（只生成，不发送） ---------------- */

export async function replyDraft(deps: Deps, comment: string, context = ''): Promise<{ draft: string; provider: string; mock: boolean }> {
  const skill = deps.skills().find((s) => s.name === 'reply-draft');
  const r = await deps.hub.chat('reply', [
    { role: 'system', content: systemPrompt(deps.agent, skill) },
    { role: 'user', content: `[TASK:reply_draft]\n用户粘贴的评论/私信：${comment}\n背景：${context}\n只输出一条回复草稿，由用户确认后自行发送。` },
  ]);
  return { draft: r.content.trim(), provider: `${r.provider}/${r.model}`, mock: r.mock };
}
