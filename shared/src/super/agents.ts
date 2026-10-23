/**
 * 1.2.0 子 Agent 体系（PROMPT-v1.2 第五部分）：定义（agents/<id>/AGENT.md）、8 个内置模板、校验、导入导出（.agent.zip）、
 * 运行与协作（层级深度 ≤3、并发上限、交接契约 Schema、退回一次、级联取消）、任务板、独立成长记录、改动分级。
 * 子 Agent 是“工具分工”，不是多账号：没有任何登录态、不代表任何平台账号。
 */
import { parseDoc, serializeDoc } from '../vfs/frontmatter.js';
import { zip, unzip } from '../vfs/archive.js';
import { utf8 } from '../core/hash.js';
import { findSecrets } from '../core/redact.js';
import { validate, charLen, type JsonSchema } from '../schema.js';
import { RELAX_PATTERNS, detectBoundary } from '../agent/policy.js';
import { FORBIDDEN_TOOL, SAFE_SUFFIX } from '../agent/tools.js';
import { RunRegistry, checkAgentBudget, excessPermissions, narrow, SUPER_ID, DEFAULT_AGENT_BUDGET, type PermLevel, type AgentBudget } from './governance.js';

export interface SubAgentDef {
  id: string; name: string; description: string; icon: string; version: number;
  permissions: PermLevel[]; tools: string[]; skills: string[]; model?: string;
  budget: AgentBudget; memory: 'shared' | 'private'; schedule?: string; platforms: string[]; dataSources: string[];
  createdBy: 'user' | 'super'; enabled: boolean; template?: string; body: string;
}
export const AGENT_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const agentPath = (id: string): string => `agents/${id}/AGENT.md`;
export const isAgentPath = (p: string): boolean => /^agents\/[a-z][a-z0-9-]{1,39}\/AGENT\.md$/.test(p);
/** 超级 Agent 自己的权限（子 Agent 的上限来源）：L0–L3；L3 每次都要用户确认。 */
export const SUPER_PERMISSIONS: PermLevel[] = ['L0', 'L1', 'L2', 'L3'];
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v ? v.split(/[,，\s]+/).filter(Boolean) : []);

export function parseAgentMd(text: string): SubAgentDef {
  const { fm, body } = parseDoc(text);
  const b = (fm.budget && typeof fm.budget === 'object' ? fm.budget : {}) as Record<string, unknown>;
  return {
    id: String(fm.id ?? ''), name: String(fm.name ?? ''), description: String(fm.description ?? ''), icon: String(fm.icon ?? 'bot'), version: Number(fm.version ?? 1) || 1,
    permissions: arr(fm.permissions) as PermLevel[], tools: arr(fm.tools), skills: arr(fm.skills), model: fm.model ? String(fm.model) : undefined,
    budget: { monthYuan: Number(b.month ?? DEFAULT_AGENT_BUDGET.monthYuan), perRunYuan: Number(b.perRun ?? DEFAULT_AGENT_BUDGET.perRunYuan) },
    memory: fm.memory === 'private' ? 'private' : 'shared', schedule: fm.schedule ? String(fm.schedule) : undefined,
    platforms: arr(fm.platforms), dataSources: arr(fm.dataSources), createdBy: fm.createdBy === 'super' ? 'super' : 'user', enabled: fm.enabled !== false,
    template: fm.template ? String(fm.template) : undefined, body: body.trim(),
  };
}
export function serializeAgentMd(d: SubAgentDef): string {
  const fm: Record<string, unknown> = {
    id: d.id, name: d.name, description: d.description.replace(/\n/g, ' '), icon: d.icon, version: d.version,
    permissions: d.permissions, tools: d.tools, skills: d.skills, ...(d.model ? { model: d.model } : {}),
    budget: { month: d.budget.monthYuan, perRun: d.budget.perRunYuan }, memory: d.memory, ...(d.schedule ? { schedule: d.schedule } : {}),
    platforms: d.platforms, dataSources: d.dataSources, createdBy: d.createdBy, enabled: d.enabled, ...(d.template ? { template: d.template } : {}),
  };
  return serializeDoc(fm, `${d.body.trim()}\n`);
}

