import { describe, it, expect } from 'vitest';
import {
  chairmanBrief, REPORT_CHAPTERS, buildReport, computeFigures, editFigure, checkConsistency, finalizeReport, traceFigure, renderReportHtml, buildDocx, runEarningsCall, mockDisclosureSpeaker, questionBasis,
  unzip, PEN_NAME, LISTED_HONESTY, NO_DATA, privacyLeaks, type ReportSources, type GovSpeaker,
} from '../src/index.js';

const AT = '2026-12-31T08:00:00.000Z';
export const src = (): ReportSources => ({
  period: '2026Q4', kind: 'quarter', groupName: '长鱼集团', at: AT,
  spend: [{ ref: 'c1', yuan: 0.3, at: AT, deptId: 'bu-video', vendor: 'mimo', model: 'mimo-v2.6-flash' }, { ref: 'c2', yuan: 0.1, at: AT, deptId: 'bu-ecom', vendor: 'mimo' }, { ref: 'g1', yuan: 0.05, at: AT, deptId: 'board', vendor: 'mimo', gov: true }],
  usage: [{ ref: 'c1', yuan: 0.3, at: AT }, { ref: 'c2', yuan: 0.1, at: AT }, { ref: 'g1', yuan: 0.05, at: AT }],
  drafts: [{ id: '1', deptId: 'bu-video', status: 'published', at: AT }, { id: '2', deptId: 'bu-video', status: 'approved', at: AT }, { id: '3', deptId: 'bu-ecom', status: 'rejected', at: AT }],
  metrics: [{ key: 'fans', label: '粉丝增长', value: 320, unit: '人', ref: 'metrics#2026-12' }, { key: 'views', label: '播放量', value: null, unit: '次', ref: null }],
  gaps: [], budgetTotal: 30, budgetAlerts: [], cases: [{ title: '口播 3 秒钩子', kind: 'hit', lesson: '开头先给结论', ref: 'retro#3' }],
  audit: { no: '内审〔2026〕001号', findings: [{ title: '越权一项', level: '高', status: 'closed' }] }, controlsText: '内控自动测试 12/12 通过', risks: [{ title: '平台规则变化', level: 'medium', response: '每周核对', owner: '法务合规部' }],
  talent: [{ text: '新设“直播策划组”负责人入职培训通过', ref: 'training#1' }], outlook: ['下季度把播放量数据接入'], deptNames: { 'bu-video': '短视频事业部', 'bu-ecom': '电商事业部', board: '董事会' },
});

describe('G10 董事长简报', () => {
  it('一屏：三件好事、三件风险、需要你拍板；多于 3 条只取前 3；空的写“本期无”', () => {
    const b = chairmanBrief({ at: AT, good: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }], risks: [], pending: [{ text: '批准 Q4 预算调整' }] });
    expect(b.good).toHaveLength(3); expect(b.risks).toHaveLength(0);
    expect(b.text).toMatch(/三件好事\n1\. a\n2\. b\n3\. c\n\n三件风险\n本期无\n\n需要你拍板（1）\n1\. 批准 Q4 预算调整/);
  });
});

