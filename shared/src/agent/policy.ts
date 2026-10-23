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
export type ApprovalReason = 'spend_call' | 'spend_day' | 'unknown_price_media' | 'video' | 'delete' | 'system_file' | 'memory_write' | 'overwrite' | 'l2';
export interface ApprovalInput {
  tool: string; level: ToolLevel; kind?: 'model' | 'delete' | 'system_file' | 'memory' | 'overwrite' | 'other';
  role?: string; estCost: number | null; spentToday: number; mediaRole?: boolean;
  thresholds: { perCallConfirmYuan: number; perDayConfirmYuan: number };
  remembered: { tool: string; scope: string }[]; scope?: string;
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
  if (i.level === 'L2' && !reasons.length) reasons.push('l2');
  const hard = reasons.some((r) => HARD_CONFIRM.has(r));
  const rememberable = !hard && reasons.length > 0;
  const remembered = rememberable && i.remembered.some((r) => r.tool === i.tool && r.scope === (i.scope ?? '*'));
  return { confirm: reasons.length > 0 && !remembered, reasons, rememberable };
}
export const APPROVAL_REASON_TEXT: Record<ApprovalReason, string> = {
  spend_call: '单次预计费用达到确认线', spend_day: '今天累计费用将达到确认线', unknown_price_media: '单价未知的媒体调用', video: '视频生成每次都要确认',
  delete: '删除操作', system_file: '修改系统文件（先看改动对比）', memory_write: '写入长期记忆', overwrite: '覆盖已有数据', l2: '这一步需要你确认',
};