/** 校验：id、description ≤500、权限 L0–L2 且为父级子集、工具白名单不含对外写入、正文不放宽边界、无密钥。 */
export function validateAgent(d: SubAgentDef, o: { parent?: PermLevel[]; knownTools?: string[] } = {}): string[] {
  const e: string[] = [];
  if (!AGENT_ID.test(d.id)) e.push(`id 需小写字母开头、小写连字符，2–40 位：${d.id}`);
  if (d.id === SUPER_ID) e.push('id 不能是 super（超级 Agent 保留）');
  if (!d.name.trim()) e.push('缺少名称');
  if (!d.description.trim()) e.push('缺少说明（做什么、何时用）');
  if (charLen(d.description) > 500) e.push(`说明超过 500 字（${charLen(d.description)}）`);
  const bad = excessPermissions(d.permissions, o.parent ?? SUPER_PERMISSIONS);
  if (bad.length) e.push(`权限越界：${bad.join('、')}（子 Agent 只能有 L0–L2，且是父级的子集）`);
  if (d.permissions.some((p) => !['L0', 'L1', 'L2', 'L3', 'forbidden'].includes(p))) e.push('未知的权限级别');
  for (const t of d.tools) {
    if (FORBIDDEN_TOOL.test(t) && !SAFE_SUFFIX.test(t)) e.push(`硬边界：工具 ${t} 属于对外写入，不能挂给任何 Agent`);
    else if (o.knownTools && !o.knownTools.includes(t)) e.push(`未知工具：${t}`);
  }
  const text = `${d.description}\n${d.body}`;
  if (RELAX_PATTERNS.test(text)) e.push('正文试图放宽硬边界，已拒绝');
  if (detectBoundary(d.body.replace(/(不|禁止|不得|不能|不做|绝不|只生成草稿)[^。\n]{0,30}/g, ''))) e.push('正文包含硬边界禁止的做法');
  if (findSecrets(serializeAgentMd(d)).length) e.push('发现疑似密钥');
  if (!(d.budget.monthYuan >= 0) || !(d.budget.perRunYuan >= 0)) e.push('额度必须是非负数');
  return e;
}

