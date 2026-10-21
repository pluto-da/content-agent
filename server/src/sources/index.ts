import type { DB } from '../db.js';
import { parseJson } from '../db.js';
import { isAllowedSourceKind, type SourceKind } from '../boundaries.js';
import type { SourceAdapter, SourceContext, FetchResult } from './types.js';
import { rssAdapter } from './rss.js';
import { webAdapter } from './web.js';
import { wechatAdapter, xAdapter, douyinAdapter } from './official.js';
import { ingest } from '../modules/library.js';
import type { TaskQueue } from '../queue.js';
import { PermanentError } from '../queue.js';

export const ADAPTERS: Record<SourceKind, SourceAdapter> = {
  rss: rssAdapter,
  web: webAdapter,
  wechat_mp: wechatAdapter,
  x_api: xAdapter,
  douyin_open: douyinAdapter,
};

export interface SourceRow { id: number; kind: SourceKind; name: string; config: Record<string, unknown>; interval_min: number; enabled: number }

export function addSource(db: DB, kind: string, name: string, config: Record<string, unknown>, intervalMin = 60): number {
  if (!isAllowedSourceKind(kind)) throw new Error(`不允许的信息源类型：${kind}`);
  return Number(db.prepare('INSERT INTO sources(kind, name, config, interval_min) VALUES(?,?,?,?)').run(kind, name, JSON.stringify(config), Math.max(5, intervalMin)).lastInsertRowid);
}

export function listSources(db: DB): SourceRow[] {
  return (db.prepare('SELECT * FROM sources ORDER BY id').all() as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as SourceRow), config: parseJson(r.config, {}) }));
}

/** 状态：未配置的官方源如实显示“未配置”。 */
export function sourceStatus(src: SourceRow, ctx: SourceContext): { status: 'ready' | 'not_configured'; missing: string[] } {
  const a = ADAPTERS[src.kind];
  const missing = a.requiredSecrets.filter((s) => !ctx.vault.has(s));
  return { status: missing.length ? 'not_configured' : 'ready', missing };
}

/** 经任务队列运行一次采集；未配置与 robots 禁止属于不可重试错误。 */
export async function runSource(db: DB, queue: TaskQueue, ctx: SourceContext, src: SourceRow): Promise<FetchResult & { inserted?: number }> {
  const startedAt = new Date().toISOString();
  const runId = Number(db.prepare("INSERT INTO runs(source_id, started_at, status) VALUES(?, ?, 'running')").run(src.id, startedAt).lastInsertRowid);
  let last = { status: 'error', items: [], message: '未执行' } as FetchResult;
  const r = await queue.run({ kind: 'collect', label: `采集：${src.name}`, retries: 2 }, async () => {
    last = await ADAPTERS[src.kind].fetch(src.config, ctx);
    if (last.status === 'not_configured') throw new PermanentError(last.message);
    if (last.status === 'error' && /robots|无效|不是公网/.test(last.message)) throw new PermanentError(last.message);
    if (last.status === 'error') throw new Error(last.message);
    return last.items.length;
  });
  let inserted = 0;
  const final = last as FetchResult;
  if (r.ok && final.status === 'ok') inserted = ingest(db, src.id, final.items).inserted;
  db.prepare("UPDATE runs SET finished_at = datetime('now'), status = ?, fetched = ?, inserted = ?, message = ? WHERE id = ?").run(
    final.status, final.items.length, inserted, final.message ?? r.error ?? null, runId,
  );
  return { ...final, inserted };
}

/** 简单调度器：每分钟检查一次到期的源。 */
export class Scheduler {
  private timer?: NodeJS.Timeout;
  private busy = new Set<number>();
  constructor(private readonly db: DB, private readonly queue: TaskQueue, private readonly ctx: SourceContext) {}
  due(now = Date.now()): SourceRow[] {
    return listSources(this.db).filter((s) => {
      if (!s.enabled || this.busy.has(s.id)) return false;
      const last = this.db.prepare('SELECT started_at FROM runs WHERE source_id = ? ORDER BY id DESC LIMIT 1').get(s.id) as { started_at: string } | undefined;
      return !last || now - Date.parse(last.started_at) >= s.interval_min * 60000;
    });
  }
  async tick(): Promise<number> {
    const due = this.due();
    await Promise.all(due.map(async (s) => {
      this.busy.add(s.id);
      try { await runSource(this.db, this.queue, this.ctx, s); } finally { this.busy.delete(s.id); }
    }));
    return due.length;
  }
  start(intervalMs = 60000): void {
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

export function recentRuns(db: DB, limit = 50): unknown[] {
  return db.prepare('SELECT r.*, s.name AS source_name FROM runs r LEFT JOIN sources s ON s.id = r.source_id ORDER BY r.id DESC LIMIT ?').all(limit);
}
