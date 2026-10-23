import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';

const AGENT_DEFAULTS = join(dirname(fileURLToPath(import.meta.url)), '../../agent');
const mk = (a2a: { enabled: boolean; token: string; skills: string[] }) => buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ca-a2a-')), agentDefaultsDir: AGENT_DEFAULTS, rateLimitMs: 0, a2a: { ...a2a, baseUrl: 'https://me.example.com', version: '1.2.0' } });

describe('E16 A2A 服务端（server 模式，默认关闭）', () => {
  it('默认关闭：Agent Card 与 /a2a 都是 404', async () => {
    const { app } = await mk({ enabled: false, token: '', skills: [] });
    expect((await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/a2a', payload: { jsonrpc: '2.0', id: 1, method: 'SendMessage' } })).statusCode).toBe(404);
  });
  it('开启后：只暴露勾选技能、不含口令；/a2a 必须 Bearer；SendMessage 只进待批列表，不自动执行', async () => {
    const token = 'local-test-token-0123456789';
    const { app } = await mk({ enabled: true, token, skills: ['review'] });
    const card = await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
    expect(card.statusCode).toBe(200);
    expect(card.json().skills.map((s: { id: string }) => s.id)).toEqual(['review']);
    expect(card.body).not.toContain(token);
    const msg = { jsonrpc: '2.0', id: 7, method: 'SendMessage', params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: '审核这段文字' }] }, metadata: { skill: 'review' } } };
    expect((await app.inject({ method: 'POST', url: '/a2a', payload: msg })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/a2a', payload: msg, headers: { authorization: `Bearer ${token}` } });
    expect(ok.json().result.task.status.state).toBe('TASK_STATE_SUBMITTED');
    const other = await app.inject({ method: 'POST', url: '/a2a', payload: { ...msg, params: { ...msg.params, metadata: { skill: 'draft' } } }, headers: { authorization: `Bearer ${token}` } });
    expect(other.json().error.message).toMatch(/未开放/);
    const inbox = await app.inject({ method: 'GET', url: '/api/a2a/inbox' });
    expect(inbox.json().items).toHaveLength(1);
  });
  it('口令太短（<16）视为未配置鉴权，不开放', async () => {
    const { app } = await mk({ enabled: true, token: 'short', skills: ['review'] });
    expect((await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' })).statusCode).toBe(404);
  });
});
