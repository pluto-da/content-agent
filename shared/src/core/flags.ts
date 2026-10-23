/**
 * 特性开关（ADR-006）：实验功能默认关闭，在“我的 → 设置 → 实验功能”里由用户打开；不能用开关放宽硬边界与审批。
 * 每个开关声明：id、说明、默认值、阶段（stable / beta / experimental / reserved）、是否需要重启。
 * reserved 是为未来预留的能力（如服务端同步），本版本强制关闭，界面只显示“预留，暂未开放”。
 */
import { Registry } from './registry.js';

export type FlagStage = 'stable' | 'beta' | 'experimental' | 'reserved';
export interface FeatureFlag { id: string; label: string; description: string; default: boolean; stage: FlagStage; since: string; reviewBy?: string }

export const FLAGS = new Registry<FeatureFlag>('特性开关');
const def = (f: FeatureFlag) => FLAGS.register(f);
def({ id: 'agent.planner', label: '任务图规划', description: '多步任务先生成任务图再执行；关闭时用逐步模式（每轮只决定下一步）', default: true, stage: 'stable', since: '0.9.0' });
def({ id: 'agent.selfcheck.judge', label: '自检判官', description: '多步任务结束、含事实陈述或刚被纠正时，用快速模型做一次判官检查（会多一次调用）', default: false, stage: 'beta', since: '0.9.0' });
def({ id: 'agent.subtasks', label: '子任务', description: '把可独立完成的一块交给子运行（深度 1、预算独立）', default: true, stage: 'stable', since: '0.9.0' });
def({ id: 'models.healthRouting', label: '健康路由', description: '默认模型近期失败率高时先走备用（仅可重试类错误）', default: true, stage: 'stable', since: '0.9.0' });
def({ id: 'media.aiLabel', label: '图片 AI 角标', description: '生成图片默认加“AI 生成”显式标识（关闭时仍需在平台勾选声明）', default: true, stage: 'stable', since: '0.9.0' });
def({ id: 'media.audioCue', label: '配音开头提示音', description: '生成的 WAV 配音开头加 0.5 秒提示音，提醒听众这是 AI 合成（MP3 不重编码，不加）；默认关', default: false, stage: 'beta', since: '0.10.0' });
def({ id: 'search.vector', label: '向量检索', description: '配置了向量模型时，记忆与素材检索加入向量召回', default: false, stage: 'experimental', since: '0.9.0', reviewBy: '1.0' });
def({ id: 'evolution.batchLessonConfirm', label: '复盘后 lessons 一次确认', description: '复盘生成的多条经验可一次确认；技能与系统文件修改仍逐条确认', default: false, stage: 'beta', since: '0.9.0' });
def({ id: 'ui.motion', label: '界面动效', description: '只做反馈类动效；系统“减少动态效果”打开时自动关闭', default: true, stage: 'stable', since: '0.8.1' });
def({ id: 'sync.server', label: '服务端同步（预留）', description: '为未来连接自己的服务器同步 VFS 预留接口；本版本不开放，不做多账号', default: false, stage: 'reserved', since: '0.9.0', reviewBy: '1.1' });
def({ id: 'models.serverRelay', label: '经服务端调用模型（预留）', description: '网页版跨域受限时经自己的服务器转发；本版本不开放', default: false, stage: 'reserved', since: '0.9.0', reviewBy: '1.1' });
FLAGS.freeze();

export type FlagOverrides = Partial<Record<string, boolean>>;
/** 解析最终值：reserved 一律 false；未知 id 一律 false（不让拼错的开关意外生效）。 */
export function flagOn(id: string, overrides: FlagOverrides = {}): boolean {
  const f = FLAGS.get(id);
  if (!f || f.stage === 'reserved') return false;
  return overrides[id] ?? f.default;
}
export function resolveFlags(overrides: FlagOverrides = {}): Record<string, boolean> {
  return Object.fromEntries(FLAGS.list().map((f) => [f.id, flagOn(f.id, overrides)]));
}
/** 清理：去掉未知 / reserved 的覆盖值（导入旧备份时用）。 */
export function sanitizeFlagOverrides(o: FlagOverrides): FlagOverrides {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === 'boolean' && FLAGS.get(k) && FLAGS.get(k)!.stage !== 'reserved'));
}
