/**
 * 1.0 存储治理的本机接线：媒体索引（kv media.index，只存 id / 类型 / 字节 / 时间，几 KB，首屏与配额计算不读 1 GB 正文）、
 * 配额设置（kv media.quota）、清理任务（启动 15 秒后 + 每 6 小时检查一次；默认只提醒，打开“自动清理”才删），VFS 版本修剪。
 * 删除都写审计（storage）。被草稿 / 对话引用、最近 N 天、标了保留的媒体永不自动清。
 */
import { keepForever, type VfsVersion } from '@content-agent/shared';
import { db, type Row } from '../../local/db';
import { audit } from '../ops';
import { dataUrlBytes, planCleanup, readQuota, referencedIds, usageOf, prunePreview, fmtBytes, type MediaIndexEntry, type MediaQuota, type CleanupPlan, type FilePrune } from './policy';

const IDX = 'media.index';
const entryOf = (r: Row): MediaIndexEntry => ({ id: r.id, kind: String(r.kind ?? 'image'), bytes: dataUrlBytes(r.dataUrl), created_at: String(r.created_at ?? new Date(0).toISOString()), ...(r.keep ? { keep: true } : {}), ...(r.mime ? { mime: String(r.mime) } : {}) });

/** 读索引；没有时（0.11 及以前的数据）用游标逐条重建一次——只在存储页或清理任务里触发，不在首屏。 */
export async function mediaIndex(o: { rebuild?: boolean } = {}): Promise<MediaIndexEntry[]> {
  const cur = await db.getKV<MediaIndexEntry[]>(IDX);
  if (cur && !o.rebuild) return cur;
  const out: MediaIndexEntry[] = [];
  await db.scan('media', (r) => { out.push(entryOf(r)); });
  await db.setKV(IDX, out);
  return out;
}
export async function noteMediaSaved(rows: Row[]): Promise<void> {
  const cur = await db.getKV<MediaIndexEntry[]>(IDX);
  if (!cur) return;   // 还没建过索引：下次用到时整体重建
  await db.setKV(IDX, [...cur.filter((e) => !rows.some((r) => r.id === e.id)), ...rows.map(entryOf)]);
}
export async function setKeep(id: number, keep: boolean): Promise<void> {
  const row = await db.get('media', id); if (!row) return;
  await db.update('media', id, { keep });
  const cur = await mediaIndex();
  await db.setKV(IDX, cur.map((e) => (e.id === id ? { ...e, keep } : e)));
}
export async function getQuota(): Promise<MediaQuota> { return readQuota(await db.getKV('media.quota')); }
export async function saveQuota(q: Partial<MediaQuota>): Promise<MediaQuota> { const n = readQuota({ ...(await getQuota()), ...q }); await db.setKV('media.quota', n); return n; }
async function referenced(): Promise<Set<number>> {
  const texts: string[] = [];
  for (const c of ['drafts', 'messages'] as const) await db.scan(c, (r) => { texts.push(JSON.stringify(r)); });
  return referencedIds(texts);
}
export async function cleanupPlan(now = Date.now()): Promise<CleanupPlan> { return planCleanup(await mediaIndex(), await getQuota(), await referenced(), now); }
/** 执行清理（用户点“立即清理”或自动清理打开时由任务调用）。返回实际删除的条数与字节。 */
export async function runCleanup(o: { actor: 'user' | 'system'; now?: number } = { actor: 'user' }): Promise<{ removed: number; freed: number; plan: CleanupPlan }> {
  const plan = await cleanupPlan(o.now);
  if (!plan.remove.length) return { removed: 0, freed: 0, plan };
  for (const e of plan.remove) await db.del('media', e.id);
  const gone = new Set(plan.remove.map((e) => e.id));
  await db.setKV(IDX, (await mediaIndex()).filter((e) => !gone.has(e.id)));
  await audit({ kind: 'storage', actor: o.actor, summary: `清理媒体 ${plan.remove.length} 个，释放 ${fmtBytes(plan.freed)}（配额 ${fmtBytes((await getQuota()).quotaBytes)}，受保护 ${fmtBytes(plan.protectedBytes)}）`, outcome: 'ok', detail: { ids: plan.remove.map((e) => e.id).slice(0, 500), freed: plan.freed } });
  return { removed: plan.remove.length, freed: plan.freed, plan };
}
export interface StorageReport { media: ReturnType<typeof usageOf>; quota: MediaQuota; plan: CleanupPlan; estimate: { usage?: number; quota?: number; persisted?: boolean } }
export async function storageReport(now = Date.now()): Promise<StorageReport> {
  const media = usageOf(await mediaIndex());
  const est: StorageReport['estimate'] = {};
  try { const e = await navigator.storage?.estimate?.(); if (e) { est.usage = e.usage; est.quota = e.quota; } est.persisted = await navigator.storage?.persisted?.(); } catch { /* 部分 WebView 不支持 */ }
  return { media, quota: await getQuota(), plan: await cleanupPlan(now), estimate: est };
}
/** 申请持久化存储（浏览器空间紧张时不被自动清掉）。 */
export async function requestPersist(): Promise<boolean> { try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; } }

