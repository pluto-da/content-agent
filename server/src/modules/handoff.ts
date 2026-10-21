import type { DB } from '../db.js';
import type { SecretVault } from '../crypto.js';
import type { HttpClient } from '../http.js';
import { wechatAccessToken } from '../sources/official.js';
import { getDraft, setDraftStatus, type Platform } from './content.js';
import type { AgentFiles } from './agentfiles.js';

/**
 * 官方创作中心地址（已核实）。仅允许这些域名在创作中心标签页中打开。
 * android / ios：官方 App 的包名与 URL Scheme（用于“本地应用”预设，用户可修改）。
 */
export const CREATOR_CENTERS = [
  { id: 'douyin', label: '抖音创作者中心', url: 'https://creator.douyin.com/', domains: ['douyin.com'], app: 'snssdk1128://', android: 'com.ss.android.ugc.aweme', ios: 'snssdk1128://' },
  { id: 'xiaohongshu', label: '小红书创作服务平台', url: 'https://creator.xiaohongshu.com/', domains: ['xiaohongshu.com'], app: 'xhsdiscover://', android: 'com.xingin.xhs', ios: 'xhsdiscover://' },
  { id: 'channels', label: '视频号助手', url: 'https://channels.weixin.qq.com/', domains: ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'], app: 'weixin://', android: 'com.tencent.mm', ios: 'weixin://' },
  { id: 'wechat_mp', label: '微信公众平台', url: 'https://mp.weixin.qq.com/', domains: ['mp.weixin.qq.com', 'weixin.qq.com', 'qq.com'], app: 'weixin://', android: 'com.tencent.mm', ios: 'weixin://' },
  { id: 'x', label: 'X', url: 'https://x.com/compose/post', domains: ['x.com', 'twitter.com'], app: 'twitter://', android: 'com.twitter.android', ios: 'twitter://' },
  { id: 'xianyu', label: '闲鱼', url: 'https://www.goofish.com/', domains: ['goofish.com', 'taobao.com'], app: 'fleamarket://', android: 'com.taobao.idlefish', ios: 'fleamarket://' },
  { id: 'zhihu', label: '知乎创作中心', url: 'https://www.zhihu.com/creator', domains: ['zhihu.com'], app: 'zhihu://', android: 'com.zhihu.android', ios: 'zhihu://' },
] as const;

export type CreatorCenter = (typeof CREATOR_CENTERS)[number];
export type CenterId = CreatorCenter['id'];
export const CENTER_IDS = CREATOR_CENTERS.map((c) => c.id) as CenterId[];
export function isCenterId(id: string): id is CenterId {
  return (CENTER_IDS as string[]).includes(id);
}

/** 知乎写作入口：专栏文章写作页；回答需要具体问题页（由用户粘贴链接）。 */
export const ZHIHU_ARTICLE_WRITE_URL = 'https://zhuanlan.zhihu.com/write';
export function zhihuQuestionUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^https:\/\/(?:www\.)?zhihu\.com\/question\/(\d{1,20})(?:\/|$|\?|#)/.exec(raw.trim());
  return m ? `https://www.zhihu.com/question/${m[1]}` : undefined;
}

export function isAllowedCreatorUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return CREATOR_CENTERS.some((c) => c.domains.some((d) => u.hostname === d || u.hostname.endsWith('.' + d)));
}

const PLATFORM_CENTER: Record<Platform, string> = {
  xiaohongshu: 'xiaohongshu', douyin_script: 'douyin', channels: 'channels', wechat_article: 'wechat_mp', xianyu: 'xianyu', x_post: 'x',
  zhihu_answer: 'zhihu', zhihu_article: 'zhihu',
};

/** 各平台发布前的合规提示（只是提醒，由用户自行判断）。 */
export const PLATFORM_TIPS: Partial<Record<Platform, string[]>> = {
  xianyu: ['闲鱼：只粘贴文案，不留站外联系方式'],
  zhihu_answer: ['知乎：开头先给结论，事实与数据注明来源', '知乎：如有利益相关请在文末声明', '知乎：不放导流信息、不求赞求关注，避免答非所问'],
  zhihu_article: ['知乎：标题不做标题党，引用资料列出处', '知乎：涉及医疗/法律/投资写明“仅供参考”', '知乎：如有利益相关请在文末声明'],
};

