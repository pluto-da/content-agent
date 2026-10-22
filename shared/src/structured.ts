import { extractJson } from './json.js';
import { validate, type JsonSchema, type SchemaError } from './schema.js';

export interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string }

export function parseAndCheck<T>(content: string, schema: JsonSchema): { data?: T; errors: SchemaError[] } {
  let data: T;
  try {
    data = extractJson<T>(content);
  } catch (e) {
    return { errors: [{ path: '$', kind: 'type', message: `输出不是合法 JSON：${e instanceof Error ? e.message : String(e)}` }] };
  }
  return { data, errors: validate(schema, data) };
}

export function repairMessage(errors: SchemaError[]): string {
  return [
    '[TASK:repair]',
    '上一次输出没有通过 Schema 校验，错误如下：',
    ...errors.slice(0, 20).map((e) => `- ${e.message}`),
    '请只输出修正后的完整 JSON：修正上述问题，其余内容尽量保持不变，不要解释。',
  ].join('\n');
}

export interface StructuredRun<T, R> { data: T; result: R; firstPass: boolean; calls: number; firstErrors: SchemaError[]; errors: SchemaError[] }

/**
 * 结构化输出（与服务商无关的核心）：调用一次 → 本地 Schema 校验 → 不通过则带错误信息修复重试一次。
 * chat 由调用方提供（服务端 ModelHub / 本机直连），两边因此共用同一套校验与修复逻辑。
 */
export async function runStructured<T, R extends { content: string }>(chat: (messages: ChatTurn[]) => Promise<R>, messages: ChatTurn[], schema: JsonSchema): Promise<StructuredRun<T, R>> {
  const r1 = await chat(messages);
  const c1 = parseAndCheck<T>(r1.content, schema);
  if (c1.data !== undefined && !c1.errors.length) return { data: c1.data, result: r1, firstPass: true, calls: 1, firstErrors: [], errors: [] };
  const r2 = await chat([...messages, { role: 'assistant', content: r1.content }, { role: 'user', content: repairMessage(c1.errors) }]);
  const c2 = parseAndCheck<T>(r2.content, schema);
  if (c2.data === undefined) throw new Error(`模型输出两次都不是合法 JSON：${c2.errors[0]?.message ?? ''}`);
  return { data: c2.data, result: r2, firstPass: false, calls: 2, firstErrors: c1.errors, errors: c2.errors };
}
