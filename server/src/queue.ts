import type { DB } from './db.js';
import type { Logger } from './logger.js';

export interface TaskOptions {
  kind: string;
  label: string;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** 不可重试的错误（如未配置、robots 禁止）。 */
export class PermanentError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PermanentError';
  }
}

export function backoffDelay(attempt: number, base: number, cap = 60_000): number {
  return Math.min(cap, base * 2 ** attempt);
}

/**
 * 持久化任务队列：并发上限、失败指数退避重试、超时；所有任务写入 tasks 表供“任务面板”查看。
 */
export class TaskQueue {
  private running = 0;
  private waiters: (() => void)[] = [];
  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
    private readonly concurrency = 3,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    // 进程重启时，上次未完成的任务标为失败（如实记录，不静默丢弃）
    db.prepare("UPDATE tasks SET status = 'failed', error = '进程重启，任务中断', finished_at = datetime('now') WHERE status IN ('queued','running')").run();
  }

  private async acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
    this.running++;
  }
  private release(): void {
    this.running--;
    this.waiters.shift()?.();
  }

  async run<T>(opts: TaskOptions, fn: () => Promise<T>): Promise<{ id: number; ok: boolean; result?: T; error?: string }> {
    const id = Number(this.db.prepare("INSERT INTO tasks(kind, label, status) VALUES(?, ?, 'queued')").run(opts.kind, opts.label).lastInsertRowid);
    await this.acquire();
    const started = Date.now();
    this.db.prepare("UPDATE tasks SET status = 'running', started_at = datetime('now') WHERE id = ?").run(id);
    const retries = opts.retries ?? 2;
    let attempt = 0;
    let lastErr: string;
    try {
      for (;;) {
        attempt++;
        try {
          const result = await this.withTimeout(fn(), opts.timeoutMs ?? 180_000);
          this.db.prepare("UPDATE tasks SET status = 'succeeded', attempts = ?, finished_at = datetime('now'), ms = ?, result = ? WHERE id = ?").run(
            attempt, Date.now() - started, summarize(result), id,
          );
          this.logger.info('queue', '任务成功', { taskId: id, kind: opts.kind, attempts: attempt, ms: Date.now() - started });
          return { id, ok: true, result };
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          const permanent = e instanceof PermanentError || (e instanceof Error && /^(未配置|NotConfigured)/.test(e.message)) || (e instanceof Error && e.name === 'NotConfiguredError');
          this.logger.warn('queue', '任务失败', { taskId: id, kind: opts.kind, attempt, error: lastErr, permanent });
          if (permanent || attempt > retries) break;
          await this.sleep(backoffDelay(attempt - 1, opts.baseDelayMs ?? 1000));
        }
      }
      this.db.prepare("UPDATE tasks SET status = 'failed', attempts = ?, error = ?, finished_at = datetime('now'), ms = ? WHERE id = ?").run(attempt, lastErr, Date.now() - started, id);
      return { id, ok: false, error: lastErr };
    } finally {
      this.release();
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`任务超时（${ms} 毫秒）`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); });
    });
  }

  list(limit = 100, status?: TaskStatus): unknown[] {
    if (status) return this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit);
    return this.db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit);
  }

  stats(): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}

function summarize(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? '' : s.slice(0, 300);
  } catch {
    return '';
  }
}
