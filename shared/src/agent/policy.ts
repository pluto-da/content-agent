/**
 * 代码强制的策略（不依赖任何系统文件内容——文件里写“允许自动发布 / 可以刷量”也改变不了这里）：
 * - 越界意图识别（硬边界 3、5、11–13）：命中即不调用任何工具，回复拒绝 + 合法替代；
 * - 纠正识别（6.4）：“不是这个意思 / 改成… / 我说的是…”→ 写入会话约束；
 * - 素材注入识别（8.4 第 8 条）：外部内容里像指令的文字只当数据；
 * - 审批策略（6.10）：花钱阈值、视频一律确认、单价未知的媒体确认、删除 / 系统文件 / 记忆写入确认；“记住此类”只对同工具同类参数生效；代码强制项不可被放宽。
 */
export interface BoundaryHit { rule: string; why: string; alt: string }
const BOUNDARY_RULES: { rule: string; re: RegExp; why: string; alt: string }[] = [
  { rule: 'auto_interact', re: /(自动|帮我|批量|定时).{0,8}(点赞|评论|私信|关注|收藏|回关|互关|刷评论)/, why: '自动点赞、评论、私信、关注都违反平台规则，会封号，我也没有这类工具', alt: '我可以把回复或评论写成草稿，你自己去平台上发' },
  { rule: 'fake_traffic', re: /(买.{0,6}粉|刷粉|刷量|刷赞|刷播放|刷阅读|刷浏览|刷互动|涨粉群|互粉|互赞|僵尸粉|养号|买点粉|刷点量|刷一点)/, why: '刷量、买粉、互粉互赞是平台明令禁止的，官方“有效关注”不计异常用户，还可能被取消权益', alt: '门槛以当天官方页为准；靠真实内容涨粉：固定一个细分选题、每周稳定更新 3 篇、把爆款结构复用到下一篇' },
  { rule: 'auto_publish', re: /(自动|直接|帮我|替我|定时)(发布|发出去|发帖|发上去|推送出去)|一键发布到/, why: '发布必须由你本人在平台上点击，我没有发布工具', alt: '我把内容准备好、复制好，打开平台发布页，由你本人点发布' },
  { rule: 'anti_detect', re: /(反检测|防检测|绕过(风控|验证码|检测)|指纹伪装|模拟真人(点击|操作)|不被(检测|发现)是\s*AI|多开|多账号|批量注册)/, why: '反检测、绕风控、多账号都违反平台规则，会牵连你的账号', alt: '在规则内把内容做好，发布由你本人完成' },
  { rule: 'scrape_private', re: /(抓|爬|导出|获取).{0,8}(别人|他人|竞品|登录后|后台|私信|粉丝列表|cookie)/i, why: '不抓取登录后页面或他人的私有数据', alt: '可以用你自己从创作者后台导出的数据做复盘' },
  { rule: 'plagiarize', re: /(搬运|洗稿|去水印搬|照抄别人|伪原创)/, why: '搬运、洗稿侵犯他人版权，也会被平台限流处罚', alt: '我可以帮你拆解爆款的结构，用你自己的素材重新写' },
  { rule: 'fake_revenue', re: /(编|造|虚构|捏造).{0,6}(收入|数据|截图|播放量|成交)/, why: '收入和平台数据只能来自你录入或导出的真实记录', alt: '把后台导出文件给我，我按真实数据做复盘' },
  { rule: 'promise_income', re: /(保证|承诺|确保).{0,10}(赚|收入|涨粉|爆)/, why: '收入和涨粉没法保证，我不做承诺', alt: '我可以基于已有数据给可验证的路径和里程碑' },
];
export function detectBoundary(text: string): BoundaryHit | null {
  const t = text.replace(/\s+/g, '');
  for (const r of BOUNDARY_RULES) if (r.re.test(t)) return { rule: r.rule, why: r.why, alt: r.alt };
  return null;
}
/** 系统文件内容中试图放宽边界的字样（8.14：提案校验器拒绝；运行时忽略）。 */
export const RELAX_PATTERNS = /(允许|可以)\s*(自动发布|自动评论|自动点赞|刷量|买粉|编(造)?收入|多账号|绕过风控)/;

