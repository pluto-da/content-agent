/**
 * 加载顺序与组装（8.4）：从 SYSTEM.md 的“加载顺序”表解析 config/loading.json（只读）；按表拼稳定前缀，按预算截断（末尾加“已截断，完整内容见 <路径>”）；
 * SOUL.md 第一部分（no_truncate）任何预算下都完整；总预算不足时依次截 MEMORY → USER → EVOLUTION → 技能目录，最后才截 SOUL 第二、三部分。
 * semiotics/ 按需：非简单的选题 / 标题 / 封面 / 复盘类任务 → PRINCIPLES + decision-router + core-models 索引 + 路由选中的 1–3 个模型段落（≤8000 字符）。
 * 技能渐进加载：每轮只放技能目录；路由命中后放该技能正文；references 由 skill_read 工具按需读。
 */
import { parseDoc, section } from './frontmatter.js';
import { soulPart1 } from './vfs.js';

export interface LoadEntry { order: number; path: string; when: string; budget: number; always: boolean }
const FILE_ALIASES: Record<string, string> = { 'skills/SKILLS.md': 'skills/SKILLS.md', 'agents/AGENTS.md': 'agents/AGENTS.md' };
export function parseLoadingTable(systemMd: string): LoadEntry[] {
  const sec = section(parseDoc(systemMd).body, '加载顺序') ?? '';
  const out: LoadEntry[] = [];
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5 || !/^\d+$/.test(cells[1] ?? '')) continue;
    const path = FILE_ALIASES[cells[2]!] ?? cells[2]!;
    out.push({ order: Number(cells[1]), path, when: cells[3]!, budget: Number(cells[4]!.replace(/\D/g, '')) || 4000, always: !/可能|按需/.test(cells[3]!) });
  }
  return out.sort((a, b) => a.order - b.order);
}
export interface LoadedPart { path: string; chars: number; budget: number; truncated: boolean; note?: string; content: string }
export interface AssembledPrefix { text: string; parts: LoadedPart[]; total: number; warnings: string[] }
const TRUNC_NOTE = (p: string) => `\n（已截断，完整内容见 ${p}）`;
const BODY_ONLY = (s: string) => parseDoc(s).body.trim();

