/**
 * 1.0 存储治理：媒体配额与清理的纯函数（不碰存储，便于测试）。
 * - 媒体大小：dataUrl 按 base64 解码后的字节估算（IndexedDB 实际占用略大）。
 * - 清理顺序：最旧的先清；被草稿 / 对话卡片引用的、最近 keepDays 天内的、用户标了“保留”的永不自动清。
 * - 目标：清到配额的 targetRatio（默认 80%）以下；还清不下来时如实报告“剩下的都受保护”。
 */
export interface MediaIndexEntry { id: number; kind: 'image' | 'audio' | 'video' | string; bytes: number; created_at: string; keep?: boolean; mime?: string }
export interface MediaQuota { quotaBytes: number; keepDays: number; targetRatio: number; autoClean: boolean }
export const DEFAULT_MEDIA_QUOTA: MediaQuota = { quotaBytes: 1024 ** 3, keepDays: 7, targetRatio: 0.8, autoClean: false };
export const MB = 1024 * 1024;

export function dataUrlBytes(dataUrl: unknown): number {
  if (typeof dataUrl !== 'string') return 0;
  const i = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || i < 0) return dataUrl.length;   // 外链：只占地址长度
  const b64 = dataUrl.length - i - 1;
  const pad = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64 * 3) / 4) - pad);
}
export function readQuota(raw: unknown): MediaQuota {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MediaQuota>;
  const d = DEFAULT_MEDIA_QUOTA;
  const n = (v: unknown, lo: number, hi: number, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv);
  return { quotaBytes: n(r.quotaBytes, 50 * MB, 64 * 1024 ** 3, d.quotaBytes), keepDays: n(r.keepDays, 0, 365, d.keepDays), targetRatio: n(r.targetRatio, 0.3, 0.95, d.targetRatio), autoClean: r.autoClean === true };
}
export interface UsageByKind { total: number; count: number; byKind: Record<string, { bytes: number; count: number }> }
export function usageOf(index: MediaIndexEntry[]): UsageByKind {
  const u: UsageByKind = { total: 0, count: 0, byKind: {} };
  for (const e of index) { u.total += e.bytes; u.count++; const k = (u.byKind[e.kind] ??= { bytes: 0, count: 0 }); k.bytes += e.bytes; k.count++; }
  return u;
}
export interface CleanupPlan { over: boolean; total: number; target: number; remove: MediaIndexEntry[]; freed: number; after: number; protectedBytes: number; reason: 'under_quota' | 'ok' | 'all_protected' | 'partly_protected' }
export function planCleanup(index: MediaIndexEntry[], q: MediaQuota, referenced: ReadonlySet<number>, now = Date.now()): CleanupPlan {
  const total = index.reduce((s, e) => s + e.bytes, 0);
  const target = Math.floor(q.quotaBytes * q.targetRatio);
  const isProtected = (e: MediaIndexEntry) => e.keep === true || referenced.has(e.id) || now - Date.parse(e.created_at) < q.keepDays * 864e5;
  const protectedBytes = index.filter(isProtected).reduce((s, e) => s + e.bytes, 0);
  if (total <= q.quotaBytes) return { over: false, total, target, remove: [], freed: 0, after: total, protectedBytes, reason: 'under_quota' };
  const cands = index.filter((e) => !isProtected(e)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const remove: MediaIndexEntry[] = [];
  let after = total;
  for (const e of cands) { if (after <= target) break; remove.push(e); after -= e.bytes; }
  const freed = total - after;
  return { over: true, total, target, remove, freed, after, protectedBytes, reason: !remove.length ? 'all_protected' : after > target ? 'partly_protected' : 'ok' };
}
/** 从草稿 / 消息 JSON 里找被引用的媒体 id（media-12、"mediaId":12 两种写法）。 */
export function referencedIds(texts: Iterable<string>): Set<number> {
  const out = new Set<number>();
  for (const t of texts) {
    for (const m of t.matchAll(/media-(\d+)/g)) out.add(Number(m[1]));
    for (const m of t.matchAll(/"mediaId"\s*:\s*(\d+)/g)) out.add(Number(m[1]));
  }
  return out;
}
export const fmtBytes = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= MB ? `${(n / MB).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);

/* ---------------- VFS 版本修剪可视化 ---------------- */
export interface VersionLite { version: number; updated: string; size: number }
export interface FilePrune { path: string; forever: boolean; versions: (VersionLite & { drop: boolean })[]; keepCount: number; dropCount: number; dropBytes: number; totalBytes: number }
/** 与 shared Vfs 写入时的修剪规则一致：永久保留（根系统文件、skills/）或 最近 20 版 + 90 天内的版本。 */
export function prunePreview(path: string, versions: VersionLite[], forever: boolean, now = Date.now(), keepLast = 20, keepDays = 90): FilePrune {
  const vs = [...versions].sort((a, b) => a.version - b.version);
  const marked = vs.map((v, i) => ({ ...v, drop: !forever && !(i >= vs.length - keepLast || now - Date.parse(v.updated) < keepDays * 864e5) }));
  const drop = marked.filter((v) => v.drop);
  return { path, forever, versions: marked, keepCount: marked.length - drop.length, dropCount: drop.length, dropBytes: drop.reduce((s, v) => s + v.size, 0), totalBytes: marked.reduce((s, v) => s + v.size, 0) };
}
