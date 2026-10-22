/**
 * 流式响应解析（0.8.0，三端共用）：SSE 行切分 + OpenAI 兼容 delta 累加（content / reasoning_content / tool_calls 按 index 合并 arguments）
 * + Anthropic 兼容事件（content_block_start / content_block_delta / message_delta）。纯函数，不做网络请求。
 */

export interface SSEEvent { event?: string; data: string }

/** SSE 行解析器：可多次 feed 任意切分的文本块；遇到空行派发一个事件。`data: [DONE]` 作为普通事件交给调用方判断。 */
export function createSSEParser(onEvent: (e: SSEEvent) => void): { feed(chunk: string): void; end(): void } {
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];
  const flush = () => {
    if (data.length) onEvent({ event, data: data.join('\n') });
    event = undefined; data = [];
  };
  const line = (l: string) => {
    if (l === '') { flush(); return; }
    if (l.startsWith(':')) return; // 注释 / 心跳
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  };
  return {
    feed(chunk: string) {
      buf += chunk;
      let idx: number;
      while ((idx = buf.search(/\r\n|\n|\r/)) >= 0) {
        const nl = buf[idx] === '\r' && buf[idx + 1] === '\n' ? 2 : 1;
        line(buf.slice(0, idx));
        buf = buf.slice(idx + nl);
      }
    },
    end() { if (buf) { line(buf); buf = ''; } flush(); },
  };
}

export interface ToolCallAcc { id: string; name: string; arguments: string }
export interface StreamState {
  content: string;
  reasoning: string;
  toolCalls: ToolCallAcc[];
  finishReason?: string;
  usage?: { input: number; output: number; cached?: number };
  model?: string;
  chunks: number;
  done: boolean;
}

export const emptyStreamState = (): StreamState => ({ content: '', reasoning: '', toolCalls: [], chunks: 0, done: false });

/** 把一条 OpenAI 兼容的 chunk（已 JSON.parse）累加进状态，返回本次新增的正文与思考文本（供界面逐字显示）。 */
export function applyOpenAIChunk(s: StreamState, j: Record<string, any>): { content: string; reasoning: string } {
  s.chunks++;
  if (typeof j.model === 'string') s.model = j.model;
  if (j.usage) s.usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0, cached: j.usage.prompt_tokens_details?.cached_tokens ?? j.usage.prompt_cache_hit_tokens };
  const ch = j.choices?.[0];
  if (!ch) return { content: '', reasoning: '' };
  const d = ch.delta ?? ch.message ?? {};
  const content = typeof d.content === 'string' ? d.content : '';
  const reasoning = typeof d.reasoning_content === 'string' ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : '';
  s.content += content;
  s.reasoning += reasoning;
  if (Array.isArray(d.tool_calls)) {
    for (const tc of d.tool_calls as Record<string, any>[]) {
      const i = typeof tc.index === 'number' ? tc.index : s.toolCalls.length;
      const cur = s.toolCalls[i] ?? (s.toolCalls[i] = { id: '', name: '', arguments: '' });
      if (tc.id) cur.id = String(tc.id);
      if (tc.function?.name) cur.name += String(tc.function.name);
      if (tc.function?.arguments) cur.arguments += String(tc.function.arguments);
    }
  }
  if (ch.finish_reason) s.finishReason = String(ch.finish_reason);
  return { content, reasoning };
}

/** Anthropic 兼容流事件（已 JSON.parse 的 data）。tool_use 的 input 以 input_json_delta 片段拼接。 */
export function applyAnthropicEvent(s: StreamState, j: Record<string, any>, blocks: Map<number, number>): { content: string; reasoning: string } {
  s.chunks++;
  switch (j.type) {
    case 'message_start':
      if (j.message?.model) s.model = j.message.model;
      if (j.message?.usage) s.usage = { input: j.message.usage.input_tokens ?? 0, output: j.message.usage.output_tokens ?? 0, cached: j.message.usage.cache_read_input_tokens };
      return { content: '', reasoning: '' };
    case 'content_block_start':
      if (j.content_block?.type === 'tool_use') {
        blocks.set(j.index, s.toolCalls.length);
        s.toolCalls.push({ id: String(j.content_block.id ?? ''), name: String(j.content_block.name ?? ''), arguments: '' });
      }
      return { content: '', reasoning: '' };
    case 'content_block_delta': {
      const d = j.delta ?? {};
      if (d.type === 'text_delta') { s.content += d.text ?? ''; return { content: d.text ?? '', reasoning: '' }; }
      if (d.type === 'thinking_delta') { s.reasoning += d.thinking ?? ''; return { content: '', reasoning: d.thinking ?? '' }; }
      if (d.type === 'input_json_delta') { const k = blocks.get(j.index); if (k !== undefined) s.toolCalls[k]!.arguments += d.partial_json ?? ''; }
      return { content: '', reasoning: '' };
    }
    case 'message_delta':
      if (j.delta?.stop_reason) s.finishReason = j.delta.stop_reason === 'tool_use' ? 'tool_calls' : String(j.delta.stop_reason);
      if (j.usage) s.usage = { input: s.usage?.input ?? 0, output: j.usage.output_tokens ?? s.usage?.output ?? 0, cached: s.usage?.cached };
      return { content: '', reasoning: '' };
    case 'message_stop':
      s.done = true;
      return { content: '', reasoning: '' };
    default:
      return { content: '', reasoning: '' };
  }
}

/**
 * 便捷封装：喂入原始 SSE 文本块，自动识别 OpenAI / Anthropic 协议并累加。
 * onDelta 在每次有新增正文或思考文本时回调。
 */
export function createStreamAccumulator(protocol: 'openai' | 'anthropic', onDelta?: (d: { content: string; reasoning: string }) => void) {
  const state = emptyStreamState();
  const blocks = new Map<number, number>();
  const parser = createSSEParser((e) => {
    if (e.data === '[DONE]') { state.done = true; return; }
    let j: Record<string, any>;
    try { j = JSON.parse(e.data); } catch { return; }
    if (j.error) { state.done = true; (state as StreamState & { error?: string }).error = String(j.error.message ?? j.error); return; }
    const d = protocol === 'anthropic' ? applyAnthropicEvent(state, j, blocks) : applyOpenAIChunk(state, j);
    if ((d.content || d.reasoning) && onDelta) onDelta(d);
  });
  return { state, feed: (t: string) => parser.feed(t), end: () => { parser.end(); state.done = true; return state; } };
}
