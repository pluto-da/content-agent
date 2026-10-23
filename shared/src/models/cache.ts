/** 缓存键（5.4）：SHA-256(role + vendor + model + 规范化请求体)，不含 Key。规则：文本只缓存 temperature=0 或 fast；embed 永久；生图 / 配音默认不缓存。 */
import { sha256 } from '../core/hash.js';
import { stableStringify } from '../schema.js';
import type { RoleRequest } from './adapters/types.js';
import type { RoleId } from './roles.js';
export function cacheKey(role: RoleId, vendor: string, model: string, req: RoleRequest): string {
  return sha256(`${role}\n${vendor}\n${model}\n${stableStringify({ ...req, stream: undefined })}`);
}
export function cacheable(req: RoleRequest): boolean {
  if (req.role === 'embed') return true;
  if (req.role === 'fast') return !req.tools?.length;
  if (req.role === 'chat') return req.temperature === 0 && !req.tools?.length && !req.stream;
  return false;
}