/* ---------------- 8 个内置模板 ---------------- */
const T = (id: string, name: string, icon: string, description: string, permissions: PermLevel[], tools: string[], skills: string[], body: string, extra: Partial<SubAgentDef> = {}): SubAgentDef => ({
  id, name, icon, description, version: 1, permissions, tools, skills, budget: { ...DEFAULT_AGENT_BUDGET }, memory: 'shared', platforms: [], dataSources: [], createdBy: 'user', enabled: true, template: id, body, ...extra,
});
const BASE = '以符号—结构底座工作：先读懂这次交接要的是什么（符号），再找出影响结果的关系（结构），结论带证据与反例；做不到就说做不到并给合法替代。';
export const AGENT_TEMPLATES: SubAgentDef[] = [
  T('topic-researcher', '选题研究员', 'hot', '汇总合法来源（官方榜单、RSS、守 robots 的公开页）的热点，按账号画像出 3–5 个选题，每个附收益假设与来源链接。需要找选题、做晨报时用。', ['L0', 'L1'], ['hot_fetch', 'memory_search', 'draft_list'], [], `# 选题研究员\n${BASE}\n\n## 职责\n- 只用合法来源；每条热点写来源与时间。\n- 按账号画像（user/profile.md）筛选，给出做或不做的理由。\n\n## 输出\n- summary：今天最值得做的 1 个选题与理由（≤300 字）。\n- artifacts：选题列表（标题、角度、收益假设、来源）。`),
  T('platform-adapter', '平台适配编辑', 'platforms', '把一篇母稿改写成多个平台的版本：按各平台写法技能与规格（字数、标签、封面要求）适配，母稿不改。需要一稿多发时用。', ['L0', 'L1', 'L2'], ['draft_read', 'draft_adapt', 'skill_read', 'publish_check'], [], `# 平台适配编辑\n${BASE}\n\n## 职责\n- 写法只读平台技能；规格只读平台清单。\n- 每个平台一篇适配稿，parent_id 指向母稿；母稿保持原样。\n\n## 输出\n- summary：适配了哪些平台、各自改了什么。\n- artifacts：适配稿 id 列表。`),
  T('visual-voice', '视觉与配音制作', 'image', '为草稿写配图提示、生成封面与配图、配音和字幕；AIGC 显式标识默认开启。需要出图、配音时用。', ['L0', 'L1', 'L2'], ['image_prompt', 'image_gen', 'tts', 'subtitle_make'], [], `# 视觉与配音制作\n${BASE}\n\n## 职责\n- 先给提示词与预计花费，再生成；视频与单价未知的媒体每次确认。\n- 生成的图片与音频保留 AI 生成标识。\n\n## 输出\n- artifacts：素材 id；cost：实际花费。`),
  T('compliance-reviewer', '合规审核员', 'shield', '检查草稿是否触碰硬边界、平台规则、敏感词、极限词，是否需要 AIGC 标识；只出审核意见，不改稿。发布前用。', ['L0'], ['draft_read', 'publish_check', 'compliance_check'], [], `# 合规审核员\n${BASE}\n\n## 职责\n- 只读，不改稿；逐条列出问题、依据（规则原文或来源）与修改建议。\n- 无问题时明确写“未发现问题”，不凑数。\n\n## 输出\n- summary：通过 / 需修改（≤300 字）。\n- evidence：每条问题的依据。`),
  T('data-analyst', '数据复盘分析师', 'analytics', '读用户录入或导入的数据，做复盘：先列观察到的模式，再提结构假设，标明证据强度；样本少直说。周复盘、看数据时用。', ['L0', 'L1'], ['metrics_read', 'metrics_import', 'memory_search'], [], `# 数据复盘分析师\n${BASE}\n\n## 职责\n- 只用录入或导入的数据，没有数据就写“待录入”。\n- 相关不说成因果；主动找反例。\n\n## 输出\n- summary：本期最重要的一个发现。\n- evidence：数据点与样本量。`),
  T('revenue-analyst', '收益分析师', 'coin', '按漏斗（曝光 / 互动 / 关注 / 转化 / 收入）做收益归因，每个结论附反证与验证办法；只用真实收入记录。看收益、定下周打法时用。', ['L0', 'L1'], ['revenue_read', 'metrics_read'], [], `# 收益分析师\n${BASE}\n\n## 职责\n- 结论带反证：还有什么解释也能说明这个结果？\n- 不承诺收入，不编造数字。\n\n## 输出\n- summary：漏斗哪一层最值得改，怎么验证。`),
  T('reply-drafter', '评论回复草稿员', 'chat', '根据用户粘贴进来的评论，起草回复草稿；只生成草稿，由用户自己去平台发，绝不代发。需要回评论时用。', ['L0', 'L1'], ['reply_draft', 'memory_search'], [], `# 评论回复草稿员\n${BASE}\n\n## 职责\n- 只生成草稿，由大哥本人复制去平台发；不读取平台私信与评论列表，只处理粘贴进来的内容。\n\n## 输出\n- artifacts：每条评论 1–2 个回复草稿。`),
  T('asset-librarian', '素材管理员', 'inbox', '整理素材箱：打标签、去重、找出可复用的图片与段落，提醒过期素材。整理素材、找旧素材时用。', ['L0', 'L1'], ['inbox_list', 'asset_tag', 'memory_search'], [], `# 素材管理员\n${BASE}\n\n## 职责\n- 只整理本机素材；删除一律交给大哥确认。\n\n## 输出\n- summary：整理了多少、发现哪些可复用。`),
];
export function fromTemplate(templateId: string, patch: Partial<SubAgentDef> = {}): SubAgentDef {
  const t = AGENT_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`没有这个模板：${templateId}`);
  return { ...structuredClone(t), ...patch, template: templateId };
}
/** 一句话起草（本机规则版，模型可用时由超级 Agent 改写正文）：按关键词挑最接近的模板，权限取模板与 L0–L2 的交集，createdBy=super，进审批。 */
export function draftAgentFromSentence(sentence: string, existing: string[] = []): SubAgentDef {
  const s = sentence.trim();
  const pick = [['热点|选题|晨报', 'topic-researcher'], ['适配|一稿多发|多平台', 'platform-adapter'], ['配图|封面|配音|字幕|生图', 'visual-voice'], ['合规|审核|敏感词', 'compliance-reviewer'], ['复盘|数据', 'data-analyst'], ['收益|收入|变现', 'revenue-analyst'], ['评论|回复', 'reply-drafter'], ['素材|整理', 'asset-librarian']].find(([re]) => new RegExp(re!).test(s))?.[1] ?? 'topic-researcher';
  const base = fromTemplate(pick);
  let id = `${pick}-2`; let n = 2; while (existing.includes(id)) id = `${pick}-${++n}`;
  const name = (/(?:叫|名为|命名为)[“"「]?([^”"」，,。]{2,12})/.exec(s)?.[1] ?? `${base.name}（${n}）`).trim();
  return { ...base, id, name, description: `${s.slice(0, 200)}（由超级 Agent 按“${base.name}”模板起草）`, createdBy: 'super', permissions: narrow(base.permissions, ['L0', 'L1', 'L2']), body: `${base.body}\n\n## 这次的专项\n${s}` };
}

