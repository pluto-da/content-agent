import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db.js';
import type { AgentFiles } from './agentfiles.js';

/** 参与备份的业务表。settings 中的密钥类键不会出现（密钥在独立的加密密钥库中）。 */
export const BACKUP_TABLES = ['sources', 'items', 'topics', 'drafts', 'draft_edits', 'handoffs', 'metrics', 'versions', 'hot_runs', 'hot_items', 'usage', 'settings'] as const;

export interface Backup { format: 'content-agent-backup'; version: 1; createdAt: string; tables: Record<string, Record<string, unknown>[]>; agentFiles: Record<string, string> }

const SECRET_KEY_RE = /(secret|token|key|password)/i;

export function exportBackup(db: DB, agent: AgentFiles): Backup {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of BACKUP_TABLES) {
    let rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    if (t === 'settings') rows = rows.filter((r) => !SECRET_KEY_RE.test(String(r.key)) || String(r.key) === 'models.comfyui.workflow');
    tables[t] = rows;
  }
  const agentFiles: Record<string, string> = {};
  for (const f of agent.listEditable()) agentFiles[f] = agent.read(f);
  return { format: 'content-agent-backup', version: 1, createdAt: new Date().toISOString(), tables, agentFiles };
}

/** 导入：先把当前数据自动备份到 backups 目录，再整体替换。 */
export function importBackup(db: DB, agent: AgentFiles, data: unknown, backupDir: string): { restored: Record<string, number>; autoBackup: string } {
  const b = data as Backup;
  if (!b || b.format !== 'content-agent-backup' || b.version !== 1 || typeof b.tables !== 'object') throw new Error('不是有效的备份文件');
  mkdirSync(backupDir, { recursive: true });
  const auto = join(backupDir, `auto-before-import-${Date.now()}.json`);
  writeFileSync(auto, JSON.stringify(exportBackup(db, agent)));
  const restored: Record<string, number> = {};
  db.exec('BEGIN');
  try {
    for (const t of BACKUP_TABLES) {
      const rows = b.tables[t];
      if (!Array.isArray(rows)) continue;
      db.exec(`DELETE FROM ${t}`);
      for (const r of rows) {
        const cols = Object.keys(r).filter((c) => /^[a-z_]+$/.test(c));
        if (!cols.length) continue;
        db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c] as never));
      }
      restored[t] = rows.length;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  for (const [f, content] of Object.entries(b.agentFiles ?? {})) {
    if (agent.read(f) !== content) agent.write(f, content, '从备份导入');
  }
  return { restored, autoBackup: auto };
}
