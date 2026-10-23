/** 导航定义（0.8.0「超级工作台」）：首页即 Agent；平台在侧栏；“我的”保留为独立页面。命令面板与测试都从这里读取。 */
export type Layout = 'phone' | 'tablet' | 'desktop';
export function layoutOf(width: number): Layout {
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desktop';
}

export interface NavItem { id: string; label: string; icon: string; desc: string; keywords?: string }

/** Agent 首页与 Agent 面板里的三个标签。旧名称（首页、找选题、写内容、去发布、看效果……）作为别名保留，命令面板能搜到。 */
export const AGENT_NAV: NavItem[] = [
  { id: 'agent', label: 'Agent', icon: 'bot', desc: '首页：和 Agent 对话，一个 Agent 管理各大平台', keywords: '首页 home 今天 today 总览 overview 对话 超级工作台' },
  { id: 'agent?ask=hot', label: '看热点', icon: 'hot', desc: '让 Agent 汇总各平台合法来源的热点并出选题', keywords: '找选题 topics 灵感 inspire 热点 热榜 hot 选题' },
  { id: 'agent/drafts', label: '草稿', icon: 'create', desc: '草稿库：全部 / 待审 / 待发布 / 已发布', keywords: '写内容 write 写一篇 创作 create 草稿 审核 review 看板 board' },
  { id: 'agent/drafts?filter=approved', label: '待发布', icon: 'send', desc: '已通过的草稿：复制并打开发布页，由你本人发布', keywords: '去发布 publish 发布台 creator 发布 handoff' },
  { id: 'agent?ask=metrics', label: '数据复盘', icon: 'analytics', desc: '录入数据，看趋势与复盘建议', keywords: '看效果 results 复盘 analytics 数据 csv' },
  { id: 'agent/inbox', label: '素材箱', icon: 'inbox', desc: '你“发给 Agent”或分享进来的内容', keywords: '素材 inbox 分享 发给agent' },
];
/** 1.2.0：指挥台（独立空间，不进“我的”）。 */
export const COMMAND_NAV: NavItem = { id: 'command', label: '指挥', icon: 'team', desc: '我的团队、任务板、工作流、审批收件箱、目标、连接（平台 / 数据源 / 外部工具）', keywords: '指挥台 超级agent 子agent 团队 team 任务板 board 工作流 workflow 审批 inbox 目标 goal mcp a2a 外部工具 数据源 自定义平台 暂停' };
export const ME_NAV: NavItem = { id: 'me', label: '我的', icon: 'user', desc: '模型、平台与软件、Agent、花钱、记录、数据、设置', keywords: '设置 settings 偏好 prefs 工作台' };