/* ---------------- 导入导出 .agent.zip ---------------- */
export function exportAgentZip(d: SubAgentDef, skills: { path: string; content: string }[] = []): Uint8Array {
  const files = [{ path: 'AGENT.md', content: serializeAgentMd(d) }, ...skills.map((s) => ({ path: `skills/${s.path.replace(/^skills\//, '')}`, content: s.content }))];
  for (const f of files) if (findSecrets(f.content).length) throw new Error(`导出已阻止：${f.path} 有疑似密钥`);
  const manifest = { kind: 'agent', schemaVersion: 1, id: d.id, version: d.version, exportedBy: 'content-agent' };
  return zip([{ path: 'manifest.json', data: utf8(JSON.stringify(manifest)) }, ...files.map((f) => ({ path: f.path, data: utf8(f.content) }))]);
}
export interface AgentImport { ok: boolean; def?: SubAgentDef; skills: { path: string; content: string }[]; errors: string[]; narrowed: PermLevel[] }
/** 导入前校验：清单完整、硬边界、Key 扫描（任一文件命中即拒绝）、权限上限（超出父级的部分去掉并告知）。导入后仍需用户确认（新建子 Agent 属 L3）。 */
export function importAgentZip(data: Uint8Array, o: { parent?: PermLevel[]; knownTools?: string[]; existing?: string[] } = {}): AgentImport {
  const errors: string[] = [];
  let entries;
  try { entries = unzip(data); } catch (e) { return { ok: false, skills: [], errors: [`不是有效的 zip：${(e as Error).message}`], narrowed: [] }; }
  const dec = new TextDecoder();
  const files = new Map(entries.map((e) => [e.path, dec.decode(e.data)]));
  for (const [p, c] of files) if (findSecrets(c).length) errors.push(`${p} 有疑似密钥，整个包拒绝导入`);
  const md = files.get('AGENT.md');
  if (!md) return { ok: false, skills: [], errors: [...errors, '缺少 AGENT.md'], narrowed: [] };
  const def = parseAgentMd(md);
  const parent = o.parent ?? SUPER_PERMISSIONS;
  const narrowedOut = excessPermissions(def.permissions, parent);
  def.permissions = narrow(def.permissions, parent);
  def.createdBy = 'user';
  if (o.existing?.includes(def.id)) errors.push(`已有同名子 Agent：${def.id}`);
  errors.push(...validateAgent(def, { parent, knownTools: o.knownTools }));
  const skills = [...files].filter(([p]) => p.startsWith('skills/')).map(([path, content]) => ({ path, content }));
  return { ok: errors.length === 0, def, skills, errors, narrowed: narrowedOut };
}

