/**
 * 本机数据层：IndexedDB（浏览器 / Capacitor WebView / Electron 都有）。没有 IndexedDB 时（单元测试、极少数隐私模式）退回内存。
 * 集合：drafts、topics、hot、apps、metrics、logs；键值：settings（含模型配置）。密钥只存本机，不写日志。
 */
export type Row = Record<string, unknown> & { id: number };
/**
 * 0.8.0（DB_VERSION 2）只新增集合：conversations、messages、inbox、tasks、hot_snapshots；旧集合不改。
 * 0.9.0（DB_VERSION 3）只新增集合（见 shared LOCAL_DB_VERSIONS）：媒体、异步任务、用量明细、VFS、运行与工具调用、锁、提醒、审计、收益、经验、提案、记忆。
 * 回滚：IndexedDB 不能降版本打开；回到 0.8 前请用“备份 → 导出 0.8 兼容备份”（BackupMigrator.down，见 ADR-003）。
 */
export const COLLECTIONS = ['drafts', 'topics', 'apps', 'metrics', 'logs', 'conversations', 'messages', 'inbox', 'tasks', 'hot_snapshots',
  'media', 'jobs', 'usage_log', 'runs', 'toolcalls', 'locks', 'reminders', 'audit', 'revenue', 'attribution', 'experiments', 'lessons', 'proposals', 'memories'] as const;
export type Collection = (typeof COLLECTIONS)[number];

const DB_NAME = 'content-agent';
export const DB_VERSION = 3;
/** 以路径为主键的集合（VFS）：不自增。 */
export const KEYED = ['vfs_files', 'vfs_versions'] as const;
export type Keyed = (typeof KEYED)[number];

interface Backend {
  all(c: Collection): Promise<Row[]>;
  put(c: Collection, row: Omit<Row, 'id'> & { id?: number }): Promise<Row>;
  del(c: Collection, id: number): Promise<void>;
  clear(c: Collection): Promise<void>;
  getKV<T>(k: string): Promise<T | undefined>;
  setKV(k: string, v: unknown): Promise<void>;
  kget<T>(c: Keyed, k: string): Promise<T | undefined>;
  kput(c: Keyed, k: string, v: unknown): Promise<void>;
  kdel(c: Keyed, k: string): Promise<void>;
  kall<T>(c: Keyed): Promise<T[]>;
}

function memory(): Backend {
  const data = new Map<string, Map<number, Row>>();
  const kv = new Map<string, unknown>();
  let seq = 0;
  const col = (c: string) => { if (!data.has(c)) data.set(c, new Map()); return data.get(c)!; };
  return {
    async all(c) { return [...col(c).values()].map((r) => structuredClone(r)); },
    async put(c, row) { const id = row.id ?? ++seq; if (id > seq) seq = id; const r = { ...structuredClone(row), id } as Row; col(c).set(id, r); return structuredClone(r); },
    async del(c, id) { col(c).delete(id); },
    async clear(c) { col(c).clear(); },
    async getKV<T>(k: string) { return structuredClone(kv.get(k)) as T | undefined; },
    async setKV(k, v) { kv.set(k, structuredClone(v)); },
    async kget<T>(c: Keyed, k: string) { return structuredClone((data.get(`k:${c}`) as unknown as Map<string, unknown> | undefined)?.get(k)) as T | undefined; },
    async kput(c, k, v) { const m = (data.get(`k:${c}`) as unknown as Map<string, unknown>) ?? new Map(); m.set(k, structuredClone(v)); data.set(`k:${c}`, m as never); },
    async kdel(c, k) { (data.get(`k:${c}`) as unknown as Map<string, unknown> | undefined)?.delete(k); },
    async kall<T>(c: Keyed) { return [...((data.get(`k:${c}`) as unknown as Map<string, unknown> | undefined)?.values() ?? [])].map((v) => structuredClone(v)) as T[]; },
  };
}

function idb(factory: IDBFactory): Backend {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      for (const c of KEYED) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('本机数据库打开失败'));
  });
  const tx = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error ?? new Error('本机数据库写入失败'));
      t.onabort = () => reject(t.error ?? new Error('本机数据库写入被中止'));
    });
  };
  return {
    all: (c) => tx<Row[]>(c, 'readonly', (s) => s.getAll() as IDBRequest<Row[]>),
    async put(c, row) {
      const clean = { ...row } as Record<string, unknown>;
      if (clean.id === undefined) delete clean.id;
      const id = await tx<IDBValidKey>(c, 'readwrite', (s) => s.put(clean));
      return { ...clean, id: Number(id) } as Row;
    },
    async del(c, id) { await tx(c, 'readwrite', (s) => s.delete(id)); },
    async clear(c) { await tx(c, 'readwrite', (s) => s.clear()); },
    getKV: <T,>(k: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
    async setKV(k, v) { await tx('kv', 'readwrite', (s) => s.put(v, k)); },
    kget: <T,>(c: Keyed, k: string) => tx<T | undefined>(c, 'readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
    async kput(c, k, v) { await tx(c, 'readwrite', (s) => s.put(v, k)); },
    async kdel(c, k) { await tx(c, 'readwrite', (s) => s.delete(k)); },
    kall: <T,>(c: Keyed) => tx<T[]>(c, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  };
}

let backend: Backend | null = null;
function be(): Backend {
  if (!backend) backend = typeof indexedDB !== 'undefined' && indexedDB ? idb(indexedDB) : memory();
  return backend;
}
/** 测试用：换成全新的内存库。 */
export function resetLocalDb(): void { backend = memory(); }

/* ---------- 0.8.1：本机数据变更订阅（常驻 / 保活组件据此重新读取，不用刷新页面） ---------- */
/** 变更键：集合名（drafts、conversations…）或 `kv:<键>`（kv:models、kv:prefs、kv:profile…）。 */
export type StoreKey = Collection | `kv:${string}`;
export const STORE_CHANGED = 'ca:store-changed';
const subs = new Set<(k: StoreKey) => void>();
export function onStoreChange(fn: (k: StoreKey) => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
export function emitStoreChange(k: StoreKey): void {
  for (const fn of [...subs]) { try { fn(k); } catch { /* 单个订阅者出错不影响其他 */ } }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORE_CHANGED, { detail: k }));
}
const after = async <T,>(p: Promise<T>, k: StoreKey): Promise<T> => { const r = await p; emitStoreChange(k); return r; };

export const db = {
  all: (c: Collection) => be().all(c),
  async get(c: Collection, id: number): Promise<Row | undefined> { return (await be().all(c)).find((r) => r.id === id); },
  insert: (c: Collection, row: Record<string, unknown>) => after(be().put(c, { ...row, created_at: row.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }), c),
  async update(c: Collection, id: number, patch: Record<string, unknown>): Promise<Row> {
    const cur = await this.get(c, id);
    if (!cur) throw new Error('记录不存在');
    return after(be().put(c, { ...cur, ...patch, id, updated_at: new Date().toISOString() }), c);
  },
  del: (c: Collection, id: number) => after(be().del(c, id), c),
  clear: (c: Collection) => after(be().clear(c), c),
  getKV: <T,>(k: string) => be().getKV<T>(k),
  setKV: (k: string, v: unknown) => after(be().setKV(k, v), `kv:${k}`),
  kget: <T,>(c: Keyed, k: string) => be().kget<T>(c, k),
  kput: (c: Keyed, k: string, v: unknown) => after(be().kput(c, k, v), `kv:${c}`),
  kdel: (c: Keyed, k: string) => after(be().kdel(c, k), `kv:${c}`),
  kall: <T,>(c: Keyed) => be().kall<T>(c),
};
