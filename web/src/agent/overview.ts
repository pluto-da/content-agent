/**
 * 工作台总览卡数据（0.8.0，借鉴 dsh-worktable 的“控制室”）：全部来自本机，不调用模型、不读平台页面。
 */
import { CENTERS, WRITE_PLATFORMS } from '../data/platforms';
import { db } from '../local/db';
import { getPrefs } from '../local/store';
import { lastUnfinishedTask, type TaskRow } from './store';

export type Stage = '发现' | '策划' | '创作' | '发布' | '归因';
export interface OverviewRow { platform: string; label: string; pendingPublish: number; inbox: number; hotToday: boolean; lastOpen?: string; stage: Stage }
export interface Overview { rows: OverviewRow[]; resume: TaskRow | null; hotUpdated?: string }

const LAST_OPEN = 'ca.lastOpen';
export function markOpened(platform: string): void {
  try { const m = JSON.parse(localStorage.getItem(LAST_OPEN) ?? '{}'); m[platform] = new Date().toISOString(); localStorage.setItem(LAST_OPEN, JSON.stringify(m)); } catch { /* 无 localStorage */ }
}
function lastOpened(): Record<string, string> { try { return JSON.parse(localStorage.getItem(LAST_OPEN) ?? '{}'); } catch { return {}; } }

export async function computeOverview(): Promise<Overview> {
  const prefs = await getPrefs();
  const drafts = await db.all('drafts');
  const inbox = (await db.all('inbox')).filter((i) => !i.used);
  const cache = await db.getKV<{ at: number; data: { items: { platform?: string }[] } }>('hot.cache');
  const today = new Date().toISOString().slice(0, 10);
  const hotToday = !!cache && new Date(cache.at).toISOString().slice(0, 10) === today;
  const opened = lastOpened();
  const rows: OverviewRow[] = prefs.platforms.map((p) => {
    const writeIds = WRITE_PLATFORMS.filter((w) => w.center === p).map((w) => w.id);
    const mine = drafts.filter((d) => writeIds.includes(String(d.platform)));
    const pendingPublish = mine.filter((d) => d.status === 'approved').length;
    const pendingReview = mine.filter((d) => d.status === 'pending').length;
    const published = mine.filter((d) => d.status === 'handed_off').length;
    const stage: Stage = pendingPublish ? '发布' : pendingReview ? '创作' : published ? '归因' : hotToday ? '策划' : '发现';
    return { platform: p, label: CENTERS.find((c) => c.id === p)?.label ?? p, pendingPublish, inbox: inbox.filter((i) => i.platform === p).length, hotToday: hotToday && !!cache?.data.items.some((i) => i.platform === p || i.platform === '综合'), lastOpen: opened[p], stage };
  });
  return { rows, resume: await lastUnfinishedTask(), hotUpdated: cache ? new Date(cache.at).toISOString() : undefined };
}

/** 侧栏角标：数字 = 已通过待发布草稿数；圆点 = 今天有新热点或有来自该平台的未处理素材。 */
export async function badges(): Promise<Record<string, { count: number; dot: boolean }>> {
  const o = await computeOverview();
  return Object.fromEntries(o.rows.map((r) => [r.platform, { count: r.pendingPublish, dot: r.inbox > 0 || r.hotToday }]));
}
