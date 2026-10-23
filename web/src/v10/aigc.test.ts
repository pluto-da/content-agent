// @vitest-environment node
/**
 * 0.10.0 AIGC 隐式标识：纯 TS 读回校验（CI 必跑）+ exiftool / ffprobe 外部校验（沙盒或 runner 有工具时跑，没有则跳过并在 accept-v10 里记“部分”）。
 * 夹具 fixtures/ 由 ffmpeg / exiftool 生成：含已有 EXIF（大端、小端、仅 IFD0）、已有 XMP、已有 ID3v2.3 / v2.4（含服务商 TXXX:AIGC）、已有 INFO ICMT、faststart MP4（moov 在 mdat 前，含服务商 comment）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelJpeg, labelMp3, labelWav, labelMp4, readJpegAigc, readId3Txxx, readWavInfo, readMp4Tags, labelImplicitBytes, aigcFields, AIGC_NS, type AigcMeta } from './aigcMedia';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => new Uint8Array(readFileSync(join(here, 'fixtures', n)));
const META: AigcMeta = { model: 'wanx2.1-t2i-turbo', provider: 'dashscope', contentId: 'ca-test-001', at: '2026-10-23T10:00:00.000Z' };
const outDir = process.env.CA_AIGC_OUT ?? join(here, '../../../out/aigc-v10');
const has = (cmd: string, args: string[]) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const EXIFTOOL = process.env.CA_EXIFTOOL ?? 'exiftool';
const hasExiftool = has(EXIFTOOL, ['-ver']);
const hasFfprobe = has('ffprobe', ['-version']);
const save = (name: string, b: Uint8Array) => { mkdirSync(outDir, { recursive: true }); const p = join(outDir, name); writeFileSync(p, b); return p; };
const exif = (p: string) => JSON.parse(execFileSync(EXIFTOOL, ['-j', '-G1', '-a', '-struct', p], { encoding: 'utf8' }))[0] as Record<string, unknown>;
const probe = (p: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:format=duration', '-of', 'json', p], { encoding: 'utf8' })).format as { tags?: Record<string, string>; duration?: string };
const decodes = (p: string) => { execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', p, '-f', 'null', '-'], { stdio: 'pipe' }); return true; };

describe('AIGC 隐式标识 · JPEG（纯 TS 读回）', () => {
  for (const f of ['plain.jpg', 'exif.jpg', 'exifbe.jpg', 'ifd0le.jpg']) {
    it(`${f}：写入 EXIF UserComment 与 XMP，可读回`, () => {
      const r = labelJpeg(fx(f), META);
      expect(r.implicit).toBe(true);
      const back = readJpegAigc(r.bytes);
      expect(back.userComment).toContain('AI 生成');
      expect(back.userComment).toContain('wanx2.1-t2i-turbo');
      expect(back.xmp).toContain(AIGC_NS);
      expect(back.xmp).toContain('<AIGC:ProduceID>ca-test-001</AIGC:ProduceID>');
      save(`labeled-${f}`, r.bytes);
    });
  }
  it('已有服务商 UserComment / dc:description 时保留，不覆盖', () => {
    const r = labelJpeg(fx('exifbe.jpg'), META);
    expect(r.preservedVendorMark).toBe(true);
    const back = readJpegAigc(r.bytes);
    expect(back.userComment).toMatch(/^provider: AIGC by vendor\n/);
    expect(back.xmp).toContain('vendor desc');
  });
  it('重复标注幂等：第二次不再写入', () => {
    const a = labelJpeg(fx('plain.jpg'), META).bytes;
    const b = labelJpeg(a, META);
    expect(b.implicit).toBe(true); expect(b.bytes.length).toBe(a.length);
  });
  it('不是 JPEG → implicit=false 且有白话原因', () => { const r = labelJpeg(new Uint8Array([1, 2, 3]), META); expect(r.implicit).toBe(false); expect(r.reason).toMatch(/JPEG/); });
});

describe('AIGC 隐式标识 · 音频（纯 TS 读回）', () => {
  it('MP3 无标签：新建 ID3v2.4 TXXX:AIGC', () => { const r = labelMp3(fx('plain.mp3'), META); expect(readId3Txxx(r.bytes).AIGC).toContain('"ProduceID":"ca-test-001"'); save('labeled-plain.mp3', r.bytes); });
  it('MP3 已有 v2.4 与服务商 TXXX:AIGC：保留原值，另写 AIGC_Propagator', () => {
    const r = labelMp3(fx('tag24.mp3'), META); const t = readId3Txxx(r.bytes);
    expect(r.preservedVendorMark).toBe(true); expect(t.AIGC).toBe('{"Label":"1","ContentProducer":"vendor"}'); expect(t.AIGC_Propagator).toContain('超级工作台');
    save('labeled-tag24.mp3', r.bytes);
  });
  it('MP3 已有 v2.3：按 v2.3 帧格式（UTF-16）写入', () => { const r = labelMp3(fx('tag23.mp3'), META); expect(r.bytes[3]).toBe(3); expect(readId3Txxx(r.bytes).AIGC).toContain('AI 生成'); save('labeled-tag23.mp3', r.bytes); });
  it('WAV 无 INFO：新建 LIST/INFO ICMT', () => { const r = labelWav(fx('plain.wav'), META); expect(readWavInfo(r.bytes).ICMT).toContain('AIGC='); save('labeled-plain.wav', r.bytes); });
  it('WAV 已有 ICMT（服务商）：原文保留在前，我们的追加在后；其他 INFO 字段不丢', () => {
    const r = labelWav(fx('info.wav'), META); const i = readWavInfo(r.bytes);
    expect(i.ICMT).toMatch(/^vendor comment\n/); expect(i.IART).toBe('Vendor'); expect(r.preservedVendorMark).toBe(true);
    save('labeled-info.wav', r.bytes);
  });
  it('提示音默认关；打开时只对 16 位 PCM WAV 加 0.5 秒', () => {
    const off = labelWav(fx('plain.wav'), META); const on = labelWav(fx('plain.wav'), META, { beep: true });
    expect(on.bytes.length - off.bytes.length).toBe(8000 * 0.5 * 2); expect(on.note).toMatch(/提示音/);
    expect(labelImplicitBytes(fx('plain.mp3'), 'audio/mpeg', META, { beep: true }).note).toMatch(/只对 WAV/);
    save('labeled-beep.wav', on.bytes);
  });
});

describe('AIGC 隐式标识 · MP4（纯 TS 读回）', () => {
  it('moov 在 mdat 后：写入 udta/©cmt + meta/ilst（©cmt、----:AIGC）', () => {
    const r = labelMp4(fx('plain.mp4'), META); const t = readMp4Tags(r.bytes);
    expect(t.udtaComment).toContain('AI 生成'); expect(t.ilstComment).toContain('AI 生成'); expect(t.freeform.AIGC).toContain('"Model":"wanx2.1-t2i-turbo"');
    save('labeled-plain.mp4', r.bytes);
  });
  it('faststart（moov 在 mdat 前）+ 服务商 comment：保留服务商 comment，修正 stco，另写 ----:AIGC', () => {
    const src = fx('fast.mp4'); const r = labelMp4(src, META); const t = readMp4Tags(r.bytes);
    expect(r.preservedVendorMark).toBe(true); expect(t.ilstComment).toBe('vendor AIGC mark'); expect(t.freeform.AIGC).toContain('ca-test-001');
    // 只改 moov：mdat 内容逐字节相同
    const tail = (b: Uint8Array) => b.subarray(b.length - 900);
    expect(Buffer.from(tail(r.bytes)).equals(Buffer.from(tail(src)))).toBe(true);
    save('labeled-fast.mp4', r.bytes);
  });
  it('分派：按文件头识别格式；不支持的格式如实返回 implicit=false', () => {
    expect(labelImplicitBytes(fx('plain.wav'), 'application/octet-stream', META).implicit).toBe(true);
    expect(labelImplicitBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 'image/webp', META)).toMatchObject({ implicit: false });
    expect(aigcFields(META)).toMatchObject({ Label: '1', ContentProducer: 'dashscope', ProduceID: 'ca-test-001' });
  });
});

describe.skipIf(!hasExiftool)('AIGC 外部校验 · exiftool 读出全部字段、原 EXIF 保留', () => {
  for (const f of ['plain.jpg', 'exif.jpg', 'exifbe.jpg', 'ifd0le.jpg']) {
    it(`exiftool：${f}`, () => {
      const j = exif(save(`labeled-${f}`, labelJpeg(fx(f), META).bytes));
      expect(String(j['ExifIFD:UserComment'])).toContain('AI 生成');
      expect(String(j['XMP-AIGC:ProduceID'] ?? j['XMP-AIGC:ProduceId'])).toBe('ca-test-001');
      expect(String(j['XMP-AIGC:Model'])).toBe('wanx2.1-t2i-turbo');
      expect(String(j['XMP-AIGC:ContentProducer'])).toBe('dashscope');
      expect(String(j['XMP-AIGC:Time'])).toContain('2026');
      if (f === 'exif.jpg') { expect(j['IFD0:Make']).toBe('TestCam'); expect(j['ExifIFD:DateTimeOriginal']).toBe('2026:10:01 10:00:00'); expect(j['IFD0:Artist']).toBe('Provider'); }
      if (f === 'exifbe.jpg') { expect(j['IFD0:Make']).toBe('BigEnd'); expect(String(j['XMP-dc:Description'])).toContain('vendor desc'); }
      if (f === 'ifd0le.jpg') expect(j['IFD0:Make']).toBe('LittleCam');
      expect(j['ExifTool:Warning']).toBeUndefined();
      // 严格校验：标注后的告警不多于原图（新建的 Exif IFD 已补齐必需字段）
      const v = (p: string) => String(JSON.parse(execFileSync(EXIFTOOL, ['-j', '-validate', p], { encoding: 'utf8' }))[0].Validate);
      const n = (x: string) => (x === 'OK' ? 0 : Number(/(\d+)/.exec(x)?.[1] ?? 99));
      expect(n(v(save(`labeled-${f}`, labelJpeg(fx(f), META).bytes)))).toBeLessThanOrEqual(n(v(join(here, 'fixtures', f))));
      expect(j['ExifTool:Error']).toBeUndefined();
    });
  }
});

describe.skipIf(!hasFfprobe)('AIGC 外部校验 · ffprobe 读出标签、文件可正常解码', () => {
  it('ffprobe：MP3 TXXX:AIGC', () => { const p = save('labeled-tag24.mp3', labelMp3(fx('tag24.mp3'), META).bytes); const t = probe(p).tags!; expect(t.AIGC).toContain('vendor'); expect(t.AIGC_Propagator).toContain('ca-test-001'); expect(decodes(p)).toBe(true); });
  it('ffprobe：MP3（无原标签）', () => { const p = save('labeled-plain.mp3', labelMp3(fx('plain.mp3'), META).bytes); expect(probe(p).tags!.AIGC).toContain('ca-test-001'); expect(decodes(p)).toBe(true); });
  it('ffprobe：WAV INFO comment', () => { const p = save('labeled-plain.wav', labelWav(fx('plain.wav'), META).bytes); expect(probe(p).tags!.comment).toContain('AI 生成'); expect(decodes(p)).toBe(true); });
  it('ffprobe：WAV 提示音 +0.5 秒', () => { const a = probe(save('labeled-plain.wav', labelWav(fx('plain.wav'), META).bytes)); const b = probe(save('labeled-beep.wav', labelWav(fx('plain.wav'), META, { beep: true }).bytes)); expect(Number(b.duration) - Number(a.duration)).toBeCloseTo(0.5, 2); });
  it('ffprobe：MP4 comment + AIGC，且可完整解码（moov 在后）', () => { const p = save('labeled-plain.mp4', labelMp4(fx('plain.mp4'), META).bytes); const t = probe(p).tags!; expect(t.comment).toContain('AI 生成'); expect(t.AIGC).toContain('ca-test-001'); expect(decodes(p)).toBe(true); });
  it('ffprobe：faststart MP4 保留服务商 comment，stco 修正后可完整解码', () => { const p = save('labeled-fast.mp4', labelMp4(fx('fast.mp4'), META).bytes); const t = probe(p).tags!; expect(t.comment).toBe('vendor AIGC mark'); expect(t.AIGC).toContain('ca-test-001'); expect(decodes(p)).toBe(true); });
});

it('外部工具可用性记录（供 accept-v10）', () => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'tools.json'), JSON.stringify({ exiftool: hasExiftool, ffprobe: hasFfprobe, at: new Date().toISOString() }));
  expect(existsSync(join(outDir, 'tools.json'))).toBe(true);
});
