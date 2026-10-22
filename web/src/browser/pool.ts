/**
 * 内嵌浏览器保活池（纯逻辑，可单测）：每个平台一个实例，同时保活上限默认 4（2–6 可调）。
 * 超过上限按最近最少使用（LRU）休眠最旧的非当前实例，只保留其最后地址；再次切回时按该地址重新打开（restored=true）。
 * 返回“要对原生层做什么”的指令列表，由 browserHost 执行，便于记录与测试（B4）。
 */
export interface PoolEntry { platform: string; url: string; lastUsed: number; alive: boolean; canGoBack?: boolean; canGoForward?: boolean; title?: string }
export type PoolAction =
  | { op: 'open'; platform: string; url: string; restored: boolean }
  | { op: 'show'; platform: string }
  | { op: 'hibernate'; platform: string; url: string };

export const KEEP_ALIVE_MIN = 2;
export const KEEP_ALIVE_MAX = 6;
export const KEEP_ALIVE_DEFAULT = 4;

export class BrowserPool {
  private entries = new Map<string, PoolEntry>();
  private tick = 0;
  current: string | null = null;
  limit: number;

  constructor(limit = KEEP_ALIVE_DEFAULT, private now: () => number = () => ++this.tick) {
    this.limit = clampLimit(limit);
  }

  setLimit(n: number): PoolAction[] { this.limit = clampLimit(n); return this.evict(); }

  get(platform: string): PoolEntry | undefined { return this.entries.get(platform); }
  aliveCount(): number { return [...this.entries.values()].filter((e) => e.alive).length; }
  list(): PoolEntry[] { return [...this.entries.values()].map((e) => ({ ...e })); }

  /** 切到某平台：已保活 → show；休眠过 → 按最后地址 open(restored)；从未打开 → 按 homeUrl open。 */
  activate(platform: string, homeUrl: string): PoolAction[] {
    const actions: PoolAction[] = [];
    const e = this.entries.get(platform);
    const t = this.now();
    if (e?.alive) {
      e.lastUsed = t;
      actions.push({ op: 'show', platform });
    } else if (e) {
      e.alive = true; e.lastUsed = t;
      actions.push({ op: 'open', platform, url: e.url, restored: true }, { op: 'show', platform });
    } else {
      this.entries.set(platform, { platform, url: homeUrl, lastUsed: t, alive: true });
      actions.push({ op: 'open', platform, url: homeUrl, restored: false }, { op: 'show', platform });
    }
    this.current = platform;
    return [...this.evict(), ...actions];
  }

  /** 原生层回传的导航状态（url / 标题 / 前进后退）。 */
  update(platform: string, s: { url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean }): void {
    const e = this.entries.get(platform);
    if (!e) return;
    if (s.url && /^https:\/\//.test(s.url)) e.url = s.url;
    if (s.title !== undefined) e.title = s.title;
    if (s.canGoBack !== undefined) e.canGoBack = s.canGoBack;
    if (s.canGoForward !== undefined) e.canGoForward = s.canGoForward;
  }

  /** 系统内存紧张：休眠所有非当前实例。 */
  trim(): PoolAction[] {
    const out: PoolAction[] = [];
    for (const e of this.entries.values()) if (e.alive && e.platform !== this.current) { e.alive = false; out.push({ op: 'hibernate', platform: e.platform, url: e.url }); }
    return out;
  }

  remove(platform: string): void { this.entries.delete(platform); if (this.current === platform) this.current = null; }

  private evict(): PoolAction[] {
    const out: PoolAction[] = [];
    const alive = [...this.entries.values()].filter((e) => e.alive);
    // 当前平台即将被激活时也计入；超出上限时休眠最久未用的非当前实例
    while (alive.length > this.limit) {
      const victims = alive.filter((e) => e.platform !== this.current).sort((a, b) => a.lastUsed - b.lastUsed);
      const v = victims[0];
      if (!v) break;
      v.alive = false;
      alive.splice(alive.indexOf(v), 1);
      out.push({ op: 'hibernate', platform: v.platform, url: v.url });
    }
    return out;
  }
}

export function clampLimit(n: number): number {
  return Math.max(KEEP_ALIVE_MIN, Math.min(KEEP_ALIVE_MAX, Math.round(Number.isFinite(n) ? n : KEEP_ALIVE_DEFAULT)));
}
