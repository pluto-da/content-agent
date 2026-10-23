/**
 * 能力声明（5.3）：界面与 Agent 只看声明不看厂商名。三层来源：内置（适配器 declare）→ 探测/列表（provider）→ 用户手动（user，最高）。
 * verified：live 真实跑通 / doc 按文档实现 / unverified 未核实 —— 不得把 doc 写成 live。
 */
import type { RoleId } from './roles.js';
import type { JsonSchema } from '../schema.js';

export interface CapabilityDecl {
  role: RoleId; vendor: string; model: string;
  stream?: boolean; tools?: 'native' | 'json' | 'none'; imageInput?: boolean; audioInput?: boolean;
  thinking?: 'none' | 'toggle' | 'always'; jsonMode?: 'json_schema' | 'json_object' | 'none';
  contextWindow?: number; maxOutput?: number;
  sizes?: string[]; aspectRatios?: string[]; maxImages?: number; editMaxInputs?: number; mask?: boolean;
  voices?: { id: string; label: string }[]; audioFormats?: string[]; maxChars?: number;
  maxAudioSeconds?: number; maxAudioBytes?: number; timestamps?: boolean;
  durations?: number[]; async?: boolean; resultTTLHours?: number;
  dims?: number[]; maxDocs?: number;
  priceUnit: 'token' | 'image' | 'second' | 'char' | 'minute' | 'call';
  verified: 'live' | 'doc' | 'unverified';
}
export const VERIFIED_LABEL: Record<CapabilityDecl['verified'], string> = { live: '已实测', doc: '按文档接入', unverified: '未核实' };
/** 保守默认（声明留空时大小守卫用；界面提示“未填写上限，按保守值处理”）。 */
export const CONSERVATIVE: Required<Pick<CapabilityDecl, 'maxChars' | 'maxAudioSeconds' | 'maxAudioBytes' | 'maxImages' | 'editMaxInputs' | 'maxDocs' | 'contextWindow'>> = {
  maxChars: 500, maxAudioSeconds: 60, maxAudioBytes: 5 * 1024 * 1024, maxImages: 1, editMaxInputs: 1, maxDocs: 20, contextWindow: 32000,
};
const PRICE_UNIT: Record<RoleId, CapabilityDecl['priceUnit']> = { chat: 'token', reason: 'token', fast: 'token', vision: 'token', image: 'image', imageEdit: 'image', tts: 'char', asr: 'second', video: 'second', embed: 'token', rerank: 'call' };

export function mergeDecl(role: RoleId, vendor: string, model: string, ...layers: (Partial<CapabilityDecl> | undefined)[]): CapabilityDecl {
  const out: CapabilityDecl = { role, vendor, model, priceUnit: PRICE_UNIT[role], verified: 'unverified' };
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) (out as any)[k] = v;
  return { ...out, role, vendor, model };
}

/** 大小守卫（5.9）：上传前检查，超出时返回白话 + 建议（切分 / 压缩），不把必然失败的请求发出去。 */
export function guardInput(decl: CapabilityDecl, input: { chars?: number; audioSeconds?: number; audioBytes?: number; images?: number; editInputs?: number; docs?: number }): { ok: true; conservative: boolean } | { ok: false; kind: 'text_too_long' | 'audio_too_long' | 'size_unsupported'; reason: string; advice: string } {
  let conservative = false;
  const lim = <K extends keyof typeof CONSERVATIVE>(k: K): number => { const v = (decl as any)[k] as number | undefined; if (v === undefined) { conservative = true; return CONSERVATIVE[k]; } return v; };
  if (input.chars !== undefined && (decl.role === 'tts') && input.chars > lim('maxChars')) return { ok: false, kind: 'text_too_long', reason: `文字 ${input.chars} 字，超过单次上限 ${lim('maxChars')} 字`, advice: '自动分段合成' };
  if (input.audioSeconds !== undefined && input.audioSeconds > lim('maxAudioSeconds')) return { ok: false, kind: 'audio_too_long', reason: `音频 ${Math.round(input.audioSeconds)} 秒，超过上限 ${lim('maxAudioSeconds')} 秒`, advice: '先切分成几段再转写' };
  if (input.audioBytes !== undefined && input.audioBytes > lim('maxAudioBytes')) return { ok: false, kind: 'audio_too_long', reason: `音频 ${(input.audioBytes / 1048576).toFixed(1)}MB，超过上限 ${(lim('maxAudioBytes') / 1048576).toFixed(0)}MB`, advice: '压缩或切分后再试' };
  if (input.images !== undefined && input.images > lim('maxImages')) return { ok: false, kind: 'size_unsupported', reason: `一次最多 ${lim('maxImages')} 张`, advice: '减少张数或分几次出' };
  if (input.editInputs !== undefined && input.editInputs > lim('editMaxInputs')) return { ok: false, kind: 'size_unsupported', reason: `最多 ${lim('editMaxInputs')} 张参考图`, advice: '减少参考图' };
  if (input.docs !== undefined && input.docs > lim('maxDocs')) return { ok: false, kind: 'size_unsupported', reason: `单次最多 ${lim('maxDocs')} 条候选`, advice: '先粗筛再重排' };
  return { ok: true, conservative };
}

/** 5.3：Agent 工具参数 Schema 由声明动态收窄（如 aspect 的 enum 只剩该模型支持的比例）。未声明时不限制枚举。 */
export function narrowToolSchema(base: JsonSchema, decl: CapabilityDecl | undefined): JsonSchema {
  const s = structuredClone(base) as any;
  const props = s.properties ?? {};
  if (decl?.aspectRatios?.length && props.aspect) props.aspect.enum = [...decl.aspectRatios];
  if (decl?.sizes?.length && props.size) props.size.enum = [...decl.sizes];
  if (decl?.maxImages && props.n) props.n.maximum = Math.min(props.n.maximum ?? 4, decl.maxImages);
  if (decl?.durations?.length && props.duration) props.duration.enum = [...decl.durations];
  if (decl?.voices?.length && props.voice) props.voice.enum = decl.voices.map((v) => v.id);
  if (decl?.editMaxInputs && props.images) props.images.maxItems = Math.min(props.images.maxItems ?? 3, decl.editMaxInputs);
  return s;
}
