/** 路由：hash 形如 #space/sub/id。四个主空间 + 设置中心；旧 hash（#review、#status 等）重定向。 */
export type Space = 'today' | 'inspire' | 'create' | 'analytics' | 'settings';
export interface Route { space: Space; sub: string; id: string | null }

export const SPACES: Space[] = ['today', 'inspire', 'create', 'analytics', 'settings'];
export const INSPIRE_TABS = ['hot', 'library', 'topics'] as const;
export const SETTINGS_SECTIONS = ['status', 'agent', 'improve', 'plugins', 'tasks', 'general', 'secrets', 'models', 'backup'] as const;

/** 0.2.x 的 13 个平级页面 → v4 新位置。 */
export const LEGACY: Record<string, string> = {
  overview: 'today', hot: 'inspire/hot', library: 'inspire/library', topics: 'inspire/topics',
  review: 'create/drafts', creator: 'create/publish', analytics: 'analytics',
  status: 'settings/status', agent: 'settings/agent', improve: 'settings/improve', plugins: 'settings/plugins', tasks: 'settings/tasks', settings: 'settings/general',
};

/** 把任意目标（旧页面 id 或新 hash）规范成新 hash。 */
export function normalize(target: string): string {
  const raw = target.replace(/^#/, '').trim();
  if (!raw) return 'today';
  const [head, ...rest] = raw.split('/');
  if (head && head in LEGACY && !(SPACES as string[]).includes(head) && rest.length === 0) return LEGACY[head]!;
  if (head === 'settings' && rest.length === 0) return 'settings';
  if (head && !(SPACES as string[]).includes(head)) return LEGACY[head] ?? 'today';
  return raw;
}

export function parseHash(hash: string): Route {
  const h = normalize(hash);
  const [space, sub = '', id = null] = h.split('/') as [Space, string?, string?];
  switch (space) {
    case 'inspire': return { space, sub: (INSPIRE_TABS as readonly string[]).includes(sub) ? sub : 'hot', id: null };
    case 'create': {
      if (/^\d+$/.test(sub)) return { space, sub: 'drafts', id: sub };
      const s = ['drafts', 'board', 'publish'].includes(sub) ? sub : 'drafts';
      return { space, sub: s, id };
    }
    case 'settings': return { space, sub: (SETTINGS_SECTIONS as readonly string[]).includes(sub) ? sub : '', id: null };
    case 'analytics': return { space, sub: '', id: null };
    default: return { space: 'today', sub: '', id: null };
  }
}

export function toHash(r: Route): string {
  return [r.space, r.sub, r.id].filter(Boolean).join('/');
}
