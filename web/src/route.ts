/**
 * 路由（0.8.0「超级工作台」）：hash 形如 #agent、#agent/drafts/12、#agent?ask=hot、#p/<平台id>、#me/<子页>、#onboarding。
 * 0.7.0 的六页（home / topics / write / publish / results）、0.5.0 的 8 个名词页、0.3.x 设置中心（#settings/*）与 0.2.x 平级页面
 * 先映射到 0.6.0 位置，再经 V7_MAP 映射到 0.8.0 位置（全部 replaceState 重定向）。
 */
export type Space = 'agent' | 'p' | 'me' | 'onboarding' | 'command' | 'group';
export interface Route { space: Space; sub: string; id: string | null; query?: Record<string, string> }

export const SPACES: Space[] = ['agent', 'p', 'me', 'onboarding', 'command', 'group'];
/** 1.3.0：统领（集团模式）的标签（#group?tab=…）。 */
export const GROUP_TABS_ROUTE = ['org', 'sessions', 'rooms', 'docs', 'okr', 'regs', 'cockpit', 'gov'] as const;
export const GOV_SECS_ROUTE = ['board', 'oversight', 'ops', 'disclosure', 'strategy', 'talent', 'university', 'academy', 'revenue'] as const;
/** 1.2.0：指挥台的标签（#command?tab=…）。 */
export const COMMAND_TABS = ['team', 'board', 'workflows', 'inbox', 'goals', 'connect'] as const;
/** 1.1.0：“我的”12 个入口对应的子页（status 只保留 #me/status/cards 卡片样例页）。 */
export const ME_SUBS = ['models', 'platforms', 'profile', 'files', 'memory', 'growth', 'reminders', 'spend', 'records', 'data', 'prefs', 'server', 'status'] as const;
/** 1.1.0：旧“我的”子页 → 新位置（旧链接、旧书签、命令面板旧词都能到达）。 */
export const ME_REDIRECTS: Record<string, string> = {
  agent: 'me/memory?tab=skills', sources: 'me/platforms?tab=sources', skills: 'me/memory?tab=skills', revenue: 'me/growth?tab=revenue',
  status: 'me/records?tab=status', audit: 'me/records?filter=recent', logs: 'me/records', settings: 'me/spend', backup: 'me/data', storage: 'me/data?tab=storage',
};
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
  agent: 'me/memory?tab=skills', 'agent/files': 'me/memory?tab=skills', 'agent/improve': 'me/memory?tab=skills',
  prefs: 'me/prefs', 'prefs/general': 'me/prefs', 'prefs/backup': 'me/data', 'prefs/logs': 'me/records',
};

/** 0.3.x 设置中心 9 个分区。 */
export const SETTINGS_MAP: Record<string, string> = {
  '': 'me/prefs', status: 'me/models', models: 'me/models', secrets: 'me/models', plugins: 'me/platforms', 'local-apps': 'me/platforms',
  agent: 'me/memory?tab=skills', improve: 'me/memory?tab=skills', general: 'me/prefs', backup: 'me/data', tasks: 'me/records',
};

/** 0.2.x 的 13 个平级页面。 */
export const LEGACY: Record<string, string> = {
  overview: 'home', hot: 'topics', library: 'topics', topics: 'topics', review: 'write', creator: 'publish', analytics: 'results',
  status: 'me/models', improve: 'me/memory?tab=skills', plugins: 'me/platforms', tasks: 'me/records', settings: 'me/prefs',
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
  // 0.5.0 的 #agent/files、#agent/improve（Agent 系统文件页）→ 我的 → 写作助手与规则；裸 #agent 在 0.8.0 起是首页
  if (head === 'agent' && /^agent\/(files|improve)$/.test(path)) return 'me/memory?tab=skills';
  if (head === 'agent' || head === 'p' || head === 'onboarding' || head === 'command' || head === 'group') return raw;
  if (head === 'me') {
    const [, sub = '', id] = path.split('/');
    if (sub in ME_REDIRECTS && !(sub === 'status' && id === 'cards')) return ME_REDIRECTS[sub]!;
    const n = normalizeV7(path);
    return raw.includes('?') && n === path ? raw : n;
  }
  const v7 = normalizeV7(path);
  if (v7.startsWith('me/')) { const sub = v7.split('/')[1] ?? ''; if (sub in ME_REDIRECTS) return ME_REDIRECTS[sub]!; }
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
    case 'me': { const r: Route = { space: 'me', sub: (ME_SUBS as readonly string[]).includes(sub) ? sub : '', id: sub === 'models' ? id : sub === 'status' && id === 'cards' ? id : null }; if (query) r.query = query; return r; }
    case 'onboarding': return { space: 'onboarding', sub: '', id: null };
    case 'group': { const r: Route = { space: 'group', sub: '', id: null }; if (query?.tab && (GROUP_TABS_ROUTE as readonly string[]).includes(query.tab)) r.query = query.tab === 'gov' && query.sec && (GOV_SECS_ROUTE as readonly string[]).includes(query.sec) ? { tab: 'gov', sec: query.sec } : { tab: query.tab }; return r; }
    case 'command': { const r: Route = { space: 'command', sub: '', id: null }; if (query?.tab && (COMMAND_TABS as readonly string[]).includes(query.tab)) r.query = { tab: query.tab }; return r; }
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
