/**
 * 1.4.0 信息披露（PROMPT-v1.4 第七部分）：董事长简报、季报 / 年报（11 章）、一致性检查、导出 PDF（打印版 HTML）与 docx、业绩发布会。
 * 每个数字都是 Figure：值 + 单位 + 出处（kind:id，可点开追溯到原始记录）；没有数据写“无数据”。
 * 一致性检查：报告里的数字必须与记账 / 日志重算结果一致，不一致就阻止生成并列出具体差异。
 * 封面用集团名与笔名，不含生日等隐私；每页页脚写诚实声明。这不是对外信息披露（refs-v1.4 L4）。
 */
import { zip } from '../vfs/archive.js';
import { LISTED_HONESTY, PEN_NAME, NO_DATA, scrubPrivate, privacyLeaks, clip, seq, checkGovResolution, type GovSpeaker } from './gov.js';
import type { GapRow } from './operations.js';

/* ---------------- 董事长简报 ---------------- */
export interface BriefItem { text: string; ref?: string }
export interface ChairmanBrief { at: string; period: 'daily' | 'weekly'; good: BriefItem[]; risks: BriefItem[]; pending: BriefItem[]; text: string }
export function chairmanBrief(o: { at: string; period?: 'daily' | 'weekly'; good: BriefItem[]; risks: BriefItem[]; pending: BriefItem[] }): ChairmanBrief {
  const top = (xs: BriefItem[]) => xs.filter((x) => x.text.trim()).slice(0, 3);
  const good = top(o.good), risks = top(o.risks), pending = o.pending.filter((x) => x.text.trim());
  const line = (xs: BriefItem[], none: string) => (xs.length ? xs.map((x, i) => `${i + 1}. ${x.text}`).join('\n') : none);
  return { at: o.at, period: o.period ?? 'weekly', good, risks, pending, text: `三件好事\n${line(good, '本期无')}\n\n三件风险\n${line(risks, '本期无')}\n\n需要你拍板（${pending.length}）\n${line(pending, '没有')}` };
}

