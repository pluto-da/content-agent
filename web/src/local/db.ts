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
  /** 1.0：按主键取一条（不再整表读取；媒体表可达 1 GB）。 */
  one(c: Collection, id: number): Promise<Row | undefined>;
  /** 1.0：逐条遍历（游标），每次只有一条在内存里；fn 返回 false 提前结束。 */
  scan(c: Collection, fn: (r: Row) => boolean | void): Promise<void>;
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
    async one(c, id) { const r = col(c).get(id); return r ? structuredClone(r) : undefined; },
    async scan(c, fn) { for (const r of [...col(c).values()]) if (fn(structuredClone(r)) === false) break; },
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

/* ---------- 1.0：大值分片（只用于 VFS 两个按路径存的表；对旧数据透明：没分片的值原样读出） ---------- */
/** 每片最多 16 000 个字符（V8 序列化按 UTF-16 约 32 KB，低于 Chromium 64 KB 的大值包装阈值）。 */
export const CHUNK_CHARS = 16000;
interface ChunkHead { __caChunks: number; __caKey: string; content: string; [k: string]: unknown }
interface ChunkRec { __caChunkOf: string; i: number; s: string }
const chunkKey = (k: string, i: number) => `${k}\u0000chunk${i}`;
const isChunkHead = (v: unknown): v is ChunkHead => !!v && typeof v === 'object' && typeof (v as ChunkHead).__caChunks === 'number';
const isChunkRec = (v: unknown): v is ChunkRec => !!v && typeof v === 'object' && typeof (v as ChunkRec).__caChunkOf === 'string';
export function splitChunks(k: string, v: unknown): { head: unknown; chunks: string[] } {
  if (!v || typeof v !== 'object' || typeof (v as { content?: unknown }).content !== 'string') return { head: v, chunks: [] };
  const content = (v as { content: string }).content;
  if (content.length <= CHUNK_CHARS) return { head: v, chunks: [] };
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += CHUNK_CHARS) chunks.push(content.slice(i, i + CHUNK_CHARS));
  return { head: { ...(v as object), content: '', __caChunks: chunks.length, __caKey: k }, chunks };
}
function joinChunks(head: ChunkHead, parts: string[]): unknown {
  const { __caChunks: _n, __caKey: _k, ...rest } = head;
  return { ...rest, content: parts.join('') };
}
export function assembleAll(rows: unknown[]): unknown[] {
  const parts = new Map<string, string[]>();
  for (const r of rows) if (isChunkRec(r)) { const a = parts.get(r.__caChunkOf) ?? []; a[r.i] = r.s; parts.set(r.__caChunkOf, a); }
  return rows.filter((r) => !isChunkRec(r)).map((r) => (isChunkHead(r) ? joinChunks(r, Array.from({ length: r.__caChunks }, (_, i) => parts.get(r.__caKey)?.[i] ?? '')) : r));
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
  /** 在一个事务里跑多步（分片读写用）。 */
  const txMulti = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore, done: (v: T) => void) => void): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out: T;
      fn(t.objectStore(store), (v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error ?? new Error('本机数据库读写失败'));
      t.onabort = () => reject(t.error ?? new Error('本机数据库读写被中止'));
    });
  };
  return {
    all: (c) => tx<Row[]>(c, 'readonly', (s) => s.getAll() as IDBRequest<Row[]>),
    one: (c, id) => tx<Row | undefined>(c, 'readonly', (s) => s.get(id) as IDBRequest<Row | undefined>),
    async scan(c, fn) {
      const d = await open();
      await new Promise<void>((resolve, reject) => {
        const t = d.transaction(c, 'readonly');
        const req = t.objectStore(c).openCursor();
        req.onsuccess = () => { const cur = req.result; if (!cur) return; if (fn(cur.value as Row) === false) return; cur.continue(); };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('本机数据库读取失败'));
      });
    },
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
    // 1.0：VFS 大文件分片存（单条值 < 64 KB，不走 Chromium 的“大值转 Blob 文件”存储）。防御性措施：Windows 导出 Internal error. 的根因是两个实例共用 userData（见 desktop/main.cjs 单实例锁），冒烟探针显示 Windows 上 1 MB 大值读写正常
    kget: <T,>(c: Keyed, k: string) => txMulti<T | undefined>(c, 'readonly', (s, done) => {
      const r = s.get(k);
      r.onsuccess = () => {
        const head = r.result as ChunkHead | undefined;
        if (!isChunkHead(head)) { done(head as T | undefined); return; }
        const parts: string[] = new Array(head.__caChunks);
        let left = head.__caChunks;
        for (let i = 0; i < head.__caChunks; i++) {
          const q = s.get(chunkKey(k, i));
          q.onsuccess = () => { parts[i] = (q.result as ChunkRec | undefined)?.s ?? ''; if (--left === 0) done(joinChunks(head, parts) as T); };
        }
      };
    }),
    async kput(c, k, v) {
      const { head, chunks } = splitChunks(k, v);
      await txMulti<void>(c, 'readwrite', (s, done) => {
        const r = s.get(k);
        r.onsuccess = () => {
          const old = r.result as ChunkHead | undefined;
          const oldN = isChunkHead(old) ? old.__caChunks : 0;
          for (let i = chunks.length; i < oldN; i++) s.delete(chunkKey(k, i));
          chunks.forEach((part, i) => s.put({ __caChunkOf: k, i, s: part } satisfies ChunkRec, chunkKey(k, i)));
          s.put(head, k);
          done();
        };
      });
    },
    async kdel(c, k) {
      await txMulti<void>(c, 'readwrite', (s, done) => {
        const r = s.get(k);
        r.onsuccess = () => { const old = r.result as ChunkHead | undefined; if (isChunkHead(old)) for (let i = 0; i < old.__caChunks; i++) s.delete(chunkKey(k, i)); s.delete(k); done(); };
      });
    },
    kall: <T,>(c: Keyed) => tx<unknown[]>(c, 'readonly', (s) => s.getAll() as IDBRequest<unknown[]>).then((rows) => assembleAll(rows) as T[]),
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
  get: (c: Collection, id: number): Promise<Row | undefined> => be().one(c, id),
  scan: (c: Collection, fn: (r: Row) => boolean | void) => be().scan(c, fn),
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
