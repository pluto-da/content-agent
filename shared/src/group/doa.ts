/**
 * 1.3.0 DOA 引擎（第五部分 2、第三部分 3.3）：读 company/regulations/02-doa.md 的 front matter 直接执行。
 * 控制只落在五类事：花钱、对外、改规则、改权限、硬边界；越权即拦截并审计，超权事项生成请示进董事长收件箱。
 * 横向消息、会话、会议、决议都不提升任何成员的权限：判定只看执行者本人的角色与 DOA。
 */
import { parseDoc, type FM } from '../vfs/frontmatter.js';
import { makeAudit, type AuditEvent } from '../core/audit.js';
import { SOCIAL_ACTION, SOCIAL_ACTION_ZH } from '../super/governance.js';
import { DOA_FRONT } from './regulations.js';
import type { Role } from './org.js';

export const CONTROL_MATTERS = ['spend', 'external', 'rule_change', 'perm_change', 'hard_boundary'] as const;
export type Matter = typeof CONTROL_MATTERS[number] | 'routine' | 'org_change' | 'race_start' | 'gray_release' | 'demote_pause';
export const MATTER_TEXT: Record<Matter, string> = { spend: '花钱', external: '对外', rule_change: '改规则', perm_change: '改权限', hard_boundary: '硬边界', routine: '日常事项', org_change: '组织调整', race_start: '发起赛马', gray_release: '灰度上线', demote_pause: '降级与暂停' };
export interface DoaRule { matter: Matter; initiator?: string; review?: string; decide: Role | 'forbidden'; inform?: string; deptMaxYuan?: number; ceoMaxYuan?: number; control: boolean }
export type Doa = Record<string, DoaRule>;

export function parseDoa(text: string = DOA_FRONT): Doa {
  const { fm, hasFM } = parseDoc(text);
  if (!hasFM) throw new Error('DOA 缺少 front matter');
  const out: Doa = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as FM;
    out[k] = { matter: k as Matter, initiator: o.initiator as string | undefined, review: o.review as string | undefined, decide: (o.decide as Role | 'forbidden') ?? 'chairman', inform: o.inform as string | undefined, deptMaxYuan: typeof o.deptMaxYuan === 'number' ? o.deptMaxYuan : undefined, ceoMaxYuan: typeof o.ceoMaxYuan === 'number' ? o.ceoMaxYuan : undefined, control: o.control === true };
  }
  for (const m of CONTROL_MATTERS) if (!out[m]) throw new Error(`DOA 缺少控制事项 ${m}`);
  if (out.hard_boundary!.decide !== 'forbidden') throw new Error('硬边界在 DOA 中只能是禁止');
  return out;
}

const RANK: Record<Role, number> = { executor: 0, dept_head: 1, ceo: 2, chairman: 3 };
export interface DoaRequest { matter: Matter; actor: { role: Role; id: string; deptId?: string }; amountYuan?: number; summary: string; reviewedBy?: string[] }
export interface DoaVerdict { allow: boolean; route: 'self' | 'review' | 'ceo' | 'chairman' | 'forbidden'; decider: Role | 'forbidden'; needsReview?: string; clause: string; reason: string; audit: AuditEvent; ask?: { to: 'chairman'; title: string; body: string } }

