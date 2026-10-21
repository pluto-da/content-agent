import { randomUUID } from 'node:crypto';
import { WebSocket as UndiciWebSocket } from 'undici';
import type { AudioResult } from './types.js';

/**
 * 百炼 CosyVoice 语音合成（官方 WebSocket 协议，2026-10-22 核实）
 * 文档：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 *
 * 地址：wss://dashscope.aliyuncs.com/api-ws/v1/inference
 *      或业务空间专属域名 wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
 * 握手头：Authorization: Bearer <API Key>（握手阶段鉴权，失败返回 401/403）
 * 流程：run-task → 等待 task-started → 一个或多个 continue-task（文本）→ finish-task
 *      → 二进制帧为音频流，result-generated 为进度事件 → task-finished 结束 / task-failed 失败
 * 同一任务的 run/continue/finish 必须使用同一个 task_id。
 */

/** 最小 WebSocket 接口（便于注入测试替身）。 */
export interface WsLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', fn: (ev: { data?: unknown; message?: string; code?: number; reason?: string; error?: unknown }) => void): void;
}
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike;

export const defaultWsFactory: WsFactory = (url, headers) => new UndiciWebSocket(url, { headers }) as unknown as WsLike;

/** 由原生 REST 基础地址推导 WebSocket 地址：https://host/api/v1 → wss://host/api-ws/v1/inference */
export function cosyvoiceWsUrl(nativeBaseURL: string): string {
  const u = new URL(nativeBaseURL);
  return `wss://${u.host}/api-ws/v1/inference`;
}

/** 按句读切分文本，每段不超过 max 个字符（continue-task 文本有长度限制）。 */
export function splitForTts(text: string, max = 500): string[] {
  const parts = text.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) {
      out.push(cur);
      cur = '';
    }
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
    } else cur += p;
  }
  if (cur) out.push(cur);
  return out;
}

export interface CosyVoiceOptions {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  text: string;
  format?: 'mp3' | 'wav' | 'pcm';
  sampleRate?: number;
  timeoutMs?: number;
  wsFactory?: WsFactory;
  workspace?: string;
}

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm' } as const;

async function toBuffer(data: unknown): Promise<Buffer | null> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  return null;
}

export function cosyvoiceSynthesize(o: CosyVoiceOptions): Promise<{ audio: Buffer; mime: string; characters: number }> {
  const format = o.format ?? 'mp3';
  const taskId = randomUUID();
  const chunks = splitForTts(o.text);
  if (!chunks.length) return Promise.reject(new Error('CosyVoice：待合成文本为空'));
  const headers: Record<string, string> = { authorization: `Bearer ${o.apiKey}`, ...(o.workspace ? { 'X-DashScope-WorkSpace': o.workspace } : {}) };
  const ws = (o.wsFactory ?? defaultWsFactory)(o.url, headers);
  ws.binaryType = 'arraybuffer';
  const header = (action: string) => ({ action, task_id: taskId, streaming: 'duplex' });

  return new Promise((resolve, reject) => {
    const audio: Buffer[] = [];
    const pending: Promise<void>[] = [];
    let characters = 0;
    let settled = false;
    const done = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(1000, 'done'); } catch { /* 已关闭 */ }
      if (err) reject(err);
      else void Promise.all(pending).then(() => {
        const buf = Buffer.concat(audio);
        if (!buf.length) reject(new Error('CosyVoice 未返回音频数据'));
        else resolve({ audio: buf, mime: MIME[format], characters });
      });
    };
    const timer = setTimeout(() => done(new Error('CosyVoice 合成超时')), o.timeoutMs ?? 120000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        header: header('run-task'),
        payload: {
          task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: o.model,
          parameters: { text_type: 'PlainText', voice: o.voice, format, sample_rate: o.sampleRate ?? 22050, volume: 50, rate: 1, pitch: 1 },
          input: {},
        },
      }));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        pending.push(toBuffer(ev.data).then((b) => { if (b) audio.push(b); }));
        return;
      }
      let msg: { header?: { event?: string; error_code?: string; error_message?: string }; payload?: { usage?: { characters?: number } } };
      try { msg = JSON.parse(ev.data) as typeof msg; } catch { return; }
      const event = msg.header?.event;
      if (msg.payload?.usage?.characters) characters = msg.payload.usage.characters;
      if (event === 'task-started') {
        for (const text of chunks) ws.send(JSON.stringify({ header: header('continue-task'), payload: { input: { text } } }));
        ws.send(JSON.stringify({ header: header('finish-task'), payload: { input: {} } }));
      } else if (event === 'task-finished') {
        done(null);
      } else if (event === 'task-failed') {
        done(new Error(`CosyVoice 任务失败：${msg.header?.error_code ?? ''} ${msg.header?.error_message ?? ''}`.trim()));
      }
    });
    ws.addEventListener('error', (ev) => done(new Error(`CosyVoice 连接错误：${ev.message ?? (ev.error instanceof Error ? ev.error.message : '握手失败（请检查 API Key 与地址）')}`)));
    ws.addEventListener('close', (ev) => done(new Error(`CosyVoice 连接在任务结束前关闭（${ev.code ?? ''} ${ev.reason ?? ''}）`.trim())));
  });
}

/** 供适配器使用的封装：返回统一的 AudioResult 字段（不含 provider/model/ms）。 */
export async function cosyvoiceTts(o: CosyVoiceOptions): Promise<Pick<AudioResult, 'audio' | 'mime' | 'usage'>> {
  const r = await cosyvoiceSynthesize(o);
  return { audio: r.audio, mime: r.mime, usage: { unit: 'char', input: r.characters || o.text.length, output: 0 } };
}
