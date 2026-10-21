import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { isIP } from 'node:net';

export const USER_AGENT = 'ContentAgent/0.1 (+self-hosted; respects robots.txt)';

export interface HttpOptions {
  proxy?: string;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string | Buffer | FormData;
}

export interface HttpResponse {
  status: number;
  text: string;
  body: Buffer;
  headers: Record<string, string>;
}

export type HttpClient = (url: string, opts?: HttpOptions) => Promise<HttpResponse>;

const agents = new Map<string, Dispatcher>();
function proxyAgent(proxy: string): Dispatcher {
  let a = agents.get(proxy);
  if (!a) {
    a = new ProxyAgent(proxy);
    agents.set(proxy, a);
  }
  return a;
}

/** 拒绝内网、回环、链路本地等地址，防止被用来探测内网。 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127))
      return false;
  }
  if (isIP(host) === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
  }
  return true;
}

export const defaultHttp: HttpClient = async (url, opts = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await undiciFetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': USER_AGENT, ...(opts.headers ?? {}) },
      body: opts.body as never,
      signal: controller.signal,
      dispatcher: opts.proxy ? proxyAgent(opts.proxy) : undefined,
      redirect: 'follow',
    });
    const max = opts.maxBytes ?? 5 * 1024 * 1024;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error(`响应过大（${buf.length} 字节）`);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, text: buf.toString('utf8'), body: buf, headers };
  } finally {
    clearTimeout(timer);
  }
};

/** 每个域名的最小请求间隔限速器。 */
export class HostRateLimiter {
  private last = new Map<string, number>();
  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}
  async wait(url: string): Promise<number> {
    const host = new URL(url).host;
    const prev = this.last.get(host);
    let waited = 0;
    if (prev !== undefined) {
      const delta = this.now() - prev;
      if (delta < this.minIntervalMs) {
        waited = this.minIntervalMs - delta;
        await this.sleep(waited);
      }
    }
    this.last.set(host, this.now());
    return waited;
  }
}