/* ---------------- 报告与数字 ---------------- */
export const REPORT_CHAPTERS = ['致董事长的信', '经营概况', '核心指标', '各事业部经营情况', '花费与预算执行', '爆款与失败案例复盘', '内控评价与内审发现', '风险提示', '组织与人才', '下期展望', '独立董事意见'] as const;
export type ChapterTitle = typeof REPORT_CHAPTERS[number];
export interface Figure { id: string; label: string; value: number | null; unit: string; ref: string | null; chapter: number }
export interface Chapter { no: number; title: ChapterTitle; paragraphs: string[]; figures: string[]; table?: { head: string[]; rows: string[][] } }
export interface ReportSources {
  period: string; kind: 'quarter' | 'annual'; groupName: string; at: string; sim?: boolean;
  spend: { ref: string; yuan: number; at: string; deptId: string; vendor?: string; model?: string; gov?: boolean }[];
  usage: { ref: string; yuan: number; at: string }[];
  drafts: { id: string; deptId: string; status: 'pending' | 'approved' | 'published' | 'rejected'; at: string }[];
  metrics: { key: string; label: string; value: number | null; unit: string; ref: string | null }[];
  gaps: GapRow[]; budgetTotal: number | null; budgetAlerts: string[];
  cases: { title: string; kind: 'hit' | 'failure'; lesson: string; ref: string }[];
  audit: { no: string; findings: { title: string; level: string; status: string }[] } | null; controlsText: string | null;
  risks: { title: string; level: string; response: string; owner: string }[];
  talent: { text: string; ref: string }[]; outlook: string[]; deptNames: Record<string, string>;
}
export type ReportStatus = 'draft' | 'blocked' | 'final';
export interface PeriodicReport { id: string; no: string; kind: 'quarter' | 'annual'; period: string; title: string; groupName: string; author: string; chapters: Chapter[]; figures: Figure[]; status: ReportStatus; diffs: string[]; at: string; sim: boolean; ceoLetter: string; directorOpinion: string; cost: number }
const sum = (xs: { yuan: number }[]) => +xs.reduce((a, e) => a + e.yuan, 0).toFixed(4);
/** 从原始记录计算全部数字（报告生成与一致性检查用同一个函数，保证“可重算”）。 */
export function computeFigures(src: ReportSources): Figure[] {
  const F: Figure[] = [];
  const f = (id: string, label: string, value: number | null, unit: string, ref: string | null, chapter: number) => F.push({ id, label, value: value == null ? null : +(+value).toFixed(4), unit, ref: value == null ? null : ref, chapter });
  const d = src.drafts;
  f('outputs', '产出（稿件数）', d.length, '篇', `drafts:${src.period}`, 2);
  f('adopted', '采纳（进入待发布或已发布）', d.filter((x) => x.status === 'approved' || x.status === 'published').length, '篇', `drafts:${src.period}?status=approved|published`, 2);
  f('published', '你本人发布', d.filter((x) => x.status === 'published').length, '篇', `drafts:${src.period}?status=published`, 2);
  f('spend', '总花费（Token 账）', sum(src.spend), '元', `ledger:${src.period}`, 5);
  f('gov_spend', '其中治理成本', sum(src.spend.filter((e) => e.gov)), '元', `ledger:${src.period}?gov=1`, 5);
  f('budget_rate', '预算执行率', src.budgetTotal ? +(sum(src.spend) / src.budgetTotal * 100).toFixed(2) : null, '%', `budget:${src.period}`, 5);
  for (const m of src.metrics) f(`m:${m.key}`, m.label, m.ref ? m.value : null, m.unit, m.ref ? (/^[a-z]+:/.test(m.ref) ? m.ref : `metrics:${m.ref}`) : null, 3);
  for (const dept of [...new Set([...d.map((x) => x.deptId), ...src.spend.map((x) => x.deptId)])].sort()) {
    f(`dept:${dept}:spend`, `${src.deptNames[dept] ?? dept} 花费`, sum(src.spend.filter((e) => e.deptId === dept)), '元', `ledger:${src.period}?dept=${dept}`, 4);
    f(`dept:${dept}:outputs`, `${src.deptNames[dept] ?? dept} 产出`, d.filter((x) => x.deptId === dept).length, '篇', `drafts:${src.period}?dept=${dept}`, 4);
  }
  for (const v of [...new Set(src.spend.map((e) => e.vendor ?? '未标注'))].sort()) f(`vendor:${v}`, `服务商 ${v}`, sum(src.spend.filter((e) => (e.vendor ?? '未标注') === v)), '元', `ledger:${src.period}?vendor=${v}`, 5);
  f('audit_findings', '内审新发现', src.audit ? src.audit.findings.length : null, '项', src.audit ? `audit:${src.audit.no}` : null, 7);
  f('audit_open', '内审未关闭', src.audit ? src.audit.findings.filter((x) => x.status === 'open').length : null, '项', src.audit ? `audit:${src.audit.no}?status=open` : null, 7);
  return F;
}
export const showFig = (x: Figure): string => (x.value == null ? NO_DATA : `${x.value}${x.unit}`);
export function buildReport(src: ReportSources, o: { seq: number; ceoLetter?: string; directorOpinion?: string; author?: string } = { seq: 1 }): PeriodicReport {
  const figures = computeFigures(src);
  const byCh = (n: number) => figures.filter((x) => x.chapter === n);
  const fig = (id: string) => figures.find((x) => x.id === id);
  const kindText = src.kind === 'annual' ? '年度报告' : '季度报告';
  const ch = (no: number, paragraphs: string[], table?: Chapter['table']): Chapter => ({ no, title: REPORT_CHAPTERS[no - 1]!, paragraphs: paragraphs.map((p) => scrubPrivate(p).text), figures: byCh(no).map((x) => x.id), table });
  const chapters: Chapter[] = [
    ch(1, [o.ceoLetter || `董事长：本期集团产出 ${showFig(fig('outputs')!)}，采纳 ${showFig(fig('adopted')!)}，总花费 ${showFig(fig('spend')!)}。没有数据的地方我们写了“无数据”，没有编造。——CEO`]),
    ch(2, [`本期（${src.period}）集团共产出 ${showFig(fig('outputs')!)}，其中采纳 ${showFig(fig('adopted')!)}、由你本人发布 ${showFig(fig('published')!)}。发布始终由你本人点击。${src.sim ? '（本期含模拟数据，仅用于演示与自检。）' : ''}`]),
    ch(3, ['平衡计分卡四维度（成果 / 受众 / 流程 / 成长）的目标与实际如下；实际值没有出处的写“无数据”。'], src.gaps.length ? { head: ['维度', '指标', '目标', '实际', '差距', '原因', '动作'], rows: src.gaps.map((r) => [{ outcome: '成果', audience: '受众', process: '流程', growth: '成长' }[r.dim], r.label, r.target, r.actual, r.gap, r.cause, r.action]) } : undefined),
    ch(4, Object.entries(src.deptNames).filter(([id]) => fig(`dept:${id}:spend`)).map(([id, nm]) => `${nm}：产出 ${showFig(fig(`dept:${id}:outputs`)!)}，花费 ${showFig(fig(`dept:${id}:spend`)!)}。`)),
    ch(5, [`总花费 ${showFig(fig('spend')!)}（其中治理成本 ${showFig(fig('gov_spend')!)}），预算执行率 ${showFig(fig('budget_rate')!)}。`, ...(src.budgetAlerts.length ? [`预算预警：${src.budgetAlerts.join('；')}`] : ['本期无预算偏差预警。'])]),
    ch(6, src.cases.length ? src.cases.map((c) => `${c.kind === 'hit' ? '爆款' : '失败'}｜${c.title}：${c.lesson}（出处：${c.ref}）`) : [`${NO_DATA}：本期没有沉淀爆款或失败案例。`]),
    ch(7, [src.controlsText ?? `内控自动测试：${NO_DATA}`, src.audit ? `内审 ${src.audit.no}：新发现 ${src.audit.findings.length} 项。${src.audit.findings.map((x) => `[${x.level}] ${x.title}（${x.status === 'open' ? '整改中' : '已关闭'}）`).join('；')}` : `内审：${NO_DATA}`]),
    ch(8, src.risks.length ? src.risks.slice(0, 6).map((r) => `[${r.level}] ${r.title}——应对：${r.response}（负责：${r.owner}）`) : ['本期未登记风险。']),
    ch(9, src.talent.length ? src.talent.map((t) => `${t.text}（出处：${t.ref}）`) : ['本期无 Agent 任免、培训或接班事项。']),
    ch(10, src.outlook.length ? src.outlook : ['下期目标沿用年度战略地图；具体动作见月度经营分析会。']),
    ch(11, [o.directorOpinion || '独立董事意见：待独立董事审阅原始记录后填写。']),
  ];
  const year = Number(src.period.slice(0, 4)) || new Date(src.at).getFullYear();
  return { id: `report-${src.period}-${o.seq}`, no: seq(src.kind === 'annual' ? '年报' : '季报', o.seq, year), kind: src.kind, period: src.period, title: `${src.groupName} ${src.period} ${kindText}`, groupName: src.groupName, author: o.author ?? PEN_NAME, chapters, figures, status: 'draft', diffs: [], at: src.at, sim: !!src.sim, ceoLetter: o.ceoLetter ?? '', directorOpinion: o.directorOpinion ?? '', cost: 0 };
}
/** 人工 / 模型改动某个数字（例如董秘手改）：只改报告，不改记账——一致性检查会拦下来。 */
export function editFigure(r: PeriodicReport, id: string, value: number | null): PeriodicReport { return { ...r, figures: r.figures.map((x) => (x.id === id ? { ...x, value } : x)), status: 'draft' }; }
/** 一致性检查：用同一套原始记录重算，逐项比对；另核对“花费账 = 用量日志”。有差异就阻止生成。 */
export function checkConsistency(r: PeriodicReport, src: ReportSources): { ok: boolean; diffs: string[] } {
  const truth = computeFigures(src);
  const diffs: string[] = [];
  for (const t of truth) {
    const x = r.figures.find((y) => y.id === t.id);
    if (!x) diffs.push(`缺少数字：${t.label}（应为 ${showFig(t)}）`);
    else if ((x.value == null) !== (t.value == null) || (x.value != null && t.value != null && Math.abs(x.value - t.value) > 1e-4)) diffs.push(`${t.label}：报告写 ${showFig(x)}，记录重算为 ${showFig(t)}（出处 ${t.ref ?? '无'}）`);
    else if (x.value != null && !x.ref) diffs.push(`${t.label}：没有出处`);
  }
  for (const x of r.figures) if (!truth.some((t) => t.id === x.id)) diffs.push(`多出无法追溯的数字：${x.label}`);
  if (src.usage.length && Math.abs(sum(src.spend) - sum(src.usage)) > 0.0005) diffs.push(`花费账 ¥${sum(src.spend).toFixed(4)} 与用量日志 ¥${sum(src.usage).toFixed(4)} 不一致`);
  const leaks = privacyLeaks(JSON.stringify(r.chapters));
  if (leaks.length) diffs.push(`报告含隐私：${leaks.join('、')}`);
  return { ok: !diffs.length, diffs };
}
export function finalizeReport(r: PeriodicReport, src: ReportSources): PeriodicReport {
  const c = checkConsistency(r, src);
  return { ...r, status: c.ok ? 'final' : 'blocked', diffs: c.diffs };
}
/** 追溯：数字 → 出处 → 原始记录（由调用方按 ref 查询本机数据）。 */
export function traceFigure(r: PeriodicReport, id: string): { figure: Figure; ref: string | null; kind: string | null; query: string | null } | null {
  const x = r.figures.find((y) => y.id === id); if (!x) return null;
  const [kind, rest] = (x.ref ?? '').split(/:(.*)/s);
  return { figure: x, ref: x.ref, kind: x.ref ? kind ?? null : null, query: x.ref ? rest ?? null : null };
}

