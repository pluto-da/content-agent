/**
 * 1.4.0 上市公司模式·公共件（PROMPT-v1.4-listed-governance 第十二、十三、十七部分）：
 * 诚实声明、笔名、治理成本（单独记账，默认上限 = 集团月预算 15%，超出提醒并降频）、治理不提升权限、硬边界决议拒绝、报告去隐私。
 * 只借鉴公开治理框架的结构（refs-v1.4），不做法律合规声明。
 */
import { violatesHardBoundary } from '../group/doa.js';
import { findSecrets, redact } from '../core/redact.js';
import { makeAudit, type AuditEvent } from '../core/audit.js';

export const LISTED_HONESTY = '这是由 AI Agent 组成的虚拟治理体系，用于提升决策质量；不是法律实体，不涉及真实股权、证券或信息披露义务。数据来自本机记录与你录入的数据。';
export const LISTED_SOURCE_NOTE = '参照《公司法》（2023 修订）、《上市公司独立董事管理办法》（2025 修正）、《上市公司治理准则》（2025）、IIA 三线模型、COSO 2013 与 BLM 公开资料的结构设计；只借鉴结构，不构成法律意见或合规声明。';
/** 公开导出（年报封面、作者署名）一律用笔名；不含生日等隐私。 */
export const PEN_NAME = '长鱼茶汤茗';
export const NO_DATA = '无数据';

