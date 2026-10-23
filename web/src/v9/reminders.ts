/**
 * 本机提醒调度（6.12，ADR-009）：只在本 App 内、只发本机通知，不调用平台、不发布、不花钱、不执行任何动作。
 * - 安卓 App：到期前用 @capacitor/local-notifications 预排（App 关闭也能弹出；Android 13+ 权限与精确时间需真机验证）；
 * - 网页 / 电脑：App 打开时每 30 秒检查一次到期提醒，用系统通知（无权限时只在 App 内显示）；
 * - 重复提醒（rrule 仅支持每周几 / 每天）到点后排下一次；点开通知进入对应会话（link）。
 */
import { nextWeekly, shDateTime } from '@content-agent/shared';
import { db, type Row } from '../local/db';
import { notify } from '../runtime';
import { audit } from './ops';

export interface Reminder { id: number; text: string; at?: string; rrule?: string; link?: string; status: 'scheduled' | 'fired' | 'cancelled'; firedAt?: string; created_at?: string }
export const listReminders = async (): Promise<Reminder[]> => ((await db.all('reminders')) as unknown as Reminder[]).sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
export async function addReminder(r: { text: string; at: string; rrule?: string; link?: string }): Promise<Reminder> {
  const row = await db.insert('reminders', { ...r, status: 'scheduled' });
  await audit({ kind: 'setting_change', actor: 'user', summary: `新建提醒：${shDateTime(new Date(r.at))} ${r.text}`, outcome: 'ok' });
  return row as unknown as Reminder;
}
export async function cancelReminder(id: number): Promise<void> { await db.update('reminders', id, { status: 'cancelled' }); }

/** 到期判断（纯函数，便于测试）：返回需要触发的提醒与重复提醒的下一次时间。 */
export function due(list: Reminder[], now: Date): { fire: Reminder[]; next: Record<number, string | null> } {
  const fire = list.filter((r) => r.status === 'scheduled' && r.at && Date.parse(r.at) <= now.getTime());
  const next: Record<number, string | null> = {};
  for (const r of fire) next[r.id] = r.rrule ? nextWeekly(r.rrule, now)?.toISOString() ?? null : null;
  return { fire, next };
}
/** 执行一次检查：只发通知 + 写状态，不做任何其他动作。 */
export async function tick(now = new Date(), send: (title: string, body: string) => Promise<boolean> = notify): Promise<number> {
  const { fire, next } = due(await listReminders(), now);
  for (const r of fire) {
    await send('超级工作台提醒', r.text).catch(() => false);
    const patch: Partial<Row> = next[r.id] ? { at: next[r.id]!, firedAt: now.toISOString() } : { status: 'fired', firedAt: now.toISOString() };
    await db.update('reminders', r.id, patch as Record<string, unknown>);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ca:reminder-fired', { detail: { id: r.id, text: r.text, link: r.link } }));
  }
  return fire.length;
}
let timer: ReturnType<typeof setInterval> | null = null;
export function startReminderScheduler(): () => void {
  if (timer) return () => {};
  void tick();
  timer = setInterval(() => void tick(), 30000);
  return () => { if (timer) clearInterval(timer); timer = null; };
}
export const reminderRowsForTest = (rows: Row[]): Reminder[] => rows as unknown as Reminder[];
