/**
 * 写作助手 = 每个平台一份 skill（与服务端 agent/skills/*.md 同一份文件，构建时打包进前端）。
 * 借鉴 Cherry Studio“智能体各带指令与默认模型”、NextChat“模板一键套用”：用户可改指令、单独指定模型（存本机）。
 */
import { parseSkillText } from '@content-agent/shared';
import soul from '../../../agent/soul.md?raw';
import workingMethod from '../../../agent/working-method.md?raw';
import userMd from '../../../agent/USER.md?raw';
import xhs from '../../../agent/skills/xiaohongshu-note.md?raw';
import douyin from '../../../agent/skills/douyin-script.md?raw';
import channels from '../../../agent/skills/channels-video.md?raw';
import wechat from '../../../agent/skills/wechat-article.md?raw';
import zhAnswer from '../../../agent/skills/zhihu-answer.md?raw';
import zhArticle from '../../../agent/skills/zhihu-article.md?raw';
import xianyu from '../../../agent/skills/xianyu-listing.md?raw';
import xpost from '../../../agent/skills/x-post.md?raw';

export const AGENT_FILES = { soul, workingMethod, user: userMd };

const RAW: Record<string, string> = {
  xiaohongshu: xhs, douyin_script: douyin, channels, wechat_article: wechat, zhihu_answer: zhAnswer, zhihu_article: zhArticle, xianyu, x_post: xpost,
};

export interface Assistant { platform: string; name: string; description: string; body: string; schema?: Record<string, unknown> }

export const ASSISTANTS: Assistant[] = Object.entries(RAW).map(([platform, src]) => ({ platform, ...parseSkillText(src) }));
export const assistantOf = (platform: string) => ASSISTANTS.find((a) => a.platform === platform);
