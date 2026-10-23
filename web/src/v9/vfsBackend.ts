/** VFS 的 IndexedDB 后端（vfs_files 以路径为键；vfs_versions 以 “路径#版本” 为键）。单例 getVfs() 首次调用时生成默认文件并运行目录守护器。 */
import { Vfs, initVfs, runDoctor, type VfsBackend, type VfsFile, type VfsVersion, type DoctorReport } from '@content-agent/shared';
import { db } from '../local/db';

export const idbVfsBackend: VfsBackend = {
  getFile: (p) => db.kget<VfsFile>('vfs_files', p),
  async putFile(f, v, prune) {
    await db.kput('vfs_files', f.path, f);
    const prefix = `${f.path}#`;
    const vs = (await db.kall<VfsVersion & { key?: string }>('vfs_versions')).filter((x) => x.path === f.path);
    const next = prune([...vs.filter((x) => x.version !== v.version), v]);
    await db.kput('vfs_versions', `${prefix}${v.version}`, v);
    for (const old of vs) if (!next.some((n) => n.version === old.version)) await db.kdel('vfs_versions', `${prefix}${old.version}`);
  },
  allFiles: () => db.kall<VfsFile>('vfs_files'),
  async versions(p) { return (await db.kall<VfsVersion>('vfs_versions')).filter((x) => x.path === p).sort((a, b) => a.version - b.version); },
  async deleteFile(p) { await db.kdel('vfs_files', p); for (const v of await this.versions(p)) await db.kdel('vfs_versions', `${p}#${v.version}`); },
};
let inst: Promise<Vfs> | null = null;
let lastReport: DoctorReport | null = null;
export function getVfs(): Promise<Vfs> {
  return (inst ??= (async () => {
    const v = new Vfs(idbVfsBackend);
    const have = await db.kall<VfsFile>('vfs_files');
    if (!have.length) lastReport = (await initVfs(v)).report;
    else lastReport = await runDoctor(v, { fix: true });
    const sch = (await db.getKV<Record<string, number>>('schema')) ?? {};
    await db.setKV('schema', { ...sch, vfs: 1 });
    return v;
  })());
}
export function resetVfsForTests(): void { inst = null; lastReport = null; }
export function doctorReport(): DoctorReport | null { return lastReport; }
/** 全部文件（路径 → 正文），供组装上下文。 */
export async function vfsFiles(): Promise<Record<string, string>> { const v = await getVfs(); return Object.fromEntries((await v.list()).map((f) => [f.path, f.content])); }
