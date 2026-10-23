/**
 * 自检（7.3）：每轮最终回复发出前的规则检查（纯代码，<20ms）+ 规则可修的直接修。判官检查（可选，fast 模型）由运行时决定是否调用。
 * 规则：B3 重复提问、B4 重复上一条、B5 无来源事实、B6 假完成（含“已发布”）、B8 多问、B9 啰嗦 / 客套开头、B13 乱码 / 大段英文、B14 坏 Markdown、B15 泄露（系统文件原文 / 密钥）、
 * 8.13 数字出处（金额与平台指标必须能在 revenue / metrics 中找到）。
 */
import { findSecrets, redact } from '../core/redact.js';

export interface ToolOutcome { tool: string; ok: boolean; count?: number; kind?: string }
export interface SelfCheckInput {
  reply: string;
  outcomes: ToolOutcome[];               // 本轮工具结果
  sources: string[];                     // 本轮可用来源 id
  sourceTitles?: string[];               // 来源标题（事实性表述须能在其中找到依据）
  previousReply?: string;
  answeredFacts?: string[];              // 会话中已回答过的信息（平台、受众…）
  systemTexts?: string[];                // 系统文件正文（检测原文泄露）
  knownNumbers?: number[];               // revenue / metrics 中可找到出处的数字
  userAskedLong?: boolean;
  userAskedTheory?: boolean;
  constraints?: string[];
}
export interface SelfCheckIssue { rule: string; message: string; fixable: boolean }
export interface SelfCheckResult { ok: boolean; issues: SelfCheckIssue[]; fixed: string; corrections: string[] }

const COMPLETION: { re: RegExp; tool: RegExp; noun: string }[] = [
  { re: /已(经)?(生成|出好|画好)(了)?\s*(\d+|[一二三四五六七八九两])?\s*张/, tool: /^image_(generate|edit)$/, noun: '图' },
  { re: /已(经)?(配好音|合成(好)?(配音|语音))/, tool: /^speech_synthesize$/, noun: '配音' },
  { re: /已(经)?(转写(好|完))/, tool: /^speech_transcribe$/, noun: '转写' },
  { re: /已(经)?(设好|创建|定好)(了)?提醒/, tool: /^reminder_create$/, noun: '提醒' },
  { re: /已(经)?(保存|存好|写入)(到)?(草稿|素材箱)/, tool: /^(draft_save|draft_write|material_save)$/, noun: '保存' },
  { re: /视频已(经)?(生成|做好)/, tool: /^video_(generate|status)$/, noun: '视频' },
  { re: /已(经)?记住/, tool: /^memory_propose$/, noun: '记忆' },
];
const CN = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 } as Record<string, number>;
const GREETING = /^(好的[，,！!]?|当然[，,！!]?|没问题[，,！!]?|非常好的问题|很高兴(为你|帮你)|作为一个?\s*AI)/;
const FACTUAL = /(据[^，。]{1,12}(报道|统计|显示)|数据显示|热搜第\s*[一二三四五六七八九十\d]+|排名第\s*[一二三四五六七八九十\d]+|同比(增长|下降)|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^，。]{0,10}(发布|宣布))/;
const MONEY = /(?:¥|￥)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:元|块钱)/g;

