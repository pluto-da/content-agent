/**
 * 本机传输层（统一能力层的 Transport 实现）：fetch（Capacitor 下由 CapacitorHttp 原生发出，不受跨域限制；网页受 CORS 限制，失败时白话提示）。
 * 超时 / 取消 / 断网分别标记，runner 据此分类；Key 只出现在请求头。
 * 0.10.0（ROADMAP「0.10」CapacitorHttp multipart / 二进制）：
 * - multipart 两种构造：FormData（网页 / 电脑默认）与 JS 手工拼字节（安卓 App 默认——CapacitorHttp 对 FormData / Blob 的原生转换在部分版本不可靠）；
 *   FormData 发送抛错时自动用 JS 构造重试一次；
 * - 二进制响应：arrayBuffer 读不出、或原生层把二进制当成 Base64 文本返回时，用 JS 识别并解码；空响应白话报错；
 * - trace：每次 multipart / 二进制请求记一条（只记字段名、类型、字节数、返回长度与耗时，不记头部、不记内容），诊断页可看、可导出，供真机验证。
 */
import { TransportError, bytesToBase64, base64ToBytes, type HttpRequest, type HttpResponse, type Transport } from '@content-agent/shared';
import { runtime } from '../runtime';

export const isWeb = (): boolean => runtime() === 'web';
export const online = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

