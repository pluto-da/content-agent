/** 健康度（5.6）：沿用服务端策略——30 分钟窗口内 ≥4 次且失败率 ≥50% 视为不健康；只统计可重试类错误与成功。 */
export class HealthTracker {
  private events = new Map<string, { at: number; ok: boolean }[]>();
  constructor(private windowMs = 30 * 60 * 1000, private minCalls = 4, private failRate = 0.5) {}
  record(key: string, ok: boolean, at = Date.now()): void {
    const list = (this.events.get(key) ?? []).filter((e) => at - e.at < this.windowMs);
    list.push({ at, ok });
    this.events.set(key, list.slice(-200));
  }
  stats(key: string, at = Date.now()): { calls: number; failures: number; rate: number } {
    const list = (this.events.get(key) ?? []).filter((e) => at - e.at < this.windowMs);
    const failures = list.filter((e) => !e.ok).length;
    return { calls: list.length, failures, rate: list.length ? failures / list.length : 0 };
  }
  healthy(key: string, at = Date.now()): boolean { const s = this.stats(key, at); return !(s.calls >= this.minCalls && s.rate >= this.failRate); }
  snapshot(): Record<string, { calls: number; failures: number; rate: number }> { return Object.fromEntries([...this.events.keys()].map((k) => [k, this.stats(k)])); }
}
