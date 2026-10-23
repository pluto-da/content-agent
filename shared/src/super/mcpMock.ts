/**
 * 测试 / 走查用的本机模拟 MCP 服务器（不联网）：按 2026-07-28（无状态，server/discover、input_required）或 2025-11-25（initialize + 会话头）应答。
 * 严格检查：2026-07-28 请求的 MCP-Protocol-Version 头必须与 _meta 一致、Mcp-Method 必须等于 method；2025-11-25 请求必须带握手得到的 Mcp-Session-Id。
 */
import type { FetchLike, McpToolInfo } from './mcp.js';

export const MOCK_MCP_TOOLS: McpToolInfo[] = [
  { name: 'search_docs', description: '在你的知识库里搜索文档（只读）', annotations: { readOnlyHint: true } },
  { name: 'create_page', description: '在你的笔记里新建一页', annotations: { readOnlyHint: false } },
  { name: 'xhs_auto_like', description: '自动给小红书笔记点赞' },
  { name: 'post_to_weibo', description: 'Publish a post to Weibo account' },
  { name: 'translate', description: '翻译一段文字' },
  { name: 'mystery', description: '' },
];
export function createMockMcp(o: { version: '2026-07-28' | '2025-11-25'; tools?: McpToolInfo[]; inputRequired?: string[]; sse?: boolean; token?: string }): FetchLike & { log: { method: string; headers: Record<string, string> }[] } {
  const tools = o.tools ?? MOCK_MCP_TOOLS;
  const sessions = new Set<string>();
  const log: { method: string; headers: Record<string, string> }[] = [];
  const fn = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = JSON.parse(init.body) as { id?: number; method: string; params?: Record<string, unknown> };
    log.push({ method: req.method, headers: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, k === 'authorization' ? '(已隐藏)' : v])) });
    const hdr = new Map<string, string>([['content-type', o.sse ? 'text/event-stream' : 'application/json']]);
    const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => { for (const [k, v] of Object.entries(extra)) hdr.set(k.toLowerCase(), v); const text = o.sse && body ? `event: message\ndata: ${JSON.stringify(body)}\n\n` : body ? JSON.stringify(body) : ''; return { status, headers: { get: (n: string) => hdr.get(n.toLowerCase()) ?? null }, text: async () => text }; };
    const ok = (result: unknown) => reply(200, { jsonrpc: '2.0', id: req.id, result });
    const err = (code: number, message: string, status = 200) => reply(status, { jsonrpc: '2.0', id: req.id, error: { code, message } });
    if (o.token && h.authorization !== `Bearer ${o.token}`) return reply(401, null);
    if (o.version === '2026-07-28') {
      const meta = (req.params?._meta ?? {}) as Record<string, unknown>;
      if (h['mcp-protocol-version'] !== meta['io.modelcontextprotocol/protocolVersion']) return err(-32001, 'HeaderMismatch', 400);
      if (h['mcp-method'] !== req.method) return err(-32001, 'HeaderMismatch: Mcp-Method', 400);
      if (req.method === 'server/discover') return ok({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'mock-2026', version: '1.0.0' } });
      if (req.method === 'initialize') return err(-32601, 'Method not found');
    } else {
      if (req.method === 'server/discover') return err(-32601, 'Method not found');
      if (req.method === 'initialize') { const sid = `s-${sessions.size + 1}`; sessions.add(sid); return reply(200, { jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mock-2025', version: '1.0.0' } } }, { 'Mcp-Session-Id': sid }); }
      if (req.method === 'notifications/initialized') return reply(202, null);
      if (!sessions.has(h['mcp-session-id'] ?? '')) return err(-32002, 'Missing session', 400);
    }
    if (req.method === 'tools/list') { const c = Number(req.params?.cursor ?? 0); const page = tools.slice(c, c + 4); return ok({ tools: page, ...(c + 4 < tools.length ? { nextCursor: String(c + 4) } : {}) }); }
    if (req.method === 'tools/call') {
      const name = String(req.params?.name); const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      if (o.version === '2026-07-28' && h['mcp-name'] !== name) return err(-32001, 'HeaderMismatch: Mcp-Name', 400);
      if (!tools.some((t) => t.name === name)) return err(-32602, `Unknown tool ${name}`);
      if (o.version === '2026-07-28' && o.inputRequired?.includes(name) && !req.params?.inputResponses) return ok({ resultType: 'input_required', inputRequests: { folder: { method: 'elicitation/create', params: { message: '要存到哪个文件夹？', requestedSchema: { type: 'object', properties: { folder: { type: 'string' } } } } } } });
      const extra = req.params?.inputResponses ? `（文件夹：${JSON.stringify(req.params.inputResponses)}）` : '';
      return ok({ content: [{ type: 'text', text: `${name} 完成：${JSON.stringify(args)}${extra}` }], isError: false });
    }
    return err(-32601, 'Method not found');
  }) as unknown as FetchLike & { log: typeof log };
  fn.log = log;
  return fn;
}
