/**
 * 经验循环（8.14）：lesson（证据 + 结论 + 置信度）→ 技能新版本 / 系统文件修订提案（diff，用户确认后生效）→ 验证、降级、回滚。
 * 防自我强化：样本量门槛、反证检查 ≥4 问、相关≠因果提示、反例优先、经验不盖过用户、不改底座与红线。不改模型权重。
 */
import { parseDoc, patchFM } from '../vfs/frontmatter.js';
import { unifiedDiff } from '../vfs/diff.js';
import { soulPart1, type Vfs } from '../vfs/vfs.js';
import { CORE_KEYPOINTS } from '../vfs/defaults.generated.js';
import { RELAX_PATTERNS } from '../agent/policy.js';
import type { Limits } from '../agent/limits.js';

export type LessonStatus = 'candidate' | 'testing' | 'effective' | 'degraded' | 'retired';
export interface Lesson { id: string; pattern: string; hypothesis: string; sampleSize: number; contentIds: string[]; control: string | null; falsification: string[]; confidence: 'low' | 'medium' | 'high'; conditions: string; status: LessonStatus; conclusion: string; needsReview?: boolean; createdAt: string }
/** 核心指令第八条七问（反证检查必须答 ≥4 问）。 */
export const SEVEN_QUESTIONS = ['有没有反例', '有没有其他解释', '样本是否足够', '有没有混杂因素', '时间先后能否说明因果', '换平台或换账号还成立吗', '什么结果会推翻它'];
export function validateLesson(l: Lesson, lim: Limits['evolution']): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(l.sampleSize) || l.sampleSize < 1) errs.push('缺少样本量');
  if (l.contentIds.length < Math.min(l.sampleSize, 1)) errs.push('缺少关联内容 id');
  if (l.falsification.filter((x) => x.trim()).length < 4) errs.push('反证检查少于 4 问（第八条七问）');
  if ((l.sampleSize < lim.minSampleMedium || !l.control) && l.confidence !== 'low') errs.push(`样本 n=${l.sampleSize}${l.control ? '' : '、无对照'}，置信度只能是 low`);
  if (l.confidence === 'high' && (l.sampleSize < lim.minSampleHigh || !l.control)) errs.push(`high 需要 n≥${lim.minSampleHigh} 且有对照`);
  if (l.status === 'effective' && (l.sampleSize < lim.minSampleHigh || !l.control || l.falsification.length < 4)) errs.push(`effective 需要 n≥${lim.minSampleHigh} + 对照 + 反证检查`);
  if ((l.sampleSize < lim.minSampleHigh || !l.control) && !/相关.{0,2}(不等于|≠).{0,2}因果|混杂/.test(l.conclusion)) errs.push('n<10 或无对照时，结论必须说明“相关≠因果”或混杂因素');
  if (l.sampleSize === 1 && !/个案/.test(l.conclusion)) errs.push('单篇只能记成“个案”');
  return errs;
}
export function lessonFile(l: Lesson): string {
  return `---\nid: memory/lessons/${l.id}\ntype: lesson\ntitle: ${l.pattern.slice(0, 30)}\nupdated: ${l.createdAt}\nversion: 1\nsource: inferred\nconfidence: inferred\neditable: agent_propose\nload: on_demand\nstatus: ${l.status}\n---\n# ${l.pattern}\n- 结构假设：${l.hypothesis}\n- 样本：n=${l.sampleSize}（${l.contentIds.join('、')}）\n- 对照：${l.control ?? '无对照'}\n- 反证检查：\n${l.falsification.map((f) => `  - ${f}`).join('\n')}\n- 置信度：${l.confidence}\n- 适用条件：${l.conditions}\n- 结论：${l.conclusion}\n`;
}
/** 反例登记：同一打法出现 contradicts 实验 → 相关 lesson 标“待复核”。 */
export function markContradicted(lessons: Lesson[], contradictedLessonIds: string[]): Lesson[] { return lessons.map((l) => (contradictedLessonIds.includes(l.id) ? { ...l, needsReview: true } : l)); }
/** 降级：effective 打法关联内容连续 degradeAfter 次低于基线 → 提议降级。 */
export function shouldDegrade(l: Lesson, recentVsBaseline: number[], lim: Limits['evolution']): boolean {
  if (l.status !== 'effective') return false;
  const tail = recentVsBaseline.slice(-lim.degradeAfter);
  return tail.length >= lim.degradeAfter && tail.every((x) => x < 0);
}