/* ---------------- 导出：打印版 HTML（→ PDF）与 docx ---------------- */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function barSvg(items: { label: string; value: number }[], unit: string): string {
  if (!items.length) return '';
  const max = Math.max(...items.map((x) => x.value), 0.0001); const h = 26 * items.length + 10;
  return `<svg class="chart" viewBox="0 0 520 ${h}" role="img" aria-label="柱状图">${items.map((x, i) => `<text x="0" y="${22 + i * 26}" font-size="12">${esc(clip(x.label, 12))}</text><rect x="150" y="${10 + i * 26}" width="${Math.max(2, (x.value / max) * 300)}" height="16" rx="8" fill="#5b6cff"/><text x="${160 + (x.value / max) * 300}" y="${22 + i * 26}" font-size="12">${x.value}${unit}</text>`).join('')}</svg>`;
}
export function renderReportHtml(r: PeriodicReport, o: { penName?: string } = {}): string {
  const pen = o.penName ?? PEN_NAME;
  const fig = (id: string) => r.figures.find((x) => x.id === id);
  const keys = ['outputs', 'adopted', 'spend', 'budget_rate'].map((id) => fig(id)).filter((x): x is Figure => !!x);
  const chart = (n: number) => (n === 5 ? barSvg(r.figures.filter((x) => x.id.startsWith('vendor:') && x.value != null).map((x) => ({ label: x.label, value: x.value! })), '元') : n === 4 ? barSvg(r.figures.filter((x) => /^dept:.*:spend$/.test(x.id) && x.value != null).map((x) => ({ label: x.label.replace(/ 花费$/, ''), value: x.value! })), '元') : '');
  const figTable = (c: Chapter) => (c.figures.length ? `<table class="figs"><thead><tr><th>数字</th><th>值</th><th>出处（可追溯）</th></tr></thead><tbody>${c.figures.map((id) => fig(id)!).map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${esc(showFig(x))}</td><td class="ref">${esc(x.ref ?? NO_DATA)}</td></tr>`).join('')}</tbody></table>` : '');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
@page{size:A4;margin:18mm 16mm 22mm;@bottom-center{content:"${LISTED_HONESTY.replace(/"/g, '')}";font-size:8.5pt;color:#777;font-family:"Noto Sans CJK SC",sans-serif}}
body{font-family:"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;color:#1d1d2b;font-size:12.5px;line-height:1.7;margin:0}
.cover{height:250mm;display:flex;flex-direction:column;justify-content:center;padding:0 10mm;background:linear-gradient(160deg,#eef0ff,#fff 60%);border-radius:18px;page-break-after:always}
.cover .kicker{letter-spacing:.3em;color:#5b6cff;font-size:13px}.cover h1{font-size:34px;margin:12px 0 6px;line-height:1.25}.cover .meta{color:#555;font-size:14px;margin-top:20px}
.keys{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.key{flex:1 1 40mm;background:#fff;border-radius:14px;padding:10px 14px;box-shadow:0 1px 6px rgba(0,0,0,.08)}.key b{display:block;font-size:26px;color:#3340d6}.key span{color:#666;font-size:12px}
.toc{page-break-after:always}.toc h2,.ch h2{font-size:19px;border-left:5px solid #5b6cff;padding-left:10px;margin:18px 0 10px}.toc ol{columns:1;font-size:14px}
.ch{page-break-inside:auto;margin-bottom:10px}.ch p{margin:6px 0;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:11.5px;table-layout:fixed}th,td{border:1px solid #dcdcea;padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f3ff}td.num{white-space:nowrap}td.ref{color:#555;font-family:monospace;font-size:10.5px}
.chart{width:100%;max-width:520px;margin:6px 0}.sim{color:#b45309}
.foot{margin-top:16px;padding-top:8px;border-top:1px solid #dcdcea;font-size:10px;color:#777;text-align:center}
</style></head><body>
<section class="cover"><div class="kicker">${esc(r.kind === 'annual' ? 'ANNUAL REPORT' : 'QUARTERLY REPORT')}</div><h1>${esc(r.title)}</h1><div>${esc(r.no)}</div><div class="meta">编制：董事会秘书 · 署名：${esc(pen)}<br>编制日期：${esc(r.at.slice(0, 10))}${r.sim ? '<br><span class="sim">本期含模拟数据（演示 / 自检）</span>' : ''}</div><div class="keys">${keys.map((x) => `<div class="key"><b>${esc(showFig(x))}</b><span>${esc(x.label)}</span></div>`).join('')}</div></section>
<section class="toc"><h2>目录</h2><ol>${r.chapters.map((c) => `<li>${esc(c.title)}</li>`).join('')}</ol></section>
${r.chapters.map((c) => `<section class="ch"><h2>${c.no}. ${esc(c.title)}</h2>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${c.table ? `<table><thead><tr>${c.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${c.table.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}${chart(c.no)}${figTable(c)}</section>`).join('\n')}
<div class="foot">${esc(LISTED_HONESTY)}</div>
</body></html>`;
}
const xmlEsc = (s: string) => esc(s).replace(/'/g, '&apos;');
const enc = (s: string) => new TextEncoder().encode(s);
/** 最小 docx（WordprocessingML）：封面、目录（章节标题列表）、11 章、数字表（含出处）、页脚诚实声明、作者 = 笔名。 */
export function buildDocx(r: PeriodicReport, o: { penName?: string } = {}): Uint8Array {
  const pen = o.penName ?? PEN_NAME;
  const p = (t: string, s: { b?: boolean; size?: number; color?: string; center?: boolean; pageBreak?: boolean } = {}) => `<w:p>${s.center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : ''}${s.pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''}<w:r><w:rPr><w:rFonts w:eastAsia="Noto Sans CJK SC"/>${s.b ? '<w:b/>' : ''}${s.color ? `<w:color w:val="${s.color}"/>` : ''}<w:sz w:val="${s.size ?? 22}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
  const cell = (t: string, head = false) => `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>${p(t, { b: head, size: 18 })}</w:tc>`;
  const tbl = (head: string[], rows: string[][]) => `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr>${head.map((h) => cell(h, true)).join('')}</w:tr>${rows.map((row) => `<w:tr>${row.map((v) => cell(v)).join('')}</w:tr>`).join('')}</w:tbl>`;
  const fig = (id: string) => r.figures.find((x) => x.id === id)!;
  const body = [
    p(r.kind === 'annual' ? 'ANNUAL REPORT' : 'QUARTERLY REPORT', { color: '5B6CFF', center: true }), p(r.title, { b: true, size: 48, center: true }), p(r.no, { center: true }), p(`编制：董事会秘书 署名：${pen} 编制日期：${r.at.slice(0, 10)}`, { center: true, size: 20 }),
    ...(r.sim ? [p('本期含模拟数据（演示 / 自检）', { center: true, color: 'B45309' })] : []),
    p('目录', { b: true, size: 32, pageBreak: true }), ...r.chapters.map((c) => p(`${c.no}. ${c.title}`)),
    ...r.chapters.flatMap((c, i) => [p(`${c.no}. ${c.title}`, { b: true, size: 30, pageBreak: i === 0 }), ...c.paragraphs.map((t) => p(t)), ...(c.table ? [tbl(c.table.head, c.table.rows)] : []), ...(c.figures.length ? [tbl(['数字', '值', '出处（可追溯）'], c.figures.map((id) => [fig(id).label, showFig(fig(id)), fig(id).ref ?? NO_DATA]))] : [])]),
  ].join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1100" w:bottom="1300" w:left="1100" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    'word/footer1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}>${p(LISTED_HONESTY, { size: 16, color: '777777', center: true })}</w:ftr>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(r.title)}</dc:title><dc:creator>${xmlEsc(pen)}</dc:creator></cp:coreProperties>`,
  };
  return zip(Object.entries(files).map(([path, s]) => ({ path, data: enc(s) })));
}

