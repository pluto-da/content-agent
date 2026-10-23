/**
 * 服务端同步接口（ADR-008，预留，默认关闭）。本版本只定义契约与冲突裁决纯函数；
 * 实现为 DisabledSync：任何调用都返回 disabled，不发网络请求。不做多账号：一个设备一份本机数据，至多同步到用户自己的一台服务器。
 */
export interface SyncFileMeta { path: string; version: number; hash: string; updated: string; deleted?: boolean; editable?: 'user' | 'agent_propose' | 'system_only' }
export type SyncDecision = { action: 'none' } | { action: 'push' } | { action: 'pull' } | { action: 'conflict'; conflictPath: string };

/** 8.6 规则：单边修改直接同步；双边修改不自动合并 → 生成 .conflict 副本；system_only 以本机为准；删除以墓碑同步。 */
export function decideSync(local: SyncFileMeta | undefined, remote: SyncFileMeta | undefined, base: { hash: string } | undefined, now = new Date()): SyncDecision {
  if (!local && !remote) return { action: 'none' };
  if (local && !remote) return { action: 'push' };
  if (!local && remote) return { action: 'pull' };
  const l = local!, r = remote!;
  if (l.hash === r.hash && !!l.deleted === !!r.deleted) return { action: 'none' };
  if (l.editable === 'system_only') return { action: 'push' };
  const lChanged = !base || l.hash !== base.hash;
  const rChanged = !base || r.hash !== base.hash;
  if (lChanged && !rChanged) return { action: 'push' };
  if (!lChanged && rChanged) return { action: 'pull' };
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  return { action: 'conflict', conflictPath: l.path.replace(/(\.\w+)?$/, (ext) => `.conflict-${stamp}${ext || ''}`) };
}

export interface SyncPort {
  readonly enabled: boolean;
  status(): Promise<{ enabled: boolean; reason: string }>;
  push(files: SyncFileMeta[]): Promise<{ ok: false; reason: string } | { ok: true }>;
  pull(since: string): Promise<{ ok: false; reason: string } | { ok: true; files: SyncFileMeta[] }>;
}
export const DisabledSync: SyncPort = {
  enabled: false,
  async status() { return { enabled: false, reason: '服务端同步是预留能力，本版本未开放（默认关闭，不做多账号）' }; },
  async push() { return { ok: false, reason: 'disabled' }; },
  async pull() { return { ok: false, reason: 'disabled' }; },
};
