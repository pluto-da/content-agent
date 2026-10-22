import type { ChatMessage, ProviderAdapter } from './types.js';
import { estimateSegments } from './util.js';

const M = (model: string) => ({ provider: 'mock', model, ms: 0, mock: true });

/** 一张 1x1 透明 PNG，作为模拟配图。 */
export const MOCK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function mockChat(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]?.content ?? '';
  const task = /\[TASK:([a-z_]+)\]/.exec(last)?.[1] ?? 'generic';
  const list = [...last.matchAll(/^- \[(\d+)\] (.+)$/gm)].map((m) => ({ id: Number(m[1]), title: m[2] ?? '' }));
  switch (task) {
    case 'topics':
      return JSON.stringify({
        topics: list.slice(0, 3).map((t, i) => ({
          title: `【模拟】${t.title.slice(0, 24)}：普通人该关注什么`,
          angle: '从受众切身相关的角度解读，给出可执行建议',
          platforms: ['xiaohongshu', 'wechat_article', 'douyin_script'],
          score: Math.round((0.8 - i * 0.1) * 100) / 100,
          reason: '时效性强，与账号定位相关（模拟理由）',
          risk: '注意引用原始来源，避免夸大',
          item_ids: [t.id],
        })),
      });
    case 'rewrite': {
      const platform = /\[PLATFORM:([a-z_]+)\]/.exec(last)?.[1] ?? 'generic';
      const topic = /选题标题：(.+)/.exec(last)?.[1]?.trim() ?? '未命名选题';
      return JSON.stringify({
        title: (topic.startsWith("【模拟】") ? topic : `【模拟】${topic}`).slice(0, 30),
        body: `【模拟输出·${platform}】\n围绕「${topic}」写成的示例正文。\n开头：交代背景与来源。\n接着：给出三点看法。\n结尾：提出一个开放问题，邀请读者思考。`,
        tags: ['模拟', platform],
        image_prompts: ['简洁明亮的信息图风格封面', '生活场景插画', '要点清单卡片'],
        voiceover: `大家好。今天聊聊${topic}。第一，先看发生了什么。第二，它和你有什么关系。最后，说说我的建议。`,
      });
    }
    case 'hot_cluster':
      return JSON.stringify({ clusters: list.slice(0, 5).map((h) => ({ name: h.title.slice(0, 16), ids: [h.id] })) });
    case 'hot_research': {
      const name = /话题簇：(.+)/.exec(last)?.[1]?.trim() ?? '未命名话题';
      return JSON.stringify({
        title: `【模拟】${name}：值得关注的三个角度`,
        background: '【模拟】依据热榜标题，该话题近期关注度上升；具体事实需核实。',
        audience: '对该领域感兴趣的普通用户（模拟）',
        angles: [
          { angle: '科普解读：发生了什么、为什么重要', platforms: ['wechat_article', 'xiaohongshu'] },
          { angle: '个人视角：对普通人的影响', platforms: ['douyin_script', 'channels'] },
          { angle: '一句话观点', platforms: ['x_post'] },
        ],
        risks: ['事实未核实', '避免引用未经证实的数据'],
        action: '先核实来源，再选择一个角度写作',
      });
    }
    case 'repair': {
      // 修复重试：取上一轮输出，按错误信息里的上限截断（演示“Schema 校验 + 一次带错误信息的修复”）
      const prev = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '{}';
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(/\{[\s\S]*\}/.exec(prev)?.[0] ?? '{}') as Record<string, unknown>; } catch { obj = {}; }
      for (const m of last.matchAll(/\$\.(\w+)(?: 第 \d+ 段)? (加权)?长度 \d+ 超过上限 (\d+)/g)) {
        const k = m[1]!; const lim = Number(m[3]);
        if (typeof obj[k] === 'string') obj[k] = [...(obj[k] as string)].slice(0, m[2] ? Math.floor(lim / 2) : lim).join('');
      }
      for (const m of last.matchAll(/缺少必填字段 (\w+)/g)) if (obj[m[1]!] === undefined) obj[m[1]!] = m[1] === 'tags' ? [] : '【模拟补全】';
      return JSON.stringify(obj);
    }
    case 'partial_rewrite': {
      const sel = /<<<选中>>>\n([\s\S]*?)\n<<<\/选中>>>/.exec(last)?.[1] ?? '';
      return JSON.stringify({ text: `【模拟局部改写】${sel.replace(/^【模拟局部改写】/, '')}` });
    }
    case 'verify_title': {
      const title = /标题：(.+)/.exec(last)?.[1]?.trim() ?? '';
      const hits = [...last.matchAll(/^- 命中「(.+?)」/gm)].map((m) => m[1]!);
      return JSON.stringify({ title: [...title].slice(0, 20).join(''), replacements: hits.map((h) => ({ from: h, to: '较好' })) });
    }
    case 'review_metrics':
      return '【模拟复盘】样本量较小，以下仅为观察，不构成结论：互动率最高的稿件标题更具体。建议标记为“待验证”。';
    case 'reply_draft':
      return '【模拟回复草稿】谢谢你的留言！这个问题我下一篇会展开讲。';
    default:
      return '【模拟输出】';
  }
}

