/**
 * 能力角色注册表（5.1）：角色是模型配置的主键。新增角色（音乐、3D…）= 在 roles/ 注册一条定义 + 写适配器 + 加卡片，不改框架。
 */
import { Registry } from '../core/registry.js';

export type RoleId = 'chat' | 'reason' | 'fast' | 'vision' | 'image' | 'imageEdit' | 'tts' | 'asr' | 'video' | 'embed' | 'rerank';
export type RoleGroup = 'text' | 'seeDraw' | 'voice' | 'video' | 'retrieval';
export interface RoleDef {
  id: RoleId; label: string; short: string; group: RoleGroup; io: string;
  tool?: string;                 // 对应 Agent 工具名（无则内部使用）
  card: 'stream' | 'reason' | 'text' | 'image' | 'imageCompare' | 'audio' | 'transcript' | 'video' | 'none';
  fallbackRole?: RoleId;         // 只有 fast→chat、reason→chat（开思考）允许跨角色回退
  paid: 'cheap' | 'per-call' | 'expensive';
  order: number;
}
export const ROLES = new Registry<RoleDef & { id: string }>('能力角色');
const r = (d: RoleDef) => ROLES.register(d);
r({ id: 'chat', label: '文本对话', short: '文本', group: 'text', io: '消息 → 文本（流式、可带工具调用）', tool: 'text_delegate', card: 'stream', paid: 'cheap', order: 1 });
r({ id: 'reason', label: '深度推理', short: '推理', group: 'text', io: '问题 → 推理过程 + 结论', tool: 'reason_deep', card: 'reason', fallbackRole: 'chat', paid: 'cheap', order: 2 });
r({ id: 'fast', label: '快速小模型', short: '快速', group: 'text', io: '短任务 → 短文本（标题、关键词、摘要、意图）', card: 'none', fallbackRole: 'chat', paid: 'cheap', order: 3 });
r({ id: 'vision', label: '看图理解', short: '看图', group: 'seeDraw', io: '图片 + 问题 → 文本（含 OCR）', tool: 'image_understand', card: 'text', paid: 'cheap', order: 4 });
r({ id: 'image', label: '生图', short: '生图', group: 'seeDraw', io: '提示词 + 尺寸/张数 → 图片', tool: 'image_generate', card: 'image', paid: 'per-call', order: 5 });
r({ id: 'imageEdit', label: '改图', short: '改图', group: 'seeDraw', io: '原图 1–3 张 + 指令 → 图片', tool: 'image_edit', card: 'imageCompare', paid: 'per-call', order: 6 });
r({ id: 'tts', label: '配音', short: '配音', group: 'voice', io: '文本 + 音色/语速 → 音频', tool: 'speech_synthesize', card: 'audio', paid: 'per-call', order: 7 });
r({ id: 'asr', label: '转写', short: '转写', group: 'voice', io: '音频 → 文本（可带时间戳）', tool: 'speech_transcribe', card: 'transcript', paid: 'per-call', order: 8 });
r({ id: 'video', label: '视频生成', short: '视频', group: 'video', io: '提示词 [+首帧] + 时长/比例 → 视频（异步）', tool: 'video_generate', card: 'video', paid: 'expensive', order: 9 });
r({ id: 'embed', label: '向量', short: '向量', group: 'retrieval', io: '文本 → 向量', card: 'none', paid: 'cheap', order: 10 });
r({ id: 'rerank', label: '重排', short: '重排', group: 'retrieval', io: '查询 + 候选 → 排序与分数', card: 'none', paid: 'cheap', order: 11 });
ROLES.freeze();

export const ROLE_IDS = ROLES.list().sort((a, b) => a.order - b.order).map((x) => x.id as RoleId);
export const ROLE_GROUPS: { id: RoleGroup; label: string; roles: RoleId[] }[] = [
  { id: 'text', label: '文字', roles: ['chat', 'reason', 'fast'] },
  { id: 'seeDraw', label: '看与画', roles: ['vision', 'image', 'imageEdit'] },
  { id: 'voice', label: '声音', roles: ['tts', 'asr'] },
  { id: 'video', label: '视频', roles: ['video'] },
  { id: 'retrieval', label: '检索', roles: ['embed', 'rerank'] },
];
export const roleDef = (id: RoleId): RoleDef => ROLES.must(id) as RoleDef;
export const roleLabel = (id: RoleId): string => roleDef(id).label;
/** 0.8.0 及以前的能力键 → 0.9.0 角色。 */
export const LEGACY_ROLE_MAP: Record<string, RoleId> = { llm: 'chat', embedding: 'embed', ocr: 'vision', vision: 'vision', image: 'image', tts: 'tts', asr: 'asr', video: 'video' };
export function isRoleId(x: string): x is RoleId { return (ROLE_IDS as string[]).includes(x); }
