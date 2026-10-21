import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DB } from '../db.js';
import type { HttpClient } from '../http.js';
import { defaultHttp, isPublicHttpUrl } from '../http.js';
import type { ModelHub } from '../models/hub.js';
import type { Segment } from '../models/types.js';
import { estimateSegments, toSrt } from '../models/util.js';

/**
 * 视频合成：配音音频 + SRT 字幕 + 图片 → 竖版 MP4（默认 1080x1920，适合抖音/视频号）。
 * 只在本机调用 ffmpeg，不上传任何内容；生成的是草稿素材，发布仍由用户本人完成。
 */

export interface ComposeInput {
  /** 配音文件路径；无法识别为音频（如模拟音频）时自动改用静音轨 */
  audioPath?: string;
  /** SRT 字幕文件路径 */
  srtPath?: string;
  /** 没有 SRT 时可直接给分段 */
  segments?: Segment[];
  /** 图片文件路径（按顺序轮播，Ken Burns 缓慢推近）；为空时使用纯色背景 */
  images: string[];
  outPath: string;
  width?: number;
  height?: number;
  fps?: number;
  /** 无可用音频时的最短时长（秒） */
  minDuration?: number;
  /** 指定烧录字幕用的字体名；null 表示强制软字幕；不传则自动查找中文字体 */
  font?: string | null;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}

export interface ComposeResult {
  path: string;
  duration: number;
  subtitles: 'burned' | 'soft' | 'none';
  font?: string;
  silentAudio: boolean;
  imageCount: number;
  bytes: number;
}

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); if (stdout.length > 1e6) stdout = stdout.slice(-1e6); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 2e5) stderr = stderr.slice(-2e5); });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 600000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

let ffmpegOk: boolean | undefined;
/** 检查 ffmpeg 是否可用（结果缓存）。 */
export async function ffmpegAvailable(ffmpegPath = FFMPEG): Promise<boolean> {
  if (ffmpegOk !== undefined && ffmpegPath === FFMPEG) return ffmpegOk;
  let ok = false;
  try { ok = (await run(ffmpegPath, ['-hide_banner', '-version'], { timeoutMs: 10000 })).code === 0; } catch { ok = false; }
  if (ffmpegPath === FFMPEG) ffmpegOk = ok;
  return ok;
}

/** 读取音频时长（秒）；不是有效音频时返回 0。 */
export async function probeDuration(path: string, ffprobePath = FFPROBE): Promise<number> {
  try {
    const r = await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeoutMs: 30000 });
    const d = Number(r.stdout.trim());
    return r.code === 0 && Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

let fontCache: string | null | undefined;
/** 查找系统中的中文字体（fontconfig）；找不到返回 null，此时改用软字幕。 */
export async function findCjkFont(): Promise<string | null> {
  if (fontCache !== undefined) return fontCache;
  try {
    const r = await run('fc-list', [':lang=zh', 'family'], { timeoutMs: 10000 });
    const fams = r.stdout.split('\n').map((l) => l.split(',')[0]!.trim()).filter(Boolean);
    const prefer = fams.find((f) => /Noto Sans CJK SC|Source Han Sans|WenQuanYi|PingFang|Microsoft YaHei|Noto Sans SC/i.test(f));
    fontCache = prefer ?? fams[0] ?? null;
  } catch {
    fontCache = null;
  }
  return fontCache;
}

