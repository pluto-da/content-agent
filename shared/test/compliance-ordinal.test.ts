import { describe, expect, it } from 'vitest';
import { checkCompliance } from '../src/compliance';

describe('1.1.0 极限用语：序数“第一，”不误报', () => {
  it('“第一，先……”“第一步”不算极限用语；“全国第一”“第一品牌”仍报', () => {
    const hits = (s: string) => checkCompliance(s).filter((h: { rule: string }) => h.rule === '极限用语').length;
    expect(hits('第一，先找出空闲时间。第一步打开日历。')).toBe(0);
    expect(hits('全国第一的效率工具')).toBe(1);
    expect(hits('第一品牌')).toBe(1);
  });
});
