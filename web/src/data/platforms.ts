/**
 * 平台与官方 App 静态数据（0.6.0：打包进前端，不再依赖接口 → “添加软件”第一步永远有平台可选）。
 * 与 server/src/modules/handoff.ts 的 CREATOR_CENTERS 一致（包名 / URL Scheme 已核实）。
 */
import type { KnownApp } from '../native';

export interface Center { id: string; label: string; app: string; url: string; android: string; ios: string }

export const CENTERS: Center[] = [
  { id: 'xiaohongshu', label: '小红书', app: '小红书', url: 'https://creator.xiaohongshu.com/', android: 'com.xingin.xhs', ios: 'xhsdiscover://' },
  { id: 'douyin', label: '抖音', app: '抖音', url: 'https://creator.douyin.com/', android: 'com.ss.android.ugc.aweme', ios: 'snssdk1128://' },
  { id: 'channels', label: '视频号', app: '微信', url: 'https://channels.weixin.qq.com/', android: 'com.tencent.mm', ios: 'weixin://' },
  { id: 'wechat_mp', label: '公众号', app: '微信', url: 'https://mp.weixin.qq.com/', android: 'com.tencent.mm', ios: 'weixin://' },
  { id: 'zhihu', label: '知乎', app: '知乎', url: 'https://www.zhihu.com/creator', android: 'com.zhihu.android', ios: 'zhihu://' },
  { id: 'xianyu', label: '闲鱼', app: '闲鱼', url: 'https://www.goofish.com/', android: 'com.taobao.idlefish', ios: 'fleamarket://' },
  { id: 'x', label: 'X', app: 'X', url: 'https://x.com/compose/post', android: 'com.twitter.android', ios: 'twitter://' },
];

/** 添加软件用的预设（与 0.5.0 的 /api/local-apps known 字段同形）。 */
export const KNOWN_APPS: KnownApp[] = CENTERS.map((c) => ({ platform: c.id, label: c.label, android: c.android, ios: c.ios }));

/** 写作平台（生成的内容格式）→ 发布平台。 */
export interface WritePlatform { id: string; label: string; short: string; center: string; skill: string }
export const WRITE_PLATFORMS: WritePlatform[] = [
  { id: 'xiaohongshu', label: '小红书笔记', short: '小红书', center: 'xiaohongshu', skill: 'xiaohongshu-note' },
  { id: 'douyin_script', label: '抖音口播脚本', short: '抖音', center: 'douyin', skill: 'douyin-script' },
  { id: 'channels', label: '视频号脚本', short: '视频号', center: 'channels', skill: 'channels-video' },
  { id: 'wechat_article', label: '公众号长文', short: '公众号', center: 'wechat_mp', skill: 'wechat-article' },
  { id: 'zhihu_answer', label: '知乎回答', short: '知乎回答', center: 'zhihu', skill: 'zhihu-answer' },
  { id: 'zhihu_article', label: '知乎专栏文章', short: '知乎文章', center: 'zhihu', skill: 'zhihu-article' },
  { id: 'xianyu', label: '闲鱼文案', short: '闲鱼', center: 'xianyu', skill: 'xianyu-listing' },
  { id: 'x_post', label: 'X 帖子', short: 'X', center: 'x', skill: 'x-post' },
];

export const writePlatform = (id: string) => WRITE_PLATFORMS.find((p) => p.id === id) ?? WRITE_PLATFORMS[0]!;
export const center = (id: string) => CENTERS.find((c) => c.id === id);
export const centerOfWrite = (id: string) => center(writePlatform(id).center)!;

/** 从一句话里认出平台（“写一篇抖音口播…”）。 */
export function detectPlatform(text: string): string | null {
  const rules: [RegExp, string][] = [
    [/小红书|笔记/, 'xiaohongshu'], [/抖音|口播/, 'douyin_script'], [/视频号/, 'channels'], [/公众号|长文/, 'wechat_article'],
    [/知乎.*(文章|专栏)/, 'zhihu_article'], [/知乎/, 'zhihu_answer'], [/闲鱼/, 'xianyu'], [/\bX\b|推特|twitter/i, 'x_post'],
  ];
  for (const [re, id] of rules) if (re.test(text)) return id;
  return null;
}