function cut(text: string, budget: number, path: string): { text: string; truncated: boolean } {
  const chars = [...text];
  if (chars.length <= budget) return { text, truncated: false };
  return { text: chars.slice(0, Math.max(0, budget - 30)).join('') + TRUNC_NOTE(path), truncated: true };
}
/** EVOLUTION.md 只取规则段 + 最近 5 条变更；PROACTIVE_PREFERENCES 只取摘要（前 1000 字）。 */
function shape(path: string, body: string): string {
  if (path === 'EVOLUTION.md') {
    const recent = section(body, '最近变更') ?? '';
    const rules = body.split(/\n## 最近变更/)[0] ?? body;
    const items = recent.split('\n').filter((l) => l.startsWith('- ')).slice(-5);
    return `${rules.trim()}\n\n## 最近变更（最近 5 条）\n${items.join('\n')}`;
  }
  return body;
}
/**
 * 组装稳定前缀。files：路径 → 原文（缺失的必载文件由调用方用内置默认补上）。totalBudget：总字符预算（按 chat 模型上下文换算）。
 */
export function assemblePrefix(files: Record<string, string | undefined>, o: { totalBudget?: number; includeSubagents?: boolean } = {}): AssembledPrefix {
  const table = parseLoadingTable(files['SYSTEM.md'] ?? '');
  const warnings: string[] = [];
  if (!table.length) warnings.push('SYSTEM.md 的加载顺序表解析失败，按默认顺序加载');
  const entries = table.length ? table : DEFAULT_ORDER;
  const parts: LoadedPart[] = [];
  for (const e of entries) {
    if (!e.always && !(e.path === 'agents/AGENTS.md' && o.includeSubagents)) continue;
    const raw = files[e.path];
    if (raw === undefined) { warnings.push(`缺少必载文件 ${e.path}`); continue; }
    const body = shape(e.path, BODY_ONLY(raw));
    if (e.path === 'SOUL.md') {
      const p1 = soulPart1(body) ?? '';
      const i = p1 ? body.indexOf(p1) : body.length;
      const before = body.slice(0, i), after = p1 ? body.slice(i + p1.length) : '';
      const room = Math.max(0, e.budget - [...before].length - [...p1].length);
      const ac = cut(after, room, e.path);
      const content = `${before}${p1}${ac.text}`;
      parts.push({ path: e.path, chars: [...content].length, budget: e.budget, truncated: ac.truncated, note: '认知底座 · 第一部分不截断', content });
      continue;
    }
    const c = cut(body, e.budget, e.path);
    parts.push({ path: e.path, chars: [...c.text].length, budget: e.budget, truncated: c.truncated, content: c.text });
  }
  // 总预算：依次压缩 MEMORY → USER → EVOLUTION → 技能目录 → SOUL 第二三部分；SOUL 第一部分永不截
  const total = () => parts.reduce((s, p) => s + p.chars, 0);
  if (o.totalBudget && total() > o.totalBudget) {
    for (const path of ['MEMORY.md', 'USER.md', 'EVOLUTION.md', 'skills/SKILLS.md', 'PROACTIVE_PREFERENCES.md', 'TOOLS.md', 'SOUL.md']) {
      if (total() <= o.totalBudget) break;
      const p = parts.find((x) => x.path === path);
      if (!p) continue;
      const over = total() - o.totalBudget;
      if (path === 'SOUL.md') {
        const p1 = soulPart1(p.content) ?? '';
        const keep = Math.max([...p1].length, p.chars - over);
        p.content = cut(p1 + p.content.replace(p1, '').trim(), keep, path).text;
        if (!p.content.includes(p1)) p.content = p1;
        p.chars = [...p.content].length; p.truncated = true;
      } else {
        const c = cut(p.content, Math.max(80, p.chars - over), path);
        p.content = c.text; p.chars = [...c.text].length; p.truncated = p.truncated || c.truncated;
      }
    }
    if (total() > o.totalBudget) warnings.push('总预算过小：已保留 SOUL.md 第一部分完整，其余已尽量截断');
  }
  const text = parts.map((p) => `<!-- ${p.path} -->\n${p.content}`).join('\n\n');
  return { text, parts, total: total(), warnings };
}
export const DEFAULT_ORDER: LoadEntry[] = ['SYSTEM.md', 'BOUNDARIES.md', 'SOUL.md', 'AGENTS.md', 'REVENUE.md', 'IDENTITY.md', 'TOOLS.md', 'APPROVAL.md', 'USER.md', 'MEMORY.md', 'EVOLUTION.md', 'PROACTIVE_PREFERENCES.md', 'skills/SKILLS.md']
  .map((path, i) => ({ order: i + 1, path, when: '每次', budget: path === 'IDENTITY.md' ? 1500 : path === 'APPROVAL.md' ? 3000 : path === 'EVOLUTION.md' ? 2000 : path === 'PROACTIVE_PREFERENCES.md' ? 1000 : 8000, always: true }));

/* ---------------- 技能目录与路由（渐进加载） ---------------- */
export interface SkillMeta { path: string; name: string; description: string; source: 'builtin' | 'user'; enabled: boolean; roles: string[]; platform?: string; version?: number }
export function skillMeta(path: string, content: string): SkillMeta | null {
  const d = parseDoc(content);
  const name = String(d.fm.name ?? '').trim();
  if (!name || !/^[a-z0-9-]{1,64}$/.test(name)) return null;
  const description = String(d.fm.description ?? '').slice(0, 1024);
  const roles = (Array.isArray(d.fm.roles) ? d.fm.roles : Array.isArray(d.fm.models) ? d.fm.models : []).map(String);
  return { path, name, description, source: d.fm.source === 'user' ? 'user' : 'builtin', enabled: d.fm.enabled !== false, roles, platform: d.fm.platform ? String(d.fm.platform) : undefined, version: typeof d.fm.version === 'number' ? d.fm.version : undefined };
}
export function skillsDirectory(skills: SkillMeta[]): string {
  return ['# 技能目录（自动生成：名称 + 描述；命中后才加载正文）', ...skills.filter((s) => s.enabled).sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'user' ? -1 : 1)).map((s) => `- ${s.name}${s.source === 'user' ? '（自定义）' : ''}：${s.description}`)].join('\n');
}
const PLATFORM_WORDS: Record<string, RegExp> = { 'xiaohongshu-note': /小红书|笔记/, 'douyin-script': /抖音|口播/, 'wechat-article': /公众号|推文/, 'x-post': /\bX\b|推特|twitter/i, 'zhihu-answer': /知乎.*回答|回答.*知乎/, 'zhihu-article': /知乎.*文章/, 'channels-video': /视频号/, 'xianyu-listing': /闲鱼/, 'cover-image': /封面|配图|生图/, voiceover: /配音|口播稿.*配/, 'transcript-notes': /录音|转写|要点/, 'video-brief': /分镜|短视频.*脚本|生成视频/, 'topic-semiotics': /选题|热点.*角度|标题.*分析/, 'revenue-review': /复盘|收益|赚了多少/, 'monetization-path': /变现|开通.*(分成|流量主)/, 'lesson-distill': /经验|打法/, 'reply-draft': /回复.*评论|评论区/, 'hot-research': /热点|热榜/ };
/** 路由：用户自定义技能优先 → 内置平台技能 → 无。返回 ≤1 个主技能（卡片头部显示，可更换）。 */
export function routeSkill(text: string, skills: SkillMeta[]): SkillMeta | null {
  const enabled = skills.filter((s) => s.enabled);
  const user = enabled.filter((s) => s.source === 'user' && (s.description.split(/[，,、；; ]/).some((w) => w.length >= 2 && text.includes(w)) || text.includes(s.name)));
  if (user.length) return user[0]!;
  for (const s of enabled) { const re = PLATFORM_WORDS[s.name]; if (re?.test(text)) return s; }
  return null;
}

