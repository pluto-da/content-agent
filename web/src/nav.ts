/** 导航定义：4 个主空间 + 设置中心；命令面板与测试都从这里读取。 */
export type Layout = 'phone' | 'tablet' | 'desktop';
export function layoutOf(width: number): Layout {
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desktop';
}

export interface NavItem { id: string; label: string; icon: string; group: string; desc: string }

export const SPACE_NAV: NavItem[] = [
  { id: 'today', label: '今天', icon: 'today', group: 'space', desc: '待审、待发布、失败任务与新热点，一条待办流' },
  { id: 'inspire', label: '灵感', icon: 'inspire', group: 'space', desc: '热点、内容库与选题' },
  { id: 'create', label: '创作', icon: 'create', group: 'space', desc: '草稿、审核、平台预览与发布交接' },
  { id: 'analytics', label: '复盘', icon: 'analytics', group: 'space', desc: '导入数据、生成复盘与回复草稿' },
];

export const SETTINGS_NAV: (NavItem & { section: string })[] = [
  { id: 'settings/status', section: 'status', label: '运行状态', icon: 'activity', group: '运行', desc: '成本、模型能力、流水线、最近任务与硬边界' },
  { id: 'settings/tasks', section: 'tasks', label: '任务与日志', icon: 'tasks', group: '运行', desc: '任务队列与结构化日志' },
  { id: 'settings/agent', section: 'agent', label: '系统文件', icon: 'agent', group: 'Agent', desc: 'soul、规则、skills 与记忆' },
  { id: 'settings/improve', section: 'improve', label: '改进与评测', icon: 'improve', group: 'Agent', desc: 'Skills 状态、A/B 评测与改进日志' },
  { id: 'settings/plugins', section: 'plugins', label: '插件', icon: 'plugins', group: '扩展', desc: '按终端启用平台模块与本地应用' },
  { id: 'settings/general', section: 'general', label: '通用', icon: 'sliders', group: '偏好', desc: '主题、语言、连接、代理与采集' },
  { id: 'settings/secrets', section: 'secrets', label: '密钥', icon: 'key', group: '偏好', desc: '平台与模型密钥（只显示末四位）' },
  { id: 'settings/models', section: 'models', label: '模型', icon: 'cpu', group: '偏好', desc: '按能力路由、备用、单价与成本' },
  { id: 'settings/backup', section: 'backup', label: '备份', icon: 'backup', group: '偏好', desc: '导出与恢复业务数据' },
];
export const SETTINGS_GROUPS = ['运行', 'Agent', '扩展', '偏好'];

/** 全部可跳转的目的地（命令面板）。 */
export const NAV: NavItem[] = [
  SPACE_NAV[0]!,
  { id: 'inspire/hot', label: '热点', icon: 'hot', group: '灵感', desc: '公开热榜采集、跨榜合并与聚类，一键转选题' },
  { id: 'inspire/library', label: '内容库', icon: 'library', group: '灵感', desc: '信息源与已采集内容' },
  { id: 'inspire/topics', label: '选题', icon: 'topics', group: '灵感', desc: '候选选题与多平台改写' },
  { id: 'create/drafts', label: '草稿与审核', icon: 'review', group: '创作', desc: '编辑、审核、平台预览' },
  { id: 'create/board', label: '看板', icon: 'kanban', group: '创作', desc: '选题 → 生成中 → 待审 → 待发布 → 已发布' },
  { id: 'create/publish', label: '发布台', icon: 'creator', group: '创作', desc: '官方创作后台与本地应用，由你本人发布' },
  SPACE_NAV[3]!,
  ...SETTINGS_NAV,
];

export const NEW_ACTIONS = [
  { to: 'inspire/hot', icon: 'hot', label: '采集热榜', hint: '抓取公开热榜，挑热点一键转选题' },
  { to: 'inspire/library', icon: 'library', label: '从内容库选素材', hint: '勾选已采集内容生成选题' },
  { to: 'inspire/topics', icon: 'topics', label: '改写选题', hint: '选平台，一次生成多平台草稿' },
  { to: 'analytics', icon: 'upload', label: '导入数据复盘', hint: '上传平台后台导出的 CSV' },
];
