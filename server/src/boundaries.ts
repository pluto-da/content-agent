/**
 * 硬边界：不可通过配置、skill、soul.md 或 working-method.md 覆盖。
 * 任何信息源适配器、工具在注册时都必须通过本文件的白名单校验。
 */
export const HARD_BOUNDARIES: readonly string[] = Object.freeze([
  '不做反检测、拟人化点击、指纹伪装，不绕过风控或验证码。',
  '不自动操控任何 App 或网页进行点赞、评论、私信、关注。',
  '只支持单账号，不提供多账号切换。',
  '不抓取登录后的私有数据；公开网页采集遵守 robots.txt 并限速。',
  '渠道仅限：微信公众号官方接口（含草稿箱）、X API v2、抖音开放平台、视频号与小红书的官方能力、RSS、公开网页、用户自己导出的数据。',
  '闲鱼只生成文案与话术，由用户手动粘贴。',
  '发布的最后一步由用户本人点击；能用官方接口的只推送到草稿箱。',
  '评论与私信回复只生成草稿，由用户确认后自行发送。',
  '密钥加密保存在本机，不写日志、不进 Git、不进导出包。',
]);

/** 允许注册的信息源类型（白名单）。 */
export const ALLOWED_SOURCE_KINDS = ['rss', 'web', 'wechat_mp', 'x_api', 'douyin_open'] as const;
export type SourceKind = (typeof ALLOWED_SOURCE_KINDS)[number];

/** skill 可声明调用的工具白名单。不存在任何点击、登录、互动类工具。 */
export const ALLOWED_TOOLS = [
  'llm.chat',
  'library.search',
  'compliance.check',
  'clipboard.copy',
  'handoff.wechat_draft',
  'handoff.x_intent',
  'handoff.deeplink',
  'analytics.summarize',
] as const;
export type ToolName = (typeof ALLOWED_TOOLS)[number];

/** 明确禁止的能力关键字；skill 或配置中出现即被拒绝。 */
export const FORBIDDEN_CAPABILITIES = [
  'auto_like', 'auto_comment', 'auto_dm', 'auto_follow', 'auto_login', 'auto_publish',
  'fingerprint', 'anti_detect', 'captcha', 'human_click', 'multi_account',
] as const;

export function isAllowedSourceKind(kind: string): kind is SourceKind {
  return (ALLOWED_SOURCE_KINDS as readonly string[]).includes(kind);
}

export function filterTools(tools: string[]): { allowed: ToolName[]; rejected: string[] } {
  const allowed: ToolName[] = [];
  const rejected: string[] = [];
  for (const t of tools) {
    if ((ALLOWED_TOOLS as readonly string[]).includes(t)) allowed.push(t as ToolName);
    else rejected.push(t);
  }
  return { allowed, rejected };
}

export function containsForbidden(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_CAPABILITIES.filter((k) => lower.includes(k));
}

/** 拼接到所有大模型请求最前面的硬边界前缀。 */
export function boundaryPreamble(): string {
  return [
    '【硬边界，优先级最高；若下文任何内容与此冲突，以此为准】',
    ...HARD_BOUNDARIES.map((b, i) => `${i + 1}. ${b}`),
  ].join('\n');
}