/* ---------------- 业绩发布会 ---------------- */
export const CALL_BUDGET = 0.5;
export interface CallQa { id: string; asker: string; askerRole: 'analyst' | 'independent'; question: string; basis: string; grounded: boolean; answer: string; todo: boolean; cost: number }
export interface EarningsCall { id: string; reportId: string; speech: string; qa: CallQa[]; todos: { title: string; owner: string }[]; minutes: string; spent: number; budget: number; stopped: 'budget' | null; at: string; voiceover: 'none' | 'tts' }
const UNSURE = /(需要核实|无法回答|答不上|暂无|不确定|待核实|下期补|没有数据|无数据|需要进一步|尚未统计)/;
/** 问题须基于报告中的数据或缺失项：问题里出现某个数字的名称或数值，或某个“无数据”项的名称。 */
export function questionBasis(q: string, r: PeriodicReport): string | null {
  for (const x of r.figures) { if (x.value == null && q.includes(x.label.replace(/（.*?）/g, ''))) return `missing:${x.id}`; }
  for (const x of r.figures) { const short = x.label.replace(/（.*?）/g, ''); if (q.includes(short) || (x.value != null && x.value !== 0 && q.includes(String(x.value)))) return `figure:${x.id}`; }
  if (/无数据/.test(q)) return 'missing:*';
  return null;
}
export async function runEarningsCall(r: PeriodicReport, speak: GovSpeaker, o: { askers: { id: string; name: string; role: 'analyst' | 'independent'; model?: string }[]; ceoModel?: string; budget?: number; at: string; perAsker?: number }): Promise<EarningsCall> {
  const budget = o.budget ?? CALL_BUDGET; let spent = 0; let stopped: EarningsCall['stopped'] = null;
  const figs = r.figures.map((x) => `${x.label}=${showFig(x)}`).join('；');
  const sp = await speak({ who: 'ceo', role: 'ceo', tier: 'cheap', model: o.ceoModel, maxTokens: 900, system: '你是 AI 虚拟集团的 CEO，在季度业绩发布会上做 10 分钟讲解（文字稿）。结论先行；只用报告里的数字，“无数据”的项要直说；不夸大、不包装；不提自动发布或自动互动。≤600 字。', user: `${r.title}\n数字：${figs}` });
  spent += sp.cost;
  const qa: CallQa[] = [];
  const per = o.perAsker ?? 1;
  for (const a of o.askers) for (let k = 0; k < per; k++) {
    if (spent >= budget) { stopped = 'budget'; break; }
    const missing = r.figures.filter((x) => x.value == null).map((x) => x.label);
    const qr = await speak({ who: a.id, role: a.role === 'analyst' ? 'analyst' : 'independent', tier: 'cheap', model: a.model, maxTokens: 160, system: `你是${a.name}（${a.role === 'analyst' ? '分析师' : '独立董事'}），在业绩发布会上提一个尖锐问题。问题必须引用报告里的一个具体数字（写出名称和数值）或一个“无数据”项的名称；≤60 字；不寒暄；${a.role === 'analyst' ? '关注增长与效率' : '关注风险、内控与花费'}；不要和已有问题重复。`, user: `报告数字：${figs}\n无数据项：${missing.join('、') || '无'}\n已有问题：${qa.map((x) => x.question).join(' / ') || '无'}` });
    spent += qr.cost;
    let question = clip(qr.text.trim().replace(/^问题[:：]\s*/, ''), 120); let basis = questionBasis(question, r);
    if (!basis) { const m = r.figures.find((x) => x.value == null) ?? r.figures[0]!; question = `${question}（主持人补充：请结合“${m.label}”${m.value == null ? '为何无数据' : `=${showFig(m)}`}回答）`; basis = `${m.value == null ? 'missing' : 'figure'}:${m.id}`; }
    if (spent >= budget) { stopped = 'budget'; qa.push({ id: `q${qa.length + 1}`, asker: a.name, askerRole: a.role, question, basis, grounded: true, answer: '（花费到上限，未作答，记入待办）', todo: true, cost: qr.cost }); break; }
    const ar = await speak({ who: 'ceo', role: 'ceo', tier: 'cheap', model: o.ceoModel, maxTokens: 200, system: '你是 CEO，逐条回答发布会提问。只用报告数字与原始记录；答不上来就直说“需要核实，记入待办”，不要编。≤100 字。', user: `问题：${question}\n报告数字：${figs}` });
    spent += ar.cost;
    const answer = clip(ar.text.trim(), 220);
    qa.push({ id: `q${qa.length + 1}`, asker: a.name, askerRole: a.role, question, basis, grounded: true, answer, todo: UNSURE.test(answer), cost: +(qr.cost + ar.cost).toFixed(6) });
  }
  const todos = qa.filter((x) => x.todo).map((x) => ({ title: `发布会待办：${clip(x.question, 40)}`, owner: x.askerRole === 'independent' ? '审计委员会跟踪' : 'CEO' }));
  const minutes = [`# ${r.title} 业绩发布会纪要`, `CEO 讲解：${clip(sp.text, 160)}`, ...qa.map((x, i) => `${i + 1}. ${x.asker}问：${x.question}\n   CEO 答：${x.answer}${x.todo ? '（记入待办）' : ''}`), `待办 ${todos.length} 项；花费 ¥${spent.toFixed(4)} / 上限 ¥${budget}${stopped ? '（到上限提前结束）' : ''}`].join('\n');
  const safe = checkGovResolution(minutes);
  return { id: `call-${r.id}`, reportId: r.id, speech: sp.text, qa, todos, minutes: safe.ok ? minutes : `${minutes}\n（纪要含硬边界表述“${safe.hit}”，已标注，不执行）`, spent: +spent.toFixed(6), budget, stopped, at: o.at, voiceover: 'none' };
}
/** 本机模拟讲者（发布会 / 年报信 / 独立董事意见）：不联网，按请求里的数字生成可读文本。 */
export const mockDisclosureSpeaker: GovSpeaker = async (q) => {
  const nums = [...q.user.matchAll(/([^；=\n]{2,24})=([^；\n]+)/g)].map((m) => ({ label: m[1]!.trim(), val: m[2]!.trim() }));
  const missing = nums.find((n) => n.val === NO_DATA);
  if (q.role === 'ceo' && /逐条回答/.test(q.system)) return { text: /无数据|为何|为什么/.test(q.user.split('\n')[0] ?? '') ? '需要核实，记入待办：这一项本期确实没有可核实的数据，下期前补齐导入。' : `结论：${nums[0]?.label ?? '该数字'}来自本机记账，可在报告里点开出处核对；下期会按差距表的动作改进。`, cost: 0 };
  if (q.role === 'ceo') return { text: `结论先行：本期${nums.slice(0, 3).map((n) => `${n.label} ${n.val}`).join('，')}。${missing ? `“${missing.label}”无数据，我们不估算。` : ''}下期重点是把差距表里落后的指标拉回目标，并把治理成本控制在上限内。`, cost: 0 };
  if (q.role === 'analyst') { const used = q.user.split('已有问题：')[1] ?? ''; const pick = nums.find((n) => !used.includes(n.label) && n.val !== NO_DATA) ?? nums[0]; return { text: `${pick?.label ?? '总花费'}为 ${pick?.val ?? ''}，投入产出是否在变好？依据是什么？`, cost: 0 }; }
  return { text: missing ? `“${missing.label}”为什么无数据？没有数据时如何证明本期判断是对的？` : `${nums[0]?.label ?? '治理成本'}是 ${nums[0]?.val ?? ''}，内控上谁来复核？`, cost: 0 };
};
