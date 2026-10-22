import { classifyThrown } from '@content-agent/shared';
import { connectedServer } from './runtime';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly advice = '', public readonly status = 0) {
    super(message);
  }
}

/** 当前模式：设置里填了服务地址并且测试连通 → server；否则 local（默认）。 */
export function apiMode(): 'local' | 'server' { return connectedServer() !== null ? 'server' : 'local'; }

async function serverApi<T>(base: string, path: string, method: string, body: unknown): Promise<T> {
  const token = localStorage.getItem('ca.token') ?? '';
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-access-token': token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const f = classifyThrown(e, { web: false, offline: typeof navigator !== 'undefined' && navigator.onLine === false });
    throw new ApiError('offline', `连不上你的服务器（${f.reason}）`, '检查网络，或到“我的 → 连接服务器”改回本机模式');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; advice?: string } };
  if (!res.ok) throw new ApiError(data.error?.code ?? 'http_' + res.status, data.error?.message ?? `服务器返回 ${res.status}`, data.error?.advice ?? '', res.status);
  return data as T;
}

/**
 * 统一请求（0.6.0）：默认走本机层（IndexedDB + 本机模型直连），连上自己的服务器后走服务端。
 * 失败一律抛 ApiError（白话 message + advice），页面据此显示“原因 + 下一步按钮”。
 */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const base = connectedServer();
  if (base !== null) return serverApi<T>(base, path, method, opts.body);
  const { localApi, LocalError } = await import('./local/router');
  try {
    return (await localApi(path, method, opts.body)) as T;
  } catch (e) {
    if (e instanceof LocalError) throw new ApiError(e.code, e.message, e.advice, e.status);
    const f = e as { reason?: string; advice?: string; kind?: string };
    if (f && typeof f.reason === 'string') throw new ApiError(`model_${f.kind ?? 'error'}`, f.reason, f.advice ?? '');
    throw new ApiError('error', e instanceof Error ? e.message : String(e), '可以到“我的 → 日志”查看详情');
  }
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const mediaUrl = (u: string) => (u.startsWith('/api/') ? (connectedServer() ?? '') + u : u);

/** 只存在本机的数据（例如“看效果”的手动录入），无论是否连接服务器都走本机层。 */
export async function localOnly<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { localApi, LocalError } = await import('./local/router');
  try { return (await localApi(path, method, body)) as T; } catch (e) {
    if (e instanceof LocalError) throw new ApiError(e.code, e.message, e.advice, e.status);
    throw new ApiError('error', e instanceof Error ? e.message : String(e));
  }
}