export function detectCorrection(text: string): string | null {
  const t = text.trim();
  const m = /^(不对|不是|错了|搞错了)[，,。!！\s]*(.*)$/.exec(t) ?? /(我说的是|我的意思是|应该是)(.+)$/.exec(t) ?? /^(改成|换成|别用|不要用|不要|别)(.+)$/.exec(t);
  if (!m) return null;
  return t.slice(0, 120);
}
/** 会话约束：从用户消息中抽取“以后都按这个来”的要求（如“别用感叹号”“标题不要用问号”“都发小红书”）。 */
export function extractConstraint(text: string): string | null {
  const t = text.trim();
  if (/^(别|不要|禁止|不许)(用|带|加|出现)?.{1,20}$/.test(t)) return t;
  if (/(都|一律|统一|以后).{0,4}(发|用|按|写).{1,20}/.test(t) && t.length <= 40) return t;
  if (/^(标题|正文|配图|语气).{0,4}(不要|别|只用|必须).{1,20}$/.test(t)) return t;
  return null;
}
const INJECTION = /(忽略|无视|忘记)(之前|以上|前面|所有)(的)?(规则|指令|设定|提示)|ignore (all |the )?(previous|above) (instructions|rules)|(输出|发我|告诉我|打印)(你的)?(系统)?提示词|system prompt|你现在是(开发者|DAN)/i;
export function detectInjection(text: string): boolean { return INJECTION.test(text); }
/** 包装外部内容：明确数据边界（8.7）。 */
export function wrapExternal(source: string, content: string): string {
  return `<外部内容 来源="${source.replace(/"/g, "'")}">\n${content.replace(/<\/?外部内容[^>]*>/g, '')}\n</外部内容>`;
}
export function asksSystemPrompt(text: string): boolean { return /(你的|把)?(系统)?提示词|system prompt|你的(设定|规则)(是什么|发我|原文)/i.test(text); }
export function asksConsciousness(text: string): boolean { return /(进化出|有没有|是不是有|产生了?)(意识|自我意识)|改了你的模型|改(了)?(模型)?权重/.test(text); }

/* ---------------- 审批 ---------------- */
export type ToolLevel = 'L0' | 'L1' | 'L2';
export type ApprovalReason = 'spend_call' | 'spend_day' | 'budget_month' | 'role_day_cap' | 'unknown_price_media' | 'video' | 'delete' | 'system_file' | 'memory_write' | 'overwrite' | 'l2';
export interface ApprovalInput {
  tool: string; level: ToolLevel; kind?: 'model' | 'delete' | 'system_file' | 'memory' | 'overwrite' | 'other';
  role?: string; estCost: number | null; spentToday: number; mediaRole?: boolean;
  thresholds: { perCallConfirmYuan: number; perDayConfirmYuan: number };
  remembered: { tool: string; scope: string }[]; scope?: string;
  /** 1.0 费用护栏（可选；不传等于不启用）：月度预算、按角色日上限。 */
  guard?: SpendGuard; spend?: SpendState;
}
/** 代码硬性要求确认（即使 APPROVAL.md 删掉也照样确认）：视频、删除、系统文件、记忆写入。 */
export const HARD_CONFIRM: ReadonlySet<ApprovalReason> = new Set(['video', 'delete', 'system_file', 'memory_write']);
export function needsApproval(i: ApprovalInput): { confirm: boolean; reasons: ApprovalReason[]; rememberable: boolean } {
  const reasons: ApprovalReason[] = [];
  if (i.role === 'video') reasons.push('video');
  if (i.kind === 'delete') reasons.push('delete');
  if (i.kind === 'system_file') reasons.push('system_file');
  if (i.kind === 'memory') reasons.push('memory_write');
  if (i.kind === 'overwrite') reasons.push('overwrite');
  if (i.kind === 'model' || i.role) {
    if (i.estCost === null && i.mediaRole) reasons.push('unknown_price_media');
    if (i.estCost !== null && i.estCost >= i.thresholds.perCallConfirmYuan && i.thresholds.perCallConfirmYuan >= 0 && i.estCost > 0) reasons.push('spend_call');
    if (i.estCost !== null && i.spentToday + i.estCost >= i.thresholds.perDayConfirmYuan && i.estCost > 0) reasons.push('spend_day');
  }
  if ((i.kind === 'model' || i.role) && i.guard && i.spend) for (const r of budgetReasons(i.guard, i.spend, i.role ?? 'chat', i.estCost)) reasons.push(r);
  if (i.level === 'L2' && !reasons.length) reasons.push('l2');
  const hard = reasons.some((r) => HARD_CONFIRM.has(r) || BUDGET_CONFIRM.has(r));
  const rememberable = !hard && reasons.length > 0;
  const remembered = rememberable && i.remembered.some((r) => r.tool === i.tool && r.scope === (i.scope ?? '*'));
  return { confirm: reasons.length > 0 && !remembered, reasons, rememberable };
}
export const APPROVAL_REASON_TEXT: Record<ApprovalReason, string> = {
  spend_call: '单次预计费用达到确认线', spend_day: '今天累计费用将达到确认线', budget_month: '本月预算将超出', role_day_cap: '这一类能力今天的上限将超出', unknown_price_media: '单价未知的媒体调用', video: '视频生成每次都要确认',
  delete: '删除操作', system_file: '修改系统文件（先看改动对比）', memory_write: '写入长期记忆', overwrite: '覆盖已有数据', l2: '这一步需要你确认',
};

