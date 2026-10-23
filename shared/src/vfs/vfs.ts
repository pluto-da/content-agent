/**
 * 本机虚拟文件系统（8.6）：路径即身份；每次写入产生版本（乐观并发 expectedVersion）；软删除 30 天回收站；
 * 写权限按 front matter editable：user（用户可编辑）/ agent_propose（Agent 只能提议，用户确认后以 user_approved 写入）/ system_only（运行时代码写）。
 * 密钥永不进入 VFS：写入前扫描，命中即拒绝。存储后端注入（web：IndexedDB vfs_files / vfs_versions；测试：内存）。
 */
import { sha256 } from '../core/hash.js';
import { findSecrets } from '../core/redact.js';
import { parseDoc, patchFM } from './frontmatter.js';
import { unifiedDiff } from './diff.js';

export type Author = 'user' | 'user_approved' | 'agent' | 'system';
export interface VfsFile { path: string; content: string; hash: string; size: number; updated: string; version: number; deleted?: boolean; deletedAt?: string; author?: Author }
export interface VfsVersion { path: string; version: number; content: string; updated: string; author: Author; note?: string }
export interface VfsBackend {
  getFile(path: string): Promise<VfsFile | undefined>;
  putFile(f: VfsFile, v: VfsVersion, prune: (vs: VfsVersion[]) => VfsVersion[]): Promise<void>;
  allFiles(): Promise<VfsFile[]>;
  versions(path: string): Promise<VfsVersion[]>;
  deleteFile(path: string): Promise<void>;
}
export class VfsError extends Error { constructor(public kind: 'conflict' | 'forbidden' | 'secret' | 'too_large' | 'not_found' | 'invalid_name', msg: string) { super(msg); this.name = 'VfsError'; } }

