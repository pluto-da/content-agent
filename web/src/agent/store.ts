/**
 * Agent 本机数据（0.8.0）：会话、消息、素材箱、任务检查点、账号画像、L2“记住此类”、界面事件总线。
 * 全部在 IndexedDB；素材只存本机。
 */
import { db, emitStoreChange, type Row } from '../local/db';

/* ---------- 事件总线（工具 → 外壳：打开平台、开始巡视、预览“发给 Agent”） ---------- */
export type ShellEvent =
  | { type: 'open'; platform: string; url: string; label?: string; hosts?: string[] }
  | { type: 'patrol'; stops: { id: string; label: string; url: string; hosts: string[]; platform: string }[] }
  | { type: 'inbox-preview'; item: InboxDraft }
  | { type: 'inbox-changed' }
  | { type: 'drafts-changed' };
type Fn = (e: ShellEvent) => void;
const listeners = new Set<Fn>();
export const bus = {
  on(fn: Fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  emit(e: ShellEvent) { for (const fn of [...listeners]) fn(e); },
};

/* ---------- 会话 ---------- */
export interface Conversation { id: number; title: string; model?: string; createdAt: string; updatedAt: string; pinned?: boolean }
export interface CardData { type: string; tool: string; status: 'pending' | 'running' | 'done' | 'error'; ms?: number; args?: unknown; data?: any; error?: { reason: string; advice?: string } }
export interface StoredMsg {
  id: number; conversationId: number; role: 'user' | 'assistant' | 'tool'; content: string; reasoning?: string;
  toolCalls?: { id: string; name: string; arguments: string }[]; toolCallId?: string; toolName?: string;
  cards?: CardData[]; model?: string; usage?: { input: number; output: number; cached?: number }; cost?: number;
  streamed?: boolean; stopped?: boolean; createdAt: string; meta?: Record<string, unknown>;
}

const toConv = (r: Row): Conversation => ({ id: r.id, title: String(r.title ?? '新会话'), model: r.model as string | undefined, createdAt: String(r.created_at), updatedAt: String(r.updated_at), pinned: !!r.pinned });
export async function listConversations(q = ''): Promise<Conversation[]> {
  const all = (await db.all('conversations')).map(toConv).filter((c) => !q || c.title.includes(q));
  return all.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}
export async function createConversation(title = '新会话'): Promise<Conversation> { return toConv(await db.insert('conversations', { title })); }
export async function getConversation(id: number): Promise<Conversation | null> { const r = await db.get('conversations', id); return r ? toConv(r) : null; }
export async function updateConversation(id: number, patch: Partial<Pick<Conversation, 'title' | 'model' | 'pinned'>>): Promise<void> { await db.update('conversations', id, patch); }
export async function deleteConversation(id: number): Promise<void> {
  for (const m of (await db.all('messages')).filter((x) => x.conversationId === id)) await db.del('messages', m.id);
  await db.del('conversations', id);
}
export async function listMessages(conversationId: number): Promise<StoredMsg[]> {
  return (await db.all('messages')).filter((m) => m.conversationId === conversationId).sort((a, b) => a.id - b.id).map((r) => ({ ...r, createdAt: String(r.created_at) }) as unknown as StoredMsg);
}
export async function addMessage(m: Omit<StoredMsg, 'id' | 'createdAt'>): Promise<StoredMsg> {
  const r = await db.insert('messages', m as unknown as Record<string, unknown>);
  await db.update('conversations', m.conversationId, {}).catch(() => {});
  return { ...(r as unknown as StoredMsg), createdAt: String(r.created_at) };
}
export async function updateMessage(id: number, patch: Partial<StoredMsg>): Promise<void> { await db.update('messages', id, patch as Record<string, unknown>); }

/* ---------- 素材箱（“发给 Agent”三通道 + 系统分享） ---------- */
export interface InboxDraft { kind: 'url' | 'text' | 'share' | 'image'; platform?: string; title?: string; url?: string; text?: string; image?: string; note?: string; channel: 'toolbar' | 'process_text' | 'share' | 'patrol' | 'context_menu' | 'paste' }
export interface InboxItem extends InboxDraft { id: number; createdAt: string; used?: boolean }
export async function addInbox(d: InboxDraft): Promise<InboxItem> {
  const r = await db.insert('inbox', { ...d, used: false } as unknown as Record<string, unknown>);
  bus.emit({ type: 'inbox-changed' });
  return { ...(r as unknown as InboxItem), createdAt: String(r.created_at) };
}
export async function listInbox(o: { since?: string; platform?: string } = {}): Promise<InboxItem[]> {
  return (await db.all('inbox')).map((r) => ({ ...r, createdAt: String(r.created_at) }) as unknown as InboxItem)
    .filter((i) => (!o.since || i.createdAt >= o.since) && (!o.platform || i.platform === o.platform)).sort((a, b) => b.id - a.id);
}
export async function markInboxUsed(ids: number[]): Promise<void> { for (const id of ids) await db.update('inbox', id, { used: true }).catch(() => {}); bus.emit({ type: 'inbox-changed' }); }
export async function deleteInbox(id: number): Promise<void> { await db.del('inbox', id); bus.emit({ type: 'inbox-changed' }); }

/* ---------- 账号画像（只服务用户本人一个账号） ---------- */
export interface Profile {
  positioning: string;
  audience: string;
  style: { tone: string; banned: string[]; emoji: string; samples: string[] };
  platforms: Record<string, { limits?: string }>;
  redlines: string[];
  performance: { note: string; draftIds: number[]; date: string }[];
}
export const EMPTY_PROFILE: Profile = { positioning: '', audience: '', style: { tone: '', banned: [], emoji: '', samples: [] }, platforms: {}, redlines: [], performance: [] };
/** 1.1.0：画像唯一真相源 = Agent 文件 user/profile.md（与 USER.md 同源，带版本）；旧 kv:profile 只在迁移前读取。 */
export async function getProfile(): Promise<Profile> {
  const { getVfs } = await import('../v9/vfsBackend');
  const { profileFromMd, PROFILE_PATH } = await import('../v11/migrate');
  let fromFile: Profile | null;
  try { fromFile = profileFromMd(await (await getVfs()).text(PROFILE_PATH)); } catch { fromFile = null; }
  const p = fromFile ?? (await db.getKV<Profile>('profile'));
  return { ...EMPTY_PROFILE, ...(p ?? {}), style: { ...EMPTY_PROFILE.style, ...(p?.style ?? {}) } };
}
export async function saveProfile(p: Profile): Promise<void> {
  const { getVfs } = await import('../v9/vfsBackend');
  const { profileToMd, PROFILE_PATH } = await import('../v11/migrate');
  const vfs = await getVfs();
  await vfs.write(PROFILE_PATH, profileToMd(p, await vfs.text(PROFILE_PATH)), { author: 'user', note: '我的 → 账号画像' });
  await db.setKV('profile', null);
  emitStoreChange('kv:profile');
}
/** 只允许改画像字段；返回新画像与改动列表（不写入）。 */
export function applyProfilePatch(cur: Profile, patch: Record<string, unknown>): { next: Profile; diff: { field: string; before: unknown; after: unknown }[] } {
  const allowed = ['positioning', 'audience', 'style', 'platforms', 'redlines', 'performance'];
  const next = structuredClone(cur) as Profile & Record<string, unknown>;
  const diff: { field: string; before: unknown; after: unknown }[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    const before = (cur as unknown as Record<string, unknown>)[k];
    const after = k === 'style' && v && typeof v === 'object' ? { ...cur.style, ...(v as object) } : v;
    if (JSON.stringify(before) !== JSON.stringify(after)) { next[k] = after; diff.push({ field: k, before, after }); }
  }
  if ((next.performance?.length ?? 0) > 10) next.performance = next.performance.slice(-10);
  return { next, diff };
}
export function profileText(p: Profile): string {
  const lines: string[] = [];
  if (p.positioning) lines.push(`定位：${p.positioning}`);
  if (p.audience) lines.push(`受众：${p.audience}`);
  if (p.style.tone) lines.push(`风格：${p.style.tone}`);
  if (p.style.banned.length) lines.push(`禁用词：${p.style.banned.join('、')}`);
  if (p.redlines.length) lines.push(`偏好红线（不碰）：${p.redlines.join('；')}`);
  if (p.performance.length) lines.push(`历史表现：${p.performance.map((x) => x.note).join('；')}`);
  return lines.join('\n') || '（用户还没有填写账号画像）';
}

/* ---------- L2 “记住此类” ---------- */
export async function rememberedApprovals(): Promise<string[]> { return (await db.getKV<string[]>('agent.approvals')) ?? []; }
export async function rememberApproval(tool: string): Promise<void> { const a = await rememberedApprovals(); if (!a.includes(tool)) await db.setKV('agent.approvals', [...a, tool]); }

/* ---------- 任务检查点 ---------- */
export interface TaskStep { name: string; tool: string; status: 'done' | 'failed'; summary: string; refs?: Record<string, unknown>; at: string }
export interface TaskRow { id: number; conversationId: number; goal: string; steps: TaskStep[]; status: 'running' | 'done' | 'stopped' | 'failed'; next?: string; created_at?: string; updated_at?: string }
export async function startTask(conversationId: number, goal: string): Promise<TaskRow> { return (await db.insert('tasks', { conversationId, goal, steps: [], status: 'running' })) as unknown as TaskRow; }
export async function addTaskStep(id: number, step: Omit<TaskStep, 'at'>, next?: string): Promise<void> {
  const t = (await db.get('tasks', id)) as unknown as TaskRow | undefined;
  if (!t) return;
  await db.update('tasks', id, { steps: [...t.steps, { ...step, at: new Date().toISOString() }], next: next ?? t.next });
}
export async function finishTask(id: number, status: TaskRow['status']): Promise<void> { await db.update('tasks', id, { status }).catch(() => {}); }
export async function lastUnfinishedTask(conversationId?: number): Promise<TaskRow | null> {
  const all = ((await db.all('tasks')) as unknown as TaskRow[]).filter((t) => t.status !== 'done' && t.steps.length > 0 && (!conversationId || t.conversationId === conversationId));
  return all.sort((a, b) => b.id - a.id)[0] ?? null;
}
