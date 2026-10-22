/** 导航定义（0.6.0）：主线 5 个动作 + 我的；命令面板与测试都从这里读取。 */
export type Layout = 'phone' | 'tablet' | 'desktop';
export function layoutOf(width: number): Layout {
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desktop';
}

export interface NavItem { id: string; label: string; icon: string; desc: string; keywords?: string }

/** 主线：每一项都是“我能在这里做什么”。 */
export const MAIN_NAV: NavItem[] = [
  { id: 'home', label: '首页', icon: 'home', desc: '下一步做什么，一句话开始', keywords: '今天 today 总览 overview' },
  { id: 'topics', label: '找选题', icon: 'hot', desc: '热点 + 手动输入一个想法', keywords: '灵感 inspire 热点 热榜 hot 内容库 library 选题 topics' },
  { id: 'write', label: '写内容', icon: 'create', desc: '生成、修改、审核', keywords: '创作 create 草稿 审核 review 看板 board' },
  { id: 'publish', label: '去发布', icon: 'send', desc: '复制文案并打开平台 App，由你本人发布', keywords: '发布台 creator 发布 handoff' },
  { id: 'results', label: '看效果', icon: 'analytics', desc: '录入数据，看趋势与复盘建议', keywords: '复盘 analytics 数据 csv' },
];
export const ME_NAV: NavItem = { id: 'me', label: '我的', icon: 'user', desc: '模型、平台与软件、规则、设置', keywords: '设置 settings 偏好 prefs 工作台' };

/** “我的”分组列表（也是命令面板目的地）。 */
export const ME_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: '工作', items: [
    { id: 'me/models', label: '模型', icon: 'cpu', desc: '连接模型服务、测试连接、默认写作模型', keywords: '模型 models 密钥 key secrets 路由 routes 用量 usage 自定义 mimo' },
    { id: 'me/platforms', label: '平台与软件', icon: 'platforms', desc: '要发的平台、手机上的官方 App', keywords: '平台 platforms 插件 plugins 本地应用 local-apps 添加软件' },
    { id: 'me/agent', label: '写作助手与规则', icon: 'agent', desc: '每个平台的写作指令与模型', keywords: 'agent 规则 skills soul 系统文件 改进 improve' },
  ] },
  { title: '通用', items: [
    { id: 'me/prefs', label: '通用设置', icon: 'sliders', desc: '主题、语言、热点来源', keywords: '偏好 prefs 通用 general 主题 语言' },
    { id: 'me/backup', label: '备份与恢复', icon: 'backup', desc: '导出 / 导入本机数据', keywords: '备份 backup 导出 导入' },
    { id: 'me/logs', label: '日志', icon: 'tasks', desc: '最近做了什么、哪里失败', keywords: '日志 logs 任务 tasks' },
    { id: 'me/server', label: '连接自己的服务器', icon: 'server', desc: '可选：配音、配图、视频等重活', keywords: '服务器 server 服务端 地址 口令' },
    { id: 'onboarding', label: '重新开始引导', icon: 'retry', desc: '再走一遍三步引导', keywords: '引导 onboarding 新手' },
  ] },
];

/** 侧栏：主线 5 项 + 我的。 */
export const SIDEBAR_ITEMS: NavItem[] = [...MAIN_NAV, ME_NAV];
/** 手机底部 5 格（看效果从首页卡片、去发布页与命令面板进入）。 */
export const BOTTOM_ITEMS: NavItem[] = [MAIN_NAV[0]!, MAIN_NAV[1]!, MAIN_NAV[2]!, MAIN_NAV[3]!, ME_NAV];
/** 命令面板全部目的地。 */
export const NAV: NavItem[] = [...SIDEBAR_ITEMS, ...ME_GROUPS.flatMap((g) => g.items)];
