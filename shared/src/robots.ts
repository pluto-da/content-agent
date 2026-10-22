export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

/** 极简 robots.txt 解析：支持 User-agent / Allow / Disallow，最长匹配优先。 */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (field === 'allow' && value) cur.allow.push(value);
      if (field === 'disallow' && value) cur.disallow.push(value);
    }
  }
  return groups;
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

export function isAllowedByRobots(groups: RobotsGroup[], path: string, agent = 'contentagent'): boolean {
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const group = specific ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const r of group.allow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: true };
  for (const r of group.disallow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: false };
  return best.allow;
}