/* ---------------- 交接契约 ---------------- */
export interface HandoffInput { goal: string; context_refs: string[]; constraints: string[]; budget: number; deadline: string | null; output_schema: JsonSchema }
export interface HandoffOutput { summary: string; artifacts: string[]; cost: number; evidence: string[]; open_questions: string[]; failures: string[] }
export const HANDOFF_INPUT_SCHEMA: JsonSchema = { type: 'object', required: ['goal', 'context_refs', 'constraints', 'budget', 'output_schema'], properties: { goal: { type: 'string', minLength: 1 }, context_refs: { type: 'array', items: { type: 'string' } }, constraints: { type: 'array', items: { type: 'string' } }, budget: { type: 'number' }, deadline: { type: ['string', 'null'] }, output_schema: { type: 'object' } } };
export const HANDOFF_OUTPUT_SCHEMA: JsonSchema = { type: 'object', required: ['summary', 'artifacts', 'cost', 'evidence', 'open_questions', 'failures'], properties: { summary: { type: 'string', maxLength: 300 }, artifacts: { type: 'array', items: { type: 'string' } }, cost: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } }, open_questions: { type: 'array', items: { type: 'string' } }, failures: { type: 'array', items: { type: 'string' } } } };
export function checkHandoff(kind: 'input' | 'output', v: unknown): string[] {
  const errs = validate(kind === 'input' ? HANDOFF_INPUT_SCHEMA : HANDOFF_OUTPUT_SCHEMA, v).map((e) => e.message);
  if (kind === 'output' && v && typeof v === 'object' && (v as HandoffOutput).summary === '') errs.push('summary 不能为空');
  return [...new Set(errs)];
}
/** 子 Agent 的返回常是模型文本：取第一个 JSON 对象并补齐缺省数组（不补 summary）。 */
export function coerceHandoffOutput(raw: unknown): HandoffOutput | null {
  let v = raw;
  if (typeof raw === 'string') { const m = /\{[\s\S]*\}/.exec(raw.replace(/^```(?:json)?|```$/g, '')); if (!m) return null; try { v = JSON.parse(m[0]); } catch { return null; } }
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<HandoffOutput>;
  const a = (x: unknown) => (Array.isArray(x) ? x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y))) : []);
  return { summary: typeof o.summary === 'string' ? o.summary : '', artifacts: a(o.artifacts), cost: typeof o.cost === 'number' ? o.cost : 0, evidence: a(o.evidence), open_questions: a(o.open_questions), failures: a(o.failures) };
}

/* ---------------- 任务板 ---------------- */
export type BoardState = 'todo' | 'running' | 'review' | 'awaiting_user' | 'done' | 'failed';
export const BOARD_COLUMNS: BoardState[] = ['todo', 'running', 'review', 'awaiting_user', 'done', 'failed'];
export const BOARD_TEXT: Record<BoardState, string> = { todo: '待办', running: '进行中', review: '待验收', awaiting_user: '待你批准', done: '完成', failed: '失败' };
const NEXT: Record<BoardState, BoardState[]> = { todo: ['running', 'failed'], running: ['review', 'awaiting_user', 'failed'], review: ['running', 'awaiting_user', 'done', 'failed'], awaiting_user: ['running', 'done', 'failed'], done: [], failed: [] };
export interface BoardTask { id: string; title: string; agentId: string; parent?: string; state: BoardState; depth: number; returned: number; cost: number; createdAt: string; updatedAt: string; summary?: string; artifacts?: string[]; failures?: string[]; history: { state: BoardState; at: string; note?: string }[] }
export function canMove(a: BoardState, b: BoardState): boolean { return NEXT[a].includes(b); }
export function moveTask(t: BoardTask, to: BoardState, note?: string, at = new Date().toISOString()): BoardTask {
  if (!canMove(t.state, to)) throw new Error(`任务板状态不能从“${BOARD_TEXT[t.state]}”到“${BOARD_TEXT[to]}”`);
  return { ...t, state: to, updatedAt: at, history: [...t.history, { state: to, at, note }] };
}

