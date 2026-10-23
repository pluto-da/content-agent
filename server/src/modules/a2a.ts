/**
 * 1.2.0 A2A 服务端（beta，默认关闭）：只在“连接自己的服务器”模式下由用户开启（a2a.server 开关 + 访问口令）。
 * 发布超级 Agent 的 Agent Card（/.well-known/agent-card.json，只暴露勾选的技能，不含 Key）；/a2a 只接受 v1.0 JSON-RPC SendMessage，必须 Bearer 鉴权。
 * 收到的请求不自动执行：写入待批列表（GET /api/a2a/inbox，受原访问口令保护），由用户在 App 的审批收件箱处理；回复 Task（TASK_STATE_SUBMITTED）。
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildAgentCard, a2aServerAllowed, A2A_SKILLS, findSecrets, redact } from '@content-agent/shared';

export interface A2AServerOpts { enabled: boolean; token: string; baseUrl: string; skills: string[]; version: string }
export function a2aOptsFromEnv(version: string): A2AServerOpts {
  return { enabled: process.env.A2A_SERVER === '1', token: process.env.A2A_TOKEN ?? '', baseUrl: process.env.A2A_BASE_URL ?? 'http://127.0.0.1:8787', skills: (process.env.A2A_SKILLS ?? '').split(',').map((s) => s.trim()).filter(Boolean), version };
}
export function registerA2A(app: FastifyInstance, o: A2AServerOpts): void {
  const gate = a2aServerAllowed({ mode: 'server', flags: { 'a2a.server': o.enabled }, hasToken: o.token.length >= 16 });
  const inbox: { id: string; at: string; skill?: string; text: string }[] = [];
  app.get('/.well-known/agent-card.json', async (_req, reply) => {
    if (!gate.ok) return reply.code(404).send({ error: { code: 'a2a_off', message: gate.why } });
    return buildAgentCard({ baseUrl: o.baseUrl, version: o.version, skills: A2A_SKILLS, selected: o.skills });
  });
  app.post('/a2a', async (req, reply) => {
    if (!gate.ok) return reply.code(404).send({ error: { code: 'a2a_off', message: gate.why } });
    const got = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!(got.length === o.token.length && timingSafeEqual(Buffer.from(got), Buffer.from(o.token)))) return reply.code(401).send({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
    const b = (req.body ?? {}) as { id?: unknown; method?: string; params?: { message?: { parts?: { text?: string }[] }; metadata?: { skill?: string } } };
    if (b.method !== 'SendMessage') return { jsonrpc: '2.0', id: b.id ?? null, error: { code: -32601, message: 'Method not found（本服务只支持 SendMessage）' } };
    const text = (b.params?.message?.parts ?? []).map((p) => p.text ?? '').join('\n').slice(0, 4000);
    if (findSecrets(text).length) return { jsonrpc: '2.0', id: b.id ?? null, error: { code: -32602, message: '消息里有疑似密钥，已拒绝' } };
    const skill = b.params?.metadata?.skill;
    if (skill && !o.skills.includes(skill)) return { jsonrpc: '2.0', id: b.id ?? null, error: { code: -32602, message: `未开放的技能：${skill}` } };
    const id = `a2a-${Date.now().toString(36)}-${inbox.length + 1}`;
    inbox.push({ id, at: new Date().toISOString(), skill, text: redact(text) });
    return { jsonrpc: '2.0', id: b.id ?? null, result: { task: { id, contextId: id, status: { state: 'TASK_STATE_SUBMITTED', message: { role: 'ROLE_AGENT', parts: [{ text: '已收到，等用户在审批收件箱批准后处理（不会自动执行）' }] } } } } };
  });
  app.get('/api/a2a/inbox', async () => ({ enabled: gate.ok, why: gate.why, items: inbox }));
}
