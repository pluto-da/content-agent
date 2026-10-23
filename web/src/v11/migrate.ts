/**
 * 1.1.0 数据迁移（PROMPT-v1.1 第九部分）。每一步幂等、迁移前自动快照（kv `v11_snapshot:<step>`）、可回滚（rollbackV11）。
 * 1 旧写作助手覆盖（kv:assistants）→ 对应平台技能的用户修订版本（进技能版本历史）；带模型覆盖的 → 模型配置“按任务指定” write:<平台>。
 * 2 账号画像（kv:profile）→ Agent 文件 user/profile.md（与 USER.md 同源：USER.md 是索引，详情在 user/profile.md）。
 * 3 热点来源：审计发现两处入口（通用设置、数据源页）写的是同一个 prefs.hotSources，属于“重复入口”而非“双写入点”，无数据要迁；入口已合并到“平台与软件”。
 * 模型配置 v3 → v4 在 local/store.ts migrateModelsIfNeeded（读取时自动执行，快照 models_v3_pre_v4）。
 * 迁移结果写审计（kind=migration）与成长记录（proposals，auto=true，status=approved）。
 */
import { DEFAULT_FILES, parseSkillText, findEntry, type ModelsStateV3, type Proposal } from '@content-agent/shared';
import { db } from '../local/db';
import { getModelsV3, saveModelsV3 } from '../local/store';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';
import { WRITE_PLATFORMS } from '../data/platforms';
import { EMPTY_PROFILE, type Profile } from '../agent/store';

export interface LegacyAssistantOverride { body?: string; providerId?: string | null; model?: string | null }
export interface V11Report { assistants: { skills: string[]; models: string[] }; profile: boolean; skipped: string[] }
const DONE = 'migrations.v11';
export const PROFILE_PATH = 'user/profile.md';
const PROFILE_START = '<!-- profile:json -->';
const PROFILE_END = '<!-- /profile:json -->';

/** 旧覆盖正文 → 技能全文：保留 front matter 与输出 Schema，只替换步骤正文；front matter 标 source: user。 */
export function skillWithBody(orig: string, body: string): string {
  const p = parseSkillText(orig);
  const old = p.body.trim();
  let next = old && orig.includes(old) ? orig.replace(old, body.trim()) : `${orig.trimEnd()}\n\n${body.trim()}\n`;
  next = /\nsource:\s*\w+/.test(next.slice(0, next.indexOf('\n---', 4))) ? next.replace(/\nsource:\s*\w+/, '\nsource: user') : next;
  return next;
}

/** 画像 ↔ user/profile.md（人读的段落 + 机器读的 JSON 块，二者同一次写入）。 */
export function profileToMd(raw: Partial<Profile>, prev?: string): string {
  const p: Profile = { ...EMPTY_PROFILE, ...raw, style: { ...EMPTY_PROFILE.style, ...(raw.style ?? {}) } };
  const human = [
    `- 定位：${p.positioning || '待填写'}`, `- 受众：${p.audience || '待填写'}`, `- 风格：${p.style.tone || '待填写'}`,
    `- 禁用词：${p.style.banned.join('、') || '无'}`, `- 红线：${p.redlines.join('、') || '无'}`,
  ].join('\n');
  const block = `${PROFILE_START}\n\`\`\`json\n${JSON.stringify(p)}\n\`\`\`\n${PROFILE_END}`;
  const head = prev && prev.startsWith('---') ? prev.slice(0, prev.indexOf('\n---', 4) + 4) : '---\nid: user/profile\ntype: profile\ntitle: 账号画像\neditable: user\nload: on_demand\nsource: user\n---';
  return `${head}\n# 账号画像（在“我的 → 账号画像”编辑；Agent 只能提议修改）\n${human}\n\n${block}\n`;
}
export function profileFromMd(text: string | undefined): Profile | null {
  if (!text) return null;
  const i = text.indexOf(PROFILE_START), j = text.indexOf(PROFILE_END);
  if (i < 0 || j < 0) return null;
  const m = /```json\n([\s\S]*?)\n```/.exec(text.slice(i, j));
  try { const p = JSON.parse(m?.[1] ?? '') as Partial<Profile>; return { ...EMPTY_PROFILE, ...p, style: { ...EMPTY_PROFILE.style, ...(p.style ?? {}) } }; } catch { return null; }
}

async function snapshot(step: string, value: unknown): Promise<void> { if ((await db.getKV(`v11_snapshot:${step}`)) === undefined) await db.setKV(`v11_snapshot:${step}`, value ?? null); }
async function growth(target: string, before: string, after: string, reason: string): Promise<void> {
  const p: Proposal = { id: `v11-${target}-${Date.now().toString(36)}`, kind: target.startsWith('skills/') ? 'skill_version' : 'system_file', target, basedOn: [], evidenceLevel: 'user', status: 'approved', before, after, reason, createdAt: new Date().toISOString(), auto: true, risk: 'low' };
  await db.insert('proposals', p as unknown as Record<string, unknown>);
}

