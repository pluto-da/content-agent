/**
 * 1.3.0 制度库（第五部分）：company/regulations/ 下 10 项制度，全部原创。
 * 首页注明：参照小米、阿里巴巴、腾讯、字节跳动公开报道的治理方式设计，非任何公司官方制度。
 * 制度修改：提案 → 相关委员会审议 → 董事长批准（L3），带版本、可回滚；章程与 DOA 默认值的改动只写进 design/proposals-v1.3.md。
 */
import { parseDoc } from '../vfs/frontmatter.js';
import { findSecrets } from '../core/redact.js';
import { GROUP_SOURCE_NOTE } from './org.js';

export interface Regulation { id: string; no: number; title: string; path: string; body: string; committee: string; highRisk: boolean }
export const REG_DIR = 'company/regulations';
export const regPath = (no: number, id: string): string => `${REG_DIR}/${String(no).padStart(2, '0')}-${id}.md`;

const H = (title: string) => `# ${title}\n\n> ${GROUP_SOURCE_NOTE}\n\n`;
const R = (no: number, id: string, title: string, committee: string, body: string, highRisk = false): Regulation => ({ id, no, title, path: regPath(no, id), body: H(title) + body, committee, highRisk });

export const DOA_FRONT = `---
id: doa
version: 1
routine:
  initiator: executor
  decide: executor
  inform: dept_head
  control: false
spend:
  initiator: executor
  review: finance
  decide: ceo
  inform: chairman
  deptMaxYuan: 0.5
  ceoMaxYuan: 2
  control: true
external:
  initiator: dept_head
  review: legal
  decide: chairman
  inform: ceo
  control: true
rule_change:
  initiator: dept_head
  review: committee
  decide: chairman
  inform: all
  control: true
perm_change:
  initiator: org
  review: hr
  decide: chairman
  inform: ceo
  control: true
hard_boundary:
  decide: forbidden
  control: true
org_change:
  initiator: org
  review: hr
  decide: chairman
  inform: all
  control: false
race_start:
  initiator: dept_head
  review: management
  decide: ceo
  inform: chairman
  control: false
gray_release:
  initiator: dept_head
  review: tech
  decide: ceo
  inform: chairman
  control: false
demote_pause:
  initiator: ceo
  decide: ceo
  inform: chairman
  control: false
---
`;

