/**
 * 1.3.0 集团模式 · 融合组织模型（PROMPT-v1.3-conglomerate 第四部分）。
 * 参照小米、阿里巴巴、腾讯、字节跳动公开报道的治理方式设计，非任何公司官方制度（来源见 design/refs-v1.3/）。
 * 一条权力链：董事长（用户）→ CEO（超级 Agent）→ 部门负责人 → 执行 Agent；CEO 以下只两级。
 * 纯函数：组织结构、清单读写（company/departments/<id>/DEPT.md、company/committees/<id>/COMMITTEE.md）、编制、增删改合并。
 */
import { parseDoc, serializeDoc } from '../vfs/frontmatter.js';
import { findSecrets } from '../core/redact.js';
import type { PermLevel } from '../super/governance.js';

export const GROUP_HONESTY = '这是由 AI Agent 组成的虚拟组织，用于分工协作，不是法律实体；对外发布由你本人完成。';
export const GROUP_SOURCE_NOTE = '参照小米、阿里巴巴、腾讯、字节跳动公开报道的治理方式设计，非任何公司官方制度。';

export type Role = 'chairman' | 'ceo' | 'dept_head' | 'executor';
export const ROLE_TEXT: Record<Role, string> = { chairman: '董事长（你）', ceo: 'CEO（超级 Agent）', dept_head: '部门负责人', executor: '执行 Agent' };
/** 层级：CEO 以下只两级（小米三级扁平）。 */
export const CHAIN: Role[] = ['chairman', 'ceo', 'dept_head', 'executor'];

export type DeptKind = 'hq' | 'bu' | 'shared' | 'pending';
export const DEPT_KIND_TEXT: Record<DeptKind, string> = { hq: '总部职能部门', bu: '事业部', shared: '共享能力中心', pending: '待分配' };
export type DeptStatus = 'active' | 'paused' | 'disabled';

export interface Dept {
  id: string; name: string; kind: DeptKind; head: string; members: string[]; duties: string[];
  budgetYuan: number; permCap: PermLevel; peers: string[]; platforms: string[]; status: DeptStatus;
  /** 拥有否决权的部门（法务合规部：合规否决）。 */
  veto?: 'compliance';
  /** 事业部下设执行岗。 */
  posts?: string[];
}
export interface Committee {
  id: string; name: string; chair: string; members: string[]; secretary: string; scope: string[]; rules: string[];
  parent?: string; veto?: 'quality';
}
export interface Headcount { maxAgents: number; maxConcurrent: number }
export const DEFAULT_HEADCOUNT: Headcount = { maxAgents: 20, maxConcurrent: 3 };

export interface Org { name: string; depts: Dept[]; committees: Committee[]; headcount: Headcount }

export const DEPT_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const deptPath = (id: string): string => `company/departments/${id}/DEPT.md`;
export const committeePath = (id: string): string => `company/committees/${id}/COMMITTEE.md`;
export const isDeptPath = (p: string): boolean => /^company\/departments\/[a-z][a-z0-9-]{1,39}\/DEPT\.md$/.test(p);
export const isCommitteePath = (p: string): boolean => /^company\/committees\/[a-z][a-z0-9-]{1,39}\/COMMITTEE\.md$/.test(p);

const d = (id: string, name: string, kind: DeptKind, duties: string[], o: Partial<Dept> = {}): Dept => ({
  id, name, kind, head: `${id}-head`, members: [], duties, budgetYuan: kind === 'bu' ? 1 : 0.5, permCap: kind === 'hq' && id !== 'finance' ? 'L1' : 'L2', peers: [], platforms: [], status: 'active', ...o,
});