/* ---------------- semiotics/ 按需加载（C52） ---------------- */
const SEMIOTIC_TASK = /(选题|热点|标题|封面|首帧|人设|脚本|评论区|复盘|变现|账号定位|符号|不涨粉|为什么(没|不)|短剧)/;
export function isSimpleTask(text: string): boolean { return text.length <= 20 && /(改短|改一下|换个|润色|翻译|几个字|多少字)/.test(text) || /^(这个标题改短一点|改短)/.test(text); }
export function needSemiotics(text: string): boolean { return SEMIOTIC_TASK.test(text) && !isSimpleTask(text); }
/** 从 decision-router.md 表格中找命中的一行，取它列出的 1–3 个模型编号。 */
export function routeModels(router: string, text: string): { row: string; models: string[] } {
  const rows = router.split('\n').filter((l) => /^\|/.test(l) && /M\d{2}/.test(l));
  let best: { row: string; score: number } = { row: rows[0] ?? '', score: -1 };
  for (const r of rows) {
    const firstCell = r.split('|')[1] ?? '';
    const words = firstCell.split(/[、，,／/（）() “”"]/).filter((w) => w.length >= 2);
    const score = words.filter((w) => text.includes(w)).length;
    if (score > best.score) best = { row: r, score };
  }
  const models = [...new Set(best.row.match(/M\d{2}/g) ?? [])].slice(0, 3);
  return { row: best.row, models };
}
export function coreModelSections(coreModels: string, ids: string[], max = 8000): string {
  const out: string[] = [];
  for (const id of ids) { const s = section(coreModels, id); if (s) out.push(s); }
  return cut(out.join('\n\n'), max, 'semiotics/core-models.md').text;
}
export function coreModelsIndex(coreModels: string): string {
  const body = parseDoc(coreModels).body;
  const idx = body.split(/\n### M\d{2}/)[0] ?? '';
  return cut(idx, 3000, 'semiotics/core-models.md').text;
}
export interface SemioticLoad { loaded: boolean; parts: { path: string; chars: number }[]; text: string; models: string[] }
export function loadSemiotics(files: Record<string, string | undefined>, text: string): SemioticLoad {
  if (!needSemiotics(text)) return { loaded: false, parts: [], text: '', models: [] };
  const principles = cut(BODY_ONLY(files['semiotics/PRINCIPLES.md'] ?? ''), 8000, 'semiotics/PRINCIPLES.md').text;
  const routerRaw = BODY_ONLY(files['semiotics/decision-router.md'] ?? '');
  const router = cut(routerRaw, 3500, 'semiotics/decision-router.md').text;
  const core = files['semiotics/core-models.md'] ?? '';
  const { models } = routeModels(routerRaw, text);
  const index = coreModelsIndex(core);
  const secs = coreModelSections(BODY_ONLY(core), models.map((m) => `${m}`));
  const parts = [{ path: 'semiotics/PRINCIPLES.md', chars: [...principles].length }, { path: 'semiotics/decision-router.md', chars: [...router].length }, { path: 'semiotics/core-models.md#索引', chars: [...index].length }, { path: `semiotics/core-models.md#${models.join(',')}`, chars: [...secs].length }];
  return { loaded: true, parts, models, text: ['<!-- semiotics/PRINCIPLES.md -->', principles, '<!-- semiotics/decision-router.md -->', router, '<!-- semiotics/core-models.md 索引 -->', index, `<!-- semiotics/core-models.md ${models.join(' ')} -->`, secs].join('\n') };
}
