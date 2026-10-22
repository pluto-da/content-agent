/** 导航定义（0.5.0）：侧栏只有 WORK_NAV（4）+ DESK_NAV（4）共 8 项，无二级菜单；命令面板与测试都从这里读取。 */
export type Layout = 'phone' | 'tablet' | 'desktop';
export function layoutOf(width: number): Layout {
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desktop';
}

export interface NavItem { id: string; label: string; icon: string; group: string; desc: string; keywords?: string }

export const WORK_NAV: NavItem[] = [
  { id: 'today', label: '今天', icon: 'today', group: '工作流', desc: '待审、待发布、失败任务与新热点，一条待办流', keywords: '总览 overview 首页 待办' },
  { id: 'inspire', label: '灵感', icon: 'inspire', group: '工作流', desc: '热点、内容库与选题', keywords: '热榜 素材' },
  { id: 'create', label: '创作', icon: 'create', group: '工作流', desc: '草稿与审核、看板、发布台', keywords: '审核 review 发布' },
  { id: 'analytics', label: '复盘', icon: 'analytics', group: '工作流', desc: '导入数据、复盘报告与回复草稿', keywords: 'csv 数据 回复' },
];

export const DESK_NAV: NavItem[] = [
  { id: 'platforms', label: '平台', icon: 'platforms', group: '工作台', desc: '各平台登录状态、本地软件与模块开关', keywords: '设置 插件 plugins 本地应用 软件 账号 登录 local-apps' },
  { id: 'models', label: '模型', icon: 'cpu', group: '工作台', desc: '路由、密钥与用量', keywords: '设置 密钥 key secrets 运行状态 status 成本 用量 mimo' },
  { id: 'agent', label: 'Agent', icon: 'agent', group: '工作台', desc: '系统文件与改进评测', keywords: '设置 系统文件 soul 规则 skills 记忆 评测 improve' },
  { id: 'prefs', label: '偏好', icon: 'sliders', group: '工作台', desc: '通用、备份与日志', keywords: '设置 settings 通用 主题 语言 代理 备份 任务 日志 tasks' },
];

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: '工作流', items: WORK_NAV },
  { title: '工作台', items: DESK_NAV },
];
export const SIDEBAR_ITEMS: NavItem[] = [...WORK_NAV, ...DESK_NAV];

/** 页面内标签（命令面板可直接跳到标签）。 */
export const TAB_NAV: NavItem[] = [
  { id: 'inspire/hot', label: '热点', icon: 'hot', group: '灵感', desc: '公开热榜采集、跨榜合并与聚类，一键转选题' },
  { id: 'inspire/library', label: '内容库', icon: 'library', group: '灵感', desc: '信息源与已采集内容' },
  { id: 'inspire/topics', label: '选题', icon: 'topics', group: '灵感', desc: '候选选题与多平台改写' },
  { id: 'create/drafts', label: '草稿与审核', icon: 'review', group: '创作', desc: '编辑、审核、平台预览' },
  { id: 'create/board', label: '看板', icon: 'kanban', group: '创作', desc: '选题 → 生成中 → 待审 → 待发布 → 已发布' },
  { id: 'create/publish', label: '发布台', icon: 'creator', group: '创作', desc: '打开官方后台或本地软件，由你本人发布' },
  { id: 'models/routes', label: '路由', icon: 'cpu', group: '模型', desc: '每种能力用哪个服务商和模型', keywords: '模型设置 备用 思考 单价' },
  { id: 'models/keys', label: '密钥', icon: 'key', group: '模型', desc: '平台与模型密钥（只显示末四位）', keywords: 'secrets api key' },
  { id: 'models/usage', label: '用量', icon: 'activity', group: '模型', desc: '花费、效率与运行状态', keywords: '运行状态 status 成本 硬边界' },
  { id: 'agent/files', label: '文件', icon: 'agent', group: 'Agent', desc: 'soul、规则、skills 与记忆', keywords: '系统文件' },
  { id: 'agent/improve', label: '改进', icon: 'improve', group: 'Agent', desc: 'Skills、A/B 评测与改进日志', keywords: '改进与评测' },
  { id: 'prefs/general', label: '通用', icon: 'sliders', group: '偏好', desc: '主题、语言、连接、代理与采集' },
  { id: 'prefs/backup', label: '备份', icon: 'backup', group: '偏好', desc: '导出与恢复业务数据' },
  { id: 'prefs/logs', label: '日志', icon: 'tasks', group: '偏好', desc: '任务队列与运行日志', keywords: '任务与日志 tasks' },
];

/** 全部可跳转的目的地（命令面板）：8 个页面 + 各页标签。 */
export const NAV: NavItem[] = [...SIDEBAR_ITEMS, ...TAB_NAV];

/** 右下“＋”抽屉中的新建动作（原 NEW_ACTIONS 弹层并入此处；第一项“添加软件”由抽屉单独渲染）。 */
export const NEW_ACTIONS = [
  { to: 'inspire/hot', icon: 'hot', label: '采集热榜', hint: '抓取公开热榜，挑热点一键转选题' },
  { to: 'inspire/library', icon: 'library', label: '从内容库选素材', hint: '勾选已采集内容生成选题' },
  { to: 'inspire/topics', icon: 'topics', label: '改写选题', hint: '选平台，一次生成多平台草稿' },
  { to: 'analytics', icon: 'upload', label: '导入数据复盘', hint: '上传平台后台导出的 CSV' },
];
