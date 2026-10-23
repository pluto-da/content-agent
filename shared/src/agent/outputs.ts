/**
 * 结构化输出校验（C53 / C54）：topic-semiotics 与 revenue-review 的输出 Schema 直接取自随包技能正文（```json schema 块），
 * 再加两条 Schema 表达不了的规则：
 *  - 选题：symbol_decode ≥1 且 falsifier 非空（Schema 已表达）；
 *  - 复盘：falsification 三项非空、beyond_evidence 存在；n<5 时 caveat 含“样本太少”，n<10 或任一下一步没有对照时含“相关≠因果”。
 * 不通过时由 runStructured 带错误信息修复一次，仍失败显示失败卡（调用方负责）。
 */
import { DEFAULT_FILES } from '../vfs/defaults.generated.js';
import { extractSchema } from '../skill.js';
import { validate, type JsonSchema, type SchemaError } from '../schema.js';

const schemaOf = (path: string): JsonSchema => extractSchema(DEFAULT_FILES[path] ?? '').schema ?? { type: 'object' };
export const TOPIC_SEMIOTICS_SCHEMA: JsonSchema = schemaOf('skills/topic-semiotics/SKILL.md');
export const REVENUE_REVIEW_SCHEMA: JsonSchema = schemaOf('skills/revenue-review/SKILL.md');

export function checkTopicSemiotics(v: unknown): SchemaError[] { return validate(TOPIC_SEMIOTICS_SCHEMA, v); }
export function checkRevenueReview(v: unknown): SchemaError[] {
  const errs = validate(REVENUE_REVIEW_SCHEMA, v);
  if (errs.length) return errs;
  const o = v as { data_scope: { n: number; caveat: string }; next_actions: { control?: string }[] };
  const n = o.data_scope.n, cav = o.data_scope.caveat ?? '';
  if (n < 5 && !cav.includes('样本太少')) errs.push({ path: '$.data_scope.caveat', kind: 'required', message: '样本 n<5，caveat 必须写“样本太少”' });
  const noControl = o.next_actions.some((a) => !a.control?.trim() || /^(无|没有|none)$/i.test(a.control.trim()));
  if ((n < 10 || noControl) && !cav.includes('相关≠因果')) errs.push({ path: '$.data_scope.caveat', kind: 'required', message: 'n<10 或没有对照，caveat 必须写“相关≠因果”' });
  return errs;
}
