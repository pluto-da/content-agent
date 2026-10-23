/**
 * 目录守护器（8.12）：每个文件夹有入口文件；入口“索引”段（<!-- index:start -->…<!-- index:end -->）与实际文件一致（不一致自动重建，不动用户写的规则段）；
 * 必载文件存在且可解析（缺失用内置默认恢复）；front matter 必填字段、大小、命名；core-directive 逐字一致；SOUL 第一部分覆盖要点；技能版本有记录；收入条目有来源凭据。
 */
import { parseDoc } from './frontmatter.js';
import { ROOT_SYSTEM, checkName, sizeLimit, soulPart1, type Vfs, type VfsFile } from './vfs.js';
import { DEFAULT_FILES, CORE_KEYPOINTS } from './defaults.generated.js';

export interface DoctorProblem { path: string; kind: 'missing_entry' | 'index_out_of_sync' | 'missing_required' | 'bad_front_matter' | 'missing_field' | 'too_large' | 'bad_name' | 'core_directive_changed' | 'keypoint_missing' | 'skill_version_missing' | 'revenue_no_source'; message: string; fixed?: boolean }
export interface DoctorReport { at: string; files: number; folders: number; problems: DoctorProblem[]; fixed: number }
const IDX_START = '<!-- index:start -->', IDX_END = '<!-- index:end -->';
const DIRS_WITH_ENTRY = (paths: string[]) => [...new Set(paths.filter((p) => p.includes('/')).map((p) => p.split('/').slice(0, -1).join('/')))];
export const entryPath = (dir: string) => `${dir}/${dir.split('/').at(-1)!.replace(/^\./, '').toUpperCase()}.md`;

export function indexBlock(dir: string, files: string[]): string {
  const items = files.filter((p) => p !== entryPath(dir) && p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)).filter((p) => !p.includes('/') || /\/[A-Z-]+\.md$/.test(p) || /\/SKILL\.md$/.test(p)).sort();
  return `${IDX_START}\n${items.length ? items.map((p) => `- ${p}`).join('\n') : '- （空）'}\n${IDX_END}`;
}
export function syncIndex(content: string, block: string): string {
  const i = content.indexOf(IDX_START), j = content.indexOf(IDX_END);
  if (i >= 0 && j > i) return content.slice(0, i) + block + content.slice(j + IDX_END.length);
  return `${content.replace(/\s*$/, '')}\n\n## 文件索引（自动维护）\n${block}\n`;
}
const REQUIRED_FM = ['id', 'type', 'updated', 'version', 'editable', 'load'];

