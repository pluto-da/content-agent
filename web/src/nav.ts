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
export const ME_NAV: NavItem = { id: 'me', label: '我的', icon: 'user', desc: '模型、平台与软件、数据源、规则、设置', keywords: '设置 settings 偏好 prefs 工作台' };

/** “我的”分组列表（也是命令面板目的地）。 */
export const ME_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: '工作', items: [
    { id: 'me/models', label: '模型', icon: 'cpu', desc: '连接模型服务、测试连接、默认写作模型', keywords: '模型 models 密钥 key secrets 路由 routes 用量 usage 自定义 mimo' },
    { id: 'me/platforms', label: '平台与软件', icon: 'platforms', desc: '要发的平台、手机上的官方 App、内置浏览器', keywords: '平台 platforms 插件 plugins 本地应用 local-apps 添加软件' },
    { id: 'me/sources', label: '数据源', icon: 'key', desc: '第三方数据服务与平台官方接口（你自己的 Key，本机加密）', keywords: '数据源 热点来源 tophub 今日热榜 新榜 千瓜 抖音开放平台 api key' },
    { id: 'me/profile', label: '账号画像', icon: 'user', desc: '定位、受众、风格、偏好红线（Agent 记忆）', keywords: '画像 profile 定位 受众 风格 红线' },
    { id: 'me/agent', label: '写作助手与规则', icon: 'agent', desc: '每个平台的写作指令与模型', keywords: 'agent 规则 skills soul 系统文件 改进 improve' },
  ] },
  { title: '通用', items: [
    { id: 'me/prefs', label: '通用设置', icon: 'sliders', desc: '主题、语言、公开热点来源、保活数量、会话绑定', keywords: '偏好 prefs 通用 general 主题 语言' },
    { id: 'me/backup', label: '备份与恢复', icon: 'backup', desc: '导出 / 导入本机数据', keywords: '备份 backup 导出 导入' },
    { id: 'me/logs', label: '日志', icon: 'tasks', desc: '最近做了什么、哪里失败', keywords: '日志 logs 任务 tasks' },
    { id: 'me/server', label: '连接自己的服务器', icon: 'server', desc: '可选：配音、配图、视频等重活', keywords: '服务器 server 服务端 地址 口令' },
    { id: 'onboarding', label: '重新开始引导', icon: 'retry', desc: '再走一遍三步引导', keywords: '引导 onboarding 新手' },
  ] },
];

/** 兼容旧代码：主线 = Agent 相关入口；侧栏底部固定 Agent / 我的。 */
export const MAIN_NAV: NavItem[] = AGENT_NAV;
export const SIDEBAR_ITEMS: NavItem[] = [AGENT_NAV[0]!, ME_NAV];
export const BOTTOM_ITEMS: NavItem[] = SIDEBAR_ITEMS;
/** 命令面板全部目的地（平台由 App 运行时追加）。 */
export const NAV: NavItem[] = [...AGENT_NAV, ME_NAV, ...ME_GROUPS.flatMap((g) => g.items)];
