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
};

export function translate(lang: Lang, key: string): string {
  return lang === 'en' ? (en[key] ?? key) : key;
}

export const LangContext = createContext<{ lang: Lang; t: (k: string) => string }>({ lang: 'zh', t: (k) => k });
export const useT = () => useContext(LangContext);
