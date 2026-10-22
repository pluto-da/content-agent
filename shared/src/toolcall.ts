/**
 * 工具调用的 JSON 指令降级（0.8.0）：模型不支持原生 tools 时，系统提示词要求“只输出一个 ```json 代码块 {"tool":"名称","args":{…}}”。
 * 这里负责提取第一个指令并用极简 Schema 校验 args；解析结果与原生 tool_calls 走同一执行器。
 */
import { validate, type JsonSchema, type SchemaError } from './schema.js';

export interface ParsedToolCall { tool: string; args: Record<string, unknown> }

function tryParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

/** 从一段文本里找第一个形如 {"tool": "...", "args": {...}} 的指令；找不到返回 null。 */
export function extractJsonToolCall(text: string): ParsedToolCall | null {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1]!.trim());
  // 没有代码块时，尝试第一个平衡的大括号对象
  if (!candidates.length) {
    const start = text.indexOf('{');
    if (start >= 0) {
      let depth = 0; let inStr = false; let esc = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i]!;
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { candidates.push(text.slice(start, i + 1)); break; }
      }
    }
  }
  for (const c of candidates) {
    const v = tryParse(c) as Record<string, unknown> | undefined;
    if (v && typeof v === 'object' && typeof v.tool === 'string' && v.tool) {
      const args = v.args ?? v.arguments ?? {};
      return { tool: v.tool, args: (typeof args === 'string' ? (tryParse(args) as Record<string, unknown>) ?? {} : args) as Record<string, unknown> };
    }
  }
  return null;
}

/** 原生 tool_calls 的 arguments 字符串 → 对象（空串 = {}；解析失败返回 null 由调用方报错修复）。 */
export function parseToolArguments(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  const v = tryParse(raw);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 校验参数；返回错误列表（空 = 通过）。 */
export function checkToolArgs(schema: JsonSchema, args: unknown): SchemaError[] {
  return validate(schema, args);
}

/** 给模型的修复提示（一次）。 */
export function toolRepairMessage(tool: string, errors: SchemaError[] | string): string {
  const detail = typeof errors === 'string' ? errors : errors.map((e) => `${e.path}: ${e.message}`).join('；');
  return `工具 ${tool} 的参数不符合要求：${detail}。请修正后重新输出一个 \`\`\`json 代码块：{"tool":"${tool}","args":{…}}，不要输出其他内容。`;
}

/** 判断服务商错误文本是否表示“不支持 tools / function calling”。 */
export function looksLikeToolsUnsupported(status: number, body: string): boolean {
  return status >= 400 && status < 500 && /tool|function/i.test(body) && /support|unknown|invalid|not allowed|unrecognized|extra|不支持/i.test(body);
}