/** 默认组织：4 职能部门 + 4 事业部 + 共享能力中心（4 个能力单元）+ 待分配。 */
export const DEFAULT_DEPTS: Dept[] = [
  d('staff', '参谋部', 'hq', ['战略', '趋势', '督导', '经管会秘书长'], { peers: ['finance', 'org'] }),
  d('org', '组织部', 'hq', ['编制', '任免提案', '考核', '技能培训', '政委派驻'], { peers: ['staff'] }),
  d('finance', '财务部', 'hq', ['预算', '成本', '收益核对（只用你录入或导入的数据）'], { peers: ['staff'] }),
  d('legal', '法务合规部', 'hq', ['硬边界', '平台规则', '广告法', 'AIGC 标识'], { veto: 'compliance', permCap: 'L0' }),
  d('bu-video', '短视频事业部', 'bu', ['短视频选题', '脚本', '口播', '视觉与配音'], { platforms: ['douyin', 'kuaishou', 'channels', 'bilibili'], posts: ['策划', '内容', '视觉 / 配音'], peers: ['data-center', 'asset-center'] }),
  d('bu-article', '图文事业部', 'bu', ['图文选题', '长文', '笔记', '配图'], { platforms: ['xiaohongshu', 'wechat', 'zhihu', 'weibo'], posts: ['策划', '内容', '视觉'], peers: ['data-center', 'asset-center'] }),
  d('bu-ecom', '电商事业部', 'bu', ['带货文案', '商品卡', '直播脚本草稿'], { platforms: ['douyin', 'xiaohongshu', 'taobao'], posts: ['策划', '内容', '视觉'], peers: ['data-center'] }),
  d('bu-intl', '国际事业部', 'bu', ['海外平台', '多语言改写', '本地化'], { platforms: ['youtube', 'tiktok', 'instagram', 'x'], posts: ['策划', '内容', '视觉'], peers: ['data-center'] }),
  d('data-center', '数据中心', 'shared', ['数据导入与口径', '效果预测（有历史数据时）', 'OKR 冲突发现'], { permCap: 'L1' }),
  d('asset-center', '素材中心', 'shared', ['素材库', '落选方案归档复用'], { permCap: 'L1' }),
  d('skill-library', '技能与模板库', 'shared', ['技能', '模板', '平台写法'], { permCap: 'L1' }),
  d('user-ops', '用户运营', 'shared', ['评论与私信回复草稿（只出草稿，不发送）'], { permCap: 'L1' }),
  d('pending', '待分配', 'pending', ['尚未归入部门的执行 Agent'], { permCap: 'L1', budgetYuan: 0 }),
];
const c = (id: string, name: string, scope: string[], o: Partial<Committee> = {}): Committee => ({ id, name, chair: 'ceo', members: [], secretary: 'staff-head', scope, rules: ['过半数通过', '否决须引用条款', '审核退回最多两轮'], ...o });
/** 5 个委员会（设计委员会隶属技术委员会，不单独计数）。 */
export const DEFAULT_COMMITTEES: Committee[] = [
  c('management', '经营管理委员会', ['战略', '规划', '预算', '执行'], { members: ['staff-head', 'finance-head', 'bu-video-head', 'bu-article-head', 'bu-ecom-head', 'bu-intl-head'] }),
  c('hr', '人力资源委员会', ['组织调整', '任免'], { members: ['org-head', 'staff-head'], secretary: 'org-head' }),
  c('quality', '质量委员会', ['发布前质量', '退回与复审', '事故复盘'], { members: ['legal-head', 'skill-library-head'], veto: 'quality' }),
  c('tech', '技术委员会', ['模型', '工具', '技能', 'MCP 选型', '灰度'], { members: ['skill-library-head', 'data-center-head'] }),
  c('design', '设计委员会', ['视觉规范', '封面'], { parent: 'tech', members: ['asset-center-head'] }),
  c('procurement', '采购委员会', ['外部服务', '付费 API'], { members: ['finance-head', 'staff-head'] }),
];
export const topCommittees = (o: Pick<Org, 'committees'>): Committee[] => o.committees.filter((x) => !x.parent);

export function defaultOrg(name = '我的集团'): Org {
  return { name, depts: DEFAULT_DEPTS.map((x) => ({ ...x, members: [...x.members], duties: [...x.duties], peers: [...x.peers], platforms: [...x.platforms], posts: x.posts ? [...x.posts] : undefined })), committees: DEFAULT_COMMITTEES.map((x) => ({ ...x, members: [...x.members], scope: [...x.scope], rules: [...x.rules] })), headcount: { ...DEFAULT_HEADCOUNT } };
}

