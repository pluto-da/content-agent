/**
 * AIGC 隐式标识（0.10.0，ROADMAP「0.10」，ADR-012）：纯 TS 改写文件元数据，不引第三方库、不重编码。
 * - JPEG：EXIF UserComment（UNICODE）+ XMP（dc:description 与自定义 AIGC 命名空间）；原有 EXIF / XMP 全部保留（追加新 IFD 并改指针，旧数据原样不动）；
 * - MP3：ID3v2.4（或沿用原有 v2.3）TXXX:AIGC；WAV：LIST/INFO ICMT；可选开头 0.5 秒提示音（只对 16 位 PCM WAV，默认关）；
 * - MP4：moov/udta/©cmt 与 udta/meta/ilst（©cmt + ---- 自由格式 AIGC），只改 moov；moov 在 mdat 前时同步修正 stco/co64；
 * - 服务商已有标识（UserComment / dc:description / TXXX:AIGC / ICMT / ©cmt）一律保留：我们的信息以“传播者”字段另写一处，不覆盖。
 * 字段参照 GB 45438-2025《人工智能生成合成内容标识方法》隐式标识的结构（Label / ContentProducer / ProduceID / ContentPropagator / PropagateID），
 * 另加 Model、Time 便于人读。写不进去时返回 implicit=false 与白话原因，调用方在卡片与发布检查里提醒“在平台勾选 AI 生成声明”。
 */
import { crc32, utf8 } from '@content-agent/shared';

export interface AigcMeta { model: string; provider?: string; contentId?: string; at: string }
export interface LabelResult { bytes: Uint8Array; implicit: boolean; preservedVendorMark?: boolean; reason?: string; note?: string }
export const AIGC_NS = 'http://ns.content-agent.local/aigc/1.0/';
export const APP_NAME = '超级工作台 content-agent';
const MARK = 'content-agent';

export function aigcFields(m: AigcMeta): Record<string, string> {
  const id = m.contentId ?? `ca-${Date.parse(m.at).toString(36)}`;
  return { Label: '1', LabelText: 'AI 生成', ContentProducer: m.provider || m.model.split('/')[0] || 'unknown', ProduceID: id, Model: m.model, Time: m.at, ContentPropagator: APP_NAME, PropagateID: id };
}
export const aigcJson = (m: AigcMeta): string => JSON.stringify(aigcFields(m));
export const aigcSentence = (m: AigcMeta): string => `AI 生成内容（AIGC）。模型：${m.model}；服务提供者：${aigcFields(m).ContentProducer}；内容编号：${aigcFields(m).ProduceID}；时间：${m.at}。由${APP_NAME}标注。`;

const dec = new TextDecoder();
const concat = (...parts: Uint8Array[]): Uint8Array => { const n = parts.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const be16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; };
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };

/* =============================== JPEG =============================== */
interface Seg { m: number; start: number; payload: number; end: number }
function jpegSegments(b: Uint8Array): Seg[] | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Seg[] = [];
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return out;
    while (b[p + 1] === 0xff) p++;
    const m = b[p + 1]!;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    out.push({ m, start: p, payload: p + 4, end: p + 2 + len });
    if (m === 0xda || m === 0xd9) break;
    p += 2 + len;
  }
  return out;
}
const EXIF_HDR = ascii('Exif\0\0');
const XMP_HDR = ascii('http://ns.adobe.com/xap/1.0/\0');
const startsWith = (b: Uint8Array, at: number, h: Uint8Array) => h.every((x, i) => b[at + i] === x);

