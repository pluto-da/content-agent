/**
 * 路由（0.8.0「超级工作台」）：hash 形如 #agent、#agent/drafts/12、#agent?ask=hot、#p/<平台id>、#me/<子页>、#onboarding。
 * 0.7.0 的六页（home / topics / write / publish / results）、0.5.0 的 8 个名词页、0.3.x 设置中心（#settings/*）与 0.2.x 平级页面
 * 先映射到 0.6.0 位置，再经 V7_MAP 映射到 0.8.0 位置（全部 replaceState 重定向）。
 */
export type Space = 'agent' | 'p' | 'me' | 'onboarding';
export interface Route { space: Space; sub: string; id: string | null; query?: Record<string, string> }

export const SPACES: Space[] = ['agent', 'p', 'me', 'onboarding'];
export const ME_SUBS = ['models', 'platforms', 'sources', 'profile', 'agent', 'prefs', 'backup', 'logs', 'server'] as const;
export const WRITE_FILTERS = ['all', 'pending', 'approved', 'handed_off'] as const;
export const AGENT_SUBS = ['', 'drafts', 'inbox'] as const;

/** 0.5.0 页面 / 标签 → 0.6.0 位置（单测逐条覆盖）。 */
export const V5_MAP: Record<string, string> = {
  today: 'home',
  inspire: 'topics', 'inspire/hot': 'topics', 'inspire/library': 'topics', 'inspire/topics': 'topics',
  create: 'write', 'create/drafts': 'write', 'create/board': 'write', 'create/publish': 'publish',
  analytics: 'results',
  platforms: 'me/platforms',
  models: 'me/models', 'models/routes': 'me/models', 'models/keys': 'me/models', 'models/usage': 'me/models',
  agent: 'me/agent', 'agent/files': 'me/agent', 'agent/improve': 'me/agent',
  prefs: 'me/prefs', 'prefs/general': 'me/prefs', 'prefs/backup': 'me/backup', 'prefs/logs': 'me/logs',
};

/** 0.3.x 设置中心 9 个分区。 */
export const SETTINGS_MAP: Record<string, string> = {
  '': 'me/prefs', status: 'me/models', models: 'me/models', secrets: 'me/models', plugins: 'me/platforms', 'local-apps': 'me/platforms',
  agent: 'me/agent', improve: 'me/agent', general: 'me/prefs', backup: 'me/backup', tasks: 'me/logs',
};

/** 0.2.x 的 13 个平级页面。 */
export const LEGACY: Record<string, string> = {
  overview: 'home', hot: 'topics', library: 'topics', topics: 'topics', review: 'write', creator: 'publish', analytics: 'results',
  status: 'me/models', improve: 'me/agent', plugins: 'me/platforms', tasks: 'me/logs', settings: 'me/prefs',
};

/** 0.7.0 六页 → 0.8.0（单测逐条覆盖）。值为完整 hash（可带 ?query）。 */
export const V7_MAP: Record<string, string> = {
  home: 'agent',
  topics: 'agent?ask=hot',
  write: 'agent/drafts',
  'write/pending': 'agent/drafts?filter=pending',
  'write/approved': 'agent/drafts?filter=approved',
  'write/handed_off': 'agent/drafts?filter=handed_off',
  'write/new': 'agent',
  publish: 'agent/drafts?filter=approved',
  results: 'agent?ask=metrics',
};

/** 0.7.0 及更早的任意地址 → 0.6.0/0.7.0 位置（旧逻辑原样保留）。 */
export function normalizeV7(raw: string): string {
  if (!raw) return 'home';
  const parts = raw.split('/');
  const head = parts[0]!;
  if (head === 'settings') return SETTINGS_MAP[parts[1] ?? ''] ?? 'me';
  if (head === 'home' || head === 'topics' || head === 'results' || head === 'onboarding') return head;
  if (head === 'write' || head === 'publish' || head === 'me') return raw;
  if (head === 'create' && parts[1] === 'drafts' && parts[2] && /^\d+$/.test(parts[2])) return `write/${parts[2]}`;
  if (head === 'create' && parts[1] && /^\d+$/.test(parts[1])) return `write/${parts[1]}`;
  const two = parts.slice(0, 2).join('/');
  if (two in V5_MAP) return V5_MAP[two]!;
  if (head in V5_MAP) return V5_MAP[head]!;
  if (head in LEGACY) return LEGACY[head]!;
  return 'home';
}

/** 把任意目标（0.8.0 hash、0.7.0 六页、0.5.0 页面、#settings/*、0.2.x 旧 id）规范成 0.8.0 hash。 */
export function normalize(target: string): string {
  const raw = target.replace(/^#/, '').trim();
  if (!raw) return 'agent';
  const [path = ''] = raw.split('?');
  const head = path.split('/')[0]!;
  if (head === 'agent' || head === 'p' || head === 'onboarding') return raw;
  if (head === 'me') return path === 'me/sources' || path === 'me/profile' ? path : normalizeV7(path);
  const v7 = normalizeV7(path);
  if (v7.startsWith('me') || v7 === 'onboarding') return v7;
  if (v7 in V7_MAP) return V7_MAP[v7]!;
  const m = /^write\/(\d+)$/.exec(v7);
  if (m) return `agent/drafts/${m[1]}`;
  if (/^publish\/\d+$/.test(v7)) return 'agent/drafts?filter=approved';
  return 'agent';
}

function parseQuery(q: string | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(q)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function parseHash(hash: string): Route {
  const h = normalize(hash);
  const [path = '', qs] = h.split('?');
  const query = parseQuery(qs);
  const [space, sub = '', id = null] = path.split('/') as [string, string?, string?];
  switch (space) {
    case 'p': return sub && /^[a-z0-9_-]+$/i.test(sub) ? { space: 'p', sub, id: null } : { space: 'agent', sub: '', id: null };
    case 'me': return { space: 'me', sub: (ME_SUBS as readonly string[]).includes(sub) ? sub : '', id: sub === 'models' ? id : null };
    case 'onboarding': return { space: 'onboarding', sub: '', id: null };
    default: {
      const s = (AGENT_SUBS as readonly string[]).includes(sub) ? sub : '';
      const r: Route = { space: 'agent', sub: s, id: s === 'drafts' && id && /^\d+$/.test(id) ? id : null };
      if (query) r.query = query;
      return r;
    }
  }
}

export function toHash(r: Route): string {
  const base = [r.space, r.sub, r.id].filter(Boolean).join('/');
  const q = r.query && Object.keys(r.query).length ? `?${new URLSearchParams(r.query).toString()}` : '';
  return base + q;
}
