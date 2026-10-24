import { describe, it, expect } from 'vitest';
import { ACADEMY_CARDS, MIN_CARDS, GLOSSARY, findTerms, weeklyLesson, badgesOf, isoWeek, PAGE_PLAIN, cardById, privacyLeaks } from '../src/index.js';

describe('G18 董事长学堂：20 张以上卡片、每周一课、徽章、术语悬停', () => {
  it('≥20 张中英文卡片，覆盖 Prompt 列出的 20 个主题；每页有一句大白话；内容不含隐私；股权激励写明不涉及真实股权', () => {
    expect(ACADEMY_CARDS.length).toBeGreaterThanOrEqual(MIN_CARDS);
    const terms = ACADEMY_CARDS.map((c) => c.term).join('|');
    for (const t of ['董事会', '独立董事', '审计委员会', '三道防线', '内控', '经营分析', '平衡计分卡', '全面预算', '季报', '业绩发布会', '战略地图', 'BLM', 'OKR', 'DOA', '赛马', '灰度', '政委', '复盘', '接班人计划', '股权激励']) expect(terms).toContain(t);
    for (const c of ACADEMY_CARDS) { expect(c.plain && c.plainEn && c.minute && c.minuteEn && c.termEn).toBeTruthy(); expect(c.minuteEn).not.toMatch(/[\u4e00-\u9fff]/); }
    expect(cardById('independent')!.plain).toBe('专门不听 CEO 的人，帮你挑毛病。');
    expect(cardById('equity')!.minute).toMatch(/不涉及任何真实股权、证券或融资/);
    for (const v of Object.values(PAGE_PLAIN)) expect(cardById(v)).toBeTruthy();
    expect(privacyLeaks(JSON.stringify(ACADEMY_CARDS))).toEqual([]);
  });
  it('术语悬停：长词优先（审计委员会不被拆成审计）、别名可查', () => {
    expect(GLOSSARY['独董']).toBe('independent');
    const hits = findTerms('审计委员会听取内审报告，独立董事反对追加预算');
    expect(hits.map((h) => h.term)).toEqual(['审计委员会', '内审报告', '独立董事', '预算']);
  });
  it('每周一课：结合本周事件、已读不重复、可关闭', () => {
    const now = new Date('2026-10-24T00:00:00Z');
    const l = weeklyLesson([{ kind: 'audit_finding', text: '内审发现两次超预算' }], [], false, now)!;
    expect(l).toMatchObject({ cardId: 'three_lines', week: isoWeek(now) });
    expect(l.text).toBe('本周内审发现两次超预算，这就是“三道防线”在起作用：业务自查、风控把关、内审独立复查，三层一起把问题拦在发布前。');
    expect(weeklyLesson([{ kind: 'audit_finding', text: 'x' }], ['three_lines'], false, now)!.cardId).not.toBe('three_lines');
    expect(weeklyLesson([], [], true, now)).toBeNull();
    expect(weeklyLesson([], ACADEMY_CARDS.map((c) => c.id), false, now)).toBeNull();
    expect(weeklyLesson([{ kind: 'budget_alert', text: 'a budget alert' }], [], false, now, 'en')!.text).toMatch(/^This week: a budget alert/);
  });
  it('成长徽章：读卡 + 拍板数量点亮，只鼓励不打卡', () => {
    expect(badgesOf(0, 0).earned).toEqual([]);
    expect(badgesOf(3, 0).earned).toEqual(['starter']);
    expect(badgesOf(10, 3)).toMatchObject({ earned: ['starter', 'steady'], next: { id: 'seasoned', needCards: 10, needMotions: 7 } });
    expect(badgesOf(30, 30).next).toBeNull();
    expect(badgesOf(0, 0).note).toMatch(/没有打卡/);
  });
});
