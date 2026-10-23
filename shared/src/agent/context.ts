/**
 * 会话上下文组装与压缩（6.9）：稳定前缀（系统文件，由 VFS 组装）→ 会话约束（全量，永不压缩）→ 压缩摘要 → 最近轮次 → 本轮。
 * 预算按 chat 模型 contextWindow，预留输出 ≥4K、工具结果 ≥8K；估算：中文 1 字≈1 token、英文 4 字符≈1 token，上浮 20%。
 * 分层：①大工具结果替换为引用 ②较早轮次由 fast 模型压成结构化摘要（Schema 校验；失败 → 规则截断）③仍超限 → 只留最近 4 轮 + 摘要。
 */
import type { ChatMessage } from '../models/adapters/types.js';
import { validate, type JsonSchema } from '../schema.js';

export function estimateTokens(text: string): number {
  let cjk = 0, other = 0;
  for (const ch of text) { if (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)) cjk++; else other++; }
  return Math.ceil((cjk + other / 4) * 1.2);
}
const msgText = (m: ChatMessage) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '[媒体]')).join(''));
export const messagesTokens = (ms: ChatMessage[]) => ms.reduce((s, m) => s + estimateTokens(msgText(m)) + 4, 0);

export interface Summary { 用户目标: string; 已做决定: string[]; 已产出: string[]; 未完成: string[]; 用户纠正: string[] }
export const SUMMARY_SCHEMA: JsonSchema = { type: 'object', required: ['用户目标', '已做决定', '已产出', '未完成', '用户纠正'], properties: { 用户目标: { type: 'string' }, 已做决定: { type: 'array', items: { type: 'string' } }, 已产出: { type: 'array', items: { type: 'string' } }, 未完成: { type: 'array', items: { type: 'string' } }, 用户纠正: { type: 'array', items: { type: 'string' } } } };

export interface AssembleInput {
  system: string; constraints: string[]; history: ChatMessage[]; turn: ChatMessage[];
  contextWindow: number; summarize?: (older: ChatMessage[]) => Promise<unknown>; priorSummary?: Summary | null;
}
export interface Assembled { messages: ChatMessage[]; compressed: 'none' | 'tool_refs' | 'summary' | 'truncated'; summary: Summary | null; tokens: number; warnings: string[] }

/** 工具结果超过 1500 字 → 引用（“共 N 字，已保存”）。 */
export function shrinkToolResults(ms: ChatMessage[], max = 1500): ChatMessage[] {
  return ms.map((m) => (m.role === 'tool' && typeof m.content === 'string' && m.content.length > max ? { ...m, content: `${m.content.slice(0, max)}…（结果共 ${m.content.length} 字，已保存，只给出前 ${max} 字）` } : m));
}
function ruleSummary(older: ChatMessage[], prior: Summary | null): Summary {
  const users = older.filter((m) => m.role === 'user').map(msgText);
  return { 用户目标: prior?.用户目标 || users[0]?.slice(0, 80) || '', 已做决定: prior?.已做决定 ?? [], 已产出: prior?.已产出 ?? [], 未完成: [], 用户纠正: [...(prior?.用户纠正 ?? []), ...users.filter((u) => /^(不对|不是|改成|别|不要)/.test(u)).map((u) => u.slice(0, 60))].slice(-10) };
}
export async function assembleContext(i: AssembleInput): Promise<Assembled> {
  const warnings: string[] = [];
  const budget = Math.max(2000, i.contextWindow - 4096 - 8192);
  const constraintBlock = i.constraints.length ? `\n\n## 本会话约束与纠正（每轮全量生效，优先于长期记忆）\n${i.constraints.map((c) => `- ${c}`).join('\n')}` : '';
  const sys: ChatMessage = { role: 'system', content: i.system + constraintBlock };
  const fixed = estimateTokens(msgText(sys)) + messagesTokens(i.turn);
  let hist = i.history;
  if (fixed + messagesTokens(hist) <= budget) return { messages: [sys, ...hist, ...i.turn], compressed: 'none', summary: i.priorSummary ?? null, tokens: fixed + messagesTokens(hist), warnings };
  hist = shrinkToolResults(hist);
  if (fixed + messagesTokens(hist) <= budget) return { messages: [sys, ...hist, ...i.turn], compressed: 'tool_refs', summary: i.priorSummary ?? null, tokens: fixed + messagesTokens(hist), warnings };
  // 保留最近若干轮（约一半预算），更早的压成摘要
  let keepFrom = hist.length;
  let used = fixed;
  while (keepFrom > 0 && used + estimateTokens(msgText(hist[keepFrom - 1]!)) < budget * 0.6) { keepFrom--; used += estimateTokens(msgText(hist[keepFrom]!)) + 4; }
  while (keepFrom < hist.length && hist[keepFrom]!.role === 'tool') keepFrom++;
  const older = hist.slice(0, keepFrom), recent = hist.slice(keepFrom);
  let summary: Summary | null = null;
  if (i.summarize) {
    try { const s = await i.summarize(older); if (!validate(SUMMARY_SCHEMA, s).length) summary = s as Summary; else warnings.push('摘要 Schema 校验失败，改用规则截断'); }
    catch { warnings.push('压缩模型出错，改用规则截断'); }
  }
  if (!summary) summary = ruleSummary(older, i.priorSummary ?? null);
  const sumMsg: ChatMessage = { role: 'user', content: `（较早对话的结构化摘要，仅供参考）${JSON.stringify(summary)}` };
  const ack: ChatMessage = { role: 'assistant', content: '好的。' };
  let msgs = [sys, sumMsg, ack, ...recent, ...i.turn];
  let tokens = messagesTokens(msgs);
  let compressed: Assembled['compressed'] = 'summary';
  if (tokens > budget) {
    // 只保留最近 4 轮（按 user 消息计）
    const lastUsers = recent.map((m, k) => (m.role === 'user' ? k : -1)).filter((k) => k >= 0);
    const cut = lastUsers.length > 4 ? lastUsers[lastUsers.length - 4]! : 0;
    msgs = [sys, sumMsg, ack, ...recent.slice(cut), ...i.turn];
    tokens = messagesTokens(msgs);
    compressed = 'truncated';
    warnings.push('上下文仍超限，只保留最近 4 轮 + 摘要');
  }
  return { messages: msgs, compressed, summary, tokens, warnings };
}
