import { describe, it, expect } from 'vitest';
import { McpClient, createMockMcp, MOCK_MCP_TOOLS, classifyMcpTool, buildServerConfig, setToolEnabled, grantTool, guardMcpCall, MCP_LATEST, MCP_LEGACY, ToolRegistry, permLevelOf } from '../src/index.js';

describe('E15 MCP 客户端', () => {
  it('2026-07-28：server/discover 选版本，无握手无会话；头与 _meta 一致；input_required 多轮', async () => {
    const f = createMockMcp({ version: '2026-07-28', inputRequired: ['create_page'] });
    const c = new McpClient('https://mcp.example.com/mcp', f);
    expect(await c.connect()).toBe(MCP_LATEST);
    const tools = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(MOCK_MCP_TOOLS.map((t) => t.name));
    const asked: unknown[] = [];
    const r = await c.callTool('create_page', { title: '周复盘' }, { onInput: async (q) => { asked.push(q); return { folder: { action: 'accept', content: { folder: '运营' } } }; } });
    expect(r.rounds).toBe(2); expect(asked).toHaveLength(1); expect(JSON.stringify(r.content)).toMatch(/运营/);
    expect(f.log.map((l) => l.method)).not.toContain('initialize');
    expect(f.log.every((l) => l.headers['mcp-protocol-version'] === MCP_LATEST && l.headers['mcp-method'] === l.method && !l.headers['mcp-session-id'])).toBe(true);
    await expect(c.callTool('create_page', {}, {})).rejects.toThrow(/更多信息/);
  });
  it('兼容 2025-11-25：discover 不认时回退 initialize → notifications/initialized，之后带会话头；SSE 响应可解析', async () => {
    const f = createMockMcp({ version: '2025-11-25', sse: true });
    const c = new McpClient('https://old.example.com/mcp', f);
    expect(await c.connect()).toBe(MCP_LEGACY);
    expect(f.log.map((l) => l.method).slice(0, 3)).toEqual(['server/discover', 'initialize', 'notifications/initialized']);
    const r = await c.callTool('search_docs', { q: '选题' });
    expect(r.isError).toBe(false);
    expect(f.log.at(-1)!.headers['mcp-session-id']).toBe('s-1');
  });
  it('凭据：调用时现取，不进配置；配置里写 Key 被拒；401 给白话错误', async () => {
    const f = createMockMcp({ version: '2026-07-28', token: 'tok-local-123' });
    await expect(new McpClient('https://m.example.com', f).connect()).rejects.toThrow(/鉴权失败/);
    expect(f.log.map((l) => l.method)).toEqual(['server/discover']);
    const ok = await new McpClient('https://m.example.com', f, async () => 'tok-local-123').listTools();
    expect(ok.length).toBe(6);
    expect(f.log.every((l) => !l.headers.authorization || l.headers.authorization === '(已隐藏)')).toBe(true);
    expect(() => buildServerConfig({ id: 'n', name: 'N', url: 'https://x.com', secretRef: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, [])).toThrow(/Key/);
    expect(() => buildServerConfig({ id: 'n', name: 'N', url: 'http://evil.com' }, [])).toThrow(/https/);
  });
  it('逐工具授权：社交互动类注册被拒、写入类默认关闭且逐次确认、无法判定的逐次确认；调用时二次检查', () => {
    expect(classifyMcpTool(MOCK_MCP_TOOLS[2]!).verdict).toBe('rejected');
    expect(classifyMcpTool(MOCK_MCP_TOOLS[3]!).verdict).toBe('rejected');
    expect(classifyMcpTool({ name: 'send_dm', description: 'Send a direct message on Instagram' }).verdict).toBe('rejected');
    expect(classifyMcpTool({ name: 'bulk_follow', description: '' }).verdict).toBe('rejected');
    expect(classifyMcpTool(MOCK_MCP_TOOLS[0]!)).toMatchObject({ verdict: 'ok', writesExternal: false });
    expect(classifyMcpTool(MOCK_MCP_TOOLS[1]!)).toMatchObject({ verdict: 'confirm_each', writesExternal: true });
    expect(classifyMcpTool(MOCK_MCP_TOOLS[5]!).verdict).toBe('confirm_each');
    let s = buildServerConfig({ id: 'notes', name: '我的笔记', url: 'https://mcp.example.com/mcp', secretRef: 'secret:notes' }, MOCK_MCP_TOOLS);
    expect(s.tools.every((t) => !t.enabled && t.level === 'L2')).toBe(true);
    expect(() => setToolEnabled(s, 'xhs_auto_like', true)).toThrow(/硬边界/);
    expect(() => setToolEnabled(s, 'search_docs', true, 'L3')).toThrow(/L2/);
    s = setToolEnabled(s, 'search_docs', true); s = setToolEnabled(s, 'create_page', true);
    const sup = { agentId: 'super', permissions: ['L0', 'L1', 'L2'] as const };
    const g = { ...sup, permissions: [...sup.permissions] };
    expect(guardMcpCall(s, 'search_docs', g).reason).toMatch(/未经你批准/);
    s = { ...s, enabled: true, approved: true };
    expect(guardMcpCall(s, 'search_docs', g).allow).toBe(true);
    expect(guardMcpCall(s, 'create_page', g)).toMatchObject({ allow: false, needsConfirm: true });
    expect(guardMcpCall(s, 'create_page', g, {}, { confirmed: true }).allow).toBe(true);
    expect(guardMcpCall(s, 'xhs_auto_like', g).allow).toBe(false);
    const sub = { agentId: 'topic-researcher', permissions: ['L0', 'L1'] as ('L0' | 'L1')[] };
    expect(guardMcpCall(s, 'search_docs', sub).reason).toMatch(/没有分配/);
    s = grantTool(s, 'search_docs', 'topic-researcher', true);
    expect(guardMcpCall(s, 'search_docs', sub)).toMatchObject({ allow: false, needsConfirm: true });
    expect(guardMcpCall(s, 'search_docs', { ...sub, permissions: ['L0', 'L1', 'L2'] }).allow).toBe(true);
    expect(guardMcpCall(s, 'search_docs', g, { q: '帮我批量点赞' }).allow).toBe(false);
    expect(guardMcpCall(s, 'search_docs', g, {}, { paused: true }).allow).toBe(false);
  });
});

describe('E2 工具全部标级（内置注册表）', () => {
  it('Agent 工具注册表里每个工具都能推出级别；对外写入名注册即被拒', () => {
    const r = new ToolRegistry();
    expect(() => r.add({ name: 'auto_follow', title: '', description: '', inputSchema: {}, level: 'L1', idempotent: true, run: async () => ({ ok: true, result: null }) })).toThrow(/硬边界/);
    r.add({ name: 'draft_list', title: '', description: '', inputSchema: {}, level: 'L0', idempotent: true, run: async () => ({ ok: true, result: null }) });
    expect(r.list().map((t) => permLevelOf(t))).toEqual(['L0']);
  });
});