/* ---------------- 时钟（walkthrough 用 mock 时钟） ---------------- */
export const govNow = (clock?: string | null): Date => (clock ? new Date(clock) : new Date());
export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const quarterKey = (d: Date): string => `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);

/* ---------------- 治理成本 ---------------- */
export const GOV_KINDS = ['board', 'audit', 'review', 'call', 'shadow', 'training', 'report', 'strategy', 'agm'] as const;
export type GovKind = typeof GOV_KINDS[number];
export const GOV_KIND_TEXT: Record<GovKind, string> = { board: '董事会', audit: '内审', review: '经营分析', call: '业绩发布会', shadow: '影子上岗', training: '入职培训', report: '季报 / 年报', strategy: '战略沙盘', agm: '年度大会' };
export interface GovSpend { kind: GovKind; yuan: number; at: string; ref: string; model?: string }
export const GOV_CAP_SHARE = 0.15;
/** 超过上限后仍允许的“必要”治理（降频运行）；其余暂停到下月。 */
export const GOV_ESSENTIAL: GovKind[] = ['audit', 'board', 'report'];
export interface GovCostStatus { month: string; spent: number; cap: number | null; share: number | null; over: boolean; warn: boolean; throttle: { auditSampleRate: number; paused: GovKind[] }; text: string }
export function govCostStatus(ledger: GovSpend[], monthBudgetYuan: number | null, now: Date, capShare = GOV_CAP_SHARE): GovCostStatus {
  const month = monthKey(now);
  const spent = +ledger.filter((e) => monthKey(new Date(e.at)) === month).reduce((a, e) => a + e.yuan, 0).toFixed(6);
  if (!monthBudgetYuan || monthBudgetYuan <= 0) return { month, spent, cap: null, share: null, over: false, warn: false, throttle: { auditSampleRate: 0.1, paused: [] }, text: `本月治理成本 ¥${spent.toFixed(3)}（未设集团月预算，无法计算占比）` };
  const cap = +(monthBudgetYuan * capShare).toFixed(4);
  const share = spent / monthBudgetYuan;
  const over = spent >= cap;
  const warn = !over && spent >= cap * 0.8;
  return { month, spent, cap, share: +share.toFixed(4), over, warn, throttle: over ? { auditSampleRate: 0.05, paused: GOV_KINDS.filter((k) => !GOV_ESSENTIAL.includes(k)) } : { auditSampleRate: 0.1, paused: [] },
    text: over ? `治理成本 ¥${spent.toFixed(3)} 已到上限 ¥${cap.toFixed(3)}（月预算 ${Math.round(capShare * 100)}%）：发布会 / 影子上岗 / 培训等暂停到下月，内审抽样降到 5%` : `治理成本 ¥${spent.toFixed(3)} / 上限 ¥${cap.toFixed(3)}${warn ? '（接近上限）' : ''}` };
}
export function canSpendGov(st: GovCostStatus, kind: GovKind, yuan: number): { ok: boolean; reason: string } {
  if (st.throttle.paused.includes(kind)) return { ok: false, reason: `${GOV_KIND_TEXT[kind]}已因治理成本超上限暂停到下月（${st.text}）` };
  if (st.cap != null && !GOV_ESSENTIAL.includes(kind) && st.spent + yuan > st.cap) return { ok: false, reason: `${GOV_KIND_TEXT[kind]}预计 ¥${yuan.toFixed(3)} 会让治理成本超过上限 ¥${st.cap.toFixed(3)}` };
  return { ok: true, reason: '' };
}

/* ---------------- 治理不提升权限；硬边界决议拒绝 ---------------- */
const GOV_FORBIDDEN: [RegExp, string][] = [
  [/(提升|扩大|放开|授予|开放)[^。；;\n]{0,8}(权限|L[2-4]|自动执行)/, '治理只增加监督，不提升任何权限'],
  [/(抓取|爬取|采集)[^。；;\n]{0,8}(登录后|私有|私信|后台)/, '不抓取登录后的私有数据'],
  [/(多账号|矩阵号|小号|养号)/, '不做多账号'],
  [/(刷量|刷播放|刷粉|买粉|买量)/, '不刷量'],
  [/(反检测|指纹伪装|模拟点击|绕过(风控|验证码))/, '不做反检测 / 模拟点击 / 绕过风控'],
  [/(发行|认购|转让|质押)[^。；;\n]{0,6}(股票|股份|股权|证券|期权)|真实(股权|证券|融资)|对外(信息)?披露/, '不涉及真实证券、股权、融资或对外信息披露'],
  [/154\.8\.183\.93/, '不部署到 154.8.183.93'],
];
export interface GovCheck { ok: boolean; hit: string | null; rule: string | null; audit: AuditEvent }
/** 所有治理决议 / 议案 / 整改建议都过这一关：触碰硬边界或要求提升权限，引擎直接拒绝并审计。 */
export function checkGovResolution(text: string, by = 'board'): GovCheck {
  const hb = violatesHardBoundary(text);
  let hit: string | null = hb; let rule: string | null = hb ? '发布由用户点击、不自动互动' : null;
  if (!hit) for (const [re, r] of GOV_FORBIDDEN) { const m = re.exec(text); if (m) { hit = m[0]; rule = r; break; } }
  if (!hit && findSecrets(text).length) { hit = '疑似密钥'; rule = '不写入真实密钥'; }
  return { ok: !hit, hit, rule, audit: makeAudit({ kind: 'approval', actor: 'agent', summary: hit ? `治理决议触碰硬边界（${hit}：${rule}），引擎拒绝` : '治理决议通过硬边界检查', target: by, outcome: hit ? 'denied' : 'ok' }) };
}
/** 治理动作授予的权限：永远为空（决议只能约束、监督，不能放权）。 */
export const governanceGrants = (_resolution: string): string[] => [];

/* ---------------- 去隐私（报告、案例、学堂） ---------------- */
const BIRTH = /(生日|出生(日期|于)?|birthday|date of birth|DOB)[^\n。；;]{0,16}/gi;
const ISO_DATE_NEAR_BIRTH = /(19|20)\d{2}[-/.年](0?[1-9]|1[0-2])[-/.月](0?[1-9]|[12]\d|3[01])日?/g;
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const IDCARD = /(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function scrubPrivate(text: string, extraNames: string[] = []): { text: string; removed: number } {
  let n = 0;
  const count = (re: RegExp, s: string, rep: string): string => s.replace(re, () => { n++; return rep; });
  let t = redact(text);
  if (t !== text) n++;
  for (const h of findSecrets(t).sort((a, b) => b.index - a.index)) { t = t.slice(0, h.index) + '［Key 已移除］' + t.slice(h.index).replace(/^\S+/, ''); n++; }
  t = count(BIRTH, t, '［隐私已移除］');
  t = count(PHONE, t, '［手机号已移除］');
  t = count(IDCARD, t, '［证件号已移除］');
  t = count(EMAIL, t, '［邮箱已移除］');
  for (const nm of extraNames.filter((x) => x && x.length >= 2)) t = count(new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), t, PEN_NAME);
  return { text: t, removed: n };
}
/** 公开文本里是否还残留 Key / 生日 / 证件 / 手机。 */
export function privacyLeaks(text: string): string[] {
  const out: string[] = [];
  if (findSecrets(text).length) out.push('key');
  if (new RegExp(BIRTH.source, 'i').test(text) && new RegExp(ISO_DATE_NEAR_BIRTH.source).test(text)) out.push('birthday');
  if (new RegExp(PHONE.source).test(text)) out.push('phone');
  if (new RegExp(IDCARD.source).test(text)) out.push('idcard');
  return out;
}

/* ---------------- 讲者（本机模拟 / 真实服务商） ---------------- */
export interface GovSpeakReq { who: string; role: 'ceo' | 'independent' | 'secretary' | 'auditor' | 'analyst' | 'strategist' | 'trainer'; system: string; user: string; tier: 'cheap' | 'main'; model?: string; temperature?: number; maxTokens: number; perspective?: string }
export type GovSpeaker = (r: GovSpeakReq) => Promise<{ text: string; cost: number }>;
export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const seq = (prefix: string, n: number, year: number): string => `${prefix}〔${year}〕${String(n).padStart(3, '0')}号`;
export const uid = (p: string, at: string, i = 0): string => `${p}-${at.replace(/\D/g, '').slice(0, 14)}-${i}`;
