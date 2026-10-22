import type { DB } from '../db.js';
import { getSetting } from '../db.js';
import type { SchemaError } from '../models/schema.js';
import type { ComplianceIssue } from './compliance.js';

/**
 * 草稿-验证分档（应用层拿不到 logits，置信度只用代理信号）：
 *  - 合规规则命中数（warn 级）
 *  - Schema 是否一次通过
 *  - 字数/条目越界数（第一次输出）
 *  - 修复后是否仍不合规
 * 得分 = 合规命中数 + (一次通过 ? 0 : 1) + (有越界 ? 1 : 0)；修复后仍不合规直接判低。
 *   0 → 高：直接进待审；1–2 → 中：只复核标题与合规命中；≥3 → 低：强模型整篇重写。
 */
export type Tier = 'high' | 'medium' | 'low';
export interface ConfidenceSignals { complianceWarns: number; schemaFirstPass: boolean; overLength: number; schemaValid: boolean }

export function signalsOf(compliance: ComplianceIssue[], s: { firstPass: boolean; firstErrors: SchemaError[]; errors: SchemaError[] }): ConfidenceSignals {
  return {
    complianceWarns: compliance.filter((c) => c.level === 'warn').length,
    schemaFirstPass: s.firstPass,
    overLength: s.firstErrors.filter((e) => e.kind === 'length' || e.kind === 'items').length,
    schemaValid: s.errors.length === 0,
  };
}

export function confidenceScore(s: ConfidenceSignals): number {
  return s.complianceWarns + (s.schemaFirstPass ? 0 : 1) + (s.overLength > 0 ? 1 : 0);
}

export function confidenceTier(s: ConfidenceSignals): Tier {
  if (!s.schemaValid) return 'low';
  const score = confidenceScore(s);
  if (score === 0) return 'high';
  if (score <= 2) return 'medium';
  return 'low';
}

export const TIER_LABEL: Record<Tier, string> = { high: '高置信', medium: '中置信', low: '低置信' };

export interface DraftVerifySettings { enabled: boolean }
export function draftVerifySettings(db: DB): DraftVerifySettings {
  return { enabled: false, ...getSetting<Partial<DraftVerifySettings>>(db, 'pipeline.draftVerify', {}) };
}
