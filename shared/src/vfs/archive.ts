/**
 * 导出 / 导入（8.6、C36、企业级“一键备份 / 恢复”）：
 * - zip（store，无压缩，纯 JS，跨端一致）：VFS 文件按目录树 + manifest.json（schemaVersion、导出时间、文件清单与 hash）；
 * - 默认排除 .local/、.cache/、runtime.lock、assets 二进制（可勾选包含）、记忆（可勾选排除）；
 * - 导出前后都用密钥规则扫描，命中即阻止（密钥本来就不在 VFS，这是第二道保险）；
 * - 导入：校验 manifest 与 hash → 预览差异 → 冲突逐个选择（保留本机 / 用导入 / 两者都留）→ 调用方先做本机快照。
 */
import { sha256 } from '../core/hash.js';
import { utf8 } from '../core/hash.js';
import { findSecrets } from '../core/redact.js';

export interface ZipEntry { path: string; data: Uint8Array }
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(d: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]!) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const e of entries) {
    const name = utf8(e.path); const crc = crc32(e.data);
    const h = new Uint8Array(30 + name.length); const dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, e.data.length, true); dv.setUint32(22, e.data.length, true); dv.setUint16(26, name.length, true);
    h.set(name, 30); chunks.push(h, e.data);
    const c = new Uint8Array(46 + name.length); const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, e.data.length, true); cv.setUint32(24, e.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    c.set(name, 46); central.push(c);
    offset += h.length + e.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end]; const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0)); let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
export function unzip(data: Uint8Array): ZipEntry[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1; for (let i = data.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目录损坏');
    const method = dv.getUint16(p + 10, true); const size = dv.getUint32(p + 20, true); const nlen = dv.getUint16(p + 28, true); const xlen = dv.getUint16(p + 30, true); const clen = dv.getUint16(p + 32, true); const off = dv.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nlen));
    if (method !== 0) throw new Error(`不支持压缩的 zip 条目：${name}（请用本 App 导出的备份）`);
    const lnlen = dv.getUint16(off + 26, true), lxlen = dv.getUint16(off + 28, true);
    const start = off + 30 + lnlen + lxlen;
    out.push({ path: name, data: data.slice(start, start + size) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export interface ManifestFile { path: string; sha256: string; bytes: number }
export interface Manifest { schemaVersion: 3; app: string; appVersion: string; exportedAt: string; files: ManifestFile[]; includes: { media: boolean; memory: boolean }; kind: 'vfs' | 'backup' }
export interface ExportOpts { includeMedia?: boolean; includeMemory?: boolean; appVersion: string; extra?: Record<string, string>; now?: Date }
export const EXCLUDED = (p: string) => p.startsWith('.local/') || p.startsWith('.cache/') || p === 'runtime.lock' || p.startsWith('exports/') && !p.endsWith('EXPORTS.md');
const isMemory = (p: string) => p.startsWith('memory/') && !/\/[A-Z-]+\.md$/.test(p) || p === 'MEMORY.md';
const isMediaBinary = (p: string) => /^assets\/(images|audio|video)\//.test(p);

export class ExportBlocked extends Error { constructor(public hits: { path: string; name: string }[]) { super(`导出已阻止：发现疑似密钥（${hits.map((h) => h.path).join('、')}）`); this.name = 'ExportBlocked'; } }

export function buildExport(files: { path: string; content: string }[], o: ExportOpts): { zip: Uint8Array; manifest: Manifest } {
  const chosen = files.filter((f) => !EXCLUDED(f.path) && (o.includeMedia || !isMediaBinary(f.path)) && (o.includeMemory !== false || !isMemory(f.path)));
  const hits: { path: string; name: string }[] = [];
  for (const f of chosen) for (const h of findSecrets(f.content)) hits.push({ path: f.path, name: h.name });
  for (const [p, c] of Object.entries(o.extra ?? {})) for (const h of findSecrets(c)) hits.push({ path: p, name: h.name });
  if (hits.length) throw new ExportBlocked(hits);
  const entries: ZipEntry[] = chosen.map((f) => ({ path: f.path, data: utf8(f.content) }));
  for (const [p, c] of Object.entries(o.extra ?? {})) entries.push({ path: p, data: utf8(c) });
  const manifest: Manifest = { schemaVersion: 3, app: 'content-agent', appVersion: o.appVersion, exportedAt: (o.now ?? new Date()).toISOString(), files: entries.map((e) => ({ path: e.path, sha256: sha256(e.data), bytes: e.data.length })), includes: { media: !!o.includeMedia, memory: o.includeMemory !== false }, kind: o.extra ? 'backup' : 'vfs' };
  entries.unshift({ path: 'manifest.json', data: utf8(JSON.stringify(manifest, null, 1)) });
  const z = zip(entries);
  // 第二道保险：对最终 zip 再扫一遍
  const again = findSecrets(new TextDecoder().decode(z));
  if (again.length) throw new ExportBlocked(again.map((h) => ({ path: 'zip', name: h.name })));
  return { zip: z, manifest };
}
export type ImportChoice = 'local' | 'incoming' | 'both';
export interface ImportPlanItem { path: string; status: 'new' | 'same' | 'conflict'; incoming: string; local?: string }
export function readImport(data: Uint8Array): { manifest: Manifest; files: Map<string, string>; errors: string[] } {
  const entries = unzip(data);
  const dec = new TextDecoder();
  const m = entries.find((e) => e.path === 'manifest.json');
  if (!m) throw new Error('备份里没有 manifest.json');
  const manifest = JSON.parse(dec.decode(m.data)) as Manifest;
  const errors: string[] = [];
  if (manifest.schemaVersion > 3) errors.push(`备份来自更新版本（schemaVersion ${manifest.schemaVersion}），请先升级 App`);
  const files = new Map<string, string>();
  for (const e of entries) {
    if (e.path === 'manifest.json') continue;
    const mf = manifest.files.find((x) => x.path === e.path);
    if (!mf) { errors.push(`清单里没有 ${e.path}`); continue; }
    if (mf.sha256 !== sha256(e.data)) { errors.push(`${e.path} 校验失败（文件被改过或损坏）`); continue; }
    files.set(e.path, dec.decode(e.data));
  }
  for (const f of manifest.files) if (!files.has(f.path) && !errors.some((x) => x.includes(f.path))) errors.push(`缺少文件 ${f.path}`);
  return { manifest, files, errors };
}
export function planImport(incoming: Map<string, string>, local: Map<string, string>): ImportPlanItem[] {
  return [...incoming].map(([path, content]) => { const l = local.get(path); return { path, incoming: content, local: l, status: l === undefined ? 'new' : l === content ? 'same' : 'conflict' }; });
}