/* ---------------- 清单读写 ---------------- */
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v ? [v] : []);
export function serializeDeptMd(x: Dept): string {
  const fm: Record<string, unknown> = { id: x.id, name: x.name, kind: x.kind, head: x.head, members: x.members, budgetYuan: x.budgetYuan, permCap: x.permCap, peers: x.peers, platforms: x.platforms, status: x.status };
  if (x.veto) fm.veto = x.veto;
  if (x.posts?.length) fm.posts = x.posts;
  return serializeDoc(fm, `# ${x.name}\n\n${DEPT_KIND_TEXT[x.kind]}。\n\n## 职责\n${x.duties.map((t) => `- ${t}`).join('\n')}\n\n## OKR\n见集团目标（公开）。\n`);
}
export function parseDeptMd(text: string): Dept {
  const { fm, body } = parseDoc(text);
  const duties = (/## 职责\n([\s\S]*?)(\n## |$)/.exec(body)?.[1] ?? '').split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  const out: Dept = { id: String(fm.id ?? ''), name: String(fm.name ?? ''), kind: (fm.kind as DeptKind) ?? 'pending', head: String(fm.head ?? ''), members: arr(fm.members), duties, budgetYuan: Number(fm.budgetYuan ?? 0), permCap: (fm.permCap as PermLevel) ?? 'L1', peers: arr(fm.peers), platforms: arr(fm.platforms), status: (fm.status as DeptStatus) ?? 'active' };
  if (fm.veto === 'compliance') out.veto = 'compliance';
  if (fm.posts) out.posts = arr(fm.posts);
  return out;
}
export function serializeCommitteeMd(x: Committee): string {
  const fm: Record<string, unknown> = { id: x.id, name: x.name, chair: x.chair, members: x.members, secretary: x.secretary };
  if (x.parent) fm.parent = x.parent;
  if (x.veto) fm.veto = x.veto;
  return serializeDoc(fm, `# ${x.name}\n\n## 议事范围\n${x.scope.map((t) => `- ${t}`).join('\n')}\n\n## 议事规则\n${x.rules.map((t) => `- ${t}`).join('\n')}\n`);
}
export function parseCommitteeMd(text: string): Committee {
  const { fm, body } = parseDoc(text);
  const sec = (t: string) => (new RegExp(`## ${t}\\n([\\s\\S]*?)(\\n## |$)`).exec(body)?.[1] ?? '').split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  const out: Committee = { id: String(fm.id ?? ''), name: String(fm.name ?? ''), chair: String(fm.chair ?? 'ceo'), members: arr(fm.members), secretary: String(fm.secretary ?? ''), scope: sec('议事范围'), rules: sec('议事规则') };
  if (fm.parent) out.parent = String(fm.parent);
  if (fm.veto === 'quality') out.veto = 'quality';
  return out;
}
export function validateDept(x: Dept, o: { existing?: string[] } = {}): string[] {
  const e: string[] = [];
  if (!DEPT_ID.test(x.id)) e.push('部门 id 只能用小写字母、数字和短横线，2–40 位');
  if (o.existing?.includes(x.id)) e.push(`部门 id ${x.id} 已存在`);
  if (!x.name.trim() || x.name.length > 20) e.push('部门名称 1–20 字');
  if (!['L0', 'L1', 'L2'].includes(x.permCap)) e.push('部门权限上限只能是 L0–L2（L3 只属于董事长确认）');
  if (x.budgetYuan < 0 || x.budgetYuan > 100) e.push('部门月预算 0–100 元');
  if (findSecrets(JSON.stringify(x)).length) e.push('清单里不能出现 Key');
  return e;
}

/* ---------------- 编制 ---------------- */
export function memberCount(o: Org): number { return new Set(o.depts.flatMap((x) => x.members)).size; }
export function checkHeadcount(o: Org, adding = 1): { ok: boolean; text: string } {
  const n = memberCount(o) + adding;
  return n <= o.headcount.maxAgents ? { ok: true, text: `编制 ${n}/${o.headcount.maxAgents}` } : { ok: false, text: `超出编制：执行 Agent 上限 ${o.headcount.maxAgents} 个（调整编制属 L3，需人力资源委员会提案、你批准）` };
}
export function clampHeadcount(h: Partial<Headcount>): Headcount {
  const n = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
  return { maxAgents: n(h.maxAgents, 1, 50, 20), maxConcurrent: n(h.maxConcurrent, 1, 5, 3) };
}

/* ---------------- 增删改合并（结构变化 = L3，经人力资源委员会提案、董事长批准） ---------------- */
export type OrgChange =
  | { op: 'add'; dept: Dept } | { op: 'rename'; id: string; name: string } | { op: 'remove'; id: string }
  | { op: 'merge'; from: string; into: string; name?: string } | { op: 'move'; agentId: string; to: string }
  | { op: 'pause'; id: string } | { op: 'resume'; id: string };
export const orgChangeLevel = (ch: OrgChange): 'L3' | 'L1' => (ch.op === 'pause' || ch.op === 'resume' || ch.op === 'move' ? 'L1' : 'L3');
export function applyOrgChange(o: Org, ch: OrgChange): Org {
  const depts = o.depts.map((x) => ({ ...x, members: [...x.members] }));
  const find = (id: string) => { const x = depts.find((y) => y.id === id); if (!x) throw new Error(`没有部门 ${id}`); return x; };
  const pending = () => find('pending');
  switch (ch.op) {
    case 'add': { const e = validateDept(ch.dept, { existing: depts.map((x) => x.id) }); if (e.length) throw new Error(e.join('；')); depts.push({ ...ch.dept, members: [...ch.dept.members] }); break; }
    case 'rename': { if (!ch.name.trim() || ch.name.length > 20) throw new Error('部门名称 1–20 字'); find(ch.id).name = ch.name.trim(); break; }
    case 'remove': { if (ch.id === 'pending') throw new Error('“待分配”不能撤销'); const x = find(ch.id); pending().members.push(...x.members); depts.splice(depts.indexOf(x), 1); break; }
    case 'merge': { const a = find(ch.from), b = find(ch.into); if (a === b) throw new Error('不能与自己合并'); b.members = [...new Set([...b.members, ...a.members])]; b.duties = [...new Set([...b.duties, ...a.duties])]; b.platforms = [...new Set([...b.platforms, ...a.platforms])]; b.budgetYuan = +(b.budgetYuan + a.budgetYuan).toFixed(2); if (ch.name) b.name = ch.name; depts.splice(depts.indexOf(a), 1); break; }
    case 'move': { for (const x of depts) x.members = x.members.filter((m) => m !== ch.agentId); find(ch.to).members.push(ch.agentId); break; }
    case 'pause': find(ch.id).status = 'paused'; break;
    case 'resume': find(ch.id).status = 'active'; break;
  }
  return { ...o, depts };
}
export function describeOrgChange(ch: OrgChange, o: Org): string {
  const n = (id: string) => o.depts.find((x) => x.id === id)?.name ?? id;
  switch (ch.op) {
    case 'add': return `新设部门「${ch.dept.name}」`;
    case 'rename': return `部门「${n(ch.id)}」更名为「${ch.name}」`;
    case 'remove': return `撤销部门「${n(ch.id)}」（成员转入待分配）`;
    case 'merge': return `「${n(ch.from)}」并入「${n(ch.into)}」`;
    case 'move': return `${ch.agentId} 调岗到「${n(ch.to)}」`;
    case 'pause': return `暂停部门「${n(ch.id)}」`;
    case 'resume': return `恢复部门「${n(ch.id)}」`;
  }
}

/* ---------------- 1.2 子 Agent 归入默认部门 ---------------- */
const TEMPLATE_DEPT: Record<string, string> = {
  'topic-researcher': 'staff', 'platform-adapter': 'skill-library', 'visual-voice': 'bu-video', 'compliance-reviewer': 'legal',
  'data-analyst': 'data-center', 'revenue-analyst': 'finance', 'reply-drafter': 'user-ops', 'asset-librarian': 'asset-center',
};
export function deptForAgent(a: { id: string; duty?: string; description?: string }): string {
  if (TEMPLATE_DEPT[a.id]) return TEMPLATE_DEPT[a.id]!;
  const s = `${a.id} ${a.duty ?? ''} ${a.description ?? ''}`;
  if (/合规|审核|compliance|review/i.test(s)) return 'legal';
  if (/数据|data|复盘|analy/i.test(s)) return 'data-center';
  if (/回复|评论|私信|reply/i.test(s)) return 'user-ops';
  if (/视频|脚本|口播|video|script/i.test(s)) return 'bu-video';
  if (/图文|笔记|长文|文案|article|copy/i.test(s)) return 'bu-article';
  if (/选题|热点|趋势|topic|trend/i.test(s)) return 'staff';
  return 'pending';
}
export function assignAgents(o: Org, agents: { id: string; duty?: string; description?: string }[]): Org {
  let out = o;
  for (const a of agents) { const to = deptForAgent(a); if (out.depts.some((x) => x.id === to)) out = applyOrgChange(out, { op: 'move', agentId: a.id, to }); else out = applyOrgChange(out, { op: 'move', agentId: a.id, to: 'pending' }); }
  return out;
}
export function deptOfAgent(o: Org, agentId: string): Dept | undefined { return o.depts.find((x) => x.members.includes(agentId) || x.head === agentId); }
export function orgSummary(o: Org): { hq: number; bu: number; shared: number; committees: number; members: number } {
  return { hq: o.depts.filter((x) => x.kind === 'hq').length, bu: o.depts.filter((x) => x.kind === 'bu').length, shared: o.depts.filter((x) => x.kind === 'shared').length, committees: topCommittees(o).length, members: memberCount(o) };
}
