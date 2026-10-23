/**
 * 统一工具定义（6.5）：一份定义同时用于原生 tool calling 与 JSON 指令降级。
 * 工具注册表强制：不存在任何对外写入工具（发布 / 评论 / 私信 / 点赞 / 关注 / 收藏 / 推送）。名字或声明命中即拒绝注册。
 */
import { Registry } from '../core/registry.js';
import type { JsonSchema } from '../schema.js';
import type { CallError } from '../models/errors.js';
import type { RoleId } from '../models/roles.js';
import type { ToolLevel, ApprovalInput } from './policy.js';

export interface Source { id: string; title: string; url?: string }
export interface CardSpec { type: string; data: Record<string, unknown> }
export type ToolOutput =
  | { ok: true; result: unknown; card?: CardSpec; count?: number; sources?: Source[]; artifacts?: string[]; cost?: number | null; model?: string; respondedModel?: string }
  | { ok: false; error: CallError; card?: CardSpec; cost?: number | null };
export interface ToolRunCtx {
  runId: string; stepId: string; conversationId: number; signal: AbortSignal; userText: string; depth: number;
  modelOverride?: Partial<Record<RoleId, { accountId: string; modelEntryId: string; model: string }>>;
  emitProgress?(p: Record<string, unknown>): void;
}
export interface ToolSpec {
  name: string; title: string; description: string; inputSchema: JsonSchema;
  level: ToolLevel; idempotent: boolean; timeoutMs?: number;
  retry?: { max: number };
  role?: RoleId; media?: boolean; kind?: ApprovalInput['kind'];
  /** 只能由用户在卡片上点击触发（Agent 调用一律拒绝） */
  userOnly?: boolean;
  /** 子任务里禁止使用（对外 / 删除 / 写入类） */
  noSubtask?: boolean;
  estimateCost?(args: Record<string, unknown>): number | null;
  /** L2 工具按参数判断是否真的需要确认（如“覆盖已有数据”才需要）；返回 false 时按 L1 处理（代码硬性项除外） */
  needsConfirm?(args: Record<string, unknown>): Promise<boolean>;
  approvalScope?(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolRunCtx): Promise<ToolOutput>;
}
export const FORBIDDEN_TOOL = /(^|_)(publish|post|comment|reply_send|send_message|dm|like|follow|favorite|collect|push_draft|auto_click)(_|$)/;
/** 只读 / 准备类后缀（publish_check、reply_draft…）不算对外写入。 */
export const SAFE_SUFFIX = /_(check|prepare|draft|status|list|preview)$/;
export class ToolRegistry extends Registry<ToolSpec & { id: string }> {
  constructor() { super('Agent 工具'); }
  add(spec: ToolSpec): ToolSpec {
    if (FORBIDDEN_TOOL.test(spec.name) && !SAFE_SUFFIX.test(spec.name) && !spec.userOnly) throw new Error(`硬边界：不允许注册对外写入工具 ${spec.name}`);
    return this.register({ ...spec, id: spec.name });
  }
  defs(filter: (t: ToolSpec) => boolean = () => true): { type: 'function'; function: { name: string; description: string; parameters: JsonSchema } }[] {
    return this.list().filter((t) => !t.userOnly && filter(t)).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  }
}
