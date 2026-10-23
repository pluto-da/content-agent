/**
 * 1.2.0 外部工具：MCP 客户端（PROMPT-v1.2 第九部分；来源与核对日期见 docs/refs-v1.2/README.md）。
 * - 传输：Streamable HTTP（单一 POST 端点；响应为单个 JSON 或请求级 SSE）。
 * - 2026-07-28：无状态核心——不握手、无会话；每个请求在 params._meta 带 io.modelcontextprotocol/protocolVersion，并带 MCP-Protocol-Version、Mcp-Method、Mcp-Name 头；
 *   先调 server/discover 选版本；MRTR：服务端返回 resultType: "input_required" + inputRequests，客户端带 inputResponses 重试原请求。
 * - 兼容 2025-11-25：discover 不被支持时回退 initialize → notifications/initialized，之后带 Mcp-Session-Id。
 * - 治理：添加时列出全部工具，逐个勾选启用并指定级别（默认 L2；写入外部系统的默认关闭）；社交互动类（点赞、评论、私信、关注、发帖、批量操作账号）
 *   注册时拒绝，调用时二次检查；无法判定的标“需逐次确认”。凭据只存 secretRef，调用时由 getAuth() 现取，不进日志与备份。
 */
import { findSecrets, redact } from '../core/redact.js';
import { SOCIAL_ACTION, SOCIAL_ACTION_ZH, SOCIAL_CONTEXT, authorize, type Grant, type PermLevel } from './governance.js';

export const MCP_LATEST = '2026-07-28';
export const MCP_LEGACY = '2025-11-25';
export const MCP_VERSIONS = [MCP_LATEST, MCP_LEGACY] as const;
export type McpVersion = typeof MCP_VERSIONS[number];
export interface McpToolInfo { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean } }
export type McpVerdict = 'ok' | 'confirm_each' | 'rejected';
export interface McpToolConfig { name: string; description: string; enabled: boolean; level: PermLevel; writesExternal: boolean; verdict: McpVerdict; reason: string; grants: string[] }
export interface McpServerConfig { id: string; name: string; url: string; protocol?: McpVersion; secretRef?: string; enabled: boolean; approved: boolean; tools: McpToolConfig[]; addedAt: string }

