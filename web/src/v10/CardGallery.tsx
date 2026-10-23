/**
 * 0.10.0 卡片预览（我的 → 运行状态 → 卡片预览，#me/status/cards）：用演示数据回放对话里的 0.9 新卡片，每类一张“正常”、一张“失败”，
 * 与对话里完全同一个组件（ToolCard → V9Body），用于逐张截图验收（shots-v10）与真机目测。不读写任何真实数据、不调用模型。
 */
import { useT } from '../i18n';
import { ToolCard, type CardActions } from '../agent/cards';
import type { CardData } from '../agent/store';
import { BackBar, Note } from '../pages/me/v9/common';

const SVG = (c: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${c}"/><circle cx="120" cy="110" r="50" fill="#fff" opacity=".7"/><text x="120" y="210" font-size="22" text-anchor="middle" fill="#fff">AI 生成</text></svg>`)}`;
function silentWav(): string {
  const n = 800, b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  let s = ''; for (const x of b) s += String.fromCharCode(x); return `data:audio/wav;base64,${btoa(s)}`;
}
const model = { model: 'qwen-image-3.0-pro', cost: 0.2 };

export interface GalleryItem { key: string; title: string; ok: CardData; fail: CardData }
export function galleryItems(): GalleryItem[] {
  const wav = silentWav();
  const err = (reason: string, advice: string) => ({ reason, advice });
  const mk = (key: string, title: string, type: string, tool: string, data: Record<string, unknown>, fail: { reason: string; advice: string } | { data: Record<string, unknown> }): GalleryItem => ({
    key, title,
    ok: { type, tool, status: 'done', ms: 2400, data },
    fail: 'data' in fail ? { type, tool, status: 'done', ms: 1800, data: fail.data } : { type, tool, status: 'error', ms: 1200, error: fail },
  });
  return [
    mk('image', '图片', 'image', 'image_generate', { media: [{ id: 'demo-1', dataUrl: SVG('#7c8cf8'), kind: 'image', prompt: '通勤效率封面' }, { id: 'demo-2', dataUrl: SVG('#e3a35b'), kind: 'image', prompt: '通勤效率封面 2' }], note: '已按小红书 3:4 出了 2 张', ...model }, { data: { status: 'failed', reason: '生图服务返回“内容不合规”', advice: '换个说法描述画面（避免人物肖像与品牌标识），或换一家生图模型' } }),
    mk('audio', '音频（配音）', 'audio', 'speech_synthesize', { media: [{ id: 'demo-a', dataUrl: wav, kind: 'audio', aiLabel: { explicit: false, implicit: true } }], model: 'cosyvoice-v3', cost: 0.01 }, { data: { status: 'failed', reason: '配音服务没有返回音频（空文件）', advice: '稍后重试；连续失败可在“我的 → 模型 → 配音”换一个音色或服务商' } }),
    mk('video', '视频', 'video', 'video_generate', { status: 'running', jobId: 'vid-20261023-001', model: 'wan2.5-t2v' }, { data: { status: 'failed', reason: '视频任务排队超时（30 分钟）', advice: '视频生成很贵，没有自动重试；需要的话说“重新生成视频”，会先问你确认花费' } }),
    mk('transcript', '转写', 'transcript', 'speech_transcribe', { text: '大家好，今天聊聊通勤路上的 3 个小习惯：第一，提前规划……', segments: [{}, {}, {}], model: 'paraformer-v2' }, err('上传音频没有发出去（网络中断）', '已自动换另一种打包方式重试过；请检查网络，或换一段短一点的音频再试')),
    mk('reason', '推理', 'reason', 'reason_deep', { conclusion: '优先写“通勤时间管理”：搜索量上升、你的账号近 30 天同类笔记互动率高 1.8 倍。', reasoning: '1. 对比三个候选选题的热度…\n2. 结合账号画像…', model: 'deepseek-reasoner' }, err('深度推理超时（240 秒）', '问题太大时可以拆成几步问；或在“我的 → 模型 → 深度推理”换更快的模型')),
    mk('not_configured', '未配置', 'not_configured', 'image_generate', { role: 'image', text: '还没接生图模型', deepLink: '#me/models/image' }, { data: { role: 'tts', text: '你用 @ 指定的配音模型没接好（Key 已失效）', deepLink: '#me/models/tts' } }),
    mk('memory', '记忆', 'memory', 'memory_propose', { text: '小红书标题不超过 18 个字', condition: '只在写小红书时' }, err('这条没有记下来：你还没点“记住”', '记忆只有你确认后才会写入；想记的话在卡片上点“记住”')),
    mk('reminder', '提醒', 'reminder', 'reminder_create', { when: '明天 09:00', text: '看昨天笔记的数据' }, err('没看懂时间“下下个周八”', '换个说法，比如“明天下午 3 点”或“每周一 10 点”')),
    mk('subtask', '子任务', 'subtask', 'text_delegate', { summary: '整理了 3 个平台的今日热点，合并后 12 条', artifacts: ['a', 'b'], cost: 0.004 }, err('子任务超过步数上限（6 步）停止了', '已把做完的部分带回来；可以说“继续整理剩下的平台”')),
    mk('checklist', '发布前检查清单', 'checklist', 'publish_check', { items: [{ ok: true, text: '标题 16 字（≤20）' }, { ok: true, text: '已标注 AI 生成' }, { ok: false, text: '正文引用了数据，请补出处' }], note: '发布由你本人在平台点击' }, err('检查没跑完：草稿已被删除', '在“草稿”里重新打开一篇再检查')),
    mk('proposal', '修订建议', 'proposal', 'system_file_propose', { target: 'skills/xiaohongshu.md' }, err('这份文件不接受修改建议（BOUNDARIES.md）', '硬边界写在代码里，任何建议都不能改它')),
    mk('revenue', '收益', 'revenue', 'revenue_summary', { text: '近 30 天收入 ¥1,280，比上月 +12%；带货占 64%（你录入的数据）。' }, err('还没有收益数据', '到“我的 → 收益”录入或导入 CSV 后再问')),
    mk('search', '检索', 'search', 'library_search', { mode: 'keyword', hits: [{ id: '1', title: '通勤 30 分钟能做的 5 件事' }, { id: '2', title: '早高峰地铁上的阅读清单' }] }, err('检索失败：向量模型返回 401', 'Key 可能失效；已退回关键词检索也没结果，请检查“我的 → 模型 → 向量”')),
  ];
}

export function CardGallery({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const actions: CardActions = { ask: () => undefined, userTool: async () => null, openDraft: () => undefined, retry: () => undefined };
  const items = galleryItems();
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="card-gallery">
      <BackBar label={t('卡片预览（演示数据）')} onBack={() => go('me/status')} />
      <Note>{t('对话里的卡片，每类一张正常、一张失败。全部是演示数据：不读你的内容、不调用模型、按钮不会执行动作。')}</Note>
      {items.map((it) => (
        <section key={it.key} className="flex flex-col gap-1" data-testid={`gallery-${it.key}`}>
          <h3 className="m-0 text-[14px] font-semibold text-fg-2">{t(it.title)}</h3>
          <div className="max-w-full" data-testid={`gallery-${it.key}-ok`} data-shot={`${it.key}-ok`}><div data-testid="msg-agent"><ToolCard card={it.ok} actions={actions} /></div></div>
          <div className="max-w-full" data-testid={`gallery-${it.key}-fail`} data-shot={`${it.key}-fail`}><div data-testid="msg-agent"><ToolCard card={it.fail} actions={actions} /></div></div>
        </section>
      ))}
    </div>
  );
}
