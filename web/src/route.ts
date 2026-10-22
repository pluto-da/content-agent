/**
 * 路由（0.6.0「装上就能用」）：hash 形如 #space/sub。
 * 主线 5 个动作页 home | topics | write | publish | results，加 me（我的，含子页）与 onboarding（首启引导）。
 * 0.5.0 的 8 个名词页、0.3.x 设置中心（#settings/*）与 0.2.x 平级页面全部重定向到新位置。
 */
export type Space = 'home' | 'topics' | 'write' | 'publish' | 'results' | 'me' | 'onboarding';
export interface Route { space: Space; sub: string; id: string | null }

export const SPACES: Space[] = ['home', 'topics', 'write', 'publish', 'results', 'me', 'onboarding'];
export const ME_SUBS = ['models', 'platforms', 'agent', 'prefs', 'backup', 'logs', 'server'] as const;
export const WRITE_FILTERS = ['all', 'pending', 'approved', 'handed_off'] as const;

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

/** 把任意目标（新 hash、0.5.0 页面、#settings/*、0.2.x 旧 id）规范成新 hash。 */
export function normalize(target: string): string {
  const raw = target.replace(/^#/, '').trim();
  if (!raw) return 'home';
  const parts = raw.split('/');
  const head = parts[0]!;
  if (head === 'settings') return SETTINGS_MAP[parts[1] ?? ''] ?? 'me';
  if (head === 'home' || head === 'topics' || head === 'results' || head === 'onboarding') return head;
  if (head === 'write' || head === 'publish' || head === 'me') return raw;
  // 0.5.0：草稿详情 #create/drafts/12 → #write/12
  if (head === 'create' && parts[1] === 'drafts' && parts[2] && /^\d+$/.test(parts[2])) return `write/${parts[2]}`;
  if (head === 'create' && parts[1] && /^\d+$/.test(parts[1])) return `write/${parts[1]}`;
  const two = parts.slice(0, 2).join('/');
  if (two in V5_MAP) return V5_MAP[two]!;
  if (head in V5_MAP) return V5_MAP[head]!;
  if (head in LEGACY) return LEGACY[head]!;
  return 'home';
}

export function parseHash(hash: string): Route {
  const h = normalize(hash);
  const [space, sub = '', id = null] = h.split('/') as [Space, string?, string?];
  switch (space) {
    case 'write':
      if (/^\d+$/.test(sub)) return { space, sub: 'all', id: sub };
      if (sub === 'new') return { space, sub: 'all', id: 'new' };
      return { space, sub: (WRITE_FILTERS as readonly string[]).includes(sub) ? sub : 'all', id: null };
    case 'publish': return { space, sub: '', id: sub || null };
    case 'me': return { space, sub: (ME_SUBS as readonly string[]).includes(sub) ? sub : '', id: sub === 'models' ? id : null };
    case 'topics': case 'results': case 'onboarding': return { space, sub: '', id: null };
    default: return { space: 'home', sub: '', id: null };
  }
}

export function toHash(r: Route): string {
  if (r.space === 'write') return r.id ? `write/${r.id}` : r.sub && r.sub !== 'all' ? `write/${r.sub}` : 'write';
  return [r.space, r.sub, r.id].filter(Boolean).join('/');
}
