/**
 * 本机生成：与服务端同一份提示词模板、平台规则、Schema 校验与一次修复重试（@content-agent/shared），
 * 硬边界前缀直接引用 server/src/boundaries.ts（只读，不复制）。
 */
import { buildSystemPrompt, checkCompliance, rewriteUserMessage, runStructured, schemaForPlatform, validate, type ChatTurn, type SchemaError } from '@content-agent/shared';
import { boundaryPreamble } from '../../../server/src/boundaries';
import { AGENT_FILES } from '../data/agentFiles';
import { isFree, writePlatform } from '../data/platforms';
import { defaultSkillSchema, platformSkill } from './platformSkill';
import { db, type Row } from './db';
import { chat, costOf, ModelError, type ChatOut } from './llm';
import { activeProvider, addUsage, getModels, getModelsV3, log } from './store';
import { resolveModel } from '@content-agent/shared';

export interface RewriteOut { title?: string; body: string; tags?: string[]; image_prompts?: string[]; voiceover?: string }

export async function systemFor(platform: string): Promise<{ system: string; schema: Record<string, unknown> }> {
  const a = await platformSkill(platform);
  const schema = schemaForPlatform(isFree(platform) ? undefined : platform, a?.schema ?? null);
  const system = buildSystemPrompt({
    boundary: boundaryPreamble(), soul: AGENT_FILES.soul, workingMethod: AGENT_FILES.workingMethod, user: AGENT_FILES.user,
    skill: a ? { name: a.name, body: a.body } : undefined, schema,
  });
  return { system, schema };
}

async function run(platform: string, messages: ChatTurn[], schema: Record<string, unknown>, pick?: { providerId?: string | null; model?: string | null }) {
  // 1.1.0：本次手动选择 > resolveModel(write:<平台>, 对话)（按任务指定 → 主模型 → 同服务商 → 其他）
  const r = pick?.providerId ? null : resolveModel(await getModelsV3(), `write:${platform}`, 'chat');
  const cfg = await activeProvider({ providerId: pick?.providerId ?? r?.target.accountId, model: pick?.model ?? r?.target.model });
  if (!cfg) throw new ModelError({ kind: 'key', reason: '还没有连接模型', advice: '先到“我的 → 模型”连接一个模型服务' });
  const adv = (await getModels()).advanced;
  let total = { input: 0, output: 0 };
  let ms = 0;
  const s = await runStructured<RewriteOut, ChatOut>(async (msgs) => {
    const r = await chat(cfg, msgs, { json: true, maxTokens: 4096, thinking: adv.thinking === 'on', temperature: adv.temperature ?? undefined, timeoutMs: 120000 });
    total = { input: total.input + r.usage.input, output: total.output + r.usage.output };
    ms += r.ms;
    return r;
  }, messages, schema);
  const cost = costOf(cfg.id, cfg.model, total);
  await addUsage(cost, total);
  return { s, cfg, cost, ms, usage: total };
}

export interface GenResult { draft: Row; firstPass: boolean; warnings: string[]; ms: number; cost: number }

