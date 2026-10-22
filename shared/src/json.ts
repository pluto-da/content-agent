/** 从模型输出中稳健地提取 JSON（容忍 ```json 包裹与前后说明文字）。 */
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('模型输出中没有 JSON');
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(close);
  if (end < start) throw new Error('模型输出 JSON 不完整');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/** 统一编解码：把行内 <think>…</think> 挪进 reasoning，正文只留成稿。 */
export function splitReasoning(content: string, reasoning?: string): { content: string; reasoning?: string } {
  const m = /^\s*<think>([\s\S]*?)<\/think>\s*/.exec(content);
  if (!m) return { content, reasoning: reasoning || undefined };
  const inline = m[1]!.trim();
  return { content: content.slice(m[0].length), reasoning: [reasoning, inline].filter(Boolean).join('\n') || undefined };
}
