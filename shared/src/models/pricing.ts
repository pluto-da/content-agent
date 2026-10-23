/** 用量与费用（5.4）：单价单位按角色；内置价只写已核实的（MiMo 文本 0.4.1 起实跑核对），其余为空并显示“单价未知，费用不估算”。单位：元。 */
import type { Price } from './config.js';
import type { Usage } from './adapters/types.js';
import type { RoleId } from './roles.js';

/** key = `${vendor}:${model}`；token 价为“元 / 百万 token”。 */
export const BUILTIN_PRICES: Record<string, Price> = {
  'mimo:mimo-v2.6-flash': { unit: 'token', input: 1, output: 2, cachedInput: 0.1 },
  'mimo:mimo-v2.6-pro': { unit: 'token', input: 3, output: 6, cachedInput: 0.3 },
  // 0.11.0（2026-10-23 核实 mimo.mi.com/docs/zh-CN/price/pay-as-you-go）：TTS 系列限时免费；ASR ¥0.5 / 小时（按输入音频时长，精确到秒）
  'mimo:mimo-v2.5-tts': { unit: 'char', per: 0 },
  'mimo:mimo-v2.5-asr': { unit: 'second', per: 0.5 / 3600 },
  'mock:*': { unit: 'call', per: 0 },
};
export function priceOf(vendor: string, model: string, user: Record<string, Price> = {}): Price | undefined {
  return user[`${vendor}:${model}`] ?? BUILTIN_PRICES[`${vendor}:${model}`] ?? BUILTIN_PRICES[`${vendor}:*`];
}
/** 返回 null = 单价未知（不估算）。 */
export function costOf(price: Price | undefined, u: Usage): number | null {
  if (!price) return null;
  switch (price.unit) {
    case 'token': {
      const cached = u.cached ?? 0;
      const inp = Math.max(0, (u.input ?? 0) - cached);
      return round(((inp * (price.input ?? 0)) + cached * (price.cachedInput ?? price.input ?? 0) + (u.output ?? 0) * (price.output ?? 0)) / 1e6);
    }
    case 'image': return round((u.images ?? 1) * (price.per ?? 0));
    case 'second': return round((u.seconds ?? 0) * (price.per ?? 0));
    case 'minute': return round(((u.seconds ?? 0) / 60) * (price.per ?? 0));
    case 'char': return round(((u.chars ?? 0) / 1000) * (price.per ?? 0));
    case 'call': return round((u.calls ?? 1) * (price.per ?? 0));
  }
}
/** 调用前估算（审批用）：文本类按输入长度粗估；媒体类按张数 / 秒数；单价未知返回 null。 */
export function estimateCost(role: RoleId, price: Price | undefined, est: { chars?: number; images?: number; seconds?: number; outTokens?: number }): number | null {
  if (!price) return null;
  if (price.unit === 'token') return costOf(price, { input: Math.ceil((est.chars ?? 0) * 1.2), output: est.outTokens ?? (role === 'fast' ? 200 : 1500) });
  return costOf(price, { images: est.images, seconds: est.seconds, chars: est.chars, calls: 1 });
}
const round = (x: number) => Math.round(x * 1e6) / 1e6;
export const fmtYuan = (x: number | null | undefined): string => (x === null || x === undefined ? '单价未知' : x < 0.01 ? `¥${x.toFixed(4)}` : `¥${x.toFixed(2)}`);