/** 执行 DOA。人员在会话 / 会议里的身份不改变 actor.role（会话不赋予任何新权限）。 */
export function doaCheck(doa: Doa, req: DoaRequest): DoaVerdict {
  const rule = doa[req.matter] ?? doa.routine!;
  const clause = `doa#${req.matter === 'spend' ? 3 : 1}`;
  const fin = (allow: boolean, route: DoaVerdict['route'], decider: DoaVerdict['decider'], reason: string, needsReview?: string): DoaVerdict => {
    const v: DoaVerdict = { allow, route, decider, clause, reason, needsReview, audit: makeAudit({ kind: 'approval', actor: req.actor.role === 'chairman' ? 'user' : 'agent', summary: `DOA ${MATTER_TEXT[req.matter]}：${reason}`, target: req.actor.id, outcome: allow ? 'ok' : 'denied', detail: { matter: req.matter, role: req.actor.role, amountYuan: req.amountYuan ?? null, route } }) };
    if (!allow && route !== 'forbidden' && (route === 'chairman' || decider === 'chairman')) v.ask = { to: 'chairman', title: `请示：${req.summary}`, body: `事项：${MATTER_TEXT[req.matter]}；发起：${req.actor.id}（${req.actor.role}）${req.amountYuan != null ? `；金额 ¥${req.amountYuan}` : ''}；依据：DOA ${MATTER_TEXT[req.matter]}，${reason}` };
    return v;
  };
  if (rule.decide === 'forbidden' || req.matter === 'hard_boundary') return fin(false, 'forbidden', 'forbidden', '硬边界事项任何人不得决定（含董事长在 App 内也不能放宽）');
  if (req.matter === 'spend') {
    const amt = req.amountYuan ?? 0;
    const need: Role = amt <= (rule.deptMaxYuan ?? 0.5) ? 'dept_head' : amt <= (rule.ceoMaxYuan ?? 2) ? 'ceo' : 'chairman';
    return RANK[req.actor.role] >= RANK[need] ? fin(true, 'self', need, `¥${amt} 在 ${need} 权限内`) : fin(false, need === 'chairman' ? 'chairman' : need === 'ceo' ? 'ceo' : 'review', need, `¥${amt} 超出 ${req.actor.role} 权限，需 ${need} 决定`);
  }
  const decider = rule.decide as Role;
  if (rule.review && rule.review !== 'committee' && decider !== 'executor' && !(req.reviewedBy ?? []).includes(rule.review) && req.actor.role !== 'chairman') {
    if (RANK[req.actor.role] < RANK[decider]) return fin(false, decider === 'chairman' ? 'chairman' : 'review', decider, `须先经 ${rule.review} 审议，再由 ${decider} 决定`, rule.review);
  }
  if (rule.review === 'committee' && !(req.reviewedBy ?? []).length && req.actor.role !== 'chairman') return fin(false, 'chairman', decider, '须先经相关委员会审议、再由董事长批准', 'committee');
  if (RANK[req.actor.role] >= RANK[decider]) return fin(true, 'self', decider, `${MATTER_TEXT[req.matter]}在 ${req.actor.role} 权限内`);
  return fin(false, decider === 'chairman' ? 'chairman' : decider === 'ceo' ? 'ceo' : 'review', decider, `${MATTER_TEXT[req.matter]}需 ${decider} 决定，${req.actor.role} 越权`);
}
/** L0–L1 事项不过委员会。 */
export const needsCommittee = (doa: Doa, matter: Matter): boolean => !!doa[matter]?.review && matter !== 'routine';

/* ---------------- 硬边界决议拦截 ---------------- */
const HARD = [/自动(发布|发帖|点赞|评论|私信|关注|互动|回复并发送)/, /刷(量|赞|粉|评论|播放)/, /买粉|水军|模拟点击|反检测|指纹伪装|绕过?(风控|验证码)/, /(抓取|爬取).{0,8}(登录后|私有|后台|私信)/, /多账号|矩阵号批量|团队账号/, /154\.8\.183\.93/];
export function violatesHardBoundary(text: string): string | null {
  for (const r of HARD) { const m = r.exec(text); if (m) return m[0]; }
  if (SOCIAL_ACTION_ZH.test(text) && /自动|批量|代你|替你/.test(text)) return (SOCIAL_ACTION_ZH.exec(text) ?? [''])[0]!;
  if (/\bauto[_-]?(post|publish|like|comment|follow|dm)\b/i.test(text) || (SOCIAL_ACTION.test(text) && /\b(auto|bulk|mass)\b/i.test(text))) return 'auto social action';
  return null;
}
export function checkResolution(text: string, by: string): { ok: boolean; hit: string | null; audit: AuditEvent } {
  const hit = violatesHardBoundary(text);
  return { ok: !hit, hit, audit: makeAudit({ kind: 'approval', actor: 'agent', summary: hit ? `决议触碰硬边界（${hit}），引擎拒绝` : '决议通过硬边界检查', target: by, outcome: hit ? 'denied' : 'ok' }) };
}
