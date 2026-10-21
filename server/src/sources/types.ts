import type { HttpClient, HostRateLimiter } from '../http.js';
import type { SecretVault } from '../crypto.js';
import type { SourceKind } from '../boundaries.js';

export interface RawItem {
  url?: string;
  title: string;
  summary?: string;
  publishedAt?: string;
  extra?: Record<string, unknown>;
}

export type FetchResult =
  | { status: 'ok'; items: RawItem[]; message?: string }
  | { status: 'not_configured'; items: []; message: string; missing: string[] }
  | { status: 'error'; items: []; message: string };

export interface SourceContext {
  http: HttpClient;
  vault: SecretVault;
  limiter: HostRateLimiter;
  proxy?: string;
}

export interface SourceAdapter {
  kind: SourceKind;
  label: string;
  /** 该适配器需要的密钥名（存于密钥库） */
  requiredSecrets: string[];
  /** 配置字段说明（用于前端表单） */
  configFields: { key: string; label: string; placeholder?: string }[];
  fetch(config: Record<string, unknown>, ctx: SourceContext): Promise<FetchResult>;
}

export function missingSecrets(adapter: SourceAdapter, vault: SecretVault): string[] {
  return adapter.requiredSecrets.filter((s) => !vault.has(s));
}

export function notConfigured(missing: string[]): FetchResult {
  return { status: 'not_configured', items: [], message: `未配置：缺少 ${missing.join('、')}`, missing };
}

export function errorResult(e: unknown): FetchResult {
  return { status: 'error', items: [], message: e instanceof Error ? e.message : String(e) };
}
