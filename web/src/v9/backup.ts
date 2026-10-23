/**
 * 一键备份 / 恢复（企业级，ADR-003 / ADR-004）：zip = manifest.json（schemaVersion 3、文件清单与 sha256）+ vfs/<目录树> + data/<集合>.json + kv/<键>.json。
 * - 永不含 Key：secrets、secure.key、缓存不导出；导出前后两道密钥扫描，命中即阻止；
 * - 恢复：先校验清单与 hash → 本机快照（kv backup.snapshot，可回滚）→ 逐项写回；Key 需要重新填写；
 * - 旧版本备份（schemaVersion 1/2 的 JSON）经 BackupMigrator 前滚。
 */
import { buildExport, readImport, ExportBlocked, BackupMigrator, sanitizeFlagOverrides, type Manifest } from '@content-agent/shared';
import { db, COLLECTIONS, type Collection } from '../local/db';
import { getVfs, resetVfsForTests } from './vfsBackend';
import { audit } from './ops';
import { importLegacyV11, LEGACY_V11_KV } from '../v11/migrate';

const KV_EXCLUDE = /^(secrets|secure\.key|cache:|backup\.snapshot|run:|models$|models_v2_backup)/;
const KV_KEYS = ['models_v3', 'prefs', 'usage', 'schema', 'approvals.remembered', 'memory.dontRemember', 'hot.cache', 'sources.creds.meta'];
const APP_VERSION = '1.2.0';

/** 1.0：本机数据库读失败时带上是哪一步，界面据此给白话建议（不是“发现密钥”）。 */
export class BackupReadError extends Error {
  constructor(public stage: string, public cause: unknown) { super(`${stage}：${(cause as Error)?.name ?? ''} ${(cause as Error)?.message ?? String(cause)}`.trim()); this.name = 'BackupReadError'; }
}
const stage = async <T,>(name: string, p: () => Promise<T>): Promise<T> => { try { return await p(); } catch (e) { throw e instanceof BackupReadError ? e : new BackupReadError(name, e); } };
export async function exportBackup(o: { includeMedia?: boolean; includeMemory?: boolean } = {}): Promise<Uint8Array> {
  const vfs = await stage('打开 Agent 文件库', () => getVfs());
  const files = (await stage('读取 Agent 文件', () => vfs.list())).map((f) => ({ path: `vfs/${f.path}`, content: f.content }));
  const extra: Record<string, string> = {};
  for (const c of COLLECTIONS) {
    if (c === 'media' && !o.includeMedia) continue;
    if (c === 'locks') continue;
    extra[`data/${c}.json`] = JSON.stringify(await stage(`读取数据集 ${c}`, () => db.all(c)));
  }
  for (const k of KV_KEYS) { if (KV_EXCLUDE.test(k)) continue; const v = await stage(`读取设置 ${k}`, () => db.getKV(k)); if (v !== undefined) extra[`kv/${k}.json`] = JSON.stringify(v); }
  try {
    const { zip, manifest } = buildExport(files, { appVersion: APP_VERSION, extra, includeMedia: o.includeMedia, includeMemory: o.includeMemory });
    await audit({ kind: 'backup', actor: 'user', summary: `导出备份：${manifest.files.length} 个文件（不含 Key${o.includeMedia ? '' : '、不含媒体'}）`, outcome: 'ok' });
    return zip;
  } catch (e) {
    if (e instanceof ExportBlocked) await audit({ kind: 'backup', actor: 'user', summary: `导出被阻止：发现疑似密钥（${e.hits.map((h) => h.path).join('、')}）`, outcome: 'failed' });
    throw e;
  }
}
export interface RestoreResult { manifest: Manifest | null; errors: string[]; restored: { files: number; collections: number; kv: number }; snapshot: boolean }
export async function restoreBackup(zipBytes: Uint8Array, o: { conflict?: 'local' | 'incoming' } = {}): Promise<RestoreResult> {
  const { manifest, files, errors } = readImport(zipBytes);
  if (errors.length) return { manifest, errors, restored: { files: 0, collections: 0, kv: 0 }, snapshot: false };
  // 恢复前本机快照（可回滚）
  let snapshot = false;
  try { const snap = await exportBackup({ includeMedia: false }); await db.setKV('backup.snapshot', Array.from(snap)); snapshot = true; } catch { /* 空库时没有可快照的内容 */ }
  let nf = 0, nc = 0, nk = 0;
  const legacy: Record<string, unknown> = {};
  const vfs = await getVfs();
  for (const [p, content] of files) {
    if (p.startsWith('vfs/')) {
      const path = p.slice(4);
      if (path === 'BOUNDARIES.md' || path === 'docs/core-directive.md') continue;   // 只读文件以随包为准
      const cur = await vfs.read(path);
      if (cur && cur.content !== content && o.conflict === 'local') continue;
      await vfs.write(path, content, { author: 'system', note: 'restore', allowLarge: true }).catch(() => {});
      nf++;
    } else if (p.startsWith('data/')) {
      const c = p.slice(5).replace(/\.json$/, '') as Collection;
      if (!(COLLECTIONS as readonly string[]).includes(c)) continue;
      const rows = JSON.parse(content) as Record<string, unknown>[];
      if (o.conflict !== 'local') await db.clear(c);
      for (const r of rows) await db.insert(c, r);
      nc++;
    } else if (p.startsWith('kv/')) {
      const k = p.slice(3).replace(/\.json$/, '');
      if (KV_EXCLUDE.test(k)) continue;
      let v = JSON.parse(content);
      if (k === 'prefs' && v?.flags) v = { ...v, flags: sanitizeFlagOverrides(v.flags) };
      if (LEGACY_V11_KV.includes(k)) { legacy[k] = v; nk++; continue; }
      if (k === 'models_v3') v = { ...v, accounts: (v.accounts ?? []).map((a: { hasKey?: boolean; keyTail?: string }) => ({ ...a, hasKey: false, keyTail: undefined })) };
      await db.setKV(k, v); nk++;
    }
  }
  if (Object.keys(legacy).length) await importLegacyV11(legacy as Parameters<typeof importLegacyV11>[0]);
  // 1.2.0：恢复后补齐超级 Agent 控制平面（幂等；恢复的是 1.2 备份则原样保留）
  await (await import('../v12/migrate')).migrateV12().catch(() => undefined);
  await audit({ kind: 'restore', actor: 'user', summary: `恢复备份（${manifest.appVersion}，${manifest.exportedAt.slice(0, 10)}）：文件 ${nf}、集合 ${nc}、设置 ${nk}；Key 需要重新填写`, outcome: 'ok' });
  return { manifest, errors: [], restored: { files: nf, collections: nc, kv: nk }, snapshot };
}
/** 旧版 JSON 备份（0.6–0.8）前滚到 v3 结构后返回（界面再走 restore 流程）。 */
export function migrateLegacyBackup(json: Record<string, unknown>): Record<string, unknown> { return BackupMigrator.migrate<Record<string, unknown>>({ schemaVersion: (json.schemaVersion as number) ?? 1, ...json }).doc; }
export async function rollbackRestore(): Promise<boolean> {
  const snap = await db.getKV<number[]>('backup.snapshot');
  if (!snap) return false;
  resetVfsForTests();
  const r = await restoreBackup(new Uint8Array(snap), { conflict: 'incoming' });
  return !r.errors.length;
}
