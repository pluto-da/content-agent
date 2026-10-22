/**
 * 路由（0.5.0「一个前台」）：hash 形如 #space/tab/id。
 * 8 个一级页面：工作流 today | inspire | create | analytics；工作台 platforms | models | agent | prefs。
 * 0.3.x 的设置中心（#settings/*）与 0.2.x 的平级页面（#review、#status …）全部重定向到新位置。
 */
export type Space = 'today' | 'inspire' | 'create' | 'analytics' | 'platforms' | 'models' | 'agent' | 'prefs';
export interface Route { space: Space; sub: string; id: string | null }

export const SPACES: Space[] = ['today', 'inspire', 'create', 'analytics', 'platforms', 'models', 'agent', 'prefs'];
export const INSPIRE_TABS = ['hot', 'library', 'topics'] as const;
export const CREATE_TABS = ['drafts', 'board', 'publish'] as const;
export const MODELS_TABS = ['routes', 'keys', 'usage'] as const;
export const AGENT_TABS = ['files', 'improve'] as const;
export const PREFS_TABS = ['general', 'backup', 'logs'] as const;

/** 每页的标签与默认标签（每页最多 3 个）。 */
export const TABS: Partial<Record<Space, readonly string[]>> = {
  inspire: INSPIRE_TABS, create: CREATE_TABS, models: MODELS_TABS, agent: AGENT_TABS, prefs: PREFS_TABS,
};

/** 0.3.x 设置中心 9 个分区 → 0.5.0 前台位置。 */
export const SETTINGS_MAP: Record<string, string> = {
  '': 'prefs',
  status: 'models/usage',
  models: 'models/routes',
  secrets: 'models/keys',
  plugins: 'platforms',
  'local-apps': 'platforms',
  agent: 'agent/files',
  improve: 'agent/improve',
  general: 'prefs/general',
  backup: 'prefs/backup',
  tasks: 'prefs/logs',
};

/** 0.2.x 的 13 个平级页面 → 新位置（经设置中心的再落到 SETTINGS_MAP）。 */
export const LEGACY: Record<string, string> = {
  overview: 'today', hot: 'inspire/hot', library: 'inspire/library', topics: 'inspire/topics',
  review: 'create/drafts', creator: 'create/publish', analytics: 'analytics',
  status: 'settings/status', agent: 'settings/agent', improve: 'settings/improve', plugins: 'settings/plugins', tasks: 'settings/tasks', settings: 'settings/general',
};

/** 把任意目标（旧页面 id、#settings/* 或新 hash）规范成新 hash。 */
export function normalize(target: string): string {
  const raw = target.replace(/^#/, '').trim();
  if (!raw) return 'today';
  const [head, ...rest] = raw.split('/');
  if (head === 'settings') return SETTINGS_MAP[rest[0] ?? ''] ?? 'prefs';
  if (head && (SPACES as string[]).includes(head)) {
    // agent 既是新页面也是 0.2.x 旧 id：带标签或 id 时按新页面处理；单独 #agent 也落到 Agent 页（同一位置）
    return raw;
  }
  if (head && head in LEGACY) return normalize(LEGACY[head]!);
  return 'today';
}

export function parseHash(hash: string): Route {
  const h = normalize(hash);
  const [space, sub = '', id = null] = h.split('/') as [Space, string?, string?];
  const tab = (list: readonly string[]) => (list.includes(sub) ? sub : list[0]!);
  switch (space) {
    case 'inspire': return { space, sub: tab(INSPIRE_TABS), id: null };
    case 'create': {
      if (/^\d+$/.test(sub)) return { space, sub: 'drafts', id: sub };
      return { space, sub: tab(CREATE_TABS), id: CREATE_TABS.includes(sub as never) ? id : null };
    }
    case 'models': return { space, sub: tab(MODELS_TABS), id: null };
    case 'agent': return { space, sub: tab(AGENT_TABS), id: null };
    case 'prefs': return { space, sub: tab(PREFS_TABS), id: sub === 'logs' ? id : null };
    case 'platforms': return { space, sub: '', id: sub || null };
    case 'analytics': return { space, sub: '', id: null };
    default: return { space: 'today', sub: '', id: null };
  }
}

export function toHash(r: Route): string {
  return [r.space, r.sub, r.id].filter(Boolean).join('/');
}
