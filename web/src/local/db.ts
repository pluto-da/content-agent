/**
 * 本机数据层：IndexedDB（浏览器 / Capacitor WebView / Electron 都有）。没有 IndexedDB 时（单元测试、极少数隐私模式）退回内存。
 * 集合：drafts、topics、hot、apps、metrics、logs；键值：settings（含模型配置）。密钥只存本机，不写日志。
 */
export type Row = Record<string, unknown> & { id: number };
export const COLLECTIONS = ['drafts', 'topics', 'apps', 'metrics', 'logs'] as const;
export type Collection = (typeof COLLECTIONS)[number];

const DB_NAME = 'content-agent';
const DB_VERSION = 1;

interface Backend {
  all(c: Collection): Promise<Row[]>;
  put(c: Collection, row: Omit<Row, 'id'> & { id?: number }): Promise<Row>;
  del(c: Collection, id: number): Promise<void>;
  clear(c: Collection): Promise<void>;
  getKV<T>(k: string): Promise<T | undefined>;
  setKV(k: string, v: unknown): Promise<void>;
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
  };
}

let backend: Backend | null = null;
function be(): Backend {
  if (!backend) backend = typeof indexedDB !== 'undefined' && indexedDB ? idb(indexedDB) : memory();
  return backend;
}
/** 测试用：换成全新的内存库。 */
export function resetLocalDb(): void { backend = memory(); }

export const db = {
  all: (c: Collection) => be().all(c),
  async get(c: Collection, id: number): Promise<Row | undefined> { return (await be().all(c)).find((r) => r.id === id); },
  insert: (c: Collection, row: Record<string, unknown>) => be().put(c, { ...row, created_at: row.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }),
  async update(c: Collection, id: number, patch: Record<string, unknown>): Promise<Row> {
    const cur = await this.get(c, id);
    if (!cur) throw new Error('记录不存在');
    return be().put(c, { ...cur, ...patch, id, updated_at: new Date().toISOString() });
  },
  del: (c: Collection, id: number) => be().del(c, id),
  clear: (c: Collection) => be().clear(c),
  getKV: <T,>(k: string) => be().getKV<T>(k),
  setKV: (k: string, v: unknown) => be().setKV(k, v),
};