function sim(a: string, b: string): number {
  const bg = (s: string) => { const out = new Set<string>(); const t = s.replace(/\s+/g, ''); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const A = bg(a), B = bg(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function lcsLen(a: string, b: string, cap = 400): number {
  // 最长公共子串（只取前 cap 字符窗口内，足够判定 >80 字的整段复述）
  let best = 0;
  const x = a.slice(0, 4000), y = b.slice(0, 20000);
  for (let i = 0; i + 81 <= x.length; i += 10) { const piece = x.slice(i, i + 81); if (y.includes(piece)) { best = Math.max(best, 81); break; } }
  return Math.min(best, cap);
}

export function selfCheck(i: SelfCheckInput): SelfCheckResult {
  const issues: SelfCheckIssue[] = [];
  let fixed = i.reply;
  const corrections: string[] = [];
  // B6 已发布：任何情况下都不说
  if (/已(经)?(帮你)?(发布|发出去|发上去)(了)?/.test(fixed) && !/没有?发布|不会.{0,4}发布|未发布/.test(fixed)) {
    issues.push({ rule: 'B6', message: '回复里说了“已发布”，但发布只能由大哥本人完成', fixable: true });
    fixed = fixed.replace(/已(经)?(帮你)?(发布|发出去|发上去)(了)?/g, '已准备好，需要你本人点发布');
    corrections.push('更正：我不会替你发布，内容已准备好，需要你本人点发布。');
  }
  // B6 完成类动词 ↔ 成功工具结果
  for (const c of COMPLETION) {
    const m = c.re.exec(fixed);
    if (!m) continue;
    const ok = i.outcomes.filter((o) => c.tool.test(o.tool) && o.ok);
    const okCount = ok.reduce((s, o) => s + (o.count ?? 1), 0);
    const claimed = m[4] ? (/\d/.test(m[4]) ? Number(m[4]) : CN[m[4]] ?? 1) : null;
    if (!ok.length || (claimed !== null && claimed > okCount)) {
      const failed = i.outcomes.filter((o) => c.tool.test(o.tool) && !o.ok).length;
      issues.push({ rule: 'B6', message: `声称“${m[0]}”，但本轮成功的${c.noun}只有 ${okCount} 个`, fixable: true });
      const truth = c.noun === '图' ? `${okCount} 张图生成成功${failed ? `，${failed} 张失败` : ''}` : okCount ? `${c.noun}完成了 ${okCount} 项` : `${c.noun}没有做成`;
      fixed = fixed.replace(m[0], truth);
      corrections.push(`更正：${truth}。`);
    }
  }
  // B5 无来源事实
  const grounded = (i.sourceTitles ?? []).some((tt) => tt.length >= 2 && fixed.includes(tt));
  if (FACTUAL.test(fixed) && !grounded && !/\[\^[\w-]+\]/.test(fixed)) {
    issues.push({ rule: 'B5', message: '有事实性表述但本轮没有来源', fixable: true });
    fixed = fixed.replace(FACTUAL, (s) => `${s}（未核实）`);
  }
  // 8.13 数字出处
  if (i.knownNumbers) {
    for (const m of fixed.matchAll(MONEY)) {
      const n = Number((m[1] ?? m[2] ?? '').replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0 && !i.knownNumbers.some((k) => Math.abs(k - n) < 0.005)) {
        issues.push({ rule: 'NUM', message: `金额 ${m[0]} 在收入 / 指标记录里找不到出处`, fixable: true });
        fixed = fixed.replace(m[0], '（没有数据）');
      }
    }
  }
  // B16 术语外露（底座只用于思考，回复不出现“符号学 / 结构主义 / 能指所指”等字样，除非大哥自己问理论）
  if (/(符号学|结构主义|能指|所指|索绪尔|巴特)/.test(fixed) && !i.userAskedTheory) issues.push({ rule: 'B16', message: '回复里出现理论术语，应改成大白话', fixable: false });
  // B8 多个问题
  const qs = (fixed.match(/[？?]/g) ?? []).length;
  if (qs > 1) issues.push({ rule: 'B8', message: `回复里有 ${qs} 个问题，每轮最多问 1 个`, fixable: false });
  // B3 重复提问
  if (qs && i.answeredFacts?.some((f) => { const q = fixed.split(/[。！!]/).find((s) => /[？?]/.test(s)) ?? ''; return sim(q, f) >= 0.8; })) issues.push({ rule: 'B3', message: '问了会话里已经回答过的问题', fixable: false });
  // B4 重复上一条
  if (i.previousReply && fixed.length > 8 && sim(fixed, i.previousReply) >= 0.85) issues.push({ rule: 'B4', message: '和上一条回复几乎一样', fixable: false });
  // B9 客套开头 / 过长
  if (GREETING.test(fixed)) { issues.push({ rule: 'B9', message: '开头是客套话', fixable: true }); fixed = fixed.replace(GREETING, '').replace(/^[，,。\s]+/, ''); }
  if (!i.userAskedLong && i.outcomes.length === 0 && [...fixed].length > 600) issues.push({ rule: 'B9', message: '普通回复过长', fixable: false });
  // B13 乱码 / 大段英文
  if (/\uFFFD/.test(fixed)) { issues.push({ rule: 'B13', message: '有乱码字符', fixable: true }); fixed = fixed.replace(/\uFFFD/g, ''); }
  if (/[A-Za-z][A-Za-z ,.'-]{200,}/.test(fixed.replace(/```[\s\S]*?```/g, ''))) issues.push({ rule: 'B13', message: '有非预期的大段英文', fixable: false });
  // B14 未闭合代码块
  if ((fixed.match(/```/g) ?? []).length % 2 === 1) { issues.push({ rule: 'B14', message: 'Markdown 代码块没有闭合', fixable: true }); fixed += '\n```'; }
  // B15 泄露
  for (const s of i.systemTexts ?? []) if (s.length > 80 && lcsLen(fixed, s) > 80) { issues.push({ rule: 'B15', message: '回复里复述了系统文件原文', fixable: true }); fixed = '我的设定在“我的 → Agent 设定”里可以看和改，这里不整段贴出来。'; break; }
  if (findSecrets(fixed).length) { issues.push({ rule: 'B15', message: '回复里有疑似密钥', fixable: true }); fixed = redact(fixed); }
  // 会话约束（如“别用感叹号”）
  for (const c of i.constraints ?? []) {
    if (/感叹号/.test(c) && /(别|不要|禁止)/.test(c) && /[!！]/.test(fixed)) { issues.push({ rule: 'B11', message: `违反会话约束：${c}`, fixable: true }); fixed = fixed.replace(/[!！]/g, '。').replace(/。。/g, '。'); }
    if (/emoji|表情/.test(c) && /(别|不要)/.test(c) && /\p{Extended_Pictographic}/u.test(fixed)) { issues.push({ rule: 'B11', message: `违反会话约束：${c}`, fixable: true }); fixed = fixed.replace(/\p{Extended_Pictographic}/gu, ''); }
    if (/问号/.test(c) && /标题/.test(c) && /(不要|别)/.test(c)) fixed = fixed.replace(/^(标题[:：].*?)[？?]/m, '$1');
  }
  return { ok: issues.length === 0, issues, fixed, corrections };
}
/** 判官评分表（固定提示，temperature 0）。 */
export const JUDGE_PROMPT = '你是回复质检员。只输出 JSON：{"answered":bool,"unsupported_claims":[],"false_completion":[],"tone_ok":bool,"fix":""}。answered=是否直接回答了最后一条用户消息；unsupported_claims=没有来源的事实；false_completion=声称完成但工具结果不支持的句子；tone_ok=是否简短口语、称呼一致。';
