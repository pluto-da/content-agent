import { describe, it, expect } from 'vitest';
import { FLAGS, flagOn, fetchAgentCard, validateAgentCard, newA2ARef, guardA2A, sendA2AMessage, a2aServerAllowed, buildAgentCard, A2A_SKILLS, AGENT_CARD_PATH, type AgentCard } from '../src/index.js';

const card: AgentCard = { name: '外部选题 Agent', description: '给选题', version: '1.0.0', supportedInterfaces: [{ url: 'https://agent.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], capabilities: {}, skills: [{ id: 'topics', name: '选题', description: '', tags: [] }] };
const fetchFn = (routes: Record<string, (body?: string, headers?: Record<string, string>) => { status: number; body: unknown }>) => {
  const log: { url: string; headers?: Record<string, string>; body?: string }[] = [];
  const f = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => { log.push({ url, headers: init?.headers, body: init?.body }); const r = routes[url]?.(init?.body, init?.headers) ?? { status: 404, body: {} }; return { status: r.status, text: async () => JSON.stringify(r.body) }; };
  return Object.assign(f, { log });
};

describe('E16 A2A（beta，默认关闭）', () => {
  it('a2a.client / a2a.server 两个开关默认关闭', () => {
    expect(FLAGS.get('a2a.client')).toMatchObject({ default: false, stage: 'beta' });
    expect(FLAGS.get('a2a.server')).toMatchObject({ default: false, stage: 'beta' });
    expect(flagOn('a2a.client')).toBe(false); expect(flagOn('a2a.server')).toBe(false);
  });
  it('客户端：读 /.well-known/agent-card.json、校验 v1.0 必填字段与密钥；SendMessage 调用', async () => {
    const f = fetchFn({ [`https://agent.example.com${AGENT_CARD_PATH}`]: () => ({ status: 200, body: card }), 'https://agent.example.com/a2a': (b) => ({ status: 200, body: { jsonrpc: '2.0', id: JSON.parse(b!).id, result: { message: { role: 'ROLE_AGENT', parts: [{ text: '三个选题：…' }] } } } }) });
    const r = await fetchAgentCard('https://agent.example.com/', f);
    expect(r.ok).toBe(true);
    expect(validateAgentCard({ ...card, supportedInterfaces: [] }).join()).toMatch(/supportedInterfaces/);
    expect(validateAgentCard({ ...card, description: 'sk-abcdefghijklmnopqrstuvwxyz123456' }).join()).toMatch(/密钥/);
    const ref = { ...newA2ARef('ext-topics', r.ok ? r.url : '', card, { secretRef: 'secret:ext' }), enabled: true, approved: true };
    const s = await sendA2AMessage(ref, '给我选题', f, async () => 'tok');
    expect(s).toEqual({ ok: true, text: '三个选题：…', taskState: undefined });
    const sent = JSON.parse(f.log.at(-1)!.body!);
    expect(sent.method).toBe('SendMessage'); expect(sent.params.message.parts[0].text).toBe('给我选题');
  });
  it('开启后受同等治理：开关、批准（L3）、L2 权限、预算、暂停', () => {
    const ref = newA2ARef('ext', 'https://a.example.com/.well-known/agent-card.json', card);
    const sup = { agentId: 'super', permissions: ['L0', 'L1', 'L2'] as ('L0' | 'L1' | 'L2')[] };
    expect(guardA2A(ref, {}, sup, 0, 0.1).reason).toMatch(/默认关闭/);
    expect(guardA2A(ref, { 'a2a.client': true }, sup, 0, 0.1)).toMatchObject({ allow: false, needsApproval: true });
    const ok = { ...ref, approved: true, enabled: true };
    expect(guardA2A(ok, { 'a2a.client': true }, sup, 0, 0.1).allow).toBe(true);
    expect(guardA2A(ok, { 'a2a.client': true }, { agentId: 'x', permissions: ['L0'] }, 0, 0.1).allow).toBe(false);
    expect(guardA2A(ok, { 'a2a.client': true }, sup, 2.95, 0.1)).toMatchObject({ allow: false, needsApproval: true });
    expect(guardA2A(ok, { 'a2a.client': true }, sup, 0, 0.1, { paused: true }).allow).toBe(false);
  });
  it('服务端：本机模式不开放；需开关 + 口令；只暴露勾选技能，Agent Card 不含 Key', () => {
    expect(a2aServerAllowed({ mode: 'local', flags: { 'a2a.server': true }, hasToken: true }).ok).toBe(false);
    expect(a2aServerAllowed({ mode: 'server', flags: {}, hasToken: true }).ok).toBe(false);
    expect(a2aServerAllowed({ mode: 'server', flags: { 'a2a.server': true }, hasToken: false }).ok).toBe(false);
    expect(a2aServerAllowed({ mode: 'server', flags: { 'a2a.server': true }, hasToken: true }).ok).toBe(true);
    const c = buildAgentCard({ baseUrl: 'https://me.example.com/', version: '1.2.0', skills: A2A_SKILLS, selected: ['draft', 'review'] });
    expect(c.skills.map((s) => s.id)).toEqual(['draft', 'review']);
    expect(c.supportedInterfaces[0]!.url).toBe('https://me.example.com/a2a');
    expect(c.securityRequirements).toEqual([{ bearer: [] }]);
    expect(validateAgentCard(c)).toEqual([]);
  });
});