/** “我的”分组列表（也是命令面板目的地）。1.1.0：22 项收敛为 12 项，每个概念一个设置入口（scripts/single-source-check.mjs 守护）。 */
export const ME_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: '工作', items: [
    { id: 'me/models', label: '模型', icon: 'cpu', desc: '主模型、能力覆盖、我的服务商；高级：按任务指定、省钱档、检索', keywords: '模型 models 密钥 key secrets 主模型 按任务 路由 routes 省钱 备用 用量 usage 自定义 mimo comfyui 深度思考' },
    { id: 'me/platforms', label: '平台与软件', icon: 'platforms', desc: '要发的平台、手机上的官方 App、数据源与热点来源', keywords: '平台 platforms 插件 plugins 本地应用 local-apps 添加软件 数据源 热点来源 tophub 今日热榜 新榜 千瓜 抖音开放平台 api key' },
    { id: 'me/profile', label: '账号画像', icon: 'user', desc: '定位、受众、风格、红线（与 Agent 的 USER 文件同源，带版本）', keywords: '画像 profile 定位 受众 风格 红线 user' },
  ] },
  { title: 'Agent', items: [
    { id: 'me/files', label: '设定与硬边界', icon: 'agent', desc: '硬边界（只读）、系统文件：查看、编辑（先看改动）、版本回滚、加载预览', keywords: 'agent 设定 系统文件 soul system vfs 版本 diff 加载预览 规则 硬边界 boundaries' },
    { id: 'me/memory', label: '记忆与技能', icon: 'history', desc: '长期记忆与技能（含各平台写法）：查看、编辑、版本、启用', keywords: '记忆 memory 忘掉 forget 偏好 技能 skills 技能目录 平台写法 写作助手 规则 改进' },
    { id: 'me/growth', label: '成长', icon: 'improve', desc: '修订建议、自动采纳记录、回滚、打法看板、收益', keywords: '成长 进化 evolution 提案 proposal 回滚 lessons 经验 收益 收入 revenue csv 归因 漏斗 变现' },
    { id: 'me/reminders', label: '提醒', icon: 'bell', desc: '本机提醒：只通知，不自动执行任何动作', keywords: '提醒 reminders 定时 通知' },
  ] },
  { title: '通用', items: [
    { id: 'me/spend', label: '花钱', icon: 'coin', desc: '月度预算、按能力日上限、异常提醒、本月花费、先问阈值', keywords: '花钱 阈值 预算 budget 花费 成本 cost 上限 异常' },
    { id: 'me/records', label: '记录', icon: 'tasks', desc: '最近任务、失败、审批、花费、设定改动；顶部是运行健康摘要', keywords: '日志 logs 任务 tasks 审计 audit 导出 记录 运行状态 status 健康 延迟 缓存 错误率' },
    { id: 'me/data', label: '数据', icon: 'backup', desc: '备份与恢复（永不含 Key）、存储配额与清理', keywords: '备份 backup 导出 导入 恢复 存储 storage 空间 配额 清理 媒体 版本 修剪 indexeddb' },
    { id: 'me/prefs', label: '通用设置', icon: 'sliders', desc: '主题、语言、保活数量、会话绑定、实验开关、重新开始引导', keywords: '偏好 prefs 通用 general 主题 语言 实验 flags 开关 引导 onboarding 新手' },
    { id: 'me/server', label: '连接自己的服务器', icon: 'server', desc: '可选：配音、配图、视频等重活', keywords: '服务器 server 服务端 地址 口令' },
  ] },
];

/** 1.1.0：旧入口名只作为命令面板别名（不在“我的”列表里显示），指向合并后的新位置。 */
export const ME_ALIASES: NavItem[] = [
  { id: 'me/platforms?tab=sources', label: '数据源', icon: 'key', desc: '已并入“平台与软件”', keywords: '数据源 热点来源 sources' },
  { id: 'me/memory?tab=skills', label: '技能', icon: 'wand', desc: '已并入“记忆与技能”', keywords: '技能 skills 写作助手与规则 写作助手 平台写法' },
  { id: 'me/growth?tab=revenue', label: '收益', icon: 'coin', desc: '已并入“成长”', keywords: '收益 收入 revenue' },
  { id: 'me/records?tab=status', label: '运行状态', icon: 'activity', desc: '已并入“记录”', keywords: '运行状态 status 健康' },
  { id: 'me/records?filter=recent', label: '审计日志', icon: 'tasks', desc: '已并入“记录”', keywords: '审计 audit' },
  { id: 'me/data?tab=storage', label: '存储', icon: 'backup', desc: '已并入“数据”', keywords: '存储 storage' },
  { id: 'onboarding', label: '重新开始引导', icon: 'retry', desc: '再走一遍三步引导（在“通用设置”底部）', keywords: '引导 onboarding 新手' },
];

/** 兼容旧代码：主线 = Agent 相关入口；侧栏底部固定 Agent / 我的。 */
export const MAIN_NAV: NavItem[] = AGENT_NAV;
export const SIDEBAR_ITEMS: NavItem[] = [AGENT_NAV[0]!, COMMAND_NAV, ME_NAV];
export const BOTTOM_ITEMS: NavItem[] = SIDEBAR_ITEMS;
/** 命令面板全部目的地（平台由 App 运行时追加）。 */
export const NAV: NavItem[] = [...AGENT_NAV, COMMAND_NAV, ME_NAV, ...ME_GROUPS.flatMap((g) => g.items), ...ME_ALIASES];
