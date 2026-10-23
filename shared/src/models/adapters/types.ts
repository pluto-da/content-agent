/**
 * 适配器契约（5.4，ADR-002）：Adapter = { vendor, roles, declare, build, parse, classify, listModels?, poll? }。
 * build / parse / classify 是纯函数：输入统一请求 → HttpRequest；HttpResponse → 统一结果。传输（fetch / CapacitorHttp / 原生流）由 Transport 注入。
 * 新增一家服务商：在 adapters/ 新建一个文件实现本接口，并在 adapters/index.ts 的列表里加一行；核心（runner、路由、界面）不改。
 */
import type { CapabilityDecl } from '../decl.js';
import type { CallError } from '../errors.js';
import type { ProviderAccount, RoleTarget } from '../config.js';
import type { RoleId } from '../roles.js';

export type Part = { name: string; value: string } | { name: string; filename: string; mime: string; base64: string };
export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE'; url: string; headers: Record<string, string>;
  body?: string; multipart?: Part[];
  responseType: 'json' | 'text' | 'binary' | 'sse';
}
export interface HttpResponse { status: number; headers?: Record<string, string>; text?: string; base64?: string; mime?: string }

export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | ContentPart[]; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string; reasoning_content?: string }
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'input_audio'; input_audio: { data: string; format: string } };

export type RoleRequest =
  | { role: 'chat' | 'reason' | 'fast'; messages: ChatMessage[]; tools?: unknown[]; stream?: boolean; maxTokens?: number; thinking?: boolean; temperature?: number; json?: boolean }
  | { role: 'vision'; image: string /* data URL 或 https */; question: string; maxTokens?: number }
  | { role: 'image'; prompt: string; size?: string; aspect?: string; n?: number; negative?: string; seed?: number; style?: string }
  | { role: 'imageEdit'; images: string[]; instruction: string; mask?: string; size?: string }
  | { role: 'tts'; text: string; voice?: string; speed?: number; style?: string; format?: string }
  | { role: 'asr'; audio: { base64: string; format: string; mime: string }; language?: string; timestamps?: boolean }
  | { role: 'video'; prompt: string; firstFrame?: string; duration?: number; aspect?: string }
  | { role: 'embed'; input: string[]; dims?: number }
  | { role: 'rerank'; query: string; documents: string[]; topK?: number };

export interface Usage { input?: number; output?: number; cached?: number; reasoning?: number; images?: number; seconds?: number; chars?: number; calls?: number }
export interface MediaOut { url?: string; base64?: string; mime: string; width?: number; height?: number; durationMs?: number; ttlHours?: number }
export type RoleValue =
  | { type: 'text'; text: string; reasoning?: string; toolCalls?: { id: string; name: string; arguments: string }[]; finishReason?: string }
  | { type: 'media'; items: MediaOut[] }
  | { type: 'transcript'; text: string; segments?: { start: number; end: number; text: string }[] }
  | { type: 'job'; jobId: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; items?: MediaOut[]; error?: string }
  | { type: 'vectors'; vectors: number[][]; dims: number }
  | { type: 'ranking'; results: { index: number; score: number }[] };
export interface Parsed { value: RoleValue; usage: Usage; respondedModel?: string; warnings?: string[] }

export interface AdapterCtx {
  account: ProviderAccount; target: RoleTarget; apiKey: string; baseURL: string;
  /** 运行时探测到的方言（工具模式等） */
  options?: Record<string, unknown>;
}
export interface ListedModel { id: string; ownedBy?: string; contextLength?: number; caps?: Partial<Record<RoleId, boolean>> & { imageIn?: boolean; reasoning?: boolean } }

export interface Adapter {
  id: string;                              // vendor id（registry 主键）
  label: string;
  roles: RoleId[];
  defaultBaseURL: string;
  baseURLPresets?: { label: string; url: string }[];
  nativeBaseURL?: string;
  keyRequired: boolean;
  region: ProviderAccount['region'];
  docs?: string;
  /** 内置能力声明（refs-v9 核实；没核实的字段不写） */
  declare(role: RoleId, model: string): Partial<CapabilityDecl>;
  build(req: RoleRequest, ctx: AdapterCtx): HttpRequest;
  parse(req: RoleRequest, res: HttpResponse, ctx: AdapterCtx): Parsed;
  classify?(status: number, body: string, ctx: AdapterCtx & { role: RoleId }): CallError | null;
  listModels?: { build(ctx: Omit<AdapterCtx, 'target'>): HttpRequest; parse(res: HttpResponse): ListedModel[] };
  /** 不走 HTTP 的本机实现（Mock）；抛出带 status/body 的错误时按 classify 分类 */
  local?(req: RoleRequest, ctx: AdapterCtx): Parsed;
  poll?: { build(jobId: string, ctx: AdapterCtx): HttpRequest; parse(res: HttpResponse, ctx: AdapterCtx): Parsed; cancel?(jobId: string, ctx: AdapterCtx): HttpRequest };
}

export class ParseError extends Error { constructor(msg: string) { super(msg); this.name = 'ParseError'; } }
export const trimURL = (u: string): string => u.trim().replace(/\/+$/, '');
export function json(res: HttpResponse): any {
  try { return JSON.parse(res.text ?? ''); } catch { throw new ParseError('返回的不是 JSON'); }
}
export const bearer = (k: string): Record<string, string> => (k ? { authorization: `Bearer ${k}` } : {});
