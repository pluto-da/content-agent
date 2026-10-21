import { containsForbidden } from '../boundaries.js';

export type Device = 'phone' | 'tablet' | 'desktop' | 'web';
export type PluginCapability = 'source' | 'rewrite' | 'handoff' | 'creator_center' | 'hot_board';

export interface PluginManifest {
  id: string;
  label: string;
  provides: PluginCapability[];
  sources?: string[];
  platforms?: string[];
  creatorCenter?: string;
  hotBoards?: string[];
  secrets?: string[];
  devices: Device[];
  description: string;
}

const ALLOWED: PluginCapability[] = ['source', 'rewrite', 'handoff', 'creator_center', 'hot_board'];

export const PLUGINS: PluginManifest[] = [
  { id: 'douyin', label: '抖音', provides: ['source', 'rewrite', 'handoff', 'creator_center', 'hot_board'], sources: ['douyin_open'], platforms: ['douyin_script'], creatorCenter: 'douyin', hotBoards: ['douyin'], secrets: ['douyin.access_token', 'douyin.open_id'], devices: ['phone', 'tablet', 'desktop', 'web'], description: '口播脚本改写、开放平台视频数据、创作者中心、热榜' },
  { id: 'xiaohongshu', label: '小红书', provides: ['rewrite', 'handoff', 'creator_center'], platforms: ['xiaohongshu'], creatorCenter: 'xiaohongshu', devices: ['phone', 'tablet', 'desktop', 'web'], description: '图文笔记改写与自动配图、创作服务平台' },
  { id: 'channels', label: '视频号', provides: ['rewrite', 'handoff', 'creator_center'], platforms: ['channels'], creatorCenter: 'channels', devices: ['phone', 'tablet', 'desktop', 'web'], description: '短视频文案、配音字幕、视频号助手' },
  { id: 'wechat_mp', label: '公众号', provides: ['source', 'rewrite', 'handoff', 'creator_center'], sources: ['wechat_mp'], platforms: ['wechat_article'], creatorCenter: 'wechat_mp', secrets: ['wechat.appid', 'wechat.secret'], devices: ['phone', 'tablet', 'desktop', 'web'], description: '长文改写、推送草稿箱、公众平台' },
  { id: 'xianyu', label: '闲鱼', provides: ['rewrite', 'handoff', 'creator_center'], platforms: ['xianyu'], creatorCenter: 'xianyu', devices: ['phone', 'tablet', 'desktop', 'web'], description: '只生成商品文案与话术，用户手动粘贴' },
  { id: 'x', label: 'X', provides: ['source', 'rewrite', 'handoff', 'creator_center', 'hot_board'], sources: ['x_api'], platforms: ['x_post'], creatorCenter: 'x', hotBoards: ['x_trends'], secrets: ['x.bearer'], devices: ['phone', 'tablet', 'desktop', 'web'], description: '帖子改写、官方发帖意图链接、趋势 API' },
  { id: 'zhihu', label: '知乎', provides: ['rewrite', 'handoff', 'creator_center'], platforms: ['zhihu_answer', 'zhihu_article'], creatorCenter: 'zhihu', devices: ['phone', 'tablet', 'desktop', 'web'], description: '回答与专栏文章改写（先给结论、引用来源）、复制并跳转写作页、知乎创作中心' },
  { id: 'rss_web', label: 'RSS 与公开网页', provides: ['source'], sources: ['rss', 'web'], devices: ['phone', 'tablet', 'desktop', 'web'], description: '订阅源与公开网页采集（遵守 robots 并限速）' },
  { id: 'hot_cn', label: '国内公开热榜', provides: ['hot_board'], hotBoards: ['baidu', 'weibo', 'zhihu', 'bilibili'], devices: ['phone', 'tablet', 'desktop', 'web'], description: '百度、微博、知乎、B 站公开热榜（robots 禁止的如实标注）' },
  { id: 'google_trends', label: 'Google Trends', provides: ['hot_board'], hotBoards: ['google_trends'], devices: ['phone', 'tablet', 'desktop', 'web'], description: '官方每日趋势 RSS（通常需代理）' },
];

/** 校验插件清单：只允许白名单能力，不允许出现禁止能力关键字。 */
export function validateManifest(m: PluginManifest): string[] {
  const errs: string[] = [];
  if (!m.id || !/^[a-z0-9_]+$/.test(m.id)) errs.push('id 非法');
  for (const p of m.provides) if (!ALLOWED.includes(p)) errs.push(`不允许的能力：${p}`);
  const bad = containsForbidden(JSON.stringify(m));
  if (bad.length) errs.push(`包含被禁止的能力：${bad.join('、')}`);
  return errs;
}

export type EnabledMap = Partial<Record<Device, string[]>>;

export function enabledFor(map: EnabledMap, device: Device): string[] {
  return map[device] ?? PLUGINS.filter((p) => p.devices.includes(device)).map((p) => p.id);
}

export function enabledPlatforms(map: EnabledMap, device: Device): string[] {
  const ids = enabledFor(map, device);
  return PLUGINS.filter((p) => ids.includes(p.id)).flatMap((p) => p.platforms ?? []);
}

export function enabledHotBoards(map: EnabledMap, device: Device): string[] {
  const ids = enabledFor(map, device);
  return PLUGINS.filter((p) => ids.includes(p.id)).flatMap((p) => p.hotBoards ?? []);
}
