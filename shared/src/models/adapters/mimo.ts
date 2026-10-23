/** 小米 MiMo（refs-v9）：文本 / 推理 OpenAI 兼容（已实跑）；TTS 同一 /chat/completions，合成文本放 assistant 消息、风格放 user 消息，返回 choices[0].message.audio.data（Base64）；ASR 同端点 input_audio。 */
import { callError } from '../errors.js';
import { buildChat, makeOpenAICompatible, parseChat } from './openai-compatible.js';
import { bearer, json, ParseError, trimURL } from './types.js';

export default makeOpenAICompatible({
  id: 'mimo', label: '小米 MiMo', defaultBaseURL: 'https://api.xiaomimimo.com/v1', region: 'cn', docs: 'https://mimo.mi.com/docs/zh-CN/api',
  baseURLPresets: [{ label: '按量付费（sk- Key）', url: 'https://api.xiaomimimo.com/v1' }, { label: 'Token Plan（tp- Key）', url: 'https://token-plan-cn.xiaomimimo.com/v1' }],
  roles: ['chat', 'reason', 'fast', 'vision', 'tts', 'asr'],
  declare: (role, model) => role === 'tts' ? { verified: 'doc', voices: [{ id: 'mimo_default', label: '默认' }, { id: '冰糖', label: '冰糖' }, { id: '茉莉', label: '茉莉' }, { id: '苏打', label: '苏打' }, { id: '白桦', label: '白桦' }], audioFormats: ['wav', 'mp3', 'pcm'] }
    : role === 'asr' ? { verified: 'doc', audioInput: true }
    : role === 'vision' ? { verified: 'doc', imageInput: true }
    : { verified: /flash|pro/.test(model) ? 'live' : 'doc', stream: true, tools: 'native', thinking: 'toggle', jsonMode: 'json_object', contextWindow: 128000 },
  build(req, ctx) {
    const d = { maxTokensParam: 'max_completion_tokens' as const, thinking: 'type' as const, tempMax: 1.5 };
    if (req.role === 'tts') {
      const messages = [...(req.style ? [{ role: 'user', content: req.style }] : []), { role: 'assistant', content: req.text }];
      return { method: 'POST', url: `${trimURL(ctx.baseURL)}/chat/completions`, headers: { 'content-type': 'application/json', ...bearer(ctx.apiKey) }, body: JSON.stringify({ model: ctx.target.model, messages, audio: { format: req.format ?? 'wav', voice: req.voice ?? 'mimo_default' } }), responseType: 'json' };
    }
    if (req.role === 'asr') {
      return { method: 'POST', url: `${trimURL(ctx.baseURL)}/chat/completions`, headers: { 'content-type': 'application/json', ...bearer(ctx.apiKey) }, body: JSON.stringify({ model: ctx.target.model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${req.audio.mime};base64,${req.audio.base64}`, format: req.audio.format } }] }], asr_options: { language: req.language ?? 'auto' } }), responseType: 'json' };
    }
    if (req.role === 'chat' || req.role === 'reason' || req.role === 'fast' || req.role === 'vision') return buildChat(req, ctx, d);
    throw new ParseError(`小米 MiMo 不支持 ${req.role}`);
  },
  parse(req, res) {
    if (req.role === 'tts') {
      const j = json(res);
      const data = j.choices?.[0]?.message?.audio?.data;
      if (!data) throw new ParseError('返回里没有 audio.data');
      return { value: { type: 'media', items: [{ base64: data, mime: `audio/${req.format === 'mp3' ? 'mpeg' : req.format ?? 'wav'}` }] }, usage: { chars: [...req.text].length, input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens }, respondedModel: j.model };
    }
    if (req.role === 'asr') { const p = parseChat(res); return { ...p, value: { type: 'transcript', text: p.value.type === 'text' ? p.value.text : '' } }; }
    const p = parseChat(res);
    const fr = p.value.type === 'text' ? p.value.finishReason : undefined;
    return fr === 'repetition_truncation' ? { ...p, warnings: ['模型检测到重复输出被截断'] } : p;
  },
  classify(status, body, ctx) {
    if (/Model Not Exist|model_not_found|not support model/i.test(body)) return callError('model_not_found', { vendor: '小米 MiMo', model: ctx.target.model, status, detail: body });
    return null;
  },
}, { maxTokensParam: 'max_completion_tokens', thinking: 'type', tempMax: 1.5 });
