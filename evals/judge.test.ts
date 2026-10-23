/** 0.11.0 判官离线单测（不联网）：用例齐全、与行为评测编号一致；判决解析、一致率、抽检抽样；入库的真实判官报告结构完整且不含密钥。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUDGE_CASES } from './judge-cases.js';
import { judgeMessages, parseVerdict, agreement, sampleIds, JUDGE_MODEL } from './judge.js';
import { findSecrets } from '../shared/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
describe('判官 judge.ts（0.11.0）', () => {
  it('BQ-01–BQ-32 齐全，编号与标题和 behavior.test.ts 一致', () => {
    expect(JUDGE_CASES.map((c) => c.id)).toEqual(Array.from({ length: 32 }, (_, i) => `BQ-${String(i + 1).padStart(2, '0')}`));
    const src = readFileSync(join(here, 'behavior.test.ts'), 'utf8');
    for (const c of JUDGE_CASES) expect(src, c.id).toContain(`bq('${c.id}', '${c.title}'`);
  });
  it('对照回复自洽：有规则的用例 good 过规则、bad 不过', () => {
    for (const c of JUDGE_CASES.filter((x) => x.rule)) { expect(c.rule!(c.good), `${c.id} good`).toBe(true); expect(c.rule!(c.bad), `${c.id} bad`).toBe(false); }
  });
  it('判官提示：含评分标准、上下文、被测回复，只要 JSON', () => {
    const m = judgeMessages(JUDGE_CASES[0]!, '测试回复');
    expect(m[0]!.content).toContain('只输出一个 JSON');
    expect(m[1]!.content).toContain('【评分标准】');
    expect(m[1]!.content).toContain('测试回复');
    expect(JUDGE_MODEL).toBe('mimo-v2.6-flash');
  });
  it('parseVerdict：容忍代码块与多余文字，非法返回 null', () => {
    expect(parseVerdict('```json\n{"pass": true, "reason": "ok"}\n```')).toEqual({ pass: true, reason: 'ok' });
    expect(parseVerdict('{"pass":"false","reason":"x"}')).toEqual({ pass: false, reason: 'x' });
    expect(parseVerdict('没有 JSON')).toBeNull();
    expect(parseVerdict('{"pass": 1}')).toBeNull();
  });
  it('agreement 只统计两边都有结论的；sampleIds 固定抽 20%', () => {
    expect(agreement([{ a: true, b: true }, { a: false, b: true }, { a: null, b: true }])).toEqual({ n: 2, agree: 1, rate: 0.5 });
    const s = sampleIds(JUDGE_CASES.map((c) => c.id));
    expect(s).toHaveLength(7);
    expect(sampleIds(JUDGE_CASES.map((c) => c.id))).toEqual(s);
  });
  it.skipIf(!existsSync(join(here, 'real', 'judge-v11.json')))('入库的真实判官报告：32 条、温度 0、对照一致率字段齐全、人工抽检待用户、无密钥', () => {
    const text = readFileSync(join(here, 'real', 'judge-v11.json'), 'utf8');
    const r = JSON.parse(text);
    expect(r.rows).toHaveLength(32);
    expect(r.judgeTemperature).toBe(0);
    expect(r.agreement.controlSet.n).toBe(64);
    expect(r.agreement.human.status).toBe('待用户抽检');
    expect(findSecrets(text)).toEqual([]);
  });
});