export const REGULATIONS: Regulation[] = [
  R(1, 'charter', '集团章程', 'hr', `## 第一条 使命
本集团是由 AI Agent 组成的虚拟组织，用于分工协作，不是法律实体；对外发布由董事长本人完成。

## 第二条 层级
董事长（用户）→ CEO（超级 Agent）→ 部门负责人 → 执行 Agent。CEO 以下只两级。

## 第三条 权责
董事长：愿景与年度目标、批准制度与组织调整、批准 L3、终裁、随时叫停。CEO：经管会主任，拆目标、调资源、主持例会、裁决部门争议（董事长可推翻）。部门负责人：本部门产出、预算、参会。执行 Agent：干活。

## 第四条 四条不变量
一、董事长终裁；二、硬边界不可放宽；三、花钱有预算；四、一切留痕、可回滚。

## 第五条 硬边界
硬边界以 BOUNDARIES.md 为准（本章程只引用，不复制）。任何决议、会话、会议不得放宽。
`, true),
  R(2, 'doa', '决策权限表（DOA）', 'management', `本表 front matter 由引擎直接执行：每类事项的发起（R）、审议（A 前置）、决定（A）、知会（I），以及金额阈值。越权即拦截并写审计；超权事项自动生成请示进入董事长收件箱。

## 第一条 控制只落在五类事上
花钱、对外、改规则、改权限、硬边界（Context 少控制：其余信息默认公开，事项默认放行）。

## 第二条 委员会制衡与速度
L0–L1 事项不过委员会；只有本表指定的事项才审议，审核退回最多两轮。

## 第三条 金额
单次花费 ≤ 部门上限由部门负责人决定；≤ CEO 上限由 CEO 决定；以上由董事长决定。
`, true),
  R(3, 'collaboration', '协作管理办法', 'management', `## 第一条 顺序
能派单不拉群，能拉群不开会；开会必须先有文档、必须有决议。

## 第二条 临时会话
六种情形自动拉群；成员不超过 5 个；默认 10 条消息、¥0.2、30 分钟；目标达成打 √、达到上限或到期自动解散；解散前生成小结，待办转工单，未决事项升级或转会议室。同时存活不超过 5 个，超出排队。

## 第三条 会议
七个常设会议室按各自规程推进；讨论用省钱档模型，综合与决议用主模型；单人单轮不超过 300 字；无来源的数据标“推测”。

## 第四条 纪要
会议自动出纪要（编号、参会、要点、决议、待办 owner + 截止时间），待办自动转工单。
`),
  R(4, 'documents', '文档与公文管理办法', 'management', `## 第一条 文档先行
会前文档写明背景、问题、选项、数据；参会者先读文档再发言。

## 第二条 写作规范
结论先行、坦诚清晰、不堆砌、不包装。检查器打分，低分要求重写。

## 第三条 公文类型
请示、报告、通知、纪要、提案、决议、简报。

## 第四条 编号与流转
编号格式：集团〔年份〕三位序号号；起草 → 审核 → 批准 / 驳回 → 归档，全程留痕。
`),
  R(5, 'budget', '预算管理办法', 'management', `## 第一条 编制与分配
集团月度总预算沿用“花钱”设置，不因集团模式增加；经管会按部门分配。

## 第二条 监控与超支
花费计入发起部门；超支即暂停并生成请示。会议与会话花费占比超过 30% 时提醒精简。

## 第三条 赛马专项预算
赛马使用专项预算，单次与月度上限可调；超出即停止该匹马。

## 第四条 季度调整
每季度由财务部出执行报告，经管会调整。
`),
  R(6, 'quality', '质量管理办法', 'quality', `## 第一条 检查清单
事实与来源、平台规格、广告法极限用语、AIGC 标识、硬边界。

## 第二条 退回与复审
质量委员会可退回，须写明原因与条款；同一稿件最多退回两轮，第三次自动升级。

## 第三条 事故复盘
质量事故自动在复盘室开会。
`),
  R(7, 'okr', '目标与考核办法', 'hr', `## 第一条 OKR 周期
默认季度，可设双月。董事长年度目标 → 经管会拆为部门 OKR → 部门拆为 Agent KR。

## 第二条 公开对齐
所有 OKR 对全集团可读；任何 Agent 可发起对齐请求。

## 第三条 KPI
只用可验证数据：产出数、一次通过率、退回率、采纳率、按时率、花费、你录入的效果数据；没有数据写“待录入”。

## 第四条 360 评议
季度由协作过的部门互评；组织部汇总，CEO 综合，报告呈董事长。
`),
  R(8, 'org-change', '组织调整办法', 'hr', `## 第一条 范围
新设、合并、撤销、更名、调岗、停用。

## 第二条 程序
权限升级、新设或撤销部门、停用 Agent：人力资源委员会提案 → 董事长批准。降级与暂停：CEO 可先处置并立即报告。只提议停用，不自动删除。

## 第三条 组织体检
每季度组织部出组织体检，建议合并、撤销或新设。
`),
  R(9, 'information', '信息与保密办法', 'hr', `## 第一条 信息分级
公开 / 部门 / 私密。集团上下文流只收公开与部门级；私密级记忆不进入。

## 第二条 Key 与隐私
Key 与隐私永不进入文档、公文、会话；写入前扫描，命中即打码并拒绝。

## 第三条 对外
公开场景用笔名，不含隐私。
`),
  R(10, 'retro', '复盘办法', 'quality', `## 第一条 四步
目标回顾 → 结果对比 → 原因分析 → 经验沉淀（复盘四步，公开常见表述）。

## 第二条 触发
每个 OKR 周期、每个重大项目、每次质量事故，自动在复盘室开会。

## 第三条 沉淀
结论作为 lesson：低风险自动采纳，高风险进收件箱；写入上下文流。
`),
];

