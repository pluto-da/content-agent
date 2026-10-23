/**
 * 本机传输层（统一能力层的 Transport 实现）：fetch（Capacitor 下由 CapacitorHttp 原生发出，不受跨域限制；网页受 CORS 限制，失败时白话提示）。
 * 超时 / 取消 / 断网分别标记，runner 据此分类；二进制响应转 Base64；multipart 用 FormData。Key 只出现在请求头。
 */
import { TransportError, bytesToBase64, base64ToBytes, type HttpRequest, type HttpResponse, type Transport } from '@content-agent/shared';
import { runtime } from '../runtime';

export const isWeb = (): boolean => runtime() === 'web';
export const online = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export const webTransport: Transport = {
  async send(req: HttpRequest, o): Promise<HttpResponse> {
    if (req.url.startsWith('mock://')) return { status: 200, text: '{}' };
    const ac = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeoutMs);
    const onAbort = () => ac.abort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let body: BodyInit | undefined = req.body;
      const headers = { ...req.headers };
      if (req.multipart) {
        const fd = new FormData();
        for (const p of req.multipart) {
          if ('value' in p) fd.append(p.name, p.value);
          else { const bytes = base64ToBytes(p.base64); fd.append(p.name, new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: p.mime }), p.filename); }
        }
        body = fd;
        delete headers['content-type'];
      }
      const res = await fetch(req.url, { method: req.method, headers, body, signal: ac.signal });
      const h: Record<string, string> = {}; res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
      if (req.responseType === 'binary' && res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, headers: h, base64: bytesToBase64(buf), mime: h['content-type']?.split(';')[0] };
      }
      return { status: res.status, headers: h, text: await res.text() };
    } catch (e) {
      if (o.signal?.aborted) throw new TransportError('已停止', { aborted: true });
      if (timedOut) throw new TransportError('超时', { timedOut: true });
      throw new TransportError(String((e as Error)?.message ?? e), { offline: !online() });
    } finally {
      clearTimeout(t);
      o.signal?.removeEventListener('abort', onAbort);
    }
  },
};
