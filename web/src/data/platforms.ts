/**
 * 平台与官方 App 静态数据（0.6.0：打包进前端，不再依赖接口 → “添加软件”第一步永远有平台可选）。
 * 包名 / URL Scheme 已核实；0.7.0 增加 B站、快手两个发布平台（server/src/modules/handoff.ts 的 CREATOR_CENTERS 未加这两个，服务端模式下它们只出现在“添加软件 / 内置网页”）。
 */
import type { KnownApp } from '../native';

/**
 * url：官方网页版首页（创作者后台）；publishUrl：官方网页版发布页（0.7.0 内置网页“在软件内打开 X 发布”用）；
 * hosts：内置网页“退出该平台登录 / 清除数据”时要清的站点（只在原生层删除，App 不读取任何 Cookie 值）。
 * 网址于 2026-10-22 用 web_search 核实（见 design/deviations-v7.md）。
 */
export interface Center { id: string; label: string; app: string; url: string; publishUrl: string; hosts: string[]; android: string; ios: string; webNote?: string }

export const CENTERS: Center[] = [
  { id: 'xiaohongshu', label: '小红书', app: '小红书', url: 'https://creator.xiaohongshu.com/', publishUrl: 'https://creator.xiaohongshu.com/publish/publish', hosts: ['xiaohongshu.com', 'creator.xiaohongshu.com', 'www.xiaohongshu.com'], android: 'com.xingin.xhs', ios: 'xhsdiscover://' },
  { id: 'douyin', label: '抖音', app: '抖音', url: 'https://creator.douyin.com/', publishUrl: 'https://creator.douyin.com/creator-micro/content/upload', hosts: ['douyin.com', 'creator.douyin.com', 'www.douyin.com'], android: 'com.ss.android.ugc.aweme', ios: 'snssdk1128://' },
  { id: 'channels', label: '视频号', app: '微信', url: 'https://channels.weixin.qq.com/', publishUrl: 'https://channels.weixin.qq.com/platform/post/create', hosts: ['channels.weixin.qq.com', 'weixin.qq.com'], android: 'com.tencent.mm', ios: 'weixin://', webNote: '视频号助手需用微信扫码登录' },
  { id: 'wechat_mp', label: '公众号', app: '微信', url: 'https://mp.weixin.qq.com/', publishUrl: 'https://mp.weixin.qq.com/', hosts: ['mp.weixin.qq.com', 'weixin.qq.com'], android: 'com.tencent.mm', ios: 'weixin://', webNote: '登录后点“新的创作”' },
  { id: 'zhihu', label: '知乎', app: '知乎', url: 'https://www.zhihu.com/creator', publishUrl: 'https://zhuanlan.zhihu.com/write', hosts: ['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com'], android: 'com.zhihu.android', ios: 'zhihu://' },
  { id: 'bilibili', label: 'B站', app: '哔哩哔哩', url: 'https://member.bilibili.com/platform/home', publishUrl: 'https://member.bilibili.com/platform/upload/video/frame', hosts: ['bilibili.com', 'member.bilibili.com', 'www.bilibili.com', 'passport.bilibili.com'], android: 'tv.danmaku.bili', ios: 'bilibili://' },
  { id: 'kuaishou', label: '快手', app: '快手', url: 'https://cp.kuaishou.com/', publishUrl: 'https://cp.kuaishou.com/article/publish/video', hosts: ['kuaishou.com', 'cp.kuaishou.com', 'www.kuaishou.com', 'passport.kuaishou.com'], android: 'com.smile.gifmaker', ios: 'kwai://' },
  { id: 'xianyu', label: '闲鱼', app: '闲鱼', url: 'https://www.goofish.com/', publishUrl: 'https://www.goofish.com/', hosts: ['goofish.com', 'www.goofish.com'], android: 'com.taobao.idlefish', ios: 'fleamarket://' },
  { id: 'x', label: 'X', app: 'X', url: 'https://x.com/home', publishUrl: 'https://x.com/compose/post', hosts: ['x.com', 'twitter.com'], android: 'com.twitter.android', ios: 'twitter://' },
];

/** 添加软件用的预设（与 0.5.0 的 /api/local-apps known 字段同形）。 */
export const KNOWN_APPS: KnownApp[] = CENTERS.map((c) => ({ platform: c.id, label: c.label, android: c.android, ios: c.ios }));

/** 写作平台（生成的内容格式）→ 发布平台。 */
export interface WritePlatform { id: string; label: string; short: string; center: string; skill: string; publishUrl?: string }
export const WRITE_PLATFORMS: WritePlatform[] = [
  { id: 'xiaohongshu', label: '小红书笔记', short: '小红书', center: 'xiaohongshu', skill: 'xiaohongshu-note' },
  { id: 'douyin_script', label: '抖音口播脚本', short: '抖音', center: 'douyin', skill: 'douyin-script' },
  { id: 'channels', label: '视频号脚本', short: '视频号', center: 'channels', skill: 'channels-video' },
  { id: 'wechat_article', label: '公众号长文', short: '公众号', center: 'wechat_mp', skill: 'wechat-article' },
  { id: 'zhihu_answer', label: '知乎回答', short: '知乎回答', center: 'zhihu', skill: 'zhihu-answer', publishUrl: 'https://www.zhihu.com/creator' },
  { id: 'zhihu_article', label: '知乎专栏文章', short: '知乎文章', center: 'zhihu', skill: 'zhihu-article' },
  { id: 'xianyu', label: '闲鱼文案', short: '闲鱼', center: 'xianyu', skill: 'xianyu-listing' },
  { id: 'x_post', label: 'X 帖子', short: 'X', center: 'x', skill: 'x-post' },
];

export const writePlatform = (id: string) => WRITE_PLATFORMS.find((p) => p.id === id) ?? WRITE_PLATFORMS[0]!;
export const center = (id: string) => CENTERS.find((c) => c.id === id);
export const centerOfWrite = (id: string) => center(writePlatform(id).center)!;
/** 某种内容在官方网页版上的发布地址（知乎回答需要具体问题，先进创作中心）。 */
export const publishUrlOfWrite = (id: string) => writePlatform(id).publishUrl ?? centerOfWrite(id).publishUrl;

/** 从一句话里认出平台（“写一篇抖音口播…”）。 */
export function detectPlatform(text: string): string | null {
  const rules: [RegExp, string][] = [
    [/小红书|笔记/, 'xiaohongshu'], [/抖音|口播/, 'douyin_script'], [/视频号/, 'channels'], [/公众号|长文/, 'wechat_article'],
    [/知乎.*(文章|专栏)/, 'zhihu_article'], [/知乎/, 'zhihu_answer'], [/闲鱼/, 'xianyu'], [/\bX\b|推特|twitter/i, 'x_post'],
  ];
  for (const [re, id] of rules) if (re.test(text)) return id;
  return null;
}