/* ---------------- 成长记录 ---------------- */
export interface AgentStats { completed: number; returned: number; failed: number; runs: number; costTotal: number; offered: number; adopted: number; lastActiveAt?: string }
export const emptyStats = (): AgentStats => ({ completed: 0, returned: 0, failed: 0, runs: 0, costTotal: 0, offered: 0, adopted: 0 });
export function statsView(s: AgentStats): { completed: number; returnRate: number | null; avgCost: number | null; adoptionRate: number | null } {
  return { completed: s.completed, returnRate: s.runs ? s.returned / s.runs : null, avgCost: s.runs ? s.costTotal / s.runs : null, adoptionRate: s.offered ? s.adopted / s.offered : null };
}
export const IDLE_DAYS = 30;
/** 长期闲置只提示停用，不自动删除。 */
export function idleHint(s: AgentStats | undefined, createdAt: string, now = Date.now(), days = IDLE_DAYS): string | null {
  const last = Date.parse(s?.lastActiveAt ?? createdAt);
  return Number.isFinite(last) && now - last > days * 864e5 ? `已经 ${Math.floor((now - last) / 864e5)} 天没用了，要不要停用？（不会自动删除）` : null;
}
/** 改动分级：记忆 / 技能 / lesson = 低风险（按 1.0 规则自动采纳）；职责（正文）、权限、工具、额度、模型 = L3，需用户确认。 */
export function agentChangeRisk(before: SubAgentDef, after: SubAgentDef): { risk: 'low' | 'L3'; fields: string[] } {
  const f: string[] = [];
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (before.body.trim() !== after.body.trim()) f.push('职责');
  if (!eq([...before.permissions].sort(), [...after.permissions].sort())) f.push('权限');
  if (!eq([...before.tools].sort(), [...after.tools].sort())) f.push('工具');
  if (!eq(before.budget, after.budget)) f.push('额度');
  if (before.model !== after.model) f.push('模型');
  if (!eq(before.dataSources, after.dataSources)) f.push('数据源授权');
  if (f.length) return { risk: 'L3', fields: f };
  const low: string[] = [];
  if (!eq(before.skills, after.skills)) low.push('技能');
  if (before.name !== after.name || before.description !== after.description || before.icon !== after.icon) low.push('名称与说明');
  if (before.enabled !== after.enabled) low.push('启用');
  return { risk: 'low', fields: low };
}

/* ---------------- @ 点名与团队摘要 ---------------- */
export function parseMention(text: string, agents: Pick<SubAgentDef, 'id' | 'name' | 'enabled'>[]): { agentId: string; name: string; rest: string } | null {
  const m = /^\s*@(\S+)\s+([\s\S]+)$/.exec(text);
  if (!m) return null;
  const key = m[1]!;
  const a = agents.filter((x) => x.enabled).sort((x, y) => y.name.length - x.name.length).find((x) => x.name === key || x.id === key || text.trim().startsWith(`@${x.name} `));
  if (!a) return null;
  const rest = text.trim().slice(1 + (text.trim().startsWith(`@${a.name}`) ? a.name.length : key.length)).trim();
  return rest ? { agentId: a.id, name: a.name, rest } : null;
}
export function teamSummary(agents: SubAgentDef[]): string {
  const on = agents.filter((a) => a.enabled);
  if (!on.length) return '';
  return ['可以交给的子 Agent（只给授权句柄，不给副本；权限是我的子集）：', ...on.map((a) => `- ${a.name}（${a.id}，${a.permissions.join('/')}）：${a.description.slice(0, 80)}`)].join('\n');
}