export async function runDoctor(vfs: Vfs, o: { fix?: boolean; revenue?: { id: string; source?: unknown }[]; now?: Date } = {}): Promise<DoctorReport> {
  const problems: DoctorProblem[] = [];
  let fixed = 0;
  let files = await vfs.list();
  const paths = () => files.map((f) => f.path);
  // 1) 必载文件
  for (const p of [...ROOT_SYSTEM, 'skills/SKILLS.md']) {
    const f = files.find((x) => x.path === p);
    if (!f || !f.content.trim()) {
      problems.push({ path: p, kind: 'missing_required', message: '必载文件缺失或为空，已用内置默认恢复', fixed: !!o.fix });
      if (o.fix && DEFAULT_FILES[p]) { await vfs.write(p, DEFAULT_FILES[p]!, { author: 'system', note: 'doctor restore' }); fixed++; }
    }
  }
  files = await vfs.list();
  // 2) 每个文件夹都有入口文件 + 索引段同步
  const dirs = DIRS_WITH_ENTRY(paths()).filter((d) => !/^(sessions|tasks|side-chats)\/./.test(d) && !/\/(versions|references|templates)$/.test(d) && !/^skills\/[^/]+$/.test(d) && !/^assets\/(images|audio|video)$/.test(d) && !/^data\/hot-snapshots$/.test(d) && !/^workspace\/(scratch|proposals|outputs)$/.test(d) && !/^\.cache\/./.test(d));
  for (const d of dirs) {
    const ep = entryPath(d);
    let entry = files.find((f) => f.path === ep);
    if (!entry) {
      problems.push({ path: ep, kind: 'missing_entry', message: `文件夹 ${d}/ 缺少入口文件`, fixed: !!o.fix });
      if (o.fix) { const def = DEFAULT_FILES[ep] ?? `---\nid: ${ep.replace(/\.md$/, '')}\ntype: doc\ntitle: ${d}/ 入口\nupdated: 2026-10-23T00:00:00+08:00\nversion: 1\neditable: user\nload: on_demand\nbudget: 3000\n---\n# ${d}/\n用途：（自动生成的入口，请补充）\n`; entry = await vfs.write(ep, def, { author: 'system', note: 'doctor create entry' }); fixed++; files = await vfs.list(); }
      else continue;
    }
    if (d === 'semiotics') continue; // 底座入口自带文件索引，且须与 app/agent/semiotics/ 逐字一致（C52），不自动追加
    const block = indexBlock(d, paths());
    const want = syncIndex(entry!.content, block);
    if (want !== entry!.content) {
      if (entry!.content.includes(IDX_START)) problems.push({ path: ep, kind: 'index_out_of_sync', message: '入口文件的索引段与实际文件不一致', fixed: !!o.fix });
      if (o.fix) { await vfs.write(ep, want, { author: 'system', note: 'doctor index' }); fixed++; files = await vfs.list(); }
    }
  }
  // 3) front matter、大小、命名
  for (const f of files) {
    if (!/\.md$/.test(f.path) || /^(sessions|tasks|side-chats|exports|\.cache|\.local)\//.test(f.path)) continue;
    const d = parseDoc(f.content);
    if (d.error) problems.push({ path: f.path, kind: 'bad_front_matter', message: `front matter 格式有误：${d.error}` });
    const isSkillOrAgent = /\/SKILL\.md$/.test(f.path) || /^agents\/(?!AGENTS)/.test(f.path) || /^hooks\/(?!HOOKS)/.test(f.path) || /\/(versions|references|templates)\//.test(f.path) || f.path.startsWith('semiotics/') || f.path.startsWith('docs/core-directive') || f.path.startsWith('docs/working-method');
    if (!isSkillOrAgent && d.hasFM) for (const k of REQUIRED_FM) if (d.fm[k] === undefined) problems.push({ path: f.path, kind: 'missing_field', message: `front matter 缺少 ${k}` });
    if ([...f.content].length > sizeLimit(f.path) + 400) problems.push({ path: f.path, kind: 'too_large', message: `超过大小上限 ${sizeLimit(f.path)}` });
    const bad = checkName(f.path);
    if (bad) problems.push({ path: f.path, kind: 'bad_name', message: bad });
  }
  // 4) 核心指令逐字一致 + 要点覆盖
  const cd = files.find((f) => f.path === 'docs/core-directive.md');
  if (!cd || cd.content !== DEFAULT_FILES['docs/core-directive.md']) {
    problems.push({ path: 'docs/core-directive.md', kind: 'core_directive_changed', message: '核心指令原文与随包原文不一致，已恢复（只读）', fixed: !!o.fix });
    if (o.fix) { await vfs.write('docs/core-directive.md', DEFAULT_FILES['docs/core-directive.md']!, { author: 'system', note: 'doctor restore core directive', allowLarge: true }); fixed++; }
  }
  const soul = files.find((f) => f.path === 'SOUL.md')?.content ?? '';
  const p1 = soulPart1(soul) ?? '';
  for (const [art, pts] of Object.entries(CORE_KEYPOINTS)) for (const pt of pts) if (!p1.includes(pt)) problems.push({ path: 'SOUL.md', kind: 'keypoint_missing', message: `SOUL.md 第一部分缺少要点（${art}）：${pt}` });
  // 5) 技能版本记录
  for (const f of files.filter((x) => /^skills\/[^/]+\/SKILL\.md$/.test(x.path))) {
    const v = Number(parseDoc(f.content).fm.version ?? 1);
    if (v > 1 && !files.some((x) => x.path === f.path.replace('SKILL.md', `versions/v${v}.md`))) problems.push({ path: f.path, kind: 'skill_version_missing', message: `技能当前 v${v} 在 versions/ 中没有记录` });
  }
  // 6) 收入凭据
  for (const r of o.revenue ?? []) if (!r.source) problems.push({ path: `data/revenue.jsonl#${r.id}`, kind: 'revenue_no_source', message: '收入记录缺少来源凭据' });
  return { at: (o.now ?? new Date()).toISOString(), files: files.length, folders: dirs.length, problems: problems.filter((p) => !(o.fix && p.fixed)), fixed };
}

/** 首启：写入全部默认文件（已存在的不覆盖），然后守护器修复索引。 */
export async function initVfs(vfs: Vfs, o: { overwrite?: boolean } = {}): Promise<{ created: number; report: DoctorReport }> {
  let created = 0;
  const existing = new Set((await vfs.list()).map((f: VfsFile) => f.path));
  for (const [p, c] of Object.entries(DEFAULT_FILES)) {
    if (existing.has(p) && !o.overwrite) continue;
    await vfs.write(p, c, { author: 'system', note: 'first run default', allowLarge: true });
    created++;
  }
  const report = await runDoctor(vfs, { fix: true });
  return { created, report };
}
