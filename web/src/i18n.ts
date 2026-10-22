import { createContext, useContext } from 'react';

export type Lang = 'zh' | 'en';

const en: Record<string, string> = {
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
