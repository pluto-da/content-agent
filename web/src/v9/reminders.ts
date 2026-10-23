/**
 * 本机提醒调度（6.12，ADR-009；0.10.0 补 Android 13+ 权限与精确时间，ADR-013）：只在本 App 内、只发本机通知，不调用平台、不发布、不花钱、不执行任何动作。
 * - 安卓 App：每条待提醒在到期前用 @capacitor/local-notifications 预排（schedule.at + allowWhileIdle），App 关闭、进程被杀也由系统 AlarmManager 弹出；
 *   Android 13+ 先查 / 申请 POST_NOTIFICATIONS；Android 12+ 查 SCHEDULE_EXACT_ALARM（没开时插件退回非精确闹钟，可能晚几分钟，界面如实提示并给“去系统设置开启”）；
 *   拒绝通知权限：不预排、不崩溃，到点在 App 内显示（App 打开时每 30 秒检查一次）；
 * - 网页 / 电脑：App 打开时每 30 秒检查一次到期提醒，用系统通知（无权限时只在 App 内显示）；
 * - 重复提醒（rrule 仅支持每周几 / 每天）到点后排下一次；点开通知进入对应会话（link）。
 */
import { nextWeekly, shDateTime } from '@content-agent/shared';
import { db, type Row } from '../local/db';
import { notify, runtime } from '../runtime';
import { audit } from './ops';

export interface Reminder { id: number; text: string; at?: string; rrule?: string; link?: string; status: 'scheduled' | 'fired' | 'cancelled'; firedAt?: string; created_at?: string; nativeAt?: string | null }
export const listReminders = async (): Promise<Reminder[]> => ((await db.all('reminders')) as unknown as Reminder[]).sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));

/* ---------------- 原生通知（安卓 / iOS App） ---------------- */
export type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported';
export interface NotifyPerms { display: PermState; exact: PermState; native: boolean; sdkNote?: string }
type LN = typeof import('@capacitor/local-notifications')['LocalNotifications'];
let lnP: Promise<LN | null> | null = null;
/** 测试用：注入假的 LocalNotifications。 */
export function setLocalNotificationsForTest(x: LN | null): void { lnP = Promise.resolve(x); }
async function ln(): Promise<LN | null> {
  if (runtime() !== 'capacitor') return lnP ? lnP : null;
  return (lnP ??= import('@capacitor/local-notifications').then((m) => m.LocalNotifications).catch(() => null));
}
const norm = (s: string | undefined): PermState => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : s ? 'prompt' : 'unsupported');

export async function notifyPerms(): Promise<NotifyPerms> {
  const L = await ln();
  if (!L) {
    const web = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission === 'default' ? 'prompt' : (Notification.permission as PermState);
    return { display: web, exact: 'unsupported', native: false };
  }
  let display: PermState = 'unsupported';
  let exact: PermState;
  try { display = norm((await L.checkPermissions()).display); } catch { /* 插件不可用 */ }
  try { exact = norm((await L.checkExactNotificationSetting()).exact_alarm); } catch { exact = 'unsupported'; /* Android 11 及以下 / iOS 无此项 */ }
  return { display, exact, native: true };
}
/** 申请通知权限（Android 13+ 弹系统框；拒绝后返回 denied，不抛错）。 */
export async function requestNotifyPermission(): Promise<PermState> {
  const L = await ln();
  try {
    if (L) return norm((await L.requestPermissions()).display);
    if (typeof Notification === 'undefined') return 'unsupported';
    return norm(await Notification.requestPermission());
  } catch { return 'denied'; }
}
/** 打开系统“闹钟和提醒”设置（Android 12+）。 */
export async function openExactAlarmSettings(): Promise<PermState> {
  const L = await ln(); if (!L) return 'unsupported';
  try { return norm((await L.changeExactNotificationSetting()).exact_alarm); } catch { return 'unsupported'; }
}
const nativeId = (id: number) => 100000 + (id % 2000000000);
/**
 * 把待提醒同步到系统闹钟：未来的、未预排或时间变了的 → schedule；已取消 / 已提醒的 → cancel。
 * 没有通知权限时不预排（返回原因），提醒仍会在 App 打开时显示。
 */
