/**
 * 安卓原生流式 HTTP（0.8.0）：CapacitorHttp 会把流式响应缓冲到结束才交给页面（capacitor issue #7890），
 * 所以模型请求在 App 里改走自写插件 StreamHttp（HttpURLConnection 分块读取，事件 response / chunk / end / error，可取消）。
 * 其余请求继续走 CapacitorHttp。插件不可用时返回 null，由调用方降级为一次性请求（不伪造逐字效果）。
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { appOs, runtime } from '../runtime';

interface StreamHttpPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  request(o: { id: string; url: string; method: string; headers: Record<string, string>; body: string; timeoutMs: number }): Promise<void>;
  cancel(o: { id: string }): Promise<void>;
  addListener(ev: 'response', fn: (e: { id: string; status: number }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'chunk', fn: (e: { id: string; data: string }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'end', fn: (e: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'error', fn: (e: { id: string; message: string; timeout?: boolean }) => void): Promise<PluginListenerHandle>;
}
export const StreamHttp = registerPlugin<StreamHttpPlugin>('StreamHttp');

let avail: Promise<boolean> | null = null;
export function nativeStreamAvailable(): Promise<boolean> {
  if (runtime() !== 'capacitor' || appOs() !== 'android') return Promise.resolve(false);
  return (avail ??= StreamHttp.isAvailable().then((r) => !!r.available).catch(() => false));
}

export interface NativeStreamResult { status: number; text: string }

/** 发起原生流式请求；onChunk 收到原始文本块。返回最终状态码与（错误时的）全文。 */
export async function nativeStream(url: string, init: { method: string; headers: Record<string, string>; body: string }, onChunk: (t: string) => void, signal?: AbortSignal, timeoutMs = 180000): Promise<NativeStreamResult> {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const handles: PluginListenerHandle[] = [];
  let status = 0;
  let errText = '';
  try {
    return await new Promise<NativeStreamResult>((resolve, reject) => {
      const add = async () => {
        handles.push(await StreamHttp.addListener('response', (e) => { if (e.id === id) status = e.status; }));
        handles.push(await StreamHttp.addListener('chunk', (e) => { if (e.id !== id) return; if (status >= 400) errText += e.data; else onChunk(e.data); }));
        handles.push(await StreamHttp.addListener('end', (e) => { if (e.id === id) resolve({ status, text: errText }); }));
        handles.push(await StreamHttp.addListener('error', (e) => { if (e.id === id) reject(Object.assign(new Error(e.message), { timeout: !!e.timeout })); }));
      };
      signal?.addEventListener('abort', () => { void StreamHttp.cancel({ id }); reject(new DOMException('已停止', 'AbortError')); });
      void add().then(() => StreamHttp.request({ id, url, ...init, timeoutMs })).catch(reject);
    });
  } finally {
    for (const h of handles) void h.remove();
  }
}