export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text.slice(0, 280))}`;
}

export interface HandoffCard {
  draftId: number;
  platform: Platform;
  copyText: string;
  center: CreatorCenter;
  /** 复制后跳转的官方写作页（知乎专栏写作页 / 用户提供的知乎问题页）；没有则用创作中心地址。 */
  jumpUrl: string;
  /** 知乎回答需要问题链接时为 true。 */
  needsQuestionUrl?: boolean;
  intentUrl?: string;
  canPushWechatDraft: boolean;
  checklist: string[];
  lastStep: string;
}

export function handoffCard(db: DB, vault: SecretVault, draftId: number, opts: { questionUrl?: string } = {}): HandoffCard {
  const d = getDraft(db, draftId);
  if (!d) throw new Error('草稿不存在');
  const platform = d.platform as Platform;
  const tags = (d.tags as string[]).map((t) => `#${t}`).join(' ');
  const copyText = [d.title, d.body, tags].filter(Boolean).join('\n\n');
  const center = CREATOR_CENTERS.find((c) => c.id === PLATFORM_CENTER[platform])!;
  const checklist = ['检查事实与来源', '确认合规提示已处理', '按平台要求标注 AI 辅助生成（如适用）'];
  if (platform === 'xiaohongshu') checklist.push('选择配图（可用生成的配图）');
  if (platform === 'douyin_script' || platform === 'channels') checklist.push('拍摄或上传视频，可使用生成的配音与字幕');
  checklist.push(...(PLATFORM_TIPS[platform] ?? []));
  const question = platform === 'zhihu_answer' ? zhihuQuestionUrl(opts.questionUrl) : undefined;
  const jumpUrl = platform === 'zhihu_article' ? ZHIHU_ARTICLE_WRITE_URL : (question ?? center.url);
  return {
    draftId, platform, copyText, center, jumpUrl,
    needsQuestionUrl: platform === 'zhihu_answer' && !question ? true : undefined,
    intentUrl: platform === 'x_post' ? xIntentUrl(`${d.body}${tags ? ' ' + tags : ''}`) : undefined,
    canPushWechatDraft: platform === 'wechat_article' && vault.has('wechat.appid') && vault.has('wechat.secret') && vault.has('wechat.thumb_media_id'),
    checklist,
    lastStep: '最后一步“发布”由你本人在官方 App 或创作中心中点击完成。',
  };
}

export function recordHandoff(db: DB, draftId: number, method: string, target: string, result: string, ok: boolean): void {
  db.prepare('INSERT INTO handoffs(draft_id, method, target, result, ok) VALUES(?,?,?,?,?)').run(draftId, method, target, result, ok ? 1 : 0);
}

/** 复制交接：记录并把草稿标为“已交接”。需要草稿已通过审核。 */
export function markCopied(db: DB, agent: AgentFiles, draftId: number): void {
  const d = getDraft(db, draftId);
  if (!d) throw new Error('草稿不存在');
  if (d.status !== 'approved') throw new Error('草稿需先通过审核');
  recordHandoff(db, draftId, 'copy', String(d.platform), '已复制，等待用户在官方 App 发布', true);
  setDraftStatus(db, draftId, 'handed_off');
  agent.daily(`草稿 #${draftId} 已复制交接（${String(d.platform)}），等待用户自行发布`);
}

/** 公众号：推送到草稿箱（POST /cgi-bin/draft/add），不发布。 */
export async function pushWechatDraft(db: DB, vault: SecretVault, http: HttpClient, agent: AgentFiles, draftId: number): Promise<{ media_id: string }> {
  const d = getDraft(db, draftId);
  if (!d) throw new Error('草稿不存在');
  if (d.platform !== 'wechat_article') throw new Error('只有公众号长文可以推送草稿箱');
  if (d.status !== 'approved') throw new Error('草稿需先通过审核');
  const missing = ['wechat.appid', 'wechat.secret', 'wechat.thumb_media_id'].filter((k) => !vault.has(k));
  if (missing.length) throw new Error(`未配置：缺少 ${missing.join('、')}`);
  const token = await wechatAccessToken(vault.get('wechat.appid')!, vault.get('wechat.secret')!, http);
  const html = String(d.body).split(/\n{2,}/).map((p) => `<p>${p.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!).replace(/\n/g, '<br/>')}</p>`).join('');
  const res = await http(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ articles: [{ article_type: 'news', title: String(d.title ?? '').slice(0, 32), content: html, thumb_media_id: vault.get('wechat.thumb_media_id') }] }),
  });
  const j = JSON.parse(res.text) as { media_id?: string; errcode?: number; errmsg?: string };
  if (!j.media_id) {
    recordHandoff(db, draftId, 'wechat_draft', 'wechat_mp', `${j.errcode} ${j.errmsg}`, false);
    throw new Error(`公众号草稿箱接口错误：${j.errcode ?? res.status} ${j.errmsg ?? ''}`);
  }
  recordHandoff(db, draftId, 'wechat_draft', 'wechat_mp', `media_id=${j.media_id}`, true);
  setDraftStatus(db, draftId, 'handed_off');
  agent.daily(`草稿 #${draftId} 已推送到公众号草稿箱，等待用户在后台发布`);
  return { media_id: j.media_id };
}