/** 解析 SRT 的最后结束时间（秒）。 */
export function srtEnd(srt: string): number {
  let end = 0;
  for (const m of srt.matchAll(/-->\s*(\d+):(\d+):(\d+)[,.](\d+)/g)) {
    end = Math.max(end, Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
  }
  return end;
}

/** ffmpeg 滤镜参数中的单引号转义（用于 force_style 中的字体名）。 */
const esc = (s: string) => s.replace(/[\\':,]/g, (c) => `\\${c}`);

export async function composeVideo(input: ComposeInput): Promise<ComposeResult> {
  const W = input.width ?? 1080;
  const H = input.height ?? 1920;
  const fps = input.fps ?? 30;
  const ffmpeg = input.ffmpegPath ?? FFMPEG;
  if (!(await ffmpegAvailable(ffmpeg))) throw new Error('未找到 ffmpeg（可设置环境变量 FFMPEG_PATH）');

  // 在临时目录里用相对文件名运行，避免滤镜参数中的路径转义问题
  const work = mkdtempSync(join(tmpdir(), 'ca-video-'));
  try {
    let srt = '';
    if (input.srtPath && existsSync(input.srtPath)) {
      copyFileSync(input.srtPath, join(work, 'subs.srt'));
      srt = readFileSync(input.srtPath, 'utf8');
    } else if (input.segments?.length) {
      srt = toSrt(input.segments);
      writeFileSync(join(work, 'subs.srt'), srt);
    }
    const hasSubs = srt.trim().length > 0;

    let duration = input.audioPath && existsSync(input.audioPath) ? await probeDuration(input.audioPath, input.ffprobePath) : 0;
    const silentAudio = duration <= 0;
    if (silentAudio) duration = Math.max(input.minDuration ?? 3, hasSubs ? srtEnd(srt) + 0.5 : 0);
    duration = Math.round(duration * 1000) / 1000;

    const images = input.images.filter((p) => existsSync(p));
    const args: string[] = ['-hide_banner', '-y'];
    const filters: string[] = [];
    const n = Math.max(1, images.length);
    const per = duration / n;
    const frames = Math.max(1, Math.round(per * fps));
    if (images.length) {
      images.forEach((p, i) => {
        const name = `img${i}${(basename(p).match(/\.\w+$/)?.[0] ?? '.png').toLowerCase()}`;
        copyFileSync(p, join(work, name));
        args.push('-i', name);
        // 先放大并居中裁切铺满画面，再用 zoompan 做缓慢推近（Ken Burns），奇偶交替推近方向
        const zoom = i % 2 === 0 ? `min(zoom+${(0.12 / frames).toFixed(6)},1.12)` : `if(eq(on,0),1.12,max(zoom-${(0.12 / frames).toFixed(6)},1.0))`;
        filters.push(`[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},trim=duration=${per.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
      });
      filters.push(`${images.map((_, i) => `[v${i}]`).join('')}concat=n=${images.length}:v=1:a=0,format=yuv420p[base]`);
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=0x1f2937:s=${W}x${H}:r=${fps}:d=${duration}`);
      filters.push('[0:v]format=yuv420p[base]');
    }
    const audioIdx = images.length ? images.length : 1;
    if (silentAudio) args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo');
    else {
      copyFileSync(input.audioPath!, join(work, 'audio' + (input.audioPath!.match(/\.\w+$/)?.[0] ?? '.mp3')));
      args.push('-i', 'audio' + (input.audioPath!.match(/\.\w+$/)?.[0] ?? '.mp3'));
    }

    let subtitles: ComposeResult['subtitles'] = 'none';
    let font: string | undefined;
    let vOut = '[base]';
    if (hasSubs) {
      const f = input.font === undefined ? await findCjkFont() : input.font;
      if (f) {
        font = f;
        subtitles = 'burned';
        // SRT 在 libass 中按默认 384x288 的脚本坐标排版，字号/边距按该坐标系给出（底部居中，距底约 1/8）
        filters.push(`[base]subtitles=subs.srt:charenc=UTF-8:force_style='FontName=${esc(f)},FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=36,MarginL=20,MarginR=20'[vs]`);
        vOut = '[vs]';
      } else {
        subtitles = 'soft';
        args.push('-i', 'subs.srt');
      }
    }
    args.push('-filter_complex', filters.join(';'), '-map', vOut, '-map', `${audioIdx}:a`);
    if (subtitles === 'soft') args.push('-map', `${audioIdx + 1}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi');
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', String(fps), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-t', String(duration), '-movflags', '+faststart', 'out.mp4',
    );
    const r = await run(ffmpeg, args, { cwd: work, timeoutMs: input.timeoutMs ?? 600000 });
    if (r.code !== 0 || !existsSync(join(work, 'out.mp4'))) {
      const tail = r.stderr.split('\n').filter((l) => l.trim()).slice(-6).join(' | ');
      throw new Error(`ffmpeg 合成失败（退出码 ${r.code}）：${tail.slice(0, 600)}`);
    }
    mkdirSync(dirname(input.outPath), { recursive: true });
    copyFileSync(join(work, 'out.mp4'), input.outPath);
    return { path: input.outPath, duration, subtitles, font, silentAudio, imageCount: images.length, bytes: statSync(input.outPath).size };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/* ---------------- 草稿视频合成（改写流水线步骤 / 单独触发） ---------------- */

export interface DraftAsset { type: string; url: string; note?: string }
export interface VideoStep { step: string; ok: boolean; message?: string; provider?: string; mock?: boolean }

/** 视频合成流水线依赖（与改写流水线 Deps 结构兼容）。 */
export interface VideoDeps {
  db: DB;
  hub: ModelHub;
  mediaDir: string;
  http?: HttpClient;
}

/** 抖音、视频号默认竖版 1080x1920。 */
export const VIDEO_PLATFORMS: Record<string, { width: number; height: number }> = {
  douyin_script: { width: 1080, height: 1920 },
  channels: { width: 1080, height: 1920 },
};

const localMedia = (mediaDir: string, draftId: number, url: string): string | null => {
  const m = new RegExp(`^/api/media/${draftId}/([\\w.-]+)$`).exec(url);
  return m ? join(mediaDir, String(draftId), m[1]!) : null;
};

/**
 * 为草稿合成竖版 MP4：使用草稿已有的配音/字幕/配图；缺配图且已配置图像能力时按提示词生成（最多 3 张，计入成本）；
 * 缺字幕时按文本估算时间轴；配音不是有效音频（如 Mock）时使用静音轨。输出保存为 /api/media/{draftId}/video.mp4。
 */
export async function composeDraftVideo(
  deps: VideoDeps, draftId: number,
  opts: { platform: string; script: string; assets: DraftAsset[]; imagePrompts?: string[]; generateImages?: boolean; synthesizeVoice?: boolean },
): Promise<{ asset?: DraftAsset; added: DraftAsset[]; steps: VideoStep[] }> {
  const steps: VideoStep[] = [];
  const added: DraftAsset[] = [];
  const dir = join(deps.mediaDir, String(draftId));
  mkdirSync(dir, { recursive: true });
  if (!(await ffmpegAvailable())) return { added, steps: [{ step: '视频合成', ok: false, message: '未找到 ffmpeg（可设置环境变量 FFMPEG_PATH）' }] };
  const size = VIDEO_PLATFORMS[opts.platform] ?? { width: 1080, height: 1920 };
  const task = `video:${opts.platform}`;

  // 配音
  let audioPath = opts.assets.filter((a) => a.type === 'audio').map((a) => localMedia(deps.mediaDir, draftId, a.url)).find((p): p is string => Boolean(p && existsSync(p)));
  if (!audioPath && opts.synthesizeVoice && deps.hub.isConfigured('tts') && opts.script.trim()) {
    try {
      const a = await deps.hub.tts(task, opts.script);
      audioPath = join(dir, 'voiceover.mp3');
      writeFileSync(audioPath, a.audio);
      added.push({ type: 'audio', url: `/api/media/${draftId}/voiceover.mp3`, note: a.mock ? '模拟音频' : undefined });
      steps.push({ step: '视频配音', ok: true, provider: a.provider, mock: a.mock });
    } catch (e) {
      steps.push({ step: '视频配音', ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // 字幕
  const srtPath = opts.assets.filter((a) => a.type === 'subtitle').map((a) => localMedia(deps.mediaDir, draftId, a.url)).find((p): p is string => Boolean(p && existsSync(p)));
  const segments = srtPath ? undefined : estimateSegments(opts.script);

  // 配图
  const images: string[] = [];
  const http = deps.http ?? defaultHttp;
  const fetchImage = async (url: string, name: string): Promise<string | null> => {
    const local = localMedia(deps.mediaDir, draftId, url);
    if (local) return existsSync(local) ? local : null;
    if (!isPublicHttpUrl(url)) return null;
    const r = await http(url, { timeoutMs: 60000, maxBytes: 20 * 1024 * 1024 });
    if (r.status >= 400) return null;
    const p = join(dir, name);
    writeFileSync(p, r.body);
    return p;
  };
  for (const [i, a] of opts.assets.filter((x) => x.type === 'image').entries()) {
    try { const p = await fetchImage(a.url, `video-src-${i + 1}.png`); if (p) images.push(p); } catch { /* 跳过无法获取的图片 */ }
  }
  if (!images.length && opts.generateImages !== false && opts.imagePrompts?.length && deps.hub.isConfigured('image')) {
    for (const [i, prompt] of opts.imagePrompts.slice(0, 3).entries()) {
      try {
        const img = await deps.hub.image(task, `${prompt}（竖版构图 9:16）`);
        const first = img.images[0];
        let p: string | null = null;
        if (first?.b64) { p = join(dir, `video-image-${i + 1}.png`); writeFileSync(p, Buffer.from(first.b64, 'base64')); }
        else if (first?.url) p = await fetchImage(first.url, `video-image-${i + 1}.png`);
        if (p) {
          images.push(p);
          added.push({ type: 'image', url: `/api/media/${draftId}/${basename(p)}`, note: `视频配图：${prompt}` });
        }
        steps.push({ step: `视频配图 ${i + 1}`, ok: Boolean(p), provider: img.provider, mock: img.mock, message: p ? undefined : '图片下载失败' });
      } catch (e) {
        steps.push({ step: `视频配图 ${i + 1}`, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  try {
    const r = await composeVideo({ audioPath, srtPath, segments, images, outPath: join(dir, 'video.mp4'), width: size.width, height: size.height });
    const notes = [
      `${size.width}x${size.height}`, `${r.duration.toFixed(1)} 秒`,
      r.subtitles === 'burned' ? `字幕已烧录（${r.font}）` : r.subtitles === 'soft' ? '未找到中文字体，已封装为软字幕' : '无字幕',
      srtPath ? '' : '字幕时间轴为估算',
      r.silentAudio ? '无有效配音，使用静音轨' : '',
      r.imageCount ? `${r.imageCount} 张图轮播` : '纯色背景',
    ].filter(Boolean).join('；');
    const asset = { type: 'video', url: `/api/media/${draftId}/video.mp4`, note: notes };
    steps.push({ step: '视频合成', ok: true, provider: 'ffmpeg', message: notes });
    return { asset, added, steps };
  } catch (e) {
    steps.push({ step: '视频合成', ok: false, message: e instanceof Error ? e.message : String(e) });
    return { added, steps };
  }
}