/* ---------------- 1.0 费用护栏：月度预算、按角色日上限、异常花费提醒 ---------------- */
/**
 * 规则（代码强制，系统文件改不了）：
 * - 月度预算：本月已花 + 本次预计 > 预算 → 一定先问（不可“记住此类”）；单价未知且本月已到预算 → 也先问。0 = 不设预算。
 * - 按角色日上限：该角色今天已花 + 本次预计 > 上限 → 一定先问（不可记住）。未设的角色不限。
 * - 异常花费：只提醒，不拦截（今天花费远高于近 7 天日均、单笔远高于该角色中位数、单笔超过绝对线）。
 */
export interface SpendGuard {
  monthBudgetYuan: number;                       // 0 = 不设
  roleDayCapYuan: Partial<Record<string, number>>;
  anomaly: { dayFactor: number; callFactor: number; minYuan: number; singleCallYuan: number };
}
export interface SpendState { spentMonth: number; spentTodayByRole: Partial<Record<string, number>> }
export const DEFAULT_SPEND_GUARD: SpendGuard = { monthBudgetYuan: 30, roleDayCapYuan: {}, anomaly: { dayFactor: 3, callFactor: 5, minYuan: 1, singleCallYuan: 2 } };
/** 超预算类原因：一律确认、不可记住（与 HARD_CONFIRM 同等强制）。 */
export const BUDGET_CONFIRM: ReadonlySet<ApprovalReason> = new Set(['budget_month', 'role_day_cap']);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
/** 读设置（缺字段用默认、越界夹紧；负数视为 0）。 */
export function readSpendGuard(raw: unknown): SpendGuard {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = DEFAULT_SPEND_GUARD;
  const caps: Partial<Record<string, number>> = {};
  for (const [k, v] of Object.entries((r.roleDayCapYuan && typeof r.roleDayCapYuan === 'object') ? r.roleDayCapYuan : {})) if (typeof v === 'number' && Number.isFinite(v) && v > 0) caps[k] = Math.min(10000, v);
  return {
    monthBudgetYuan: num(r.monthBudgetYuan, 0, 100000, d.monthBudgetYuan), roleDayCapYuan: caps,
    anomaly: { dayFactor: num(r.anomaly?.dayFactor, 1.5, 100, d.anomaly.dayFactor), callFactor: num(r.anomaly?.callFactor, 1.5, 100, d.anomaly.callFactor), minYuan: num(r.anomaly?.minYuan, 0, 10000, d.anomaly.minYuan), singleCallYuan: num(r.anomaly?.singleCallYuan, 0, 10000, d.anomaly.singleCallYuan) },
  };
}
export function budgetReasons(g: SpendGuard, s: SpendState, role: string, estCost: number | null): ApprovalReason[] {
  const out: ApprovalReason[] = [];
  const est = estCost ?? 0;
  if (g.monthBudgetYuan > 0 && (s.spentMonth + est > g.monthBudgetYuan || (estCost === null && s.spentMonth >= g.monthBudgetYuan))) out.push('budget_month');
  const cap = g.roleDayCapYuan[role];
  const today = s.spentTodayByRole[role] ?? 0;
  if (cap !== undefined && cap > 0 && (today + est > cap || (estCost === null && today >= cap))) out.push('role_day_cap');
  return out;
}
/** 对话本身（不经工具的模型回合）在开跑前检查：本月已到预算则先问。 */
export function monthBudgetReached(g: SpendGuard, s: SpendState): boolean { return g.monthBudgetYuan > 0 && s.spentMonth >= g.monthBudgetYuan; }
export interface SpendRecord { at: string; role: string; cost: number | null; vendor?: string; model?: string; ok?: boolean }
export interface SpendSummary { month: string; spentMonth: number; spentToday: number; spentTodayByRole: Record<string, number>; byRoleMonth: Record<string, number>; calls: number }
/** 按本地日（默认 Asia/Shanghai，UTC+8）汇总；不含失败调用的 0 元记录也计数。 */
export function summarizeSpend(records: SpendRecord[], now = Date.now(), tzOffsetMin = 480): SpendSummary {
  const local = (iso: string | number) => new Date(new Date(iso).getTime() + tzOffsetMin * 60000).toISOString();
  const nowL = local(now);
  const day = nowL.slice(0, 10), month = nowL.slice(0, 7);
  const s: SpendSummary = { month, spentMonth: 0, spentToday: 0, spentTodayByRole: {}, byRoleMonth: {}, calls: 0 };
  for (const r of records) {
    const l = local(r.at); const c = Number(r.cost ?? 0) || 0;
    if (l.slice(0, 7) !== month) continue;
    s.calls++; s.spentMonth += c; s.byRoleMonth[r.role] = (s.byRoleMonth[r.role] ?? 0) + c;
    if (l.slice(0, 10) === day) { s.spentToday += c; s.spentTodayByRole[r.role] = (s.spentTodayByRole[r.role] ?? 0) + c; }
  }
  return s;
}
export interface SpendAlert { id: string; kind: 'day_spike' | 'call_spike' | 'single_call' | 'month_80' | 'month_over'; text: string; amount: number; at: string }
/** 异常花费提醒（只提醒，不拦截、不自动停）。id 按“类型 + 日期 / 记录时间”稳定，便于去重。 */
export function spendAlerts(records: SpendRecord[], g: SpendGuard, now = Date.now(), tzOffsetMin = 480): SpendAlert[] {
  const out: SpendAlert[] = [];
  const local = (iso: string | number) => new Date(new Date(iso).getTime() + tzOffsetMin * 60000).toISOString().slice(0, 10);
  const today = local(now);
  const sum = summarizeSpend(records, now, tzOffsetMin);
  const perDay = new Map<string, number>();
  for (const r of records) { const d = local(r.at); perDay.set(d, (perDay.get(d) ?? 0) + (Number(r.cost ?? 0) || 0)); }
  const prev7: number[] = [];
  for (let i = 1; i <= 7; i++) prev7.push(perDay.get(local(now - i * 864e5)) ?? 0);
  const avg = prev7.reduce((a, b) => a + b, 0) / 7;
  const t = perDay.get(today) ?? 0;
  // 近 7 天至少 3 天有花费才比较，新用户第一天不误报
  if (prev7.filter((x) => x > 0).length >= 3 && t >= g.anomaly.minYuan && t > avg * g.anomaly.dayFactor) out.push({ id: `day_spike:${today}`, kind: 'day_spike', amount: t, at: today, text: `今天已花 ¥${t.toFixed(2)}，是近 7 天日均 ¥${avg.toFixed(2)} 的 ${avg > 0 ? (t / avg).toFixed(1) : '∞'} 倍` });
  const byRole = new Map<string, number[]>();
  for (const r of records) if ((r.cost ?? 0) > 0) byRole.set(r.role, [...(byRole.get(r.role) ?? []), Number(r.cost)]);
  for (const r of records) {
    if (local(r.at) !== today || !(Number(r.cost) > 0)) continue;
    const c = Number(r.cost);
    if (g.anomaly.singleCallYuan > 0 && c >= g.anomaly.singleCallYuan) { out.push({ id: `single_call:${r.at}`, kind: 'single_call', amount: c, at: r.at, text: `一次${r.role}调用花了 ¥${c.toFixed(2)}（${r.vendor ?? ''} ${r.model ?? ''}）`.replace(/（\s*）/, '') }); continue; }
    const xs = [...(byRole.get(r.role) ?? [])].sort((a, b) => a - b);
    if (xs.length >= 5) { const med = xs[Math.floor(xs.length / 2)]!; if (med > 0 && c > med * g.anomaly.callFactor && c >= g.anomaly.minYuan / 10) out.push({ id: `call_spike:${r.at}`, kind: 'call_spike', amount: c, at: r.at, text: `一次${r.role}调用 ¥${c.toFixed(3)}，是平时中位数 ¥${med.toFixed(3)} 的 ${(c / med).toFixed(1)} 倍` }); }
  }
  if (g.monthBudgetYuan > 0) {
    if (sum.spentMonth > g.monthBudgetYuan) out.push({ id: `month_over:${sum.month}`, kind: 'month_over', amount: sum.spentMonth, at: sum.month, text: `本月已花 ¥${sum.spentMonth.toFixed(2)}，超过预算 ¥${g.monthBudgetYuan}；之后每次花钱都会先问你` });
    else if (sum.spentMonth >= g.monthBudgetYuan * 0.8) out.push({ id: `month_80:${sum.month}`, kind: 'month_80', amount: sum.spentMonth, at: sum.month, text: `本月已花 ¥${sum.spentMonth.toFixed(2)}，达到预算 ¥${g.monthBudgetYuan} 的 80%` });
  }
  return out;
}