export type ProposalKind = 'skill_version' | 'system_file' | 'degrade' | 'rollback';
export interface Proposal { id: string; kind: ProposalKind; target: string; basedOn: string[]; evidenceLevel: 'low' | 'medium' | 'high' | 'user'; status: 'pending' | 'approved' | 'rejected' | 'rolled_back'; before: string; after: string; reason: string; createdAt: string; decidedAt?: string; rejectReason?: string }
/** 提案校验器：拒绝针对 BOUNDARIES.md；删改 SOUL 第一部分要点；放宽 APPROVAL / REVENUE 红线；任何放宽边界的字样。 */
export function validateProposal(p: Pick<Proposal, 'target' | 'before' | 'after' | 'kind'>, history: Proposal[] = [], now = new Date(), cooldownDays = 30): string[] {
  const errs: string[] = [];
  if (p.target === 'BOUNDARIES.md') errs.push('BOUNDARIES.md 由代码强制，不接受任何修订建议');
  if (p.target === 'SOUL.md') {
    const p1 = soulPart1(p.after) ?? '';
    for (const [art, pts] of Object.entries(CORE_KEYPOINTS)) for (const pt of pts) if (!p1.includes(pt)) { errs.push(`不能删改 SOUL.md 第一部分要点（${art}：${pt}）`); break; }
  }
  if (RELAX_PATTERNS.test(p.after) && !RELAX_PATTERNS.test(p.before)) errs.push('提案试图放宽硬边界（如自动发布、刷量、编收入），已拒绝');
  if (p.target === 'APPROVAL.md') {
    const lines = (s: string) => s.split('\n').filter((l) => /^\s*-\s/.test(l) && /必须先问/.test(sectionOf(s, l))).length;
    if (lines(p.after) < lines(p.before)) errs.push('APPROVAL.md 只能更严格，不能删减“必须先问”的条目');
  }
  if (p.target === 'REVENUE.md') { const red = (s: string) => (/(## 红线[\s\S]*?)(\n## |$)/.exec(s)?.[1] ?? ''); if (red(p.after).length < red(p.before).length) errs.push('REVENUE.md 的红线段只能加不能删'); }
  const recent = history.find((h) => h.status === 'rejected' && h.target === p.target && h.after === p.after && now.getTime() - Date.parse(h.decidedAt ?? h.createdAt) < cooldownDays * 864e5);
  if (recent) errs.push(`同一提案 ${cooldownDays} 天内被拒绝过，不重复提出`);
  return errs;
}
function sectionOf(text: string, line: string): string { const i = text.indexOf(line); const head = text.slice(0, i).split('\n').reverse().find((l) => /^##\s/.test(l)) ?? ''; return head; }
export function proposalFile(p: Proposal): string {
  return `---\nid: workspace/proposals/${p.id}\ntype: proposal\ntitle: ${p.kind} · ${p.target}\nupdated: ${p.createdAt}\nversion: 1\neditable: system_only\nload: never\ntarget: ${p.target}\nkind: ${p.kind}\nbasedOn: [${p.basedOn.join(', ')}]\nevidenceLevel: ${p.evidenceLevel}\nstatus: ${p.status}\n---\n# 提案：${p.target}\n## 理由\n${p.reason}\n## 改动对比\n\`\`\`diff\n${unifiedDiff(p.before, p.after, `${p.target}（现在）`, `${p.target}（提议）`)}\n\`\`\`\n## 回滚方式\n成长记录里一键回滚到采纳前的版本。\n`;
}
/** 采纳：以 user_approved 写入目标文件（版本 +1），技能同时存 versions/vN.md，EVOLUTION.md 最近变更区追加一行。未确认的提案永不改变目标文件。 */
export async function applyProposal(vfs: Vfs, p: Proposal, now = new Date()): Promise<{ version: number }> {
  if (p.status !== 'pending') throw new Error('提案不是待确认状态');
  const errs = validateProposal(p);
  if (errs.length) throw new Error(errs.join('；'));
  const cur = await vfs.read(p.target);
  if ((cur?.content ?? '') !== p.before) throw new Error('目标文件在提案之后被改过，请重新生成提案');
  let after = p.after;
  if (p.kind === 'skill_version' && /\/SKILL\.md$/.test(p.target)) {
    const v = Number(parseDoc(p.before).fm.version ?? 1) + 1;
    after = patchFM(after, { version: v, status: 'testing' });
    await vfs.write(p.target.replace('SKILL.md', `versions/v${v - 1}.md`), p.before, { author: 'user_approved', note: `archive v${v - 1}` }).catch(() => {});
    await vfs.write(p.target.replace('SKILL.md', `versions/v${v}.md`), after, { author: 'user_approved', note: `v${v} from ${p.id}` });
  }
  const f = await vfs.write(p.target, after, { author: 'user_approved', expectedVersion: cur?.version, note: `proposal ${p.id}` });
  await appendEvolution(vfs, `${now.toISOString().slice(0, 10)} 采纳 ${p.id}：${p.target}（${p.kind}，依据 ${p.basedOn.join('、') || '用户要求'}）→ v${f.version}`);
  p.status = 'approved'; p.decidedAt = now.toISOString();
  return { version: f.version };
}
export async function rollbackProposal(vfs: Vfs, p: Proposal, now = new Date()): Promise<{ version: number }> {
  if (p.status !== 'approved') throw new Error('只有已采纳的提案可以回滚');
  const cur = await vfs.read(p.target);
  const f = await vfs.write(p.target, p.before, { author: 'user_approved', expectedVersion: cur?.version, note: `rollback ${p.id}` });
  await appendEvolution(vfs, `${now.toISOString().slice(0, 10)} 回滚 ${p.id}：${p.target} → v${f.version}`);
  p.status = 'rolled_back'; p.decidedAt = now.toISOString();
  return { version: f.version };
}
export async function appendEvolution(vfs: Vfs, line: string): Promise<void> {
  const cur = (await vfs.text('EVOLUTION.md')) ?? '';
  const marker = /## 最近变更[^\n]*\n/.exec(cur);
  const next = marker ? cur.replace(marker[0], `${marker[0]}- ${line}\n`) : `${cur.replace(/\s*$/, '')}\n\n## 最近变更（自动维护，最近 5 条）\n- ${line}\n`;
  await vfs.write('EVOLUTION.md', next, { author: 'system', note: 'evolution log' });
}