export async function syncNativeSchedule(now = new Date()): Promise<{ scheduled: number; cancelled: number; skipped?: string }> {
  const L = await ln();
  if (!L) return { scheduled: 0, cancelled: 0, skipped: 'not_native' };
  const perms = await notifyPerms();
  const list = await listReminders();
  let cancelled = 0, scheduled = 0;
  const stale = list.filter((r) => r.nativeAt && (r.status !== 'scheduled' || r.nativeAt !== r.at));
  if (stale.length) { try { await L.cancel({ notifications: stale.map((r) => ({ id: nativeId(r.id) })) }); cancelled = stale.length; } catch { /* 已不存在 */ } for (const r of stale) await db.update('reminders', r.id, { nativeAt: null }); }
  if (perms.display !== 'granted') return { scheduled: 0, cancelled, skipped: 'no_permission' };
  const todo = list.filter((r) => r.status === 'scheduled' && r.at && Date.parse(r.at) > now.getTime() && r.nativeAt !== r.at);
  if (todo.length) {
    try {
      await L.schedule({ notifications: todo.map((r) => ({ id: nativeId(r.id), title: '超级工作台提醒', body: r.text, schedule: { at: new Date(r.at!), allowWhileIdle: true }, extra: { reminderId: r.id, link: r.link ?? null } })) });
      for (const r of todo) await db.update('reminders', r.id, { nativeAt: r.at });
      scheduled = todo.length;
    } catch (e) { return { scheduled: 0, cancelled, skipped: `schedule_failed: ${(e as Error).message}` }; }
  }
  return { scheduled, cancelled };
}
let tapHooked = false;
async function hookTap(): Promise<void> {
  if (tapHooked) return; const L = await ln(); if (!L) return; tapHooked = true;
  try { await L.addListener('localNotificationActionPerformed', (a) => { const link = (a.notification.extra as { link?: string } | undefined)?.link; if (link && typeof window !== 'undefined') window.location.hash = link.startsWith('#') ? link : `#${link}`; }); } catch { tapHooked = false; }
}

export async function addReminder(r: { text: string; at: string; rrule?: string; link?: string }): Promise<Reminder> {
  const row = await db.insert('reminders', { ...r, status: 'scheduled' });
  await audit({ kind: 'setting_change', actor: 'user', summary: `新建提醒：${shDateTime(new Date(r.at))} ${r.text}`, outcome: 'ok' });
  await syncNativeSchedule().catch(() => undefined);
  return row as unknown as Reminder;
}
export async function cancelReminder(id: number): Promise<void> { await db.update('reminders', id, { status: 'cancelled' }); await syncNativeSchedule().catch(() => undefined); }

/** 到期判断（纯函数，便于测试）：返回需要触发的提醒与重复提醒的下一次时间。 */
export function due(list: Reminder[], now: Date): { fire: Reminder[]; next: Record<number, string | null> } {
  const fire = list.filter((r) => r.status === 'scheduled' && r.at && Date.parse(r.at) <= now.getTime());
  const next: Record<number, string | null> = {};
  for (const r of fire) next[r.id] = r.rrule ? nextWeekly(r.rrule, now)?.toISOString() ?? null : null;
  return { fire, next };
}
/** 执行一次检查：只发通知 + 写状态，不做任何其他动作。系统已预排过的那一次不再重复弹（只更新状态与 App 内提示）。 */
export async function tick(now = new Date(), send: (title: string, body: string) => Promise<boolean> = notify): Promise<number> {
  const { fire, next } = due(await listReminders(), now);
  for (const r of fire) {
    const deliveredByOs = !!r.nativeAt && r.nativeAt === r.at;
    if (!deliveredByOs) await send('超级工作台提醒', r.text).catch(() => false);
    const patch: Partial<Row> = next[r.id] ? { at: next[r.id]!, firedAt: now.toISOString(), nativeAt: null } : { status: 'fired', firedAt: now.toISOString(), nativeAt: null };
    await db.update('reminders', r.id, patch as Record<string, unknown>);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ca:reminder-fired', { detail: { id: r.id, text: r.text, link: r.link } }));
  }
  if (fire.some((r) => next[r.id])) await syncNativeSchedule(now).catch(() => undefined);   // 重复提醒排下一次
  return fire.length;
}
let timer: ReturnType<typeof setInterval> | null = null;
export function startReminderScheduler(): () => void {
  if (timer) return () => {};
  void tick().catch(() => 0);
  void hookTap();
  void syncNativeSchedule().catch(() => undefined);
  timer = setInterval(() => void tick().catch(() => 0), 30000);
  return () => { if (timer) clearInterval(timer); timer = null; };
}
export const reminderRowsForTest = (rows: Row[]): Reminder[] => rows as unknown as Reminder[];