/** 一句话想法 → 一篇草稿（待审核）。 */
export async function generateDraft(idea: string, platform: string, pick?: { providerId?: string | null; model?: string | null }): Promise<GenResult> {
  const text = idea.trim();
  if (!text) throw new ModelError({ kind: 'unknown', reason: '先输入一个想法', advice: '例如“通勤时间怎么利用”' });
  const { system, schema } = await systemFor(platform);
  const topic = await db.insert('topics', { title: text, angle: '', origin: 'manual', platforms: [platform], status: 'adopted' });
  try {
    const { s, cfg, cost, ms } = await run(platform, [{ role: 'system', content: system }, { role: 'user', content: rewriteUserMessage(platform, { title: text }, null, []) }], schema, pick);
    const out = s.data;
    const draft = await db.insert('drafts', {
      topic_id: topic.id, idea: text, platform, title: out.title ?? '', body: out.body ?? '', tags: out.tags ?? [], image_prompts: out.image_prompts ?? [], voiceover: out.voiceover ?? '',
      compliance: checkCompliance(`${out.title ?? ''}\n${out.body ?? ''}`), model: `${cfg.label} · ${cfg.model}`, status: 'pending', first_pass: s.firstPass, ms, cost,
    });
    const warnings = s.errors.map((e: SchemaError) => e.message);
    await log('info', `生成草稿 #${draft.id}（${writePlatform(platform).label}，${cfg.model}，${(ms / 1000).toFixed(1)} 秒${s.firstPass ? '' : '，格式修复 1 次'}）`);
    return { draft, firstPass: s.firstPass, warnings, ms, cost };
  } catch (e) {
    await log('error', `生成失败：${e instanceof ModelError ? `${e.reason}（${e.advice}）` : e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

/** 按一句话要求改写整篇（“改得更口语一点”）。 */
export async function reviseDraft(draft: Row, instruction: string, pick?: { providerId?: string | null; model?: string | null }): Promise<GenResult> {
  const platform = String(draft.platform);
  const { system, schema } = await systemFor(platform);
  const extra = `上一版：\n标题：${String(draft.title ?? '')}\n正文：${String(draft.body ?? '')}\n修改要求：${instruction.trim() || '润色，使表达更清晰'}\n只按要求修改，其余尽量保持。`;
  const { s, cfg, cost, ms } = await run(platform, [{ role: 'system', content: system }, { role: 'user', content: rewriteUserMessage(platform, { title: String(draft.idea ?? draft.title ?? '') }, null, [], extra) }], schema, pick);
  const out = s.data;
  const updated = await db.update('drafts', draft.id, { title: out.title ?? draft.title, body: out.body, tags: out.tags ?? draft.tags, compliance: checkCompliance(`${out.title ?? ''}\n${out.body}`), model: `${cfg.label} · ${cfg.model}`, status: 'pending' });
  await log('info', `改写草稿 #${draft.id}：${instruction.slice(0, 40)}`);
  return { draft: updated, firstPass: s.firstPass, warnings: s.errors.map((e) => e.message), ms, cost };
}

/** 平台硬限制检查（标题 / 正文字数），编辑器实时提示用。 */
export function limitWarnings(platform: string, title: string, body: string): string[] {
  const schema = schemaForPlatform(isFree(platform) ? undefined : platform, defaultSkillSchema(platform));
  return validate(schema, { title, body }).filter((e) => e.kind === 'length').map((e) => e.message.replace('$.title', '标题').replace('$.body', '正文'));
}

/** 1.1.0 一稿多适配：母稿保持不变，按平台技能各生成一篇适配稿（parent_id 指向母稿）。 */
export async function adaptDraft(motherId: number, platforms: string[], pick?: { providerId?: string | null; model?: string | null }): Promise<GenResult[]> {
  const m = await db.get('drafts', motherId);
  if (!m) throw new ModelError({ kind: 'unknown', reason: '母稿不存在', advice: '先写一篇' });
  const out: GenResult[] = [];
  for (const p of platforms.filter((x) => !isFree(x))) {
    const idea = `把下面这篇母稿适配成「${writePlatform(p).label}」：保留核心观点、事实与作者口吻，不新增数据；按该平台的字数、结构、标签、配图与配音提示要求调整。\n标题：${String(m.title ?? '')}\n正文：${String(m.body ?? '')}`;
    const r = await generateDraft(idea, p, pick);
    await db.update('drafts', r.draft.id, { parent_id: motherId, idea: String(m.idea ?? m.title ?? '') });
    out.push({ ...r, draft: (await db.get('drafts', r.draft.id))! });
  }
  await log('info', `母稿 #${motherId} 适配到 ${platforms.map((x) => writePlatform(x).short).join('、')}（母稿保留）`);
  return out;
}
