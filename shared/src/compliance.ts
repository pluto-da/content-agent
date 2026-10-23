export interface ComplianceIssue { level: 'warn' | 'info'; rule: string; match: string; advice: string }

const RULES: { rule: string; re: RegExp; advice: string; level?: 'warn' | 'info' }[] = [
  { rule: '极限用语', re: /(最好|最佳|第一(?![，,、：:.．；;步次天个条点])|唯一|顶级|国家级|全网最低|百分百|100%|绝对|史上最)/g, advice: '广告法禁止极限用语，建议改为客观描述' },
  { rule: '功效承诺', re: /(根治|治愈|包治|药到病除|永不复发|减肥\d+斤|祛斑|无副作用)/g, advice: '涉及医疗/功效承诺，存在违规风险' },
  { rule: '诱导互动', re: /(点赞|关注|转发|评论).{0,4}(抽奖|领取|送|返现)|求(赞|关注|转发)/g, advice: '诱导互动违反多数平台社区规范' },
  { rule: '站外引流', re: /(加\s*v|加微信|vx|wx[:：]|私聊我|二维码|qq群)/gi, advice: '站外引流易被限流，闲鱼与小红书尤其严格' },
  { rule: '隐私信息', re: /(1[3-9]\d{9}|\d{17}[\dXx])/g, advice: '疑似手机号或身份证号，请删除' },
  { rule: '收益承诺', re: /(稳赚|保本|躺赚|日入|月入过万|零风险)/g, advice: '收益承诺违反平台与金融监管规定' },
];

export function checkCompliance(text: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const r of RULES) {
    const found = new Set(text.match(r.re) ?? []);
    for (const m of found) issues.push({ level: r.level ?? 'warn', rule: r.rule, match: m, advice: r.advice });
  }
  issues.push({ level: 'info', rule: 'AI 生成标识', match: '', advice: '如内容由 AI 辅助生成，请按平台要求进行标注（由你决定）' });
  return issues;
}
