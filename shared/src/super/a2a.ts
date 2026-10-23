/**
 * 1.2.0 Agent 互通：A2A（beta，默认关闭；PROMPT-v1.2 第十部分；规范要点见 docs/refs-v1.2/README.md 第 5–7 条）。
 * - 客户端（开关 a2a.client）：读取外部 Agent 的 Agent Card（/.well-known/agent-card.json），作为“外部子 Agent”被超级 Agent 调用，
 *   受同样的权限（外部调用 = L2）、预算、审批、审计约束；添加 / 启用属 L3。JSON-RPC 方法用 v1.0 的 SendMessage。
 * - 服务端（开关 a2a.server）：只在“连接自己的服务器”模式下可开，发布本机超级 Agent 的 Agent Card，只暴露用户勾选的技能，必须鉴权；
 *   手机本机模式不开放端口。收到的请求一律进审批收件箱，不自动执行。Agent Card 不含任何 Key。
 */
import { findSecrets, redact } from '../core/redact.js';
import { flagOn, type FlagOverrides } from '../core/flags.js';
import { authorize, checkAgentBudget, type AgentBudget, type Grant } from './governance.js';

export const A2A_VERSION = '1.0';
export const AGENT_CARD_PATH = '/.well-known/agent-card.json';
export interface AgentSkill { id: string; name: string; description: string; tags: string[]; examples?: string[] }
export interface AgentInterface { url: string; protocolBinding: 'JSONRPC' | 'GRPC' | 'HTTP+JSON'; protocolVersion: string }
export interface AgentCard {
  name: string; description: string; version: string; supportedInterfaces: AgentInterface[];
  capabilities: { streaming?: boolean; pushNotifications?: boolean; extendedAgentCard?: boolean };
  skills: AgentSkill[]; defaultInputModes?: string[]; defaultOutputModes?: string[];
  securitySchemes?: Record<string, Record<string, unknown>>; securityRequirements?: Record<string, string[]>[]; provider?: { organization: string; url?: string };
}
export function validateAgentCard(c: unknown): string[] {
  const e: string[] = [];
  if (!c || typeof c !== 'object') return ['Agent Card 不是 JSON 对象'];
  const x = c as Partial<AgentCard>;
  for (const k of ['name', 'description', 'version'] as const) if (typeof x[k] !== 'string' || !x[k]) e.push(`缺少 ${k}`);
  if (!Array.isArray(x.supportedInterfaces) || !x.supportedInterfaces.length) e.push('缺少 supportedInterfaces（v1.0 必填）');
  else for (const i of x.supportedInterfaces) { if (!/^https:\/\//.test(i.url ?? '') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(i.url ?? '')) e.push(`接口地址需为 https：${i.url}`); }
  if (!x.capabilities || typeof x.capabilities !== 'object') e.push('缺少 capabilities');
  if (!Array.isArray(x.skills)) e.push('缺少 skills');
  if (findSecrets(JSON.stringify(c)).length) e.push('Agent Card 里出现疑似密钥，拒绝');
  return e;
}
export interface A2AAgentRef { id: string; name: string; cardUrl: string; card: AgentCard; secretRef?: string; enabled: boolean; approved: boolean; budget: AgentBudget; addedAt: string }
type FetchGet = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
export async function fetchAgentCard(base: string, fetchFn: FetchGet): Promise<{ ok: true; card: AgentCard; url: string } | { ok: false; errors: string[] }> {
  let u: URL; try { u = new URL(base); } catch { return { ok: false, errors: ['地址不对'] }; }
  const url = u.pathname.endsWith('.json') ? u.href : `${u.origin}${AGENT_CARD_PATH}`;
  const r = await fetchFn(url, { method: 'GET', headers: { accept: 'application/json' } });
  if (r.status !== 200) return { ok: false, errors: [`读取 Agent Card 失败：HTTP ${r.status}`] };
  let card: unknown; try { card = JSON.parse(await r.text()); } catch { return { ok: false, errors: ['Agent Card 不是 JSON'] }; }
  const errs = validateAgentCard(card);
  return errs.length ? { ok: false, errors: errs } : { ok: true, card: card as AgentCard, url };
}
/** 添加外部 Agent：默认未启用、未批准（L3），默认额度与子 Agent 一样 ¥3/月。 */
export function newA2ARef(id: string, cardUrl: string, card: AgentCard, o: { secretRef?: string; now?: string } = {}): A2AAgentRef {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw new Error(`id 不合法：${id}`);
  if (o.secretRef && !/^secret:[\w.-]+$/.test(o.secretRef)) throw new Error('凭据只能用 secret:<id> 引用');
  return { id, name: card.name, cardUrl, card, secretRef: o.secretRef, enabled: false, approved: false, budget: { monthYuan: 3, perRunYuan: 1 }, addedAt: o.now ?? new Date().toISOString() };
}
/** 调用外部 Agent 前的治理：开关 a2a.client 打开 + 已批准已启用 + 调用者有 L2 + 预算。 */
export function guardA2A(ref: A2AAgentRef, flags: FlagOverrides, grant: Grant, spentMonth: number, est: number | null, o: { paused?: boolean } = {}): { allow: boolean; reason: string; needsApproval: boolean } {
  if (!flagOn('a2a.client', flags)) return { allow: false, reason: 'A2A 客户端是实验功能，默认关闭（设置 → 实验功能）', needsApproval: false };
  if (o.paused) return { allow: false, reason: '已全部暂停', needsApproval: false };
  if (!ref.approved || !ref.enabled) return { allow: false, reason: '这个外部 Agent 还没经你批准或已停用', needsApproval: !ref.approved };
  const a = authorize({ ...grant, tools: '*' }, { name: `a2a.${ref.id}`, level: 'L2' });
  if (!a.allow) return { allow: false, reason: a.reason, needsApproval: a.needsApproval };
  const b = checkAgentBudget(`a2a:${ref.id}`, ref.budget, spentMonth, est);
  if (!b.ok) return { allow: false, reason: b.text, needsApproval: true };
  return { allow: true, reason: '已授权', needsApproval: false };
}
/** v1.0 SendMessage（JSON-RPC）。返回外部 Agent 的文本（Message 或 Task 的产出），全部打码。 */
export async function sendA2AMessage(ref: A2AAgentRef, text: string, fetchFn: FetchGet, getAuth: () => Promise<string | null>, signal?: AbortSignal): Promise<{ ok: true; text: string; taskState?: string } | { ok: false; error: string }> {
  const iface = ref.card.supportedInterfaces.find((i) => i.protocolBinding === 'JSONRPC');
  if (!iface) return { ok: false, error: '这个外部 Agent 没有 JSON-RPC 接口' };
  const auth = await getAuth();
  const body = { jsonrpc: '2.0', id: Date.now(), method: 'SendMessage', params: { message: { messageId: `m-${Date.now().toString(36)}`, role: 'ROLE_USER', parts: [{ text }] } } };
  const r = await fetchFn(iface.url, { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': A2A_VERSION, ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body), signal });
  const raw = await r.text();
  if (r.status === 401 || r.status === 403) return { ok: false, error: '外部 Agent 鉴权失败' };
  let j: { result?: { message?: { parts?: { text?: string }[] }; task?: { status?: { state?: string; message?: { parts?: { text?: string }[] } }; artifacts?: { parts?: { text?: string }[] }[] } }; error?: { message?: string } };
  try { j = JSON.parse(raw); } catch { return { ok: false, error: `返回不是 JSON：${redact(raw.slice(0, 80))}` }; }
  if (j.error) return { ok: false, error: redact(String(j.error.message ?? '外部 Agent 报错')) };
  const parts = j.result?.message?.parts ?? [...(j.result?.task?.artifacts ?? []).flatMap((a) => a.parts ?? []), ...(j.result?.task?.status?.message?.parts ?? [])];
  return { ok: true, text: redact(parts.map((p) => p.text ?? '').join('\n').trim()), taskState: j.result?.task?.status?.state };
}

/* ---------------- 服务端 ---------------- */
/** 只在“连接自己的服务器”模式 + 开关 a2a.server 打开 + 配了鉴权口令时才允许；手机本机模式永远不开放。 */
export function a2aServerAllowed(o: { mode: 'local' | 'server'; flags: FlagOverrides; hasToken: boolean }): { ok: boolean; why: string } {
  if (o.mode !== 'server') return { ok: false, why: '手机本机模式不开放端口；只有连接自己的服务器时可以开启' };
  if (!flagOn('a2a.server', o.flags)) return { ok: false, why: 'A2A 服务端是实验功能，默认关闭' };
  if (!o.hasToken) return { ok: false, why: '必须先设置访问口令（鉴权）' };
  return { ok: true, why: '已开启' };
}
/** 发布本机超级 Agent 的 Agent Card：只暴露勾选的技能；声明 Bearer 鉴权；不含任何 Key。 */
export function buildAgentCard(o: { baseUrl: string; version: string; skills: AgentSkill[]; selected: string[] }): AgentCard {
  const card: AgentCard = {
    name: '超级工作台 · 超级 Agent', description: '内容运营超级 Agent：选题、写稿、一稿多发适配、合规审核、复盘。只生成草稿；发布与互动由用户本人在官方 App 内完成。收到的请求先进用户的审批收件箱。',
    version: o.version, supportedInterfaces: [{ url: `${o.baseUrl.replace(/\/+$/, '')}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: A2A_VERSION }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    skills: o.skills.filter((s) => o.selected.includes(s.id)), defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } }, securityRequirements: [{ bearer: [] }],
  };
  if (findSecrets(JSON.stringify(card)).length) throw new Error('Agent Card 里出现疑似密钥，拒绝发布');
  return card;
}
export const A2A_SKILLS: AgentSkill[] = [
  { id: 'draft', name: '写草稿', description: '按给定主题写一篇草稿（只返回草稿文本，不发布）', tags: ['writing'] },
  { id: 'adapt', name: '一稿多发适配', description: '把一段文字改写成指定平台的版本', tags: ['writing', 'platform'] },
  { id: 'review', name: '合规审核', description: '检查硬边界、平台规则、极限词，只出意见', tags: ['compliance'] },
  { id: 'topics', name: '选题建议', description: '根据给定方向给出 3–5 个选题与理由', tags: ['research'] },
];