export const ROOT_SYSTEM = ['SYSTEM.md', 'AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'APPROVAL.md', 'BOUNDARIES.md', 'HEARTBEAT.md', 'PROACTIVE_PREFERENCES.md', 'REVENUE.md', 'EVOLUTION.md'];
/** 版本永久保留：根系统文件、skills/、REVENUE.md、EVOLUTION.md。其余保留最近 20 版或 90 天。 */
export function keepForever(path: string): boolean { return ROOT_SYSTEM.includes(path) || path.startsWith('skills/'); }
export function sizeLimit(path: string): number {
  if (path === 'USER.md' || path === 'MEMORY.md') return 4000;
  if (ROOT_SYSTEM.includes(path)) return 8000;
  const base = path.split('/').at(-1)!.replace(/\.md$/, '');
  const dir = path.split('/').at(-2)?.replace(/^\./, '');
  if (dir && base === dir.toUpperCase()) return 3000;
  if (/\/SKILL\.md$/.test(path)) return 12000;
  if (/\/references\//.test(path)) return 30000;
  if (path.startsWith('semiotics/')) return 120000;
  if (path.startsWith('memory/daily/')) return 20000;
  if (path.startsWith('memory/')) return 20000;
  if (path.startsWith('docs/')) return 60000;
  return 200000;
}
/** 命名规则：小写连字符；入口文件为文件夹名大写；根系统文件大写；people/topics 允许中文（URL 编码策略见偏离记录：保留中文原文）。 */
export function checkName(path: string): string | null {
  if (/\s/.test(path)) return '路径不能有空格';
  if (path.includes('..') || path.startsWith('/')) return '路径不合法';
  const parts = path.split('/');
  const file = parts.at(-1)!;
  if (parts.length === 1 && (ROOT_SYSTEM.includes(file) || file === 'runtime.lock')) return null;
  const dir = parts.at(-2)?.replace(/^\./, '');
  if (dir && file.replace(/\.md$/, '') === dir.toUpperCase()) return null;
  if (file === 'SKILL.md' || path === 'semiotics/PRINCIPLES.md') return null;
  const cjkOk = /^memory\/(people|topics)\//.test(path);
  if (!cjkOk && !/^[a-z0-9.][a-z0-9._-]*$/.test(file) && !/^L-\d{8}-[a-z0-9-]+\.md$/.test(file) && !/^P-\d{8}-[a-z0-9-]+\.md$/.test(file) && !/^v\d+\.md$/.test(file) && !/^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(file)) return `文件名需小写连字符：${file}`;
  return null;
}
export function editableOf(content: string, path: string): 'user' | 'agent_propose' | 'system_only' {
  if (path === 'BOUNDARIES.md' || path === 'runtime.lock' || path === 'config/loading.json' || /^(sessions|tasks)\//.test(path)) return 'system_only';
  const e = parseDoc(content).fm.editable;
  return e === 'agent_propose' || e === 'system_only' || e === 'user' ? e : 'user';
}
export function canWrite(editable: 'user' | 'agent_propose' | 'system_only', author: Author): boolean {
  if (author === 'system') return true;
  if (editable === 'system_only') return false;
  if (author === 'agent') return false;     // Agent 只能提议（proposal），不能直接写系统文件与技能
  return true;                              // user / user_approved
}
/** Agent 可以直接写的运行数据区（记忆条目经确认后由运行时以 user_approved 写；草稿区 workspace/scratch 可写）。 */
export function agentWritable(path: string): boolean { return /^workspace\/(scratch|proposals)\//.test(path) || /^memory\/daily\//.test(path); }

export class Vfs {
  constructor(private be: VfsBackend, private now: () => Date = () => new Date()) {}
  async read(path: string): Promise<VfsFile | undefined> { const f = await this.be.getFile(path); return f && !f.deleted ? f : undefined; }
  async text(path: string): Promise<string | undefined> { return (await this.read(path))?.content; }
  async write(path: string, content: string, o: { author: Author; expectedVersion?: number; note?: string; allowLarge?: boolean } ): Promise<VfsFile> {
    const bad = checkName(path);
    if (bad) throw new VfsError('invalid_name', bad);
    const cur = await this.be.getFile(path);
    if (o.expectedVersion !== undefined && (cur?.version ?? 0) !== o.expectedVersion) throw new VfsError('conflict', `文件已被修改（当前版本 ${cur?.version ?? 0}，你基于 ${o.expectedVersion}），请刷新后再保存`);
    const editable = editableOf(cur?.content ?? content, path);
    if (!(o.author === 'agent' && agentWritable(path)) && !canWrite(editable, o.author)) throw new VfsError('forbidden', path === 'BOUNDARIES.md' ? 'BOUNDARIES.md 由代码强制，只读' : o.author === 'agent' ? 'Agent 不能直接修改这个文件，只能提交修订建议' : '这个文件只能由系统写入');
    if (findSecrets(content).length) throw new VfsError('secret', '内容里有疑似密钥，已拒绝写入（密钥只存本机安全存储）');
    const lim = sizeLimit(path);
    if (!o.allowLarge && [...content].length > lim && o.author !== 'system') throw new VfsError('too_large', `超过大小上限 ${lim} 字符`);
    if (path === 'SOUL.md') { const p1 = soulPart1(content); if (p1 !== null && [...p1].length > 6000) throw new VfsError('too_large', 'SOUL.md 第一部分（核心指令）超过 6000 字符，请精简'); }
    const version = (cur?.version ?? 0) + 1;
    const updated = this.now().toISOString();
    const body = /\.md$/.test(path) && parseDoc(content).hasFM ? patchFM(content, { version, updated: isoSh(this.now()) }) : content;
    const f: VfsFile = { path, content: body, hash: sha256(body), size: body.length, updated, version, author: o.author };
    const v: VfsVersion = { path, version, content: body, updated, author: o.author, note: o.note };
    const nowMs = this.now().getTime();
    await this.be.putFile(f, v, (vs) => (keepForever(path) ? vs : vs.filter((x, i) => i >= vs.length - 20 || nowMs - Date.parse(x.updated) < 90 * 864e5)));
    return f;
  }
  async list(dir = ''): Promise<VfsFile[]> { const pre = dir ? `${dir.replace(/\/$/, '')}/` : ''; return (await this.be.allFiles()).filter((f) => !f.deleted && f.path.startsWith(pre)).sort((a, b) => a.path.localeCompare(b.path)); }
  async softDelete(path: string, author: Author): Promise<void> {
    const f = await this.be.getFile(path);
    if (!f) throw new VfsError('not_found', '文件不存在');
    if (!canWrite(editableOf(f.content, path), author)) throw new VfsError('forbidden', '没有删除权限');
    await this.be.putFile({ ...f, deleted: true, deletedAt: this.now().toISOString() }, { path, version: f.version, content: f.content, updated: this.now().toISOString(), author, note: 'deleted' }, (vs) => vs);
  }
  async restore(path: string): Promise<void> { const f = await this.be.getFile(path); if (f?.deleted) await this.be.putFile({ ...f, deleted: false, deletedAt: undefined }, { path, version: f.version, content: f.content, updated: this.now().toISOString(), author: 'user', note: 'restored' }, (vs) => vs); }
  async purge(path: string): Promise<void> { await this.be.deleteFile(path); }
  async trash(): Promise<VfsFile[]> { const t = this.now().getTime(); return (await this.be.allFiles()).filter((f) => f.deleted && t - Date.parse(f.deletedAt ?? f.updated) < 30 * 864e5); }
  async move(from: string, to: string, author: Author): Promise<void> { const f = await this.read(from); if (!f) throw new VfsError('not_found', '文件不存在'); await this.write(to, f.content, { author }); await this.softDelete(from, author); }
  history(path: string): Promise<VfsVersion[]> { return this.be.versions(path); }
  async diff(path: string, v1: number, v2: number): Promise<string> {
    const vs = await this.be.versions(path);
    const a = vs.find((x) => x.version === v1)?.content ?? '', b = vs.find((x) => x.version === v2)?.content ?? '';
    return unifiedDiff(a, b, `${path}@v${v1}`, `${path}@v${v2}`);
  }
  async rollback(path: string, toVersion: number, author: Author = 'user_approved'): Promise<VfsFile> {
    const v = (await this.be.versions(path)).find((x) => x.version === toVersion);
    if (!v) throw new VfsError('not_found', `没有版本 ${toVersion}`);
    const cur = await this.read(path);
    return this.write(path, v.content, { author, expectedVersion: cur?.version, note: `rollback to v${toVersion}` });
  }
}
export function soulPart1(content: string): string | null {
  const i = content.indexOf('## 一、核心指令');
  if (i < 0) return null;
  const j = content.indexOf('\n## 二、', i);
  return content.slice(i, j < 0 ? undefined : j);
}
export function isoSh(d: Date): string { const t = new Date(d.getTime() + 8 * 3600e3); return `${t.toISOString().slice(0, 19)}+08:00`; }

export function memoryVfsBackend(): VfsBackend & { files: Map<string, VfsFile>; vers: Map<string, VfsVersion[]> } {
  const files = new Map<string, VfsFile>(), vers = new Map<string, VfsVersion[]>();
  return {
    files, vers,
    async getFile(p) { const f = files.get(p); return f ? { ...f } : undefined; },
    async putFile(f, v, prune) { files.set(f.path, { ...f }); const list = [...(vers.get(f.path) ?? []).filter((x) => x.version !== v.version), v]; vers.set(f.path, prune(list)); },
    async allFiles() { return [...files.values()].map((f) => ({ ...f })); },
    async versions(p) { return [...(vers.get(p) ?? [])]; },
    async deleteFile(p) { files.delete(p); vers.delete(p); },
  };
}