/** 02-doa.md 的完整文本 = DOA front matter + 正文。 */
export function regulationText(r: Regulation): string { return r.id === 'doa' ? DOA_FRONT + r.body : r.body; }
export const REGULATION_FILES: Record<string, string> = Object.fromEntries(REGULATIONS.map((r) => [r.path, regulationText(r)]));
export const REGULATION_INDEX = `${REG_DIR}/REGULATIONS.md`;
export const REGULATION_INDEX_TEXT = `# 制度库\n\n> ${GROUP_SOURCE_NOTE}\n\n${REGULATIONS.map((r) => `${r.no}. [${r.title}](${r.path.slice(REG_DIR.length + 1)})${r.highRisk ? '（高风险：改动只以修订建议存在，需你确认）' : ''}`).join('\n')}\n`;

/** 条款引用：“第N条”或“制度id#N”。 */
export function clauseExists(ref: string): boolean {
  const m = /^(?:(\d{1,2})|([a-z-]+))#(\d+)$/.exec(ref.trim());
  if (!m) return false;
  const r = REGULATIONS.find((x) => (m[1] ? x.no === Number(m[1]) : x.id === m[2]));
  if (!r) return false;
  const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][Number(m[3])] ?? '';
  return new RegExp(`## 第${cn}条`).test(r.body);
}
export function clauseText(ref: string): string {
  const m = /^(?:(\d{1,2})|([a-z-]+))#(\d+)$/.exec(ref.trim());
  const r = m ? REGULATIONS.find((x) => (m[1] ? x.no === Number(m[1]) : x.id === m[2])) : undefined;
  if (!r || !m) return ref;
  const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][Number(m[3])] ?? '';
  return `《${r.title}》第${cn}条`;
}

/* ---------------- 制度修改：L3、版本、回滚 ---------------- */
export interface RegVersion { id: string; version: number; text: string; at: string; author: 'default' | 'user_approved' }
export type RegHistory = Record<string, RegVersion[]>;
export function initRegHistory(at = new Date().toISOString()): RegHistory {
  return Object.fromEntries(REGULATIONS.map((r) => [r.id, [{ id: r.id, version: 1, text: regulationText(r), at, author: 'default' as const }]]));
}
export const currentReg = (h: RegHistory, id: string): RegVersion | undefined => h[id]?.at(-1);
export interface RegProposal { regId: string; title: string; committee: string; level: 'L3'; highRisk: boolean; text: string; diffLines: number; errors: string[] }
export function proposeRegChange(h: RegHistory, regId: string, text: string): RegProposal {
  const r = REGULATIONS.find((x) => x.id === regId);
  const cur = currentReg(h, regId);
  const errors: string[] = [];
  if (!r || !cur) errors.push(`没有制度 ${regId}`);
  if (findSecrets(text).length) errors.push('制度里不能出现 Key');
  if (!text.includes(GROUP_SOURCE_NOTE)) errors.push('首页必须注明参照来源（非任何公司官方制度）');
  if (regId === 'charter' && /(放宽|取消|删除).{0,8}(硬边界|BOUNDARIES)/.test(text)) errors.push('章程不得放宽硬边界');
  if (regId === 'doa' && !parseDoc(text).hasFM) errors.push('DOA 必须保留可执行的 front matter');
  const a = new Set((cur?.text ?? '').split('\n')), b = text.split('\n');
  return { regId, title: r?.title ?? regId, committee: r?.committee ?? 'management', level: 'L3', highRisk: !!r?.highRisk, text, diffLines: b.filter((l) => !a.has(l)).length, errors };
}
export function applyRegChange(h: RegHistory, p: RegProposal, approvedByChairman: boolean, at = new Date().toISOString()): RegHistory {
  if (!approvedByChairman) throw new Error('制度修改属 L3：须相关委员会审议、董事长批准');
  if (p.errors.length) throw new Error(p.errors.join('；'));
  const list = h[p.regId] ?? [];
  return { ...h, [p.regId]: [...list, { id: p.regId, version: (list.at(-1)?.version ?? 0) + 1, text: p.text, at, author: 'user_approved' }] };
}
export function rollbackReg(h: RegHistory, regId: string): RegHistory {
  const list = h[regId] ?? [];
  if (list.length < 2) throw new Error('没有可回滚的版本');
  return { ...h, [regId]: list.slice(0, -1) };
}