/* ---------------- 清理任务 ---------------- */
let timer: ReturnType<typeof setInterval> | null = null;
export interface TaskResult { at: string; over: boolean; removed: number; freed: number; note: string }
export async function cleanupTick(now = Date.now()): Promise<TaskResult> {
  const q = await getQuota();
  const plan = await cleanupPlan(now);
  let r: TaskResult;
  if (!plan.over) r = { at: new Date(now).toISOString(), over: false, removed: 0, freed: 0, note: `媒体 ${fmtBytes(plan.total)} / 配额 ${fmtBytes(q.quotaBytes)}` };
  else if (q.autoClean) { const x = await runCleanup({ actor: 'system', now }); r = { at: new Date(now).toISOString(), over: true, removed: x.removed, freed: x.freed, note: x.removed ? `自动清理 ${x.removed} 个，释放 ${fmtBytes(x.freed)}` : '超出配额，但剩下的都受保护（被引用 / 最近 / 标了保留）' }; }
  else r = { at: new Date(now).toISOString(), over: true, removed: 0, freed: 0, note: `媒体 ${fmtBytes(plan.total)}，超出配额 ${fmtBytes(q.quotaBytes)}；可清理 ${plan.remove.length} 个（${fmtBytes(plan.freed)}），等你在“我的 → 存储”确认` };
  await db.setKV('media.lastTask', r);
  return r;
}
/** App 启动后调用：15 秒后第一次（避开首屏），之后每 6 小时。 */
export function startCleanupTask(firstDelayMs = 15000, everyMs = 6 * 3600e3): () => void {
  if (timer) return () => {};
  const first = setTimeout(() => { void cleanupTick().catch(() => {}); }, firstDelayMs);
  timer = setInterval(() => { void cleanupTick().catch(() => {}); }, everyMs);
  return () => { clearTimeout(first); if (timer) clearInterval(timer); timer = null; };
}

/* ---------------- VFS 版本修剪 ---------------- */
export async function versionPreview(now = Date.now()): Promise<FilePrune[]> {
  const all = await db.kall<VfsVersion>('vfs_versions');
  const by = new Map<string, VfsVersion[]>();
  for (const v of all) by.set(v.path, [...(by.get(v.path) ?? []), v]);
  return [...by].map(([p, vs]) => prunePreview(p, vs.map((v) => ({ version: v.version, updated: v.updated, size: new TextEncoder().encode(v.content ?? '').length })), keepForever(p), now))
    .sort((a, b) => b.dropBytes - a.dropBytes || b.totalBytes - a.totalBytes);
}
/** 按规则修剪全部文件（只删预览里标为“可修剪”的版本；永久保留的文件不动）。 */
export async function pruneVersions(now = Date.now()): Promise<{ files: number; versions: number; bytes: number }> {
  const prev = await versionPreview(now);
  let files = 0, versions = 0, bytes = 0;
  for (const f of prev) {
    if (!f.dropCount) continue;
    files++;
    for (const v of f.versions.filter((x) => x.drop)) { await db.kdel('vfs_versions', `${f.path}#${v.version}`); versions++; bytes += v.size; }
  }
  if (versions) await audit({ kind: 'storage', actor: 'user', summary: `修剪设定文件旧版本 ${versions} 个（${files} 个文件，${fmtBytes(bytes)}）；永久保留的文件未动`, outcome: 'ok' });
  return { files, versions, bytes };
}
