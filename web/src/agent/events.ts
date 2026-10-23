/**
 * Agent 事件与轮次参数（0.11.0）：0.8 对话循环 agent/loop.ts 已删除（ADR-005 重审，agent.runtime.v9 开关到期），
 * 这里只保留两套界面 / 测试共用的类型与“历史 → 模型消息”工具函数；运行一律走 v9/engine.ts 的 runTurnV9。
 */
import type { ProviderConfig } from '../local/llm';
import type { chatAgent, AgentMsg } from './model';
import type { CardData, StoredMsg } from './store';

export const LIMITS = { toolCallsPerTurn: 8, toolTimeoutMs: 60000, turnMs: 180000, historyMessages: 40 };

export type AgentEvent =
  | { type: 'message'; msg: StoredMsg }
  | { type: 'delta'; id: number; content: string; reasoning: string }
  | { type: 'card'; id: number; index: number; card: CardData }
  | { type: 'confirm'; tool: string; label: string; args: unknown; rememberable?: boolean; spend?: boolean; estCost?: number | null; resolve: (d: 'allow' | 'deny' | 'remember') => void }
  | { type: 'done'; stopped?: boolean; error?: string }
  | { type: 'mode'; toolMode: 'native' | 'json' };

export interface TurnOpts {
  conversationId: number;
  text: string;
  cfg: ProviderConfig;
  signal?: AbortSignal;
  onEvent: (e: AgentEvent) => void;
  /** 测试注入：替换模型调用 */
  call?: typeof chatAgent;
  /** trace（B5）：记录每步 */
  trace?: TraceStep[];
}
export interface TraceStep { kind: 'model' | 'tool'; name?: string; args?: unknown; result?: unknown; ms: number; usage?: { input: number; output: number; cached?: number }; streamed?: boolean; firstTokenMs?: number; chunks?: number; content?: string; error?: string; mode?: string; thinking?: boolean }

/** 历史 → 模型消息；较早轮次压缩为一段摘要（本机拼接，不调用模型）。 */
export function historyToMessages(msgs: StoredMsg[], keep = LIMITS.historyMessages): AgentMsg[] {
  const recent = msgs.slice(-keep);
  // 截断后第一条不能是孤立的 tool 消息
  while (recent[0]?.role === 'tool') recent.shift();
  const older = msgs.slice(0, msgs.length - recent.length);
  const out: AgentMsg[] = [];
  if (older.length) out.push({ role: 'user', content: `（较早的对话摘要）${older.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 40)).join(' / ').slice(0, 600)}` }, { role: 'assistant', content: '好的，我记得这些。' });
  for (const m of recent) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    else if (m.role === 'assistant') {
      const x: AgentMsg = { role: 'assistant', content: m.content };
      if (m.reasoning) x.reasoning_content = m.reasoning;
      if (m.toolCalls?.length && !m.meta?.json) x.tool_calls = m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } }));
      out.push(x);
    } else out.push({ role: 'user', content: m.content });
  }
  return out;
}

