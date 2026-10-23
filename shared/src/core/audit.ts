/**
 * 本机审计日志（企业级·可审计）：Agent 每次工具调用、审批、花费、系统文件改动（含 diff）、导入导出、迁移、Key 变更（只记末四位）。
 * 纯函数部分：事件结构、筛选、导出（JSONL / CSV），全部先打码。存储由 web 层 db 集合 audit 负责（只追加）。
 */
import { redactDeep } from './redact.js';

export type AuditKind = 'tool_call' | 'approval' | 'spend' | 'system_file_change' | 'memory_change' | 'export' | 'import' | 'backup' | 'restore' | 'migration' | 'key_change' | 'run_state' | 'error' | 'flag_change' | 'setting_change' | 'storage';
export interface AuditEvent {
  id?: number; at: string; kind: AuditKind; actor: 'user' | 'agent' | 'system';
  summary: string;                  // 一句白话
  runId?: string; conversationId?: number; tool?: string; cost?: number;
  target?: string;                  // 文件路径 / 设置键 / 角色
  diff?: string;                    // 系统文件改动的统一 diff
  outcome?: 'ok' | 'denied' | 'failed' | 'pending';
  detail?: Record<string, unknown>;
}
export interface AuditFilter { kinds?: AuditKind[]; actor?: AuditEvent['actor']; from?: string; to?: string; text?: string; runId?: string }

export function makeAudit(e: Omit<AuditEvent, 'at'> & { at?: string }): AuditEvent {
  return redactDeep({ ...e, at: e.at ?? new Date().toISOString() });
}
export function filterAudit(list: AuditEvent[], f: AuditFilter = {}): AuditEvent[] {
  const q = f.text?.trim().toLowerCase();
  return list.filter((e) =>
    (!f.kinds?.length || f.kinds.includes(e.kind)) && (!f.actor || e.actor === f.actor) && (!f.runId || e.runId === f.runId) &&
    (!f.from || e.at >= f.from) && (!f.to || e.at <= f.to) &&
    (!q || `${e.summary} ${e.tool ?? ''} ${e.target ?? ''}`.toLowerCase().includes(q)));
}
export function auditToJsonl(list: AuditEvent[]): string { return list.map((e) => JSON.stringify(redactDeep(e))).join('\n') + (list.length ? '\n' : ''); }
const csvCell = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function auditToCsv(list: AuditEvent[]): string {
  const cols: (keyof AuditEvent)[] = ['at', 'kind', 'actor', 'summary', 'outcome', 'tool', 'cost', 'target', 'runId'];
  return [cols.join(','), ...list.map((e) => cols.map((c) => csvCell(redactDeep(e)[c])).join(','))].join('\n') + '\n';
}
export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  tool_call: '工具调用', approval: '审批', spend: '花费', system_file_change: '系统文件改动', memory_change: '记忆改动', export: '导出', import: '导入',
  backup: '备份', restore: '恢复', migration: '迁移', key_change: 'Key 变更', run_state: '运行状态', error: '错误', flag_change: '实验开关', setting_change: '设置', storage: '存储清理',
};