interface Entry { tag: number; type: number; count: number; raw: Uint8Array }
class Tiff {
  dv: DataView; le: boolean;
  constructor(public b: Uint8Array) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.le = b[0] === 0x49; }
  u16(o: number) { return this.dv.getUint16(o, this.le); }
  u32(o: number) { return this.dv.getUint32(o, this.le); }
  ifd(off: number): { entries: Entry[]; next: number; pos: number } {
    const n = this.u16(off);
    const entries: Entry[] = [];
    for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; entries.push({ tag: this.u16(e), type: this.u16(e + 2), count: this.u32(e + 4), raw: this.b.slice(e + 8, e + 12) }); }
    return { entries, next: this.u32(off + 2 + n * 12), pos: off };
  }
  w16(n: number) { const x = new Uint8Array(2); new DataView(x.buffer).setUint16(0, n, this.le); return x; }
  w32(n: number) { const x = new Uint8Array(4); new DataView(x.buffer).setUint32(0, n, this.le); return x; }
  encIfd(entries: Entry[], next: number): Uint8Array {
    const s = [...entries].sort((a, b) => a.tag - b.tag);
    return concat(this.w16(s.length), ...s.map((e) => concat(this.w16(e.tag), this.w16(e.type), this.w32(e.count), e.raw)), this.w32(next));
  }
}
const TAG_EXIF = 0x8769, TAG_UC = 0x9286;
/** 新建 Exif IFD 时补上 EXIF 规范要求的基本字段（全部内联 4 字节，不额外占数据区），避免严格校验告警。 */
function requiredExif(t: Tiff, dims?: { w: number; h: number }): Entry[] {
  const short = (n: number) => concat(t.w16(n), new Uint8Array(2));
  const out: Entry[] = [
    { tag: 0x9000, type: 7, count: 4, raw: ascii('0232') },
    { tag: 0x9101, type: 7, count: 4, raw: Uint8Array.of(1, 2, 3, 0) },
    { tag: 0xa000, type: 7, count: 4, raw: ascii('0100') },   // FlashpixVersion（0.11.0：exiftool 12.x -validate 要求）
    { tag: 0xa001, type: 3, count: 1, raw: short(1) },
  ];
  if (dims) out.push({ tag: 0xa002, type: 4, count: 1, raw: t.w32(dims.w) }, { tag: 0xa003, type: 4, count: 1, raw: t.w32(dims.h) });
  return out;
}
function jpegDims(b: Uint8Array, segs: Seg[]): { w: number; h: number } | undefined {
  const sof = segs.find((s) => s.m >= 0xc0 && s.m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.m));
  return sof ? { h: (b[sof.payload + 1]! << 8) | b[sof.payload + 2]!, w: (b[sof.payload + 3]! << 8) | b[sof.payload + 4]! } : undefined;
}
function utf16(s: string, le: boolean): Uint8Array { const o = new Uint8Array(s.length * 2); const dv = new DataView(o.buffer); for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), le); return o; }
function decodeUC(b: Uint8Array, le: boolean): string {
  const code = dec.decode(b.subarray(0, 8)).replace(/\0+$/, '');
  const body = b.subarray(8);
  if (code === 'UNICODE') { let s = ''; const dv = new DataView(body.buffer, body.byteOffset, body.byteLength); for (let i = 0; i + 1 < body.length; i += 2) s += String.fromCharCode(dv.getUint16(i, le)); return s.replace(/\0+$/, ''); }
  return dec.decode(body).replace(/\0+$/, '').trim();
}
function readUC(t: Tiff): string | null {
  const exifE = t.ifd(t.u32(4)).entries.find((e) => e.tag === TAG_EXIF);
  if (!exifE) return null;
  const uc = t.ifd(new DataView(exifE.raw.buffer).getUint32(0, t.le)).entries.find((e) => e.tag === TAG_UC);
  if (!uc) return null;
  const off = uc.count <= 4 ? -1 : new DataView(uc.raw.buffer).getUint32(0, t.le);
  return decodeUC(off < 0 ? uc.raw.subarray(0, uc.count) : t.b.subarray(off, off + uc.count), t.le);
}
/** 在 TIFF 末尾追加新的 Exif IFD（含 UserComment），改 IFD0 指针；没有 Exif IFD 时连 IFD0 一起复制到末尾并改头部指针。原数据一字节不动。 */
function tiffWithUserComment(tiffIn: Uint8Array | null, text: string, dims?: { w: number; h: number }): { tiff: Uint8Array; preserved: boolean } {
  if (!tiffIn) {
    const t = new Tiff(ascii('II*\0'));
    const uc = concat(ascii('UNICODE\0'), utf16(text, true));
    // 布局：头 8 | IFD0（X/YResolution + ResolutionUnit + ExifIFD 指针 + YCbCrPositioning）| ExifIFD（必需字段 + UserComment）| UserComment | 2 个 RATIONAL
    // 0.11.0：补 IFD0 的 X/YResolution、ResolutionUnit（JPEG EXIF 规范必需；exiftool 12.x -validate 会告警）
    const req = requiredExif(t, dims);
    const ifd0Len = 2 + 5 * 12 + 4, exifLen = 2 + (req.length + 1) * 12 + 4;
    const exifOff = 8 + ifd0Len, ucOff = exifOff + exifLen;
    const ucPadded = uc.length % 2 ? concat(uc, new Uint8Array(1)) : uc;
    const ratOff = ucOff + ucPadded.length;
    const rat = concat(t.w32(72), t.w32(1), t.w32(72), t.w32(1));
    const sh = (n: number) => concat(t.w16(n), new Uint8Array(2));
    const ifd0 = t.encIfd([
      { tag: 0x011a, type: 5, count: 1, raw: t.w32(ratOff) }, { tag: 0x011b, type: 5, count: 1, raw: t.w32(ratOff + 8) }, { tag: 0x0128, type: 3, count: 1, raw: sh(2) },
      { tag: TAG_EXIF, type: 4, count: 1, raw: t.w32(exifOff) }, { tag: 0x0213, type: 3, count: 1, raw: sh(1) },
    ], 0);
    const exif = t.encIfd([...req, { tag: TAG_UC, type: 7, count: uc.length, raw: t.w32(ucOff) }], 0);
    return { tiff: concat(ascii('II*\0'), t.w32(8), ifd0, exif, ucPadded, rat), preserved: false };
  }
  const t = new Tiff(tiffIn.slice());
  const ifd0Off = t.u32(4);
  const ifd0 = t.ifd(ifd0Off);
  const exifIdx = ifd0.entries.findIndex((e) => e.tag === TAG_EXIF);
  const old = readUC(t);
  const full = old ? `${old}\n${text}` : text;
  const uc = concat(ascii('UNICODE\0'), utf16(full, t.le));
  let tail: Uint8Array;
  let cur = t.b.length + (t.b.length % 2);
  const pad = new Uint8Array(t.b.length % 2);
  const ucOff = cur; cur += uc.length + (uc.length % 2);
  const ucPad = new Uint8Array(uc.length % 2);
  const ucEntry: Entry = { tag: TAG_UC, type: 7, count: uc.length, raw: t.w32(ucOff) };
  if (exifIdx >= 0) {
    const exif = t.ifd(new DataView(ifd0.entries[exifIdx]!.raw.buffer).getUint32(0, t.le));
    const newExifOff = cur;
    const newExif = t.encIfd([...exif.entries.filter((e) => e.tag !== TAG_UC), ucEntry], exif.next);
    tail = concat(pad, uc, ucPad, newExif);
    const out = concat(t.b, tail);
    out.set(t.w32(newExifOff), ifd0Off + 2 + exifIdx * 12 + 8);
    return { tiff: out, preserved: true };
  }
  const exifOff = cur;
  const exif = t.encIfd([...requiredExif(t, dims), ucEntry], 0);
  cur += exif.length;
  const newIfd0Off = cur;
  const newIfd0 = t.encIfd([...ifd0.entries, { tag: TAG_EXIF, type: 4, count: 1, raw: t.w32(exifOff) }], ifd0.next);
  const out = concat(t.b, pad, uc, ucPad, exif, newIfd0);
  out.set(t.w32(newIfd0Off), 4);
  return { tiff: out, preserved: true };
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function xmpDescription(m: AigcMeta, withDc: boolean): string {
  const f = aigcFields(m);
  return `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:AIGC="${AIGC_NS}">`
    + (withDc ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(aigcSentence(m))}</rdf:li></rdf:Alt></dc:description>` : '')
    + Object.entries(f).map(([k, v]) => `<AIGC:${k}>${esc(v)}</AIGC:${k}>`).join('')
    + `<AIGC:AIGC>${esc(aigcJson(m))}</AIGC:AIGC></rdf:Description>`;
}
function xmpPacket(m: AigcMeta): string {
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${xmpDescription(m, true)}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}
const app1 = (hdr: Uint8Array, body: Uint8Array) => concat(Uint8Array.of(0xff, 0xe1), be16(2 + hdr.length + body.length), hdr, body);

export function labelJpeg(input: Uint8Array, m: AigcMeta): LabelResult {
  const segs = jpegSegments(input);
  if (!segs) return { bytes: input, implicit: false, reason: '不是有效的 JPEG 文件' };
  const exifSeg = segs.find((s) => s.m === 0xe1 && startsWith(input, s.payload, EXIF_HDR));
  const xmpSeg = segs.find((s) => s.m === 0xe1 && startsWith(input, s.payload, XMP_HDR));
  const oldXmp = xmpSeg ? dec.decode(input.subarray(xmpSeg.payload + XMP_HDR.length, xmpSeg.end)) : '';
  const oldTiff = exifSeg ? input.slice(exifSeg.payload + 6, exifSeg.end) : null;
  if (oldXmp.includes(AIGC_NS) && oldXmp.includes(MARK)) return { bytes: input, implicit: true, note: '已有本应用的标识，未重复写入' };
  const preservedVendorMark = (!!oldTiff && !!readUC(new Tiff(oldTiff))) || /dc:description/.test(oldXmp);
  // EXIF
  const { tiff } = tiffWithUserComment(oldTiff, aigcSentence(m) + ` AIGC=${aigcJson(m)}`, jpegDims(input, segs));
  let exifNew: Uint8Array | null = 2 + 6 + tiff.length <= 0xffff ? app1(EXIF_HDR, tiff) : null;
  // XMP
  let xmpStr: string;
  if (oldXmp && /<\/rdf:RDF>/.test(oldXmp)) xmpStr = oldXmp.replace(/<\/rdf:RDF>/, `${xmpDescription(m, !/dc:description/.test(oldXmp))}</rdf:RDF>`);
  else xmpStr = xmpPacket(m);
  let xmpNew: Uint8Array | null = app1(XMP_HDR, utf8(xmpStr));
  if (xmpNew.length - 2 > 0xffff) xmpNew = null;
  if (!exifNew && !xmpNew) return { bytes: input, implicit: false, reason: '原图元数据过大，放不下标识' };
  // 组装：替换已有段；没有的插在 APP0/Exif 之后
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let insertedExif = !exifNew, insertedXmp = !xmpNew;
  const firstAfter = segs.find((s) => !(s.m === 0xe0 || (s.m === 0xe1 && (s === exifSeg))))!;
  for (const s of segs) {
    if (s === firstAfter) {
      if (!insertedExif && !exifSeg) { parts.push(exifNew!); insertedExif = true; }
      if (!insertedXmp && !xmpSeg) { parts.push(xmpNew!); insertedXmp = true; }
    }
    if (s === exifSeg && exifNew) { parts.push(exifNew); insertedExif = true; if (!xmpSeg && xmpNew && !insertedXmp) { parts.push(xmpNew); insertedXmp = true; } }
    else if (s === xmpSeg && xmpNew) { parts.push(xmpNew); insertedXmp = true; }
    else if (s.m === 0xda) { parts.push(input.subarray(s.start)); break; }
    else parts.push(input.subarray(s.start, s.end));
  }
  if (exifNew === null) exifNew = null;
  return { bytes: concat(...parts), implicit: true, preservedVendorMark, note: !exifNew ? '原 EXIF 过大，只写了 XMP' : undefined };
}
export function readJpegAigc(b: Uint8Array): { userComment: string | null; xmp: string } {
  const segs = jpegSegments(b) ?? [];
  const e = segs.find((s) => s.m === 0xe1 && startsWith(b, s.payload, EXIF_HDR));
  const x = segs.find((s) => s.m === 0xe1 && startsWith(b, s.payload, XMP_HDR));
  return { userComment: e ? readUC(new Tiff(b.slice(e.payload + 6, e.end))) : null, xmp: x ? dec.decode(b.subarray(x.payload + XMP_HDR.length, x.end)) : '' };
}

/* =============================== MP3（ID3v2） =============================== */
const syncsafe = (b: Uint8Array, o: number) => ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f);
const toSyncsafe = (n: number) => Uint8Array.of((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
interface Id3Frame { id: string; start: number; end: number; data: Uint8Array }
function id3Parse(b: Uint8Array): { ver: number; flags: number; size: number; framesStart: number; framesEnd: number; frames: Id3Frame[] } | null {
  if (b.length < 10 || dec.decode(b.subarray(0, 3)) !== 'ID3') return null;
  const ver = b[3]!, flags = b[5]!, size = syncsafe(b, 6);
  let p = 10;
  if (flags & 0x40) p += ver === 4 ? syncsafe(b, 10) : new DataView(b.buffer, b.byteOffset).getUint32(10) + 4;
  const end = Math.min(b.length, 10 + size);
  const frames: Id3Frame[] = [];
  while (p + 10 <= end && b[p] !== 0) {
    const id = dec.decode(b.subarray(p, p + 4));
    const fs = ver === 4 ? syncsafe(b, p + 4) : new DataView(b.buffer, b.byteOffset).getUint32(p + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || p + 10 + fs > end) break;
    frames.push({ id, start: p, end: p + 10 + fs, data: b.subarray(p + 10, p + 10 + fs) });
    p += 10 + fs;
  }
  return { ver, flags, size, framesStart: 10, framesEnd: p, frames };
}
function txxxDecode(d: Uint8Array): { desc: string; value: string } {
  const enc = d[0]!;
  const body = d.subarray(1);
  if (enc === 1 || enc === 2) {
    let le = enc === 1 ? true : false; let o = 0;
    const read = () => { if (enc === 1 && body[o] === 0xff && body[o + 1] === 0xfe) { le = true; o += 2; } else if (enc === 1 && body[o] === 0xfe && body[o + 1] === 0xff) { le = false; o += 2; } let s = ''; while (o + 1 < body.length) { const c = le ? body[o]! | (body[o + 1]! << 8) : (body[o]! << 8) | body[o + 1]!; o += 2; if (!c) break; s += String.fromCharCode(c); } return s; };
    const desc = read(); const value = read(); return { desc, value };
  }
  const i = body.indexOf(0);
  return { desc: dec.decode(body.subarray(0, i < 0 ? body.length : i)), value: dec.decode(body.subarray(i < 0 ? body.length : i + 1)).replace(/\0+$/, '') };
}
function txxxFrame(ver: number, desc: string, value: string): Uint8Array {
  const body = ver === 4
    ? concat(Uint8Array.of(3), utf8(desc), Uint8Array.of(0), utf8(value))
    : concat(Uint8Array.of(1), Uint8Array.of(0xff, 0xfe), utf16(desc, true), Uint8Array.of(0, 0), Uint8Array.of(0xff, 0xfe), utf16(value, true));
  return concat(ascii('TXXX'), ver === 4 ? toSyncsafe(body.length) : be32(body.length), Uint8Array.of(0, 0), body);
}
export function readId3Txxx(b: Uint8Array): Record<string, string> {
  const t = id3Parse(b); const out: Record<string, string> = {};
  for (const f of t?.frames ?? []) if (f.id === 'TXXX') { const x = txxxDecode(f.data); out[x.desc] = x.value; }
  return out;
}
export function labelMp3(input: Uint8Array, m: AigcMeta): LabelResult {
  const t = id3Parse(input);
  const json = aigcJson(m);
  if (!t) {
    const fr = txxxFrame(4, 'AIGC', json);
    return { bytes: concat(ascii('ID3'), Uint8Array.of(4, 0, 0), toSyncsafe(fr.length), fr, input), implicit: true };
  }
  if (t.ver !== 3 && t.ver !== 4) return { bytes: input, implicit: false, reason: `ID3v2.${t.ver} 标签较旧，未改写（请在平台勾选 AI 生成声明）` };
  if (t.flags & 0x80) return { bytes: input, implicit: false, reason: '原标签用了“非同步”编码，未改写（请在平台勾选 AI 生成声明）' };
  const tx = readId3Txxx(input);
  if (Object.values(tx).some((v) => v.includes(MARK) || v.includes(APP_NAME))) return { bytes: input, implicit: true, note: '已有本应用的标识，未重复写入' };
  const vendor = 'AIGC' in tx;
  const fr = txxxFrame(t.ver, vendor ? 'AIGC_Propagator' : 'AIGC', json);
  const tagEnd = 10 + t.size;
  const body = concat(input.subarray(10, t.framesEnd), fr, input.subarray(t.framesEnd, tagEnd));
  const footer = t.ver === 4 && (t.flags & 0x10) ? concat(ascii('3DI'), Uint8Array.of(4, 0, t.flags), toSyncsafe(body.length)) : new Uint8Array(0);
  const rest = input.subarray(tagEnd + ((t.ver === 4 && (t.flags & 0x10)) ? 10 : 0));
  return { bytes: concat(ascii('ID3'), Uint8Array.of(t.ver, input[4]!, t.flags), toSyncsafe(body.length), body, footer, rest), implicit: true, preservedVendorMark: vendor };
}

/* =============================== WAV（RIFF） =============================== */
interface Chunk { id: string; start: number; size: number; data: number; end: number }
function riffChunks(b: Uint8Array): Chunk[] | null {
  if (b.length < 12 || dec.decode(b.subarray(0, 4)) !== 'RIFF' || dec.decode(b.subarray(8, 12)) !== 'WAVE') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = []; let p = 12;
  while (p + 8 <= b.length) { const size = dv.getUint32(p + 4, true); const end = Math.min(b.length, p + 8 + size + (size % 2)); out.push({ id: dec.decode(b.subarray(p, p + 4)), start: p, size, data: p + 8, end }); p = end; }
  return out;
}
const chunk = (id: string, data: Uint8Array) => concat(ascii(id), le32(data.length), data, new Uint8Array(data.length % 2));
export function readWavInfo(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of riffChunks(b) ?? []) if (c.id === 'LIST' && dec.decode(b.subarray(c.data, c.data + 4)) === 'INFO') {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = c.data + 4;
    while (p + 8 <= c.data + c.size) { const id = dec.decode(b.subarray(p, p + 4)); const s = dv.getUint32(p + 4, true); out[id] = dec.decode(b.subarray(p + 8, p + 8 + s)).replace(/\0+$/, ''); p += 8 + s + (s % 2); }
  }
  return out;
}
/** 0.5 秒提示音（880 Hz，带 10 ms 淡入淡出），只生成 16 位 PCM。 */
export function beepPcm16(sampleRate: number, channels: number, seconds = 0.5): Uint8Array {
  const n = Math.round(sampleRate * seconds); const out = new Uint8Array(n * channels * 2); const dv = new DataView(out.buffer);
  const ramp = Math.max(1, Math.round(sampleRate * 0.01));
  for (let i = 0; i < n; i++) { const env = Math.min(1, i / ramp, (n - 1 - i) / ramp); const v = Math.round(Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 0.3 * env * 32767); for (let c = 0; c < channels; c++) dv.setInt16((i * channels + c) * 2, v, true); }
  return out;
}
export function labelWav(input: Uint8Array, m: AigcMeta, o: { beep?: boolean } = {}): LabelResult {
  const cs = riffChunks(input);
  if (!cs) return { bytes: input, implicit: false, reason: '不是有效的 WAV 文件' };
  const info = readWavInfo(input);
  if ((info.ICMT ?? '').includes(MARK)) return { bytes: input, implicit: true, note: '已有本应用的标识，未重复写入' };
  const ours = `${aigcSentence(m)} AIGC=${aigcJson(m)}`;
  const vendor = !!info.ICMT;
  const sub = Object.entries({ ...info, ICMT: vendor ? `${info.ICMT}\n${ours}` : ours }).map(([k, v]) => chunk(k, concat(utf8(v), Uint8Array.of(0))));
  const list = chunk('LIST', concat(ascii('INFO'), ...sub));
  let note: string | undefined;
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const fmt = cs.find((c) => c.id === 'fmt ');
  const pcm16 = !!fmt && dv.getUint16(fmt.data, true) === 1 && dv.getUint16(fmt.data + 14, true) === 16;
  if (o.beep && !pcm16) note = '提示音只支持 16 位 PCM WAV，本文件未加';
  const parts: Uint8Array[] = [];
  let placed = false;
  for (const c of cs) {
    if (c.id === 'LIST' && dec.decode(input.subarray(c.data, c.data + 4)) === 'INFO') { if (!placed) { parts.push(list); placed = true; } continue; }
    if (c.id === 'data') {
      if (!placed) { parts.push(list); placed = true; }
      if (o.beep && pcm16) { const beep = beepPcm16(dv.getUint32(fmt!.data + 4, true), dv.getUint16(fmt!.data + 2, true)); parts.push(chunk('data', concat(beep, input.subarray(c.data, c.data + c.size)))); note = '已在开头加 0.5 秒提示音'; continue; }
    }
    parts.push(input.subarray(c.start, c.end));
  }
  if (!placed) parts.push(list);
  const body = concat(...parts);
  return { bytes: concat(ascii('RIFF'), le32(body.length + 4), ascii('WAVE'), body), implicit: true, preservedVendorMark: vendor, note };
}

/* =============================== MP4（ISO BMFF） =============================== */
interface Box { type: string; start: number; hdr: number; end: number }
function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const out: Box[] = []; let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p); let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type: dec.decode(b.subarray(p + 4, p + 8)), start: p, hdr, end: p + size }); p += size;
  }
  return out;
}
const box = (type: string | Uint8Array, ...payload: Uint8Array[]) => { const body = concat(...payload); return concat(be32(8 + body.length), typeof type === 'string' ? ascii(type) : type, body); };
const CMT = Uint8Array.of(0xa9, 0x63, 0x6d, 0x74); // ©cmt
const dataAtom = (text: string) => box('data', be32(1), be32(0), utf8(text));
const freeform = (mean: string, name: string, text: string) => box('----', box('mean', be32(0), utf8(mean)), box('name', be32(0), utf8(name)), dataAtom(text));
const hdlrMdir = () => box('hdlr', be32(0), be32(0), ascii('mdir'), ascii('appl'), new Uint8Array(8), Uint8Array.of(0));
const isCmt = (b: Uint8Array, x: Box) => CMT.every((v, i) => b[x.start + 4 + i] === v);
export function readMp4Tags(b: Uint8Array): { udtaComment?: string; ilstComment?: string; freeform: Record<string, string> } {
  const out: { udtaComment?: string; ilstComment?: string; freeform: Record<string, string> } = { freeform: {} };
  const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov'); if (!moov) return out;
  const udta = boxes(b, moov.start + moov.hdr, moov.end).find((x) => x.type === 'udta'); if (!udta) return out;
  for (const c of boxes(b, udta.start + udta.hdr, udta.end)) {
    if (isCmt(b, c)) { const s = (b[c.start + 8]! << 8) | b[c.start + 9]!; out.udtaComment = dec.decode(b.subarray(c.start + 12, c.start + 12 + s)); }
    if (c.type === 'meta') { const ilst = boxes(b, c.start + 12, c.end).find((x) => x.type === 'ilst'); for (const it of ilst ? boxes(b, ilst.start + 8, ilst.end) : []) {
      const kids = boxes(b, it.start + 8, it.end); const d = kids.find((k) => k.type === 'data'); const val = d ? dec.decode(b.subarray(d.start + 16, d.end)) : '';
      if (isCmt(b, it)) out.ilstComment = val;
      if (it.type === '----') { const n = kids.find((k) => k.type === 'name'); if (n) out.freeform[dec.decode(b.subarray(n.start + 12, n.end))] = val; }
    } }
  }
  return out;
}
/** 修正 moov 内 stco / co64 中指向 moov 之后数据的偏移。 */
function patchChunkOffsets(moov: Uint8Array, threshold: number, delta: number): boolean {
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const walk = (s: number, e: number): boolean => {
    for (const x of boxes(moov, s, e)) {
      if (['trak', 'mdia', 'minf', 'stbl'].includes(x.type) && !walk(x.start + x.hdr, x.end)) return false;
      if (x.type === 'stco') { const n = dv.getUint32(x.start + x.hdr + 4); for (let i = 0; i < n; i++) { const o = x.start + x.hdr + 8 + i * 4; const v = dv.getUint32(o); if (v >= threshold) { if (v + delta > 0xffffffff) return false; dv.setUint32(o, v + delta); } } }
      if (x.type === 'co64') { const n = dv.getUint32(x.start + x.hdr + 4); for (let i = 0; i < n; i++) { const o = x.start + x.hdr + 8 + i * 8; const v = dv.getBigUint64(o); if (v >= BigInt(threshold)) dv.setBigUint64(o, v + BigInt(delta)); } }
    }
    return true;
  };
  return walk(8, moov.length);
}
export function labelMp4(input: Uint8Array, m: AigcMeta): LabelResult {
  const top = boxes(input, 0, input.length);
  const moov = top.find((x) => x.type === 'moov');
  if (!top.length || top[0]!.type !== 'ftyp' || !moov) return { bytes: input, implicit: false, reason: '不是有效的 MP4 文件（找不到 moov）' };
  const tags = readMp4Tags(input);
  if (Object.values(tags.freeform).some((v) => v.includes(MARK) || v.includes(APP_NAME))) return { bytes: input, implicit: true, note: '已有本应用的标识，未重复写入' };
  const vendor = !!(tags.udtaComment || tags.ilstComment || tags.freeform.AIGC);
  const sentence = aigcSentence(m); const json = aigcJson(m);
  const ff = freeform('com.content-agent', tags.freeform.AIGC ? 'AIGC_Propagator' : 'AIGC', json);
  const moovKids = boxes(input, moov.start + moov.hdr, moov.end);
  const udta = moovKids.find((x) => x.type === 'udta');
  const udtaKids = udta ? boxes(input, udta.start + udta.hdr, udta.end) : [];
  const meta = udtaKids.find((x) => x.type === 'meta');
  // 新 meta
  let newMeta: Uint8Array;
  if (meta) {
    const metaKids = boxes(input, meta.start + meta.hdr + 4, meta.end);
    const ilst = metaKids.find((x) => x.type === 'ilst');
    const items = ilst ? input.subarray(ilst.start + ilst.hdr, ilst.end) : new Uint8Array(0);
    const newIlst = box('ilst', items, tags.ilstComment ? new Uint8Array(0) : box(CMT, dataAtom(sentence)), ff);
    const keep = metaKids.filter((x) => x !== ilst).map((x) => input.subarray(x.start, x.end));
    if (!metaKids.some((x) => x.type === 'hdlr')) keep.unshift(hdlrMdir());
    newMeta = box('meta', input.subarray(meta.start + meta.hdr, meta.start + meta.hdr + 4), ...keep, newIlst);
  } else newMeta = box('meta', be32(0), hdlrMdir(), box('ilst', box(CMT, dataAtom(sentence)), ff));
  const qtCmt = tags.udtaComment ? new Uint8Array(0) : box(CMT, be16(utf8(sentence).length), be16(0x55c4), utf8(sentence));
  const newUdta = box('udta', ...udtaKids.filter((x) => x !== meta).map((x) => input.subarray(x.start, x.end)), qtCmt, newMeta);
  const kids = udta ? moovKids.map((x) => (x === udta ? newUdta : input.subarray(x.start, x.end))) : [...moovKids.map((x) => input.subarray(x.start, x.end)), newUdta];
  const newMoov = box('moov', ...kids);
  const delta = newMoov.length - (moov.end - moov.start);
  const dataAfter = top.some((x) => x.type === 'mdat' && x.start > moov.start);
  if (dataAfter && delta && !patchChunkOffsets(newMoov, moov.end, delta)) return { bytes: input, implicit: false, reason: '文件太大，修正数据偏移会溢出，未改写' };
  return { bytes: concat(input.subarray(0, moov.start), newMoov, input.subarray(moov.end)), implicit: true, preservedVendorMark: vendor };
}

/* =============================== PNG（0.9.0 起） =============================== */
export function pngInsertText(bytes: Uint8Array, key: string, value: string): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return bytes;
  const ihdrEnd = 8 + 8 + 13 + 4;
  const data = utf8(`${key}\0${value}`);
  const c = new Uint8Array(12 + data.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, data.length); c.set(utf8('tEXt'), 4); c.set(data, 8);
  dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
  return concat(bytes.subarray(0, ihdrEnd), c, bytes.subarray(ihdrEnd));
}

/* =============================== 分派 =============================== */
export const IMPLICIT_MIMES = ['image/png', 'image/jpeg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'video/mp4', 'audio/mp4'] as const;
export function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (dec.decode(b.subarray(0, 3)) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (dec.decode(b.subarray(0, 4)) === 'RIFF' && dec.decode(b.subarray(8, 12)) === 'WAVE') return 'audio/wav';
  if (dec.decode(b.subarray(4, 8)) === 'ftyp') return 'video/mp4';
  return null;
}
export function labelImplicitBytes(bytes: Uint8Array, mime: string, m: AigcMeta, o: { beep?: boolean } = {}): LabelResult {
  const t = sniff(bytes) ?? mime;
  try {
    if (t === 'image/png') { const out = pngInsertText(bytes, 'AIGC', aigcJson(m)); return { bytes: out, implicit: out !== bytes }; }
    if (t === 'image/jpeg') return labelJpeg(bytes, m);
    if (t === 'audio/mpeg' || t === 'audio/mp3') return { ...labelMp3(bytes, m), ...(o.beep ? { note: 'MP3 不重编码，提示音只对 WAV 生效' } : {}) };
    if (t === 'audio/wav' || t === 'audio/x-wav' || t === 'audio/wave') return labelWav(bytes, m, o);
    if (t === 'video/mp4' || t === 'audio/mp4') return labelMp4(bytes, m);
    return { bytes, implicit: false, reason: `${mime} 格式暂不支持写入隐式标识` };
  } catch (e) { return { bytes, implicit: false, reason: `写入标识时出错：${(e as Error).message}` }; }
}
