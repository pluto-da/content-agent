import type { ModelHub } from './hub.js';
import type { ChatMessage, ChatOptions, ChatResult } from './types.js';
import { extractJson } from './util.js';
import { validate, type JsonSchema, type SchemaError } from './schema.js';

export interface StructuredResult<T> {
  data: T;
  /** 最后一次调用的结果 */
  result: ChatResult;
  /** 第一次输出即通过 Schema 校验 */
  firstPass: boolean;
  /** 实际调用次数（1 或 2） */
  calls: number;
  /** 第一次输出的校验错误（用于置信度信号） */
  firstErrors: SchemaError[];
  /** 修复后仍未通过的错误（为空表示最终合规） */
  errors: SchemaError[];
}

function parseAndCheck<T>(content: string, schema: JsonSchema): { data?: T; errors: SchemaError[] } {
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

/**
 * 结构化输出：适配器支持时传 response_format（json_schema / json_object），
 * 不论是否支持都在本地做 Schema 校验；不通过则带错误信息修复重试一次（共享同一稳定前缀）。
 * 修复后仍有长度/条目类问题时返回 errors 交给调用方（置信度分档）；仍不是合法 JSON 则抛错。
 */
export async function chatStructured<T>(
  hub: ModelHub, task: string, messages: ChatMessage[], schema: JsonSchema, opts: ChatOptions & { name?: string } = {},
): Promise<StructuredResult<T>> {
  const { name = 'output', ...chatOpts } = opts;
  const rf = { type: 'json_schema' as const, name: name.replace(/[^\w-]/g, '_').slice(0, 64), schema };
  const r1 = await hub.chat(task, messages, { ...chatOpts, responseFormat: rf });
  const c1 = parseAndCheck<T>(r1.content, schema);
  if (c1.data !== undefined && !c1.errors.length) return { data: c1.data, result: r1, firstPass: true, calls: 1, firstErrors: [], errors: [] };
  const r2 = await hub.chat(task, [...messages, { role: 'assistant', content: r1.content }, { role: 'user', content: repairMessage(c1.errors) }], { ...chatOpts, responseFormat: rf });
  const c2 = parseAndCheck<T>(r2.content, schema);
  if (c2.data === undefined) throw new Error(`模型输出两次都不是合法 JSON：${c2.errors[0]?.message ?? ''}`);
  return { data: c2.data, result: r2, firstPass: false, calls: 2, firstErrors: c1.errors, errors: c2.errors };
}
