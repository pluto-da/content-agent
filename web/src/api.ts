import { serverBase } from './runtime';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly advice = '', public readonly status = 0) {
    super(message);
  }
}

/** 统一请求：带访问口令、统一错误格式、离线标记。 */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = localStorage.getItem('ca.token') ?? '';
  let res: Response;
  try {
    res = await fetch(serverBase() + path, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-access-token': token } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('offline', '无法连接服务（离线或服务地址错误）', '检查网络或在设置中填写服务地址');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; advice?: string } };
  if (!res.ok) throw new ApiError(data.error?.code ?? 'http_' + res.status, data.error?.message ?? `请求失败（${res.status}）`, data.error?.advice ?? '', res.status);
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const mediaUrl = (u: string) => (u.startsWith('/api/') ? serverBase() + u : u);