function hashVec(text: string, dim = 32): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const ch of text) v[ch.codePointAt(0)! % dim]! += 1;
  return v;
}

/** 模拟服务商的前缀缓存：同一 system 前缀第二次出现即视为命中（用于演示缓存命中率）。 */
const seenPrefixes = new Set<string>();
export function resetMockCache(): void { seenPrefixes.clear(); }

export function mockAdapter(): ProviderAdapter {
  return {
    async chat(messages, model) {
      const content = mockChat(messages);
      const input = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 2);
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const cachedInput = sys && seenPrefixes.has(sys) ? Math.ceil(sys.length / 2) : 0;
      if (sys) seenPrefixes.add(sys);
      return { ...M(model), content, usage: { unit: 'token', input, output: Math.ceil(content.length / 2), cachedInput } };
    },
    async vision(images, prompt, model) {
      const content = /OCR|文字/.test(prompt) ? '【模拟 OCR】图片中的文字：示例文本' : `【模拟视觉理解】共 ${images.length} 张图片：画面主体清晰，适合作为封面。`;
      return { ...M(model), content, usage: { unit: 'token', input: 100 * images.length, output: content.length } };
    },
    async image(_prompt, model, opts) {
      const n = opts?.n ?? 1;
      return { ...M(model), images: Array.from({ length: n }, () => ({ b64: MOCK_PNG_B64 })), usage: { unit: 'image', input: 0, output: n } };
    },
    async imageEdit(images, _instruction, model, opts) {
      if (!images.length) throw new Error('图像编辑需要至少一张输入图');
      const n = opts?.n ?? 1;
      return { ...M(model), images: Array.from({ length: n }, () => ({ b64: MOCK_PNG_B64 })), usage: { unit: 'image', input: images.length, output: n } };
    },
    async tts(text, model) {
      // 返回一个最小的“模拟音频”字节串（不是真实 mp3，界面会标注模拟）
      return { ...M(model), audio: Buffer.from(`MOCK-AUDIO:${text.slice(0, 50)}`), mime: 'audio/mpeg', usage: { unit: 'char', input: text.length, output: 0 } };
    },
    async asr(audio, model) {
      const raw = audio.data?.toString('utf8') ?? '';
      const text = raw.startsWith('MOCK-AUDIO:') ? raw.slice('MOCK-AUDIO:'.length) : '【模拟转写】这是一段示例转写文本。';
      return { ...M(model), text, segments: estimateSegments(text), usage: { unit: 'second', input: Math.ceil(text.length / 4.5), output: 0 } };
    },
    async video(_prompt, model) {
      return { ...M(model), taskId: 'mock-task-1', status: 'pending', usage: { unit: 'call', input: 1, output: 0 } };
    },
    async videoStatus(taskId, model) {
      return { ...M(model), taskId, status: 'succeeded', url: 'mock://video.mp4', message: '模拟视频', usage: { unit: 'call', input: 0, output: 0 } };
    },
    async embed(texts, model) {
      return { ...M(model), vectors: texts.map((t) => hashVec(t)), usage: { unit: 'token', input: texts.join('').length, output: 0 } };
    },
    async rerank(query, docs, model) {
      const q = new Set(query);
      const scores = docs.map((d, index) => ({ index, score: [...d].filter((c) => q.has(c)).length / Math.max(1, d.length) })).sort((a, b) => b.score - a.score);
      return { ...M(model), scores, usage: { unit: 'call', input: 1, output: 0 } };
    },
  };
}
