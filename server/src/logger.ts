import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact } from './crypto.js';

export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry { time: string; level: Level; module: string; msg: string; [k: string]: unknown }

/** 结构化 JSON 日志：写入文件、保留内存环形缓冲（供界面查看），全部脱敏。 */
export class Logger {
  private ring: LogEntry[] = [];
  constructor(private readonly file?: string, private readonly max = 500, private readonly echo = false) {
    if (file) mkdirSync(dirname(file), { recursive: true });
  }
  log(level: Level, module: string, msg: string, fields: Record<string, unknown> = {}): LogEntry {
    const entry: LogEntry = { time: new Date().toISOString(), level, module, msg, ...fields };
    const line = redact(JSON.stringify(entry));
    const safe = JSON.parse(line) as LogEntry;
    this.ring.push(safe);
    if (this.ring.length > this.max) this.ring.shift();
    if (this.file) appendFileSync(this.file, line + '\n');
    if (this.echo) process.stdout.write(line + '\n');
    return safe;
  }
  info(m: string, msg: string, f?: Record<string, unknown>) { return this.log('info', m, msg, f); }
  warn(m: string, msg: string, f?: Record<string, unknown>) { return this.log('warn', m, msg, f); }
  error(m: string, msg: string, f?: Record<string, unknown>) { return this.log('error', m, msg, f); }
  recent(limit = 200, level?: Level): LogEntry[] {
    const list = level ? this.ring.filter((e) => e.level === level) : this.ring;
    return list.slice(-limit).reverse();
  }
}
