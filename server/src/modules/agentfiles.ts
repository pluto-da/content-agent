import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import type { DB } from '../db.js';

/** 允许编辑的系统文件（相对 agent 目录）。 */
export const CORE_FILES = ['soul.md', 'working-method.md', 'USER.md', 'APPROVAL.md'] as const;
/** 无论 APPROVAL.md 写了什么，这些动作永远需要用户确认。 */
export const MANDATORY_APPROVAL = ['publish', 'reply'] as const;

export interface VersionRow { id: number; target: string; content: string; reason: string | null; expected: string | null; eval_result: string | null; kind: string; active: number; created_at: string }

export class AgentFiles {
  constructor(private readonly db: DB, readonly dir: string) {}

  /** 首次启动：把默认系统文件复制到 agent 目录（不覆盖已有文件），并为每个文件建立初始版本。 */
  init(defaultsDir: string): void {
    mkdirSync(this.dir, { recursive: true });
    if (existsSync(defaultsDir) && normalize(defaultsDir) !== normalize(this.dir)) {
      cpSync(defaultsDir, this.dir, { recursive: true, force: false, errorOnExist: false });
    }
    for (const d of ['skills', 'memory/topics', 'memory/daily', 'evals']) mkdirSync(join(this.dir, d), { recursive: true });
    for (const f of this.listEditable()) {
      const has = this.db.prepare('SELECT 1 FROM versions WHERE target = ? LIMIT 1').get(f);
      if (!has) this.db.prepare("INSERT INTO versions(target, content, reason, kind, active) VALUES(?, ?, '初始版本', 'init', 1)").run(f, this.read(f));
    }
  }

  private safePath(rel: string): string {
    const p = normalize(join(this.dir, rel));
    const r = relative(this.dir, p);
    if (r.startsWith('..') || r.includes('\0')) throw new Error('非法路径');
    if (!/\.(md|json)$/.test(p)) throw new Error('只允许 .md / .json 文件');
    return p;
  }

  listEditable(): string[] {
    const out: string[] = CORE_FILES.filter((f) => existsSync(join(this.dir, f)));
    const sk = join(this.dir, 'skills');
    if (existsSync(sk)) for (const f of readdirSync(sk).filter((x) => x.endsWith('.md')).sort()) out.push(`skills/${f}`);
    return out;
  }

  read(rel: string): string {
    const p = this.safePath(rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  }

  /** 写入新版本：保存修改前后内容、理由、预期效果，并设为生效。 */
  write(rel: string, content: string, reason = '', expected = ''): VersionRow {
    const p = this.safePath(rel);
    const before = existsSync(p) ? readFileSync(p, 'utf8') : '';
    const hasHistory = this.db.prepare('SELECT 1 FROM versions WHERE target = ? LIMIT 1').get(rel);
    if (!hasHistory && before) this.db.prepare("INSERT INTO versions(target, content, reason, kind, active) VALUES(?, ?, '修改前版本', 'init', 0)").run(rel, before);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    this.db.prepare('UPDATE versions SET active = 0 WHERE target = ?').run(rel);
    const id = Number(this.db.prepare("INSERT INTO versions(target, content, reason, expected, kind, active) VALUES(?, ?, ?, ?, 'edit', 1)").run(rel, content, reason, expected).lastInsertRowid);
    this.appendImprovementLog(`修改 ${rel}（版本 #${id}）：${reason || '未填写理由'}`);
    return this.version(id)!;
  }

  version(id: number): VersionRow | undefined {
    return this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id) as VersionRow | undefined;
  }

  history(rel: string): VersionRow[] {
    return this.db.prepare('SELECT * FROM versions WHERE target = ? ORDER BY id DESC').all(rel) as unknown as VersionRow[];
  }

  allHistory(limit = 200): Omit<VersionRow, 'content'>[] {
    return this.db.prepare('SELECT id, target, reason, expected, eval_result, kind, active, created_at FROM versions ORDER BY id DESC LIMIT ?').all(limit) as unknown as Omit<VersionRow, 'content'>[];
  }

  /** 回滚：把历史版本重新设为生效，并新增一条“回滚”记录；历史永不删除。 */
  rollback(versionId: number, reason = ''): VersionRow {
    const v = this.version(versionId);
    if (!v) throw new Error('版本不存在');
    writeFileSync(this.safePath(v.target), v.content);
    this.db.prepare('UPDATE versions SET active = 0 WHERE target = ?').run(v.target);
    const id = Number(
      this.db.prepare("INSERT INTO versions(target, content, reason, kind, active) VALUES(?, ?, ?, 'rollback', 1)").run(v.target, v.content, `回滚到 #${versionId}${reason ? '：' + reason : ''}`).lastInsertRowid,
    );
    this.appendImprovementLog(`回滚 ${v.target} 到版本 #${versionId}（新记录 #${id}）`);
    return this.version(id)!;
  }

  setEvalResult(versionId: number, result: unknown): void {
    this.db.prepare('UPDATE versions SET eval_result = ? WHERE id = ?').run(JSON.stringify(result), versionId);
  }

  /** 每日日志：memory/daily/YYYY-MM-DD.md 追加一行（本地时区由调用方给出日期）。 */
  daily(line: string, date = new Date()): string {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const p = join(this.dir, 'memory', 'daily', `${d}.md`);
    mkdirSync(dirname(p), { recursive: true });
    if (!existsSync(p)) writeFileSync(p, `# ${d}\n\n`);
    appendFileSync(p, `- ${new Date().toISOString().slice(11, 16)} ${line.replace(/\n/g, ' ')}\n`);
    return p;
  }

  listMemory(): { path: string; size: number }[] {
    const out: { path: string; size: number }[] = [];
    for (const sub of ['memory/topics', 'memory/daily']) {
      const d = join(this.dir, sub);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith('.md')).sort().reverse()) out.push({ path: `${sub}/${f}`, size: statSync(join(d, f)).size });
    }
    return out;
  }

  /** 主题记忆：带类型（fact/inference/hypothesis）、来源、日期。 */
  writeTopic(name: string, entry: { text: string; kind: 'fact' | 'inference' | 'hypothesis'; source: string }): string {
    const safe = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'misc';
    const p = join(this.dir, 'memory', 'topics', `${safe}.md`);
    if (!existsSync(p)) writeFileSync(p, `# ${name}\n\n`);
    const label = { fact: '事实', inference: '推论', hypothesis: '待验证' }[entry.kind];
    appendFileSync(p, `- [${label}] ${entry.text}（来源：${entry.source}，${new Date().toISOString().slice(0, 10)}）\n`);
    return `memory/topics/${safe}.md`;
  }

  appendImprovementLog(line: string): void {
    const p = join(this.dir, 'improvement-log.md');
    if (!existsSync(p)) writeFileSync(p, '# 改进日志\n\n每次变更的理由、评测与回滚记录。由系统自动追加。\n\n');
    appendFileSync(p, `- ${new Date().toISOString()} ${line}\n`);
  }

  /** 解析 APPROVAL.md 中“必须确认”的动作；publish、reply 始终强制需要确认。 */
  approvalRequired(): string[] {
    const txt = this.read('APPROVAL.md');
    const set = new Set<string>(MANDATORY_APPROVAL);
    const section = /##\s*必须确认[\s\S]*?(?=\n##\s|$)/.exec(txt)?.[0] ?? '';
    for (const m of section.matchAll(/`([a-z_]+)`/g)) set.add(m[1]!);
    return [...set];
  }

  needsApproval(action: string): boolean {
    return this.approvalRequired().includes(action);
  }
}
