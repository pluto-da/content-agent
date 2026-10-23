/**
 * 本机数据与配置文件的 schemaVersion 注册（ADR-003）：每类持久化文档一个 Migrator，可前滚可回滚，CI 校验步骤连续。
 * - models：v2（0.6–0.8 服务商视角）↔ v3（能力角色）
 * - backup：v1（0.6 JSON 备份，含 drafts/topics…）→ v2（0.8 增加 conversations/messages）→ v3（0.9 增加 vfs 与 models v3，永不含 Key）
 * - prefs：v1（无版本号）↔ v2（加 schemaVersion、flags、spend 阈值、keyPolicy）
 * - config/*.json（limits / routing / ui / heartbeat / reminders）：v1，读取时 compatRead（未来版本只读不写回）
 */
import { Migrator } from './migrate.js';
import { ModelsMigrator } from '../models/config.js';

export const BackupMigrator = new Migrator<{ schemaVersion: 3 }>('备份包', 3, 1)
  .add({ from: 1, to: 2, name: 'backup v1→v2（会话）', up: (d: any) => ({ ...d, conversations: d.conversations ?? [], messages: d.messages ?? [] }), down: (d: any) => { const { conversations: _c, messages: _m, ...rest } = d; return rest; } })
  .add({ from: 2, to: 3, name: 'backup v2→v3（VFS / 模型 v3 / 收益）', up: (d: any) => { const { apiKeys: _k, ...rest } = d; return { ...rest, vfs: d.vfs ?? null, revenue: d.revenue ?? [], audit: d.audit ?? [] }; }, down: (d: any) => { const { vfs: _v, revenue: _r, audit: _a, ...rest } = d; return rest; } });

export interface PrefsV2 { schemaVersion: 2; flags: Record<string, boolean>; spend: { perCallConfirmYuan: number; perDayConfirmYuan: number }; keyPolicy: 'account' | 'per-role'; [k: string]: unknown }
export const PrefsMigrator = new Migrator<PrefsV2>('偏好', 2, 1)
  .add({ from: 1, to: 2, name: 'prefs v1→v2（实验开关 / 花钱阈值 / Key 共用）', up: (d: any) => ({ ...d, flags: d.flags ?? {}, spend: d.spend ?? { perCallConfirmYuan: 1, perDayConfirmYuan: 10 }, keyPolicy: d.keyPolicy ?? 'account' }), down: (d: any) => { const { flags: _f, spend: _s, keyPolicy: _k, ...rest } = d; return rest; } });

export const ConfigMigrators = {
  limits: new Migrator<{ schemaVersion: number }>('config/limits.json', 1, 1),
  routing: new Migrator<{ schemaVersion: number }>('config/routing.json', 1, 1),
  ui: new Migrator<{ schemaVersion: number }>('config/ui.json', 1, 1),
  heartbeat: new Migrator<{ schemaVersion: number }>('subscriptions/heartbeat.json', 1, 1),
  reminders: new Migrator<{ schemaVersion: number }>('subscriptions/reminders.json', 1, 1),
};
export const ALL_MIGRATORS = [ModelsMigrator, BackupMigrator, PrefsMigrator, ...Object.values(ConfigMigrators)];
/** 本机 IndexedDB 结构版本（只新增集合、不改旧集合）：1=0.6、2=0.8、3=0.9。 */
export const LOCAL_DB_VERSIONS: { version: number; app: string; added: string[] }[] = [
  { version: 1, app: '0.6.0', added: ['drafts', 'topics', 'apps', 'metrics', 'logs', 'kv'] },
  { version: 2, app: '0.8.0', added: ['conversations', 'messages', 'inbox', 'tasks', 'hot_snapshots'] },
  { version: 3, app: '0.9.0', added: ['media', 'jobs', 'usage_log', 'vfs_files', 'vfs_versions', 'runs', 'toolcalls', 'locks', 'reminders', 'audit', 'revenue', 'attribution', 'experiments', 'lessons', 'proposals', 'memories'] },
];