type Part = NonNullable<HttpRequest['multipart']>[number];
export type MultipartMode = 'formdata' | 'js';
export interface TraceEntry { at: string; method: string; host: string; path: string; mode?: MultipartMode | 'retry-js'; fields?: { name: string; kind: 'text' | 'file'; bytes: number; mime?: string }[]; requestBytes?: number; status?: number; responseBytes?: number; responseBase64Len?: number; decodedFrom?: 'binary' | 'base64-text'; ms: number; error?: string }
const TRACE_MAX = 50;
const trace: TraceEntry[] = [];
export const getTransportTrace = (): TraceEntry[] => [...trace];
export const clearTransportTrace = (): void => { trace.length = 0; };
function push(e: TraceEntry) { trace.unshift(e); if (trace.length > TRACE_MAX) trace.length = TRACE_MAX; if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ca:transport-trace')); }

/** 默认 multipart 构造方式：安卓 / iOS App 用 JS 拼字节，网页与电脑用 FormData。可在诊断页切换（localStorage ca.multipartMode）。 */
export function multipartMode(): MultipartMode {
  const o = typeof localStorage !== 'undefined' ? localStorage.getItem('ca.multipartMode') : null;
  if (o === 'js' || o === 'formdata') return o;
  return runtime() === 'capacitor' ? 'js' : 'formdata';
}
const enc = new TextEncoder();
const quote = (s: string) => s.replace(/"/g, '%22').replace(/\r|\n/g, ' ');
/** JS 构造 multipart/form-data 请求体（RFC 7578）：文本字段 UTF-8，文件字段原样字节。 */
export function buildMultipart(parts: Part[], boundary = `----CA${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`): { body: Uint8Array; contentType: string; boundary: string } {
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    if ('value' in p) chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(p.name)}"\r\n\r\n${p.value}\r\n`));
    else {
      chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(p.name)}"; filename="${quote(p.filename ?? 'file')}"\r\nContent-Type: ${p.mime || 'application/octet-stream'}\r\n\r\n`));
      chunks.push(base64ToBytes(p.base64)); chunks.push(enc.encode('\r\n'));
    }
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const n = chunks.reduce((s, c) => s + c.length, 0); const body = new Uint8Array(n); let k = 0;
  for (const c of chunks) { body.set(c, k); k += c.length; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}`, boundary };
}
function formData(parts: Part[]): FormData {
  const fd = new FormData();
  for (const p of parts) {
    if ('value' in p) fd.append(p.name, p.value);
    else { const bytes = base64ToBytes(p.base64); fd.append(p.name, new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: p.mime }), p.filename); }
  }
  return fd;
}
const fieldsOf = (parts: Part[]) => parts.map((p) => ('value' in p ? { name: p.name, kind: 'text' as const, bytes: enc.encode(p.value).length } : { name: p.name, kind: 'file' as const, bytes: Math.floor((p.base64.length * 3) / 4), mime: p.mime }));

const B64_RE = /^[A-Za-z0-9+/\r\n]+={0,2}\s*$/;
/** 原生层把二进制当成 Base64 文本返回时识别出来（只在声明是二进制类型时尝试）。 */
export function decodeBinaryBody(buf: Uint8Array, mime: string | undefined): { bytes: Uint8Array; from: 'binary' | 'base64-text' } {
  const binaryType = !!mime && !/^(text\/|application\/(json|xml))/.test(mime);
  if (binaryType && buf.length >= 16 && buf.length % 4 === 0 && buf.length < 64 * 1024 * 1024) {
    const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 4096)));
    if (B64_RE.test(head) && B64_RE.test(new TextDecoder().decode(buf.subarray(Math.max(0, buf.length - 64))))) {
      try { const d = base64ToBytes(new TextDecoder().decode(buf).replace(/\s+/g, '')); if (d.length) return { bytes: d, from: 'base64-text' }; } catch { /* 不是 Base64，按原样 */ }
    }
  }
  return { bytes: buf, from: 'binary' };
}

/** 白话失败原因（runner 会再按 flags 分类；这里给出“为什么 + 下一步”）。 */
export function plainTransportMessage(raw: string, o: { multipart?: boolean; binary?: boolean; web: boolean }): string {
  if (o.web && /fetch|network|cors|load failed/i.test(raw)) return '网页版被浏览器的跨域限制拦下了（这家服务不允许网页直接调用）。用安卓 / 电脑 App 就没有这个限制';
  if (o.multipart) return `上传文件的请求没有发出去（${raw}）。已自动换另一种打包方式重试过；请检查网络，或换一张小一点的图片 / 短一点的音频再试`;
  if (o.binary) return `下载生成结果时出错（${raw}）。结果链接可能已失效，请重新生成一次`;
  return raw;
}

async function once(req: HttpRequest, o: { signal?: AbortSignal; timeoutMs: number }, mode: MultipartMode | null): Promise<{ res: HttpResponse; reqBytes?: number; decodedFrom?: 'binary' | 'base64-text'; rawLen?: number }> {
  const ac = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeoutMs);
  const onAbort = () => ac.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let body: BodyInit | undefined = req.body;
    const headers = { ...req.headers };
    let reqBytes: number | undefined;
    if (req.multipart && mode === 'formdata') { body = formData(req.multipart); delete headers['content-type']; delete headers['Content-Type']; }
    if (req.multipart && mode === 'js') { const m = buildMultipart(req.multipart); body = m.body.buffer.slice(m.body.byteOffset, m.body.byteOffset + m.body.byteLength) as ArrayBuffer; delete headers['Content-Type']; headers['content-type'] = m.contentType; reqBytes = m.body.length; }
    const res = await fetch(req.url, { method: req.method, headers, body, signal: ac.signal });
    const h: Record<string, string> = {}; res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    if (req.responseType === 'binary' && res.ok) {
      const mime = h['content-type']?.split(';')[0];
      const raw = new Uint8Array(await res.arrayBuffer());
      const d = decodeBinaryBody(raw, mime);
      if (!d.bytes.length) throw new TransportError('服务商返回了空文件');
      return { res: { status: res.status, headers: h, base64: bytesToBase64(d.bytes), mime }, reqBytes, decodedFrom: d.from, rawLen: d.bytes.length };
    }
    return { res: { status: res.status, headers: h, text: await res.text() }, reqBytes };
  } catch (e) {
    if (o.signal?.aborted) throw new TransportError('已停止', { aborted: true });
    if (timedOut) throw new TransportError('超时', { timedOut: true });
    if (e instanceof TransportError) throw e;
    throw new TransportError(String((e as Error)?.message ?? e), { offline: !online() });
  } finally {
    clearTimeout(t);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

export const webTransport: Transport = {
  async send(req: HttpRequest, o): Promise<HttpResponse> {
    if (req.url.startsWith('mock://')) return { status: 200, text: '{}' };
    const traced = !!req.multipart || req.responseType === 'binary';
    const t0 = Date.now();
    let u: URL | null = null; try { u = new URL(req.url); } catch { /* 相对地址 */ }
    const base: TraceEntry = { at: new Date().toISOString(), method: req.method, host: u?.host ?? '', path: u?.pathname ?? req.url, ms: 0, ...(req.multipart ? { fields: fieldsOf(req.multipart) } : {}) };
    const mode = req.multipart ? multipartMode() : null;
    try {
      let r: Awaited<ReturnType<typeof once>>;
      let used: TraceEntry['mode'] = mode ?? undefined;
      try { r = await once(req, o, mode); }
      catch (e) {
        const te = e as TransportError;
        if (mode !== 'formdata' || te.flags?.aborted || te.flags?.timedOut || te.flags?.offline) throw e;
        used = 'retry-js';
        r = await once(req, o, 'js');   // FormData 失败 → JS 构造重试一次
      }
      if (traced) push({ ...base, mode: used, requestBytes: r.reqBytes, status: r.res.status, responseBytes: r.rawLen ?? r.res.text?.length, responseBase64Len: r.res.base64?.length, decodedFrom: r.decodedFrom, ms: Date.now() - t0 });
      return r.res;
    } catch (e) {
      const te = e as TransportError;
      if (traced) push({ ...base, mode: mode ?? undefined, ms: Date.now() - t0, error: te.message });
      if (te.flags?.aborted || te.flags?.timedOut) throw e;
      throw new TransportError(plainTransportMessage(te.message, { multipart: !!req.multipart, binary: req.responseType === 'binary', web: isWeb() }), te.flags ?? {});
    }
  },
};

/** 诊断页“传输自检”（用户点击才运行）：向回显服务发一个 multipart（含 1 KB 二进制文件）并下载一张小图，记录 trace。不带任何 Key。 */
export async function transportSelfTest(echoBase = 'https://httpbin.org'): Promise<{ multipart: { ok: boolean; detail: string }; binary: { ok: boolean; detail: string } }> {
  const file = new Uint8Array(1024).map((_, i) => i % 256);
  const out = { multipart: { ok: false, detail: '' }, binary: { ok: false, detail: '' } };
  try {
    const r = await webTransport.send({ method: 'POST', url: `${echoBase}/anything`, headers: {}, responseType: 'json', multipart: [{ name: 'model', value: '自检-model' }, { name: 'file', filename: 'probe.bin', mime: 'application/octet-stream', base64: bytesToBase64(file) }] }, { timeoutMs: 20000 });
    const j = JSON.parse(r.text ?? '{}') as { form?: Record<string, string>; files?: Record<string, string>; headers?: Record<string, string> };
    const fileOk = typeof j.files?.file === 'string' && j.files.file.length > 0;
    out.multipart = { ok: r.status === 200 && j.form?.model === '自检-model' && fileOk, detail: `HTTP ${r.status}；回显字段 model=${j.form?.model ?? '无'}；文件 ${fileOk ? '已收到' : '未收到'}；Content-Type ${(j.headers?.['Content-Type'] ?? '').split(';')[0]}` };
  } catch (e) { out.multipart.detail = (e as Error).message; }
  try {
    const r = await webTransport.send({ method: 'GET', url: `${echoBase}/image/png`, headers: {}, responseType: 'binary' }, { timeoutMs: 20000 });
    const b = base64ToBytes(r.base64 ?? '');
    out.binary = { ok: r.status === 200 && b[0] === 0x89 && b[1] === 0x50, detail: `HTTP ${r.status}；返回 ${b.length} 字节（Base64 ${r.base64?.length ?? 0} 字符）；${b[0] === 0x89 ? 'PNG 文件头正确' : '文件头不对'}` };
  } catch (e) { out.binary.detail = (e as Error).message; }
  return out;
}
