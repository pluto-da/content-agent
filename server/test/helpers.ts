import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpClient, HttpOptions, HttpResponse } from '../src/http.js';

export function tmp(prefix = 'ca-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export type Route = (url: string, opts: HttpOptions) => Partial<HttpResponse> & { status?: number; text?: string } | undefined;

/** 可编程的假 HTTP 客户端，记录所有请求。 */
export function fakeHttp(routes: Route[]): HttpClient & { calls: { url: string; opts: HttpOptions }[] } {
  const calls: { url: string; opts: HttpOptions }[] = [];
  const fn = (async (url: string, opts: HttpOptions = {}) => {
    calls.push({ url, opts });
    for (const r of routes) {
      const res = r(url, opts);
      if (res) {
        const text = res.text ?? (res.body ? res.body.toString('utf8') : '');
        return { status: res.status ?? 200, text, body: res.body ?? Buffer.from(text), headers: res.headers ?? {} };
      }
    }
    return { status: 404, text: 'not found', body: Buffer.from('not found'), headers: {} };
  }) as HttpClient & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

export const AGENT_DEFAULTS = join(import.meta.dirname, '..', '..', 'agent');
