import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db.js';
import { parseJson } from '../db.js';
import { boundaryPreamble } from '../boundaries.js';
import type { ModelHub } from '../models/hub.js';
import { extractJson, toSrt } from '../models/util.js';
import type { Skill } from '../skills/loader.js';
import { missingCapabilities } from '../skills/loader.js';
import type { AgentFiles } from './agentfiles.js';
import { checkCompliance } from './compliance.js';
import { getItems } from './library.js';

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

/** 组装系统提示词：硬边界永远在最前，其次 soul、工作方法、用户画像、skill。 */
export function systemPrompt(agent: AgentFiles, skill?: Skill): string {
  return [
    boundaryPreamble(),
    '【soul.md】\n' + agent.read('soul.md'),
    '【working-method.md】\n' + agent.read('working-method.md'),
    '【USER.md】\n' + agent.read('USER.md'),
    skill ? `【skill：${skill.name}】\n${skill.body}` : '',
    '请严格按要求的 JSON 格式输出；不得编造数据或来源；信息不足时写明“待核实”。',
  ].filter(Boolean).join('\n\n---\n\n');
}

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

/* ---------------- 改写流水线 ---------------- */

export interface PipelineStep { step: string; ok: boolean; message?: string; provider?: string; mock?: boolean }
interface RewriteOut { title?: string; body: string; tags?: string[]; image_prompts?: string[]; voiceover?: string }

function saveMedia(deps: Deps, draftId: number, name: string, data: Buffer | string): string {
  const dir = join(deps.mediaDir, String(draftId));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
  return `/api/media/${draftId}/${name}`;
}

export async function rewrite(deps: Deps, topicId: number, platform: Platform): Promise<{ draftId: number; steps: PipelineStep[] }> {
  const topic = deps.db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId) as Record<string, unknown> | undefined;
  if (!topic) throw new Error('选题不存在');
  const skill = findSkill(deps, PLATFORMS[platform].skill);
  const items = getItems(deps.db, parseJson<number[]>(topic.item_ids, []));
  const research = parseJson<Record<string, unknown> | null>(topic.research, null);
  const steps: PipelineStep[] = [];
  const missing = missingCapabilities(skill, (c) => deps.hub.isConfigured(c));
  if (missing.includes('llm')) throw new Error('未配置：文本/对话模型');

  const r = await deps.hub.chat(`rewrite:${platform}`, [
    { role: 'system', content: systemPrompt(deps.agent, skill) },
    {
      role: 'user',
      content: [
        `[TASK:rewrite] [PLATFORM:${platform}]`,
        `选题标题：${String(topic.title)}`,
        `角度：${String(topic.angle ?? '')}`,
        research ? `调研：${JSON.stringify(research)}` : '',
        items.length ? `素材：\n${items.map((i) => `- ${i.title} ${i.url ?? ''}`).join('\n')}` : '',
        '请输出 JSON：{"title","body","tags","image_prompts"(可选),"voiceover"(可选)}',
      ].filter(Boolean).join('\n'),
    },
  ]);
  const out = extractJson<RewriteOut>(r.content);
  steps.push({ step: '文本生成', ok: true, provider: `${r.provider}/${r.model}`, mock: r.mock });
  const compliance = checkCompliance(`${out.title ?? ''}\n${out.body}`);
  const draftId = Number(
    deps.db.prepare("INSERT INTO drafts(topic_id, platform, title, body, tags, compliance, model, status) VALUES(?,?,?,?,?,?,?, 'pending')").run(
      topicId, platform, out.title ?? '', out.body, JSON.stringify(out.tags ?? []), JSON.stringify(compliance), `${r.provider}/${r.model}`,
    ).lastInsertRowid,
  );
  const assets: { type: string; url: string; note?: string }[] = [];

  // 配图：小红书 3 张、公众号 1 张封面（需要 image 能力）
  if (skill.models.includes('image')) {
    if (!deps.hub.isConfigured('image')) steps.push({ step: '配图', ok: false, message: '未配置：图像生成' });
    else {
      const prompts = (out.image_prompts?.length ? out.image_prompts : [String(topic.title)]).slice(0, platform === 'wechat_article' ? 1 : 3);
      for (const [i, p] of prompts.entries()) {
        try {
          const img = await deps.hub.image(`rewrite:${platform}`, p);
          const first = img.images[0];
          const url = first?.b64 ? saveMedia(deps, draftId, `image-${i + 1}.png`, Buffer.from(first.b64, 'base64')) : (first?.url ?? '');
          assets.push({ type: 'image', url, note: p });
          steps.push({ step: `配图 ${i + 1}`, ok: true, provider: img.provider, mock: img.mock });
        } catch (e) {
          steps.push({ step: `配图 ${i + 1}`, ok: false, message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  }

  // 口播：TTS 配音 → ASR 时间轴 → SRT 字幕
  if (skill.models.includes('tts')) {
    const script = out.voiceover || out.body;
    if (!deps.hub.isConfigured('tts')) steps.push({ step: '配音', ok: false, message: '未配置：语音合成' });
    else {
      try {
        const audio = await deps.hub.tts(`rewrite:${platform}`, script);
        assets.push({ type: 'audio', url: saveMedia(deps, draftId, 'voiceover.mp3', audio.audio), note: audio.mock ? '模拟音频' : undefined });
        steps.push({ step: '配音', ok: true, provider: audio.provider, mock: audio.mock });
        if (skill.models.includes('asr')) {
          if (!deps.hub.isConfigured('asr')) steps.push({ step: '字幕', ok: false, message: '未配置：语音转写' });
          else {
            const tr = await deps.hub.asr(`rewrite:${platform}`, { data: audio.audio, mime: audio.mime });
            assets.push({ type: 'subtitle', url: saveMedia(deps, draftId, 'subtitle.srt', toSrt(tr.segments)) });
            steps.push({ step: '字幕', ok: true, provider: tr.provider, mock: tr.mock });
          }
        }
      } catch (e) {
        steps.push({ step: '配音/字幕', ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  deps.db.prepare('UPDATE drafts SET assets = ?, pipeline = ? WHERE id = ?').run(JSON.stringify(assets), JSON.stringify(steps), draftId);
  deps.db.prepare("UPDATE topics SET status = 'adopted' WHERE id = ?").run(topicId);
  deps.agent.daily(`改写草稿 #${draftId}（${PLATFORMS[platform].label}），步骤：${steps.map((s) => `${s.step}${s.ok ? '✓' : '✗'}`).join('、')}`);
  return { draftId, steps };
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