describe('G11 季报、年报 11 个章节，数字可追溯，导出 PDF 与 docx，使用笔名', () => {
  it('11 章；每个数字有出处，没有数据写“无数据”；追溯到原始记录', () => {
    expect(REPORT_CHAPTERS).toHaveLength(11);
    const r = buildReport(src(), { seq: 1 });
    expect(r.chapters.map((c) => c.title)).toEqual([...REPORT_CHAPTERS]);
    for (const f of r.figures) { if (f.value == null) expect(f.ref).toBeNull(); else expect(f.ref).toMatch(/^[a-z]+:/); }
    expect(r.figures.find((f) => f.id === 'm:views')?.value).toBeNull();
    expect(r.figures.find((f) => f.id === 'spend')?.value).toBe(0.45);
    expect(r.figures.find((f) => f.id === 'gov_spend')?.value).toBe(0.05);
    expect(r.figures.find((f) => f.id === 'budget_rate')?.value).toBe(1.5);
    expect(traceFigure(r, 'adopted')).toMatchObject({ kind: 'drafts', query: '2026Q4?status=approved|published' });
    expect(r.author).toBe(PEN_NAME);
  });
  it('PDF 打印版：封面集团名 + 笔名、目录、图表、关键数字、每页诚实声明；不含隐私', () => {
    const r = finalizeReport(buildReport(src(), { seq: 1 }), src());
    const html = renderReportHtml(r);
    expect(html).toContain('长鱼集团 2026Q4 季度报告'); expect(html).toContain(`署名：${PEN_NAME}`);
    expect(html).toContain('<section class="toc">'); expect(html).toContain('<svg class="chart"'); expect(html).toContain('class="key"');
    expect(html).toContain(LISTED_HONESTY); expect(html).toContain(NO_DATA);
    expect(privacyLeaks(html)).toEqual([]);
  });
  it('docx：合法 zip，含正文 / 页脚诚实声明 / 作者笔名，11 章标题齐全', () => {
    const r = buildReport(src(), { seq: 1 });
    const files = new Map(unzip(buildDocx(r)).map((e) => [e.path, new TextDecoder().decode(e.data)]));
    expect([...files.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml']);
    for (const t of REPORT_CHAPTERS) expect(files.get('word/document.xml')).toContain(t);
    expect(files.get('word/footer1.xml')).toContain('不是法律实体');
    expect(files.get('docProps/core.xml')).toContain(`<dc:creator>${PEN_NAME}</dc:creator>`);
  });
});

describe('G12 一致性检查阻止错误报告', () => {
  it('原样通过；手改一个数字 → 阻止并列出差异；记账与用量不一致 → 阻止', () => {
    const r = buildReport(src(), { seq: 1 });
    expect(finalizeReport(r, src()).status).toBe('final');
    const bad = finalizeReport(editFigure(r, 'outputs', 30), src());
    expect(bad.status).toBe('blocked');
    expect(bad.diffs).toEqual(['产出（稿件数）：报告写 30篇，记录重算为 3篇（出处 drafts:2026Q4）']);
    const s2 = src(); s2.usage[0]!.yuan = 0.9;
    expect(checkConsistency(r, s2).diffs.join()).toMatch(/花费账 ¥0\.4500 与用量日志 ¥1\.0500 不一致/);
    expect(computeFigures(src()).length).toBe(r.figures.length);
  });
});

describe('G13 业绩发布会', () => {
  it('CEO 讲解；分析师 ×2 + 独立董事提问须基于报告数字或缺失项；答不上来记入待办；花费上限 ¥0.5', async () => {
    const r = buildReport(src(), { seq: 1 });
    const c = await runEarningsCall(r, mockDisclosureSpeaker, { askers: [{ id: 'an1', name: '分析师甲', role: 'analyst' }, { id: 'an2', name: '分析师乙', role: 'analyst' }, { id: 'id-1', name: '独立董事 A', role: 'independent' }], at: AT });
    expect(c.speech).toMatch(/结论先行/);
    expect(c.qa).toHaveLength(3);
    for (const q of c.qa) expect(q.basis).toMatch(/^(figure|missing):/);
    expect(c.qa.find((q) => q.askerRole === 'independent')!.basis).toBe('missing:m:views');
    expect(c.todos.length).toBeGreaterThanOrEqual(1);
    expect(c.minutes).toMatch(/业绩发布会纪要/);
    expect(questionBasis('今天天气不错', r)).toBeNull();
    const costly: GovSpeaker = async () => ({ text: '总花费（Token 账）为什么是 0.45？', cost: 0.2 });
    const capped = await runEarningsCall(r, costly, { askers: [{ id: 'a', name: '甲', role: 'analyst' }, { id: 'b', name: '乙', role: 'analyst' }, { id: 'c', name: '丙', role: 'independent' }], at: AT });
    expect(capped.stopped).toBe('budget'); expect(capped.spent).toBeLessThanOrEqual(0.5 + 0.2);
    const offTopic: GovSpeaker = async (q) => ({ text: q.role === 'analyst' ? '你们团队氛围怎么样？' : '需要核实。', cost: 0 });
    const fixed = await runEarningsCall(r, offTopic, { askers: [{ id: 'a', name: '甲', role: 'analyst' }], at: AT });
    expect(fixed.qa[0]!.question).toMatch(/主持人补充/);
  });
});