/* ---------------- 工具分级 ---------------- */
const READ_NAME = /(^|[_\-.])(get|list|search|read|fetch|query|find|lookup|describe|view|show|stat|stats|count|summar(y|ize)|analy[sz]e|translate|convert|check)([_\-.]|$)/i;
const WRITE_NAME = /(^|[_\-.])(create|update|delete|remove|write|send|upload|insert|set|put|patch|append|edit|modify|move|rename|submit|schedule|invite)([_\-.]|$)/i;
const SOCIAL_DESC = /\b(like|upvote|comment on|reply to|direct message|send (a )?message|follow|unfollow|repost|retweet|publish|post to|tweet|bulk|mass[- ]?(follow|like|dm))\b/i;
/** 注册时判定：社交互动类 → 拒绝；写入外部系统 → 默认关闭；无法判定 → 需逐次确认。 */
export function classifyMcpTool(t: McpToolInfo): { verdict: McpVerdict; writesExternal: boolean; reason: string } {
  const name = t.name ?? ''; const desc = `${t.title ?? ''} ${t.description ?? ''}`;
  if (SOCIAL_ACTION.test(name) || SOCIAL_ACTION_ZH.test(name) || SOCIAL_ACTION_ZH.test(desc) || (SOCIAL_DESC.test(desc) && (SOCIAL_CONTEXT.test(desc) || SOCIAL_CONTEXT.test(name)))) return { verdict: 'rejected', writesExternal: true, reason: '硬边界：点赞、评论、私信、关注、发帖、批量操作社交账号类工具不能接入' };
  const writes = t.annotations?.readOnlyHint === false || t.annotations?.destructiveHint === true || WRITE_NAME.test(name);
  if (writes) return { verdict: 'confirm_each', writesExternal: true, reason: '会写入外部系统：默认关闭，打开后每次调用都要你确认' };
  if (t.annotations?.readOnlyHint === true || READ_NAME.test(name)) return { verdict: 'ok', writesExternal: false, reason: '只读' };
  return { verdict: 'confirm_each', writesExternal: false, reason: '无法判定是否只读：每次调用都要你确认' };
}
/** 添加服务器：列出全部工具并给出默认配置（默认 L2；被拒的不可启用；写入类默认关闭；服务器本身未经批准前不可用 = L3）。 */
export function buildServerConfig(o: { id: string; name: string; url: string; protocol?: McpVersion; secretRef?: string }, tools: McpToolInfo[], now = new Date().toISOString()): McpServerConfig {
  if (!/^https:\/\//.test(o.url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(o.url)) throw new Error('MCP 服务器地址需为 https（本机调试可用 http://127.0.0.1）');
  if (findSecrets(JSON.stringify(o)).length) throw new Error('配置里不能直接写 Key；凭据请用安全表单保存（只存引用）');
  return { ...o, enabled: false, approved: false, addedAt: now, tools: tools.map((t) => { const c = classifyMcpTool(t); return { name: t.name, description: (t.description ?? '').slice(0, 500), enabled: false, level: 'L2', writesExternal: c.writesExternal, verdict: c.verdict, reason: c.reason, grants: [] }; }) };
}
/** 用户逐个勾选：被拒工具不能启用；级别不能是 L3 / 禁止（外部工具最多 L2）。 */
export function setToolEnabled(s: McpServerConfig, tool: string, on: boolean, level: PermLevel = 'L2'): McpServerConfig {
  return { ...s, tools: s.tools.map((t) => { if (t.name !== tool) return t; if (on && t.verdict === 'rejected') throw new Error(`${tool} 被硬边界拒绝，不能启用`); if (level === 'L3' || level === 'forbidden') throw new Error('外部工具最高 L2'); return { ...t, enabled: on, level }; }) };
}
export function grantTool(s: McpServerConfig, tool: string, agentId: string, on: boolean): McpServerConfig {
  return { ...s, tools: s.tools.map((t) => (t.name !== tool ? t : { ...t, grants: on ? [...new Set([...t.grants, agentId])] : t.grants.filter((g) => g !== agentId) })) };
}
export const mcpToolId = (serverId: string, tool: string): string => `mcp.${serverId}.${tool}`;
/** 调用前的治理检查（二次检查硬边界 + 服务器批准 + 工具启用 + 授权 + 逐次确认）。 */
export function guardMcpCall(s: McpServerConfig, tool: string, grant: Grant, args: Record<string, unknown> = {}, o: { paused?: boolean; confirmed?: boolean } = {}): { allow: boolean; needsConfirm: boolean; reason: string } {
  const t = s.tools.find((x) => x.name === tool);
  if (!t) return { allow: false, needsConfirm: false, reason: '服务器没有这个工具' };
  const again = classifyMcpTool({ name: t.name, description: t.description });
  if (again.verdict === 'rejected' || t.verdict === 'rejected') return { allow: false, needsConfirm: false, reason: again.reason };
  if (SOCIAL_ACTION_ZH.test(JSON.stringify(args)) && /(自动|批量|帮我)/.test(JSON.stringify(args))) return { allow: false, needsConfirm: false, reason: '硬边界：参数里是社交互动类操作' };
  if (o.paused || !s.enabled || !s.approved) return { allow: false, needsConfirm: false, reason: o.paused ? '已全部暂停' : '这个外部工具服务器未启用或未经你批准' };
  if (!t.enabled) return { allow: false, needsConfirm: false, reason: '这个工具没有启用' };
  if (grant.agentId !== 'super' && !t.grants.includes(grant.agentId)) return { allow: false, needsConfirm: false, reason: '没有分配给这个子 Agent' };
  const a = authorize({ ...grant, tools: '*' }, { name: mcpToolId(s.id, tool), level: t.level });
  if (!a.allow) return { allow: false, needsConfirm: a.needsApproval, reason: a.reason };
  if ((t.verdict === 'confirm_each' || t.writesExternal) && !o.confirmed) return { allow: false, needsConfirm: true, reason: t.reason };
  return { allow: true, needsConfirm: false, reason: '已授权' };
}

/* ---------------- 客户端 ---------------- */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;
export interface InputRequest { [k: string]: unknown }
export class McpError extends Error { constructor(public code: number, message: string) { super(message); this.name = 'McpError'; } }
interface Rpc { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code: number; message: string } }
function parseBody(text: string, ctype: string | null, id: number): Rpc {
  if ((ctype ?? '').includes('text/event-stream')) {
    const msgs = text.split(/\n\n/).map((b) => b.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')).filter(Boolean).map((d) => { try { return JSON.parse(d) as Rpc; } catch { return null; } }).filter((x): x is Rpc => !!x);
    const hit = msgs.find((m) => m.id === id) ?? msgs.at(-1);
    if (!hit) throw new McpError(-32700, 'SSE 响应里没有结果');
    return hit;
  }
  try { return JSON.parse(text) as Rpc; } catch { throw new McpError(-32700, `响应不是 JSON：${redact(text.slice(0, 80))}`); }
}
export class McpClient {
  version: McpVersion | null = null;
  serverInfo: Record<string, unknown> = {};
  private session: string | null = null;
  private seq = 0;
  constructor(private url: string, private fetchFn: FetchLike, private getAuth: () => Promise<string | null> = async () => null, private clientInfo = { name: 'content-agent', version: '1.2.0' }) {}
  private async post(method: string, params: Record<string, unknown> = {}, o: { notify?: boolean; name?: string; signal?: AbortSignal; version?: McpVersion } = {}): Promise<{ rpc: Rpc | null; headers: { get(n: string): string | null } }> {
    const v = o.version ?? this.version ?? MCP_LATEST;
    const id = ++this.seq;
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': v };
    if (v === MCP_LATEST) { headers['Mcp-Method'] = method; if (o.name) headers['Mcp-Name'] = o.name; params = { ...params, _meta: { ...(params._meta as object ?? {}), 'io.modelcontextprotocol/protocolVersion': v, 'io.modelcontextprotocol/clientInfo': this.clientInfo, 'io.modelcontextprotocol/clientCapabilities': {} } }; }
    else if (this.session) headers['Mcp-Session-Id'] = this.session;
    const auth = await this.getAuth(); if (auth) headers.authorization = `Bearer ${auth}`;
    const body: Rpc = o.notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
    const res = await this.fetchFn(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: o.signal });
    if (o.notify) return { rpc: null, headers: res.headers };
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new McpError(res.status, '鉴权失败：请检查这个服务器的凭据（安全表单）');
    if (res.status >= 400 && !text.trim().startsWith('{')) throw new McpError(res.status, `HTTP ${res.status}`);
    const rpc = parseBody(text, res.headers.get('content-type'), id);
    return { rpc, headers: res.headers };
  }
  private unwrap(r: Rpc | null): Record<string, unknown> { if (!r) return {}; if (r.error) throw new McpError(r.error.code, r.error.message); return r.result ?? {}; }
  /** 选版本：先 server/discover（2026-07-28）；不支持就回退 2025-11-25 的 initialize 握手。 */
  async connect(signal?: AbortSignal): Promise<McpVersion> {
    let sup: string[] | null;
    try {
      const res = this.unwrap((await this.post('server/discover', {}, { version: MCP_LATEST, signal })).rpc);
      sup = (res.supportedVersions as string[] | undefined) ?? [];
      this.serverInfo = (res.serverInfo as Record<string, unknown>) ?? {};
    } catch (e) { if (signal?.aborted || (e instanceof McpError && (e.code === 401 || e.code === 403))) throw e; sup = null; /* 旧服务器不认 server/discover：回退握手 */ }
    if (sup && sup.includes(MCP_LATEST)) { this.version = MCP_LATEST; return this.version; }
    if (sup && !sup.includes(MCP_LEGACY)) throw new McpError(-32602, `服务器不支持本 App 的协议版本（它支持：${sup.join('、') || '未声明'}）`);
    const { rpc, headers } = await this.post('initialize', { protocolVersion: MCP_LEGACY, capabilities: {}, clientInfo: this.clientInfo }, { version: MCP_LEGACY, signal });
    const res = this.unwrap(rpc);
    if (res.protocolVersion !== MCP_LEGACY) throw new McpError(-32602, `服务器协商的版本 ${String(res.protocolVersion)} 本 App 不支持`);
    this.session = headers.get('mcp-session-id');
    this.serverInfo = (res.serverInfo as Record<string, unknown>) ?? {};
    this.version = MCP_LEGACY;
    await this.post('notifications/initialized', {}, { notify: true, version: MCP_LEGACY, signal });
    return this.version;
  }
  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    if (!this.version) await this.connect(signal);
    const out: McpToolInfo[] = []; let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const res = this.unwrap((await this.post('tools/list', cursor ? { cursor } : {}, { signal })).rpc);
      out.push(...((res.tools as McpToolInfo[]) ?? []));
      cursor = res.nextCursor as string | undefined; if (!cursor) break;
    }
    return out;
  }
  /** tools/call；遇到 input_required 时把 inputRequests 交给 onInput（由用户在界面上回答），带 inputResponses 重试，最多 3 轮。 */
  async callTool(name: string, args: Record<string, unknown>, o: { onInput?: (reqs: InputRequest) => Promise<Record<string, unknown> | null>; signal?: AbortSignal } = {}): Promise<{ content: unknown[]; isError: boolean; rounds: number }> {
    if (!this.version) await this.connect(o.signal);
    let inputResponses: Record<string, unknown> | undefined;
    for (let round = 1; round <= 4; round++) {
      const res = this.unwrap((await this.post('tools/call', { name, arguments: args, ...(inputResponses ? { inputResponses } : {}) }, { name, signal: o.signal })).rpc);
      if (res.resultType === 'input_required') {
        if (round > 3 || !o.onInput) throw new McpError(-32000, '服务器需要更多信息，但没有可回答的界面');
        const ans = await o.onInput((res.inputRequests as InputRequest) ?? {});
        if (!ans) throw new McpError(-32000, '你取消了这次调用');
        inputResponses = ans; continue;
      }
      return { content: (res.content as unknown[]) ?? [], isError: res.isError === true, rounds: round };
    }
    throw new McpError(-32000, '多轮请求超过上限');
  }
}
