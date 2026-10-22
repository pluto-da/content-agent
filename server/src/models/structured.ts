import type { ModelHub } from './hub.js';
import type { ChatMessage, ChatOptions, ChatResult } from './types.js';
import { repairMessage, runStructured, type JsonSchema, type SchemaError } from '@content-agent/shared';

export { repairMessage };

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

/**
 * 结构化输出：适配器支持时传 response_format（json_schema / json_object），
 * 校验与“带错误信息修复重试一次”由共用模块 runStructured 完成（本机模式同一份逻辑）。
 */
export async function chatStructured<T>(
  hub: ModelHub, task: string, messages: ChatMessage[], schema: JsonSchema, opts: ChatOptions & { name?: string } = {},
): Promise<StructuredResult<T>> {
  const { name = 'output', ...chatOpts } = opts;
  const rf = { type: 'json_schema' as const, name: name.replace(/[^\w-]/g, '_').slice(0, 64), schema };
  return runStructured<T, ChatResult>((msgs) => hub.chat(task, msgs as ChatMessage[], { ...chatOpts, responseFormat: rf }), messages as never, schema);
}