export async function migrateV11(): Promise<V11Report> {
  const done = (await db.getKV<Record<string, boolean>>(DONE)) ?? {};
  const rep: V11Report = { assistants: { skills: [], models: [] }, profile: false, skipped: [] };
  const vfs = await getVfs();

  // 1 写作助手覆盖 → 技能修订 + 按任务指定
  if (!done.assistants) {
    const ov = (await db.getKV<Record<string, LegacyAssistantOverride>>('assistants')) ?? {};
    if (Object.keys(ov).length) {
      await snapshot('assistants', ov);
      let models: ModelsStateV3 | null = null;
      for (const [platform, o] of Object.entries(ov)) {
        const wp = WRITE_PLATFORMS.find((w) => w.id === platform); if (!wp) { rep.skipped.push(platform); continue; }
        const path = `skills/${wp.skill}/SKILL.md`;
        if (o.body?.trim()) {
          const cur = (await vfs.text(path)) ?? DEFAULT_FILES[path] ?? '';
          const next = skillWithBody(cur, o.body);
          if (next.trim() !== cur.trim()) {
            await vfs.write(path, next, { author: 'user', note: '1.1.0 迁移：旧“写作助手”里你改过的写法 → 技能修订版本（可在技能版本历史回滚）' });
            await growth(path, cur, next, '1.1.0：旧写作助手覆盖迁入平台技能（同一件事只留一个真相源）');
            rep.assistants.skills.push(path);
          }
        }
        if (o.providerId || o.model) {
          models ??= await getModelsV3();
          const acc = models.accounts.find((a) => a.id === o.providerId) ?? models.accounts.find((a) => a.models.some((e) => e.model === o.model));
          const e = acc?.models.find((x) => x.model === o.model) ?? acc?.models.find((x) => x.roles.includes('chat'));
          if (acc && e && findEntry(models, e.id)) {
            const b = models.roles.chat;
            models.roles.chat = { ...b, tasks: { ...(b.tasks ?? {}), [`write:${platform}`]: { accountId: acc.id, modelEntryId: e.id, model: e.model } } };
            rep.assistants.models.push(`write:${platform}`);
          } else rep.skipped.push(`model:${platform}`);
        }
      }
      if (models) await saveModelsV3(models);
      await db.setKV('assistants', null);
      await audit({ kind: 'migration', actor: 'system', summary: `1.1.0 写作助手迁移：${rep.assistants.skills.length} 条写法 → 技能修订；${rep.assistants.models.length} 条模型覆盖 → 按任务指定${rep.skipped.length ? `；跳过 ${rep.skipped.join('、')}` : ''}`, outcome: 'ok' });
    }
    done.assistants = true;
  }

  // 2 画像 → user/profile.md
  if (!done.profile) {
    const kv = await db.getKV<Profile>('profile');
    const cur = await vfs.text(PROFILE_PATH);
    if (kv && !profileFromMd(cur)) {
      await snapshot('profile', { kv, file: cur ?? null });
      const p = { ...EMPTY_PROFILE, ...kv, style: { ...EMPTY_PROFILE.style, ...(kv.style ?? {}) } };
      const next = profileToMd(p, cur);
      await vfs.write(PROFILE_PATH, next, { author: 'user', note: '1.1.0 迁移：账号画像并入 Agent 的 USER 文件（user/profile.md）' });
      await growth(PROFILE_PATH, cur ?? '', next, '1.1.0：账号画像与 USER 同源');
      await audit({ kind: 'migration', actor: 'system', summary: '1.1.0 画像迁移：kv:profile → user/profile.md', outcome: 'ok' });
      rep.profile = true;
    }
    done.profile = true;
  }

  await db.setKV(DONE, done);
  return rep;
}

/** 旧版本备份里的 kv 键：恢复时不直接写回，而是交给 importLegacyV11 走迁移（避免旧数据绕过单一真相源）。 */
export const LEGACY_V11_KV = ['assistants', 'profile'];
/** 恢复旧备份（0.9–1.0）：写作助手覆盖重新走迁移；画像以备份为准写入 user/profile.md。 */
export async function importLegacyV11(o: { assistants?: Record<string, LegacyAssistantOverride> | null; profile?: Profile | null }): Promise<V11Report> {
  const done = (await db.getKV<Record<string, boolean>>(DONE)) ?? {};
  if (o.assistants && Object.keys(o.assistants).length) { await db.setKV('assistants', o.assistants); done.assistants = false; }
  if (o.profile && typeof o.profile === 'object') {
    const vfs = await getVfs();
    const p = { ...EMPTY_PROFILE, ...o.profile, style: { ...EMPTY_PROFILE.style, ...(o.profile.style ?? {}) } };
    await vfs.write(PROFILE_PATH, profileToMd(p, await vfs.text(PROFILE_PATH)), { author: 'user', note: '恢复备份：账号画像' });
    done.profile = true;
  }
  await db.setKV(DONE, done);
  return migrateV11();
}

/** 回滚 1.1.0 迁移：恢复 kv 快照（写作助手覆盖、画像）。技能文件与 user/profile.md 的改动在各自版本历史里回滚。 */
export async function rollbackV11(): Promise<string[]> {
  const out: string[] = [];
  const a = await db.getKV<Record<string, LegacyAssistantOverride> | null>('v11_snapshot:assistants');
  if (a) { await db.setKV('assistants', a); out.push('assistants'); }
  const p = await db.getKV<{ kv: Profile } | null>('v11_snapshot:profile');
  if (p?.kv) { await db.setKV('profile', p.kv); out.push('profile'); }
  await db.setKV(DONE, {});
  await audit({ kind: 'migration', actor: 'user', summary: `1.1.0 迁移已回滚：${out.join('、') || '无可回滚的快照'}`, outcome: 'ok' });
  return out;
}
