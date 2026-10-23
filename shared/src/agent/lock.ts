/**
 * 会话单写者锁 + 输入队列 + 发送去重（6.2 / 6.14）：
 * - 每个会话一把锁（conversationId → runId），心跳 5 秒，30 秒无心跳视为崩溃残留，可被新运行接管（旧运行置 failed:interrupted）；
 * - 运行中再发送 → 进入该会话输入队列；全局并发 ≤2 个 Run；
 * - 同一 clientMessageId 只入库一次；“内容哈希 + 2 秒窗口”去重。
 * 存储由 LockStore 注入（web 层用 IndexedDB 集合 locks + BroadcastChannel；测试用内存）。
 */
export interface LockRecord { conversationId: number; runId: string; heartbeat: number; owner: string }
export interface LockStore { get(cid: number): Promise<LockRecord | undefined>; put(r: LockRecord): Promise<void>; del(cid: number): Promise<void>; all(): Promise<LockRecord[]> }
export const HEARTBEAT_MS = 5000, STALE_MS = 30000;

export function memoryLockStore(): LockStore {
  const m = new Map<number, LockRecord>();
  return { async get(c) { return m.get(c); }, async put(r) { m.set(r.conversationId, { ...r }); }, async del(c) { m.delete(c); }, async all() { return [...m.values()]; } };
}
export class LockManager {
  private queues = new Map<number, string[]>();
  private seen = new Map<string, number>();
  constructor(private store: LockStore, private owner: string, private now: () => number = Date.now, private maxGlobal = 2) {}
  /** 获取锁：成功返回 {ok}；已被活跃运行占用返回 busy；残留锁被接管返回 takeover（含旧 runId）。 */
  async acquire(cid: number, runId: string): Promise<{ ok: true; takeover?: string } | { ok: false; reason: 'busy' | 'global_limit'; holder?: string }> {
    const cur = await this.store.get(cid);
    const t = this.now();
    let takeover: string | undefined;
    if (cur && t - cur.heartbeat <= STALE_MS) return { ok: false, reason: 'busy', holder: cur.runId };
    if (cur) takeover = cur.runId;
    const active = (await this.store.all()).filter((l) => l.conversationId !== cid && t - l.heartbeat <= STALE_MS);
    if (active.length >= this.maxGlobal) return { ok: false, reason: 'global_limit' };
    await this.store.put({ conversationId: cid, runId, heartbeat: t, owner: this.owner });
    return takeover ? { ok: true, takeover } : { ok: true };
  }
  async heartbeat(cid: number, runId: string): Promise<boolean> {
    const cur = await this.store.get(cid);
    if (!cur || cur.runId !== runId) return false;
    await this.store.put({ ...cur, heartbeat: this.now() });
    return true;
  }
  async release(cid: number, runId: string): Promise<void> { const cur = await this.store.get(cid); if (cur?.runId === runId) await this.store.del(cid); }
  enqueue(cid: number, text: string): number { const q = this.queues.get(cid) ?? []; q.push(text); this.queues.set(cid, q); return q.length; }
  dequeue(cid: number): string | undefined { const q = this.queues.get(cid); const v = q?.shift(); if (q && !q.length) this.queues.delete(cid); return v; }
  queued(cid: number): number { return this.queues.get(cid)?.length ?? 0; }
  clearQueue(cid: number): void { this.queues.delete(cid); }
  /** 发送去重：同 clientMessageId 或同内容 2 秒内 → 重复。 */
  isDuplicate(cid: number, text: string, clientMessageId?: string): boolean {
    const t = this.now();
    for (const [k, at] of this.seen) if (t - at > 60000) this.seen.delete(k);
    const keys = [clientMessageId ? `id:${clientMessageId}` : '', `c:${cid}:${text.trim()}`].filter(Boolean);
    const dup = keys.some((k) => { const at = this.seen.get(k); return at !== undefined && (k.startsWith('id:') || t - at < 2000); });
    if (!dup) for (const k of keys) this.seen.set(k, t);
    return dup;
  }
}
