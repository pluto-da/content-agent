import { createContext, useContext } from 'react';

export type Lang = 'zh' | 'en';

const en: Record<string, string> = {
  今天: 'Today', 灵感: 'Ideas', 创作: 'Create', 新建: 'New', 返回: 'Back', 草稿: 'Drafts', 看板: 'Board', 发布台: 'Publish desk', 草稿与审核: 'Drafts & review',
  '从哪里开始？发布始终由你本人完成。': 'Where to start? You always publish yourself.', 从内容库选素材: 'Pick from library', 改写选题: 'Rewrite a topic', 导入数据复盘: 'Import data for review',
  '抓取公开热榜，挑热点一键转选题': 'Fetch public boards, turn a trend into a topic', 勾选已采集内容生成选题: 'Select items to generate topics', '选平台，一次生成多平台草稿': 'Pick platforms, draft them all at once', '上传平台后台导出的 CSV': 'Upload CSV exported from the platform',
  件事等你处理: 'things need you', 待审: 'Review', 待发布: 'To publish', 新热点: 'New trend', 转选题: 'To topic', 已转: 'Done', 已转为选题: 'Topic created', 查看: 'View',
  '已通过，等你本人发布': 'Approved, waiting for you to publish', 命中你的关注词: 'Matches your keywords', 个榜单: 'boards', 待办: 'To-do', 今天没有待办: 'Nothing to do today', 去找灵感: 'Find ideas',
  '处理中…': 'Working…', '发布由你本人在官方后台或 App 中点击完成；本应用不自动点赞、评论、私信或关注。': 'You publish yourself in the official app; this app never auto-likes, comments, DMs or follows.',
  发布由你本人在官方后台或App中点击完成: 'You publish yourself', 状态筛选: 'Filter by status', 从左侧选择一篇草稿进行编辑与审核: 'Pick a draft on the left to edit and review', 编辑: 'Edit', 平台预览: 'Preview', 编辑或预览: 'Edit or preview',
  更多操作: 'More actions', 退回待审: 'Back to pending', 发布交接: 'Hand-off', '修改会留痕；通过后可去发布': 'Edits are logged; publish after approval', 我的账号: 'My account', 预览: 'preview', 我: 'Me',
  无配图: 'No image', '（正文为空）': '(empty)', '（口播字幕预览）': '(subtitle preview)', 标题: 'Title', 正文: 'Body', '中文计 2': 'CJK counts 2', 仅示意以平台实际显示为准: 'Approximate', '仅示意，以平台实际显示为准': 'Approximate; the platform decides',
  生成中: 'Generating', 已发布: 'Published', 暂无: 'None', 等你审核: 'Waiting for review', 排队或运行中的任务: 'Queued or running', '已通过，等你本人发布 ': 'Approved', 已交接给你发布: 'Handed off to you',
  设置分组: 'Settings sections', 扩展: 'Extensions', 偏好: 'Preferences', 插件: 'Plugins', 通用: 'General', '硬边界写在代码中，设置不能放宽。': 'Hard boundaries are enforced in code.', 连接: 'Connection',
  '看中哪条，点“转选题”即生成选题卡': 'Click “To topic” to create a topic card', '待审、待发布、失败任务与新热点，一条待办流': 'Reviews, publishing, failures and trends in one feed', '热点、内容库与选题': 'Trends, library and topics',
  '草稿、审核、平台预览与发布交接': 'Drafts, review, preview and hand-off', '运行状态、系统文件、插件、任务与偏好': 'Status, agent files, plugins, tasks and preferences', '主题、语言、连接、代理与采集': 'Theme, language, connection, proxy',
  '平台与模型密钥（只显示末四位）': 'Platform and model keys (last 4 shown)', '按能力路由、备用、单价与成本': 'Routing, fallback, prices and cost', 导出与恢复业务数据: 'Export and restore data',
  '编辑、审核、平台预览': 'Edit, review, preview', '选题 → 生成中 → 待审 → 待发布 → 已发布': 'Topic → generating → review → to publish → published', '官方创作后台与本地应用，由你本人发布': 'Official creator hubs and local apps; you publish',
  '公开热榜采集、跨榜合并与聚类，一键转选题': 'Public boards, merged and clustered; one click to topic', 发布始终由你本人在官方后台或App中点击完成: 'You always publish yourself', '发布始终由你本人在官方后台或 App 中点击完成': 'You always publish yourself in the official app',
  总览: 'Overview', 热点: 'Trends', 内容库: 'Library', 选题: 'Topics', 审核: 'Review', 创作中心: 'Creator hubs', 复盘: 'Analytics',
  系统文件: 'Agent files', 改进与评测: 'Improve & eval', 插件管理: 'Plugins', 任务与日志: 'Tasks & logs', 设置: 'Settings',
  刷新: 'Refresh', 保存: 'Save', 取消: 'Cancel', 删除: 'Delete', 添加: 'Add', 运行: 'Run', 复制: 'Copy', 通过: 'Approve', 驳回: 'Reject',
  已配置: 'Configured', 未配置: 'Not configured', 模拟输出: 'Mock output', 离线: 'Offline', 加载中: 'Loading…', 暂无数据: 'No data',
  待审草稿: 'Drafts to review', 热点命中: 'Trend matches', 任务: 'Tasks', 模型能力: 'Model capabilities', 硬边界: 'Hard boundaries',
  采集热榜: 'Fetch boards', 强制刷新: 'Force refresh', 聚类: 'Cluster', 深度调研: 'Research', 生成选题: 'Generate topics', 改写: 'Rewrite',
  信息源: 'Sources', 搜索: 'Search', 语义检索: 'Semantic search', 去发布: 'Go publish', 推送公众号草稿箱: 'Push to WeChat drafts',
  发布由你本人完成: 'You press “Publish” yourself', 主题: 'Theme', 浅色: 'Light', 深色: 'Dark', 跟随系统: 'System', 语言: 'Language',
  服务地址: 'Server URL', 访问口令: 'Access token', 代理: 'Proxy', 密钥: 'Secrets', 模型: 'Models', 成本: 'Cost', 备份: 'Backup',
  导出: 'Export', 导入: 'Import', 回滚: 'Roll back', 历史版本: 'History', 记忆: 'Memory', 改进日志: 'Improvement log', 'A/B 评测': 'A/B eval',
  启用: 'Enable', 本终端: 'This device', 通知: 'Notifications', 开启通知: 'Enable notifications', 回复草稿: 'Reply draft', 跳过: 'Skip',
  打开: 'Open', '用 App 打开': 'Open app', 外部浏览器打开: 'Open in browser', 合规提示: 'Compliance', 素材: 'Assets', 流水线: 'Pipeline',
  本地应用: 'Local apps', 网页端: 'Web', 打开应用: 'Open app', 分享草稿到应用: 'Share draft to app', 导入已安装应用: 'Import installed apps', 选择应用: 'Choose app',
  '退出登录/清除登录': 'Log out / clear login', 已保存会话: 'Session saved', 未登录: 'Not logged in', 会话已被平台过期: 'Session expired by platform', 登录状态: 'Login status', 知乎: 'Zhihu',
  导入CSV: 'Import CSV', 生成复盘: 'Generate review', 状态: 'Status', 理由: 'Reason', 内容: 'Content', 测试: 'Test', 提供方: 'Provider',
  内容生产: 'Create', 发布与复盘: 'Publish & review', 系统: 'System', 快速跳转: 'Quick jump', '搜索页面…': 'Search pages…', 页面: 'Pages', 搜索或跳转: 'Search or jump to', 内容运营助手: 'Content Agent',
  全部功能: 'All features', 更多: 'More', 切换到浅色: 'Switch to light', 切换到深色: 'Switch to dark',
  今日运营概况与待办: 'Today at a glance', '公开热榜采集、跨榜合并与聚类': 'Public trend boards, merged and clustered', 信息源与已采集内容: 'Sources and collected items', 候选选题与多平台改写: 'Topic candidates and rewrites',
  人工审核草稿与发布交接: 'Review drafts and hand off', 官方创作后台与本地应用: 'Official creator hubs and local apps', '导入数据、生成复盘与回复草稿': 'Import data, reviews and reply drafts',
  'soul、规则、skills 与记忆': 'Soul, rules, skills and memory', 'Skills 状态、A/B 评测与改进日志': 'Skills, A/B evals and improvement log', 按终端启用平台模块与本地应用: 'Per-device modules and local apps', 任务队列与结构化日志: 'Task queue and structured logs', '主题、连接、密钥、模型与备份': 'Theme, connection, secrets, models, backup',
  较上周: 'vs last week', 夜深了: 'Good night', 早上好: 'Good morning', 下午好: 'Good afternoon', 晚上好: 'Good evening', 这是今天的内容运营概况: "here's today's content overview",
  热榜条目: 'Trend items', '近 30 天成本': 'Cost (30d)', 任务成功率: 'Task success', 失败任务: 'Failed tasks', '近 14 天草稿数': 'Drafts, last 14 days', 各榜单条目数: 'Items per board', '近 14 天成本': 'Cost, last 14 days', '近 14 天任务数': 'Tasks, last 14 days',
  流水线状态: 'Pipeline', 从选题到交接的内容流转: 'From topic to hand-off', 候选选题: 'Candidates', 待审核: 'Pending', 已通过: 'Approved', 已交接: 'Handed off', 已驳回: 'Rejected',
  审核队列: 'Review queue', 没有待审草稿: 'Nothing to review', 热点榜: 'Trending', '跨榜单合并 · 最新': 'Merged across boards · latest', 全部: 'All', 关注词命中: 'Keyword matches', 榜: 'boards', 先采集热榜: 'fetch boards first',
  今天要处理什么: 'What needs you today', '今日待审、热点与关键指标': 'Today: reviews, trends and key numbers', 去审核: 'Go review', 待改写: 'awaiting rewrite', 篇待审: 'to review', '热点前 5': 'Top 5 trends', 运行状态: 'Status', '成本、模型能力、流水线、最近任务与硬边界': 'Cost, models, pipeline, recent tasks and boundaries', 模型设置: 'Model settings', 失败: 'failed',
  各能力成本: 'Cost by capability', '近 30 天': 'Last 30 days', 次: ' calls', 暂无调用记录: 'No usage yet', 最近任务: 'Recent tasks', '写在代码中，不可放宽': 'Enforced in code',
};

export function translate(lang: Lang, key: string): string {
  return lang === 'en' ? (en[key] ?? key) : key;
}

export const LangContext = createContext<{ lang: Lang; t: (k: string) => string }>({ lang: 'zh', t: (k) => k });
export const useT = () => useContext(LangContext);