/* ---------------- 编排：深度、并发、预算、交接契约、退回一次、级联取消 ---------------- */
export const HIERARCHY = { user: 0, super: 1, subAgent: 2, subtask: 3, maxDepth: 3 } as const;
export interface DelegateCtx { runId: string; depth: number; signal: AbortSignal; feedback?: string; attempt: number }
export interface OrchestratorOpts {
  registry: RunRegistry; concurrency: number;
  execute(agent: SubAgentDef, input: HandoffInput, ctx: DelegateCtx): Promise<unknown>;
  review?(agent: SubAgentDef, input: HandoffInput, out: HandoffOutput): Promise<{ ok: boolean; feedback?: string }> | { ok: boolean; feedback?: string };
  spentMonth(agentId: string): number;
  estimate?(agent: SubAgentDef, input: HandoffInput): number | null;
  onTask?(t: BoardTask): void;
  onSpend?(agentId: string, yuan: number): void;
  isPaused?(id: string): boolean;
  now?(): string;
}
export type DelegateResult = { ok: true; output: HandoffOutput; task: BoardTask; returned: boolean } | { ok: false; reason: 'depth' | 'paused' | 'budget' | 'schema' | 'input' | 'cancelled' | 'error' | 'rejected' | 'persistent_from_sub'; text: string; task?: BoardTask; approval?: { kind: 'spend'; why: string } };
export class Orchestrator {
  private active = 0;
  private waiters: (() => void)[] = [];
  private seq = 0;
  constructor(private o: OrchestratorOpts) {}
  get running(): number { return this.active; }
  private async slot(signal: AbortSignal): Promise<void> {
    if (this.active < Math.min(5, Math.max(1, this.o.concurrency))) { this.active++; return; }
    await new Promise<void>((res, rej) => { const w = () => { signal.removeEventListener('abort', ab); this.active++; res(); }; const ab = () => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error('cancelled')); }; this.waiters.push(w); signal.addEventListener('abort', ab, { once: true }); });
  }
  private release(): void { this.active--; const w = this.waiters.shift(); if (w) w(); }
  private emit(t: BoardTask): BoardTask { this.o.onTask?.(t); return t; }
  /**
   * 交给一个子 Agent。from 是发起者：'super'（深度 1）→ 子 Agent 运行在深度 2；子 Agent 发起的只能是一次性子任务（深度 3，用 subtask()），不能再交给常驻子 Agent。
   */
  async delegate(agent: SubAgentDef, input: HandoffInput, from: { agentId: string; depth: number; runId?: string; title?: string }): Promise<DelegateResult> {
    const now = () => this.o.now?.() ?? new Date().toISOString();
    if (from.agentId !== SUPER_ID) return { ok: false, reason: 'persistent_from_sub', text: '子 Agent 不能把任务交给常驻子 Agent，只能派一次性子任务' };
    const depth = from.depth + 1;
    if (depth > HIERARCHY.maxDepth) return { ok: false, reason: 'depth', text: `超过最大深度 ${HIERARCHY.maxDepth}` };
    const inErr = checkHandoff('input', input);
    if (inErr.length) return { ok: false, reason: 'input', text: `交接输入不合格：${inErr.join('；')}` };
    if (this.o.registry.paused || !agent.enabled || this.o.isPaused?.(agent.id)) return { ok: false, reason: 'paused', text: this.o.registry.paused ? '已全部暂停' : `${agent.name} 已暂停` };
    const est = this.o.estimate?.(agent, input) ?? null;
    const bv = checkAgentBudget(agent.id, agent.budget, this.o.spentMonth(agent.id), est === null ? null : Math.min(est, input.budget || est));
    let task: BoardTask = this.emit({ id: `t-${Date.now().toString(36)}-${++this.seq}`, title: from.title ?? input.goal.slice(0, 60), agentId: agent.id, parent: from.runId, state: 'todo', depth, returned: 0, cost: 0, createdAt: now(), updatedAt: now(), history: [{ state: 'todo', at: now() }] });
    if (!bv.ok) { task = this.emit(moveTask(task, 'failed', bv.text, now())); return { ok: false, reason: 'budget', text: bv.text, task, approval: { kind: 'spend', why: bv.text } }; }
    const run = this.o.registry.register({ runId: `${task.id}`, agentId: agent.id, parent: from.runId, kind: 'run' });
    try {
      await this.slot(run.ctl.signal);
    } catch { task = this.emit(moveTask(task, 'failed', '已取消', now())); return { ok: false, reason: 'cancelled', text: '已取消', task }; }
    let returned = false; let feedback: string | undefined;
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        task = this.emit(moveTask(task, 'running', attempt > 1 ? `退回重做：${feedback ?? ''}` : undefined, now()));
        if (run.ctl.signal.aborted) throw new Error('cancelled');
        const raw = await this.o.execute(agent, input, { runId: run.runId, depth, signal: run.ctl.signal, feedback, attempt });
        if (run.ctl.signal.aborted) throw new Error('cancelled');
        const out = coerceHandoffOutput(raw);
        const errs = out ? checkHandoff('output', out) : ['返回不是交接契约 JSON'];
        if (out) { task = { ...task, cost: task.cost + (out.cost || 0) }; if (out.cost) this.o.onSpend?.(agent.id, out.cost); }
        task = this.emit(moveTask(task, 'review', undefined, now()));
        if (errs.length || !out) {
          if (attempt === 1) { feedback = `返回格式不合格：${errs.join('；')}。请严格按交接契约 JSON 返回。`; returned = true; task = { ...task, returned: task.returned + 1 }; continue; }
          task = this.emit(moveTask(task, 'failed', errs.join('；'), now()));
          return { ok: false, reason: 'schema', text: `退回一次后仍不合格：${errs.join('；')}`, task };
        }
        const rv = (await this.o.review?.(agent, input, out)) ?? { ok: true };
        if (!rv.ok) {
          if (attempt === 1) { feedback = rv.feedback ?? '不合格，请按要求修改'; returned = true; task = { ...task, returned: task.returned + 1 }; continue; }
          task = this.emit(moveTask(task, 'awaiting_user', `退回一次后仍不合格：${rv.feedback ?? ''}`, now()));
          return { ok: false, reason: 'rejected', text: `退回一次后仍不合格，交给你决定：${rv.feedback ?? ''}`, task };
        }
        task = this.emit(moveTask({ ...task, summary: out.summary, artifacts: out.artifacts, failures: out.failures }, 'done', undefined, now()));
        return { ok: true, output: out, task, returned };
      }
      throw new Error('unreachable');
    } catch (e) {
      const cancelled = run.ctl.signal.aborted || (e as Error).message === 'cancelled';
      if (task.state !== 'done' && task.state !== 'failed') task = this.emit(canMove(task.state, 'failed') ? moveTask(task, 'failed', cancelled ? '已取消' : (e as Error).message, now()) : task);
      return { ok: false, reason: cancelled ? 'cancelled' : 'error', text: cancelled ? '已取消' : (e as Error).message, task };
    } finally { this.o.registry.done(run.runId); this.release(); }
  }
  /** 子 Agent 内部的一次性子任务：深度 +1，超过 3 拒绝；跟随父运行级联取消。 */
  async subtask<T>(parent: { agentId: string; depth: number; runId: string }, fn: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: 'depth' | 'cancelled' | 'error'; text: string }> {
    const depth = parent.depth + 1;
    if (depth > HIERARCHY.maxDepth) return { ok: false, reason: 'depth', text: `一次性子任务不能再派子任务（最大深度 ${HIERARCHY.maxDepth}）` };
    const r = this.o.registry.register({ runId: `${parent.runId}.s${++this.seq}`, agentId: parent.agentId, parent: parent.runId, kind: 'run' });
    try { const v = await fn(r.ctl.signal); return r.ctl.signal.aborted ? { ok: false, reason: 'cancelled', text: '已取消' } : { ok: true, value: v }; }
    catch (e) { return { ok: false, reason: r.ctl.signal.aborted ? 'cancelled' : 'error', text: (e as Error).message }; }
    finally { this.o.registry.done(r.runId); }
  }
}
export function updateStats(s: AgentStats | undefined, r: DelegateResult, at = new Date().toISOString()): AgentStats {
  const n = { ...(s ?? emptyStats()), runs: (s?.runs ?? 0) + 1, lastActiveAt: at };
  if (r.ok) { n.completed++; n.offered++; if (r.returned) n.returned++; n.costTotal += r.task.cost; }
  else { n.failed++; if (r.task) { n.costTotal += r.task.cost; if (r.task.returned) n.returned++; } }
  return n;
}
