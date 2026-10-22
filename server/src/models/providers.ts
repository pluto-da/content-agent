import type { ProviderDef } from './types.js';

/**
 * 内置提供方目录。接口地址已于 2026-10-22 通过官方文档核实，详见 docs/models.md。
 * 用户可在设置中修改 baseURL 与模型名。
 */
export const BUILTIN_PROVIDERS: ProviderDef[] = [
  {
    id: 'mock', label: 'Mock（模拟输出，仅测试）', protocol: 'mock', baseURL: 'mock://local', secretName: '', useProxy: false, region: 'test',
    capabilities: ['llm', 'vision', 'image', 'tts', 'asr', 'video', 'embedding', 'ocr'],
    models: { llm: 'mock-llm', vision: 'mock-vision', image: 'mock-image', tts: 'mock-tts', asr: 'mock-asr', video: 'mock-video', embedding: 'mock-embed', ocr: 'mock-vision' },
    imageEditModel: 'mock-image-edit', ttsVoice: 'mock-voice', jsonMode: 'json_schema', supportsSeed: true,
  },
  {
    id: 'dashscope', label: '通义·阿里云百炼（千问/万相/CosyVoice/Paraformer）', protocol: 'dashscope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', nativeBaseURL: 'https://dashscope.aliyuncs.com/api/v1',
    secretName: 'model.dashscope.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision', 'ocr', 'embedding', 'image', 'video', 'asr', 'tts'],
    models: { llm: 'qwen-plus', vision: 'qwen-vl-plus', ocr: 'qwen-vl-ocr', embedding: 'text-embedding-v4', image: 'wan2.6-t2i', video: 'wan2.6-t2v', asr: 'paraformer-v2', tts: 'cosyvoice-v3-flash' },
    imageEditModel: 'qwen-image-2.0-pro', ttsVoice: 'longanyang', jsonMode: 'json_object', supportsSeed: true,
  },
  {
    id: 'deepseek', label: 'DeepSeek', protocol: 'openai', baseURL: 'https://api.deepseek.com', secretName: 'model.deepseek.key', useProxy: false, region: 'cn',
    capabilities: ['llm'], models: { llm: 'deepseek-v4-pro' }, jsonMode: 'json_object',
  },
  {
    // 小米 MiMo（2026-10-22 核实 mimo.mi.com）：OpenAI 兼容；max_completion_tokens（默认且上限 131072）；
    // thinking {type} 默认 enabled，思考时 temperature/top_p 被强制为 1.0/0.95；response_format 仅 text / json_object；
    // finish_reason 可能为 repetition_truncation。按量 Key 前缀 sk-；Token Plan Key（tp-/ttp-）需把 baseURL 切到 token-plan-cn。
    id: 'mimo', label: '小米 MiMo', protocol: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', secretName: 'model.mimo.key', envSecret: 'MIMO_API_KEY', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision'], models: { llm: 'mimo-v2.6-flash', vision: 'mimo-v2.6-flash' },
    modelOptions: ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'],
    baseURLPresets: [
      { label: '按量付费（sk- Key）', url: 'https://api.xiaomimimo.com/v1' },
      { label: 'Token Plan（tp- / ttp- Key）', url: 'https://token-plan-cn.xiaomimimo.com/v1' },
    ],
    // 元 / 百万 token（国内价）：缓存命中 / 未命中 / 输出
    defaultPrices: {
      'mimo-v2.6-flash': { cachedInput: 0.02, input: 1, output: 2 },
      'mimo-v2.6-pro': { cachedInput: 0.025, input: 3, output: 6 },
      'mimo-v2.6-pro-ultraspeed': { cachedInput: 0.25, input: 30, output: 60 },
    },
    jsonMode: 'json_object', maxOutputTokens: 131072,
    chatDialect: { maxTokensParam: 'max_completion_tokens', thinkingParam: 'type', thinkingIgnoresSampling: true, temperatureRange: [0, 1.5], retryFinishReasons: ['repetition_truncation'] },
  },
  {
    id: 'zhipu', label: '智谱（GLM/CogView/CogVideoX）', protocol: 'zhipu', baseURL: 'https://open.bigmodel.cn/api/paas/v4', secretName: 'model.zhipu.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision', 'ocr', 'image', 'video', 'embedding', 'tts', 'asr'],
    models: { llm: 'glm-4-flash', vision: 'glm-4v-flash', ocr: 'glm-4v-flash', image: 'cogview-3-flash', video: 'cogvideox-flash', embedding: 'embedding-3', tts: 'cogtts', asr: 'glm-asr' }, jsonMode: 'json_object',
  },
  {
    id: 'ark', label: '豆包·火山方舟（model 填接入点 ID）', protocol: 'openai', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', secretName: 'model.ark.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision', 'ocr', 'image', 'embedding'], models: {},
  },
  {
    id: 'minimax', label: 'MiniMax（语音/海螺视频）', protocol: 'minimax', baseURL: 'https://api.minimaxi.com/v1', nativeBaseURL: 'https://api.minimaxi.com', secretName: 'model.minimax.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'tts', 'video'], models: { llm: 'MiniMax-M1', tts: 'speech-2.8-hd', video: 'MiniMax-Hailuo-2.3' },
  },
  {
    id: 'kimi', label: 'Kimi（月之暗面）', protocol: 'openai', baseURL: 'https://api.moonshot.cn/v1', secretName: 'model.kimi.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision'], models: { llm: 'kimi-latest', vision: 'kimi-latest' }, jsonMode: 'json_object',
  },
  {
    id: 'openai', label: 'OpenAI（经代理）', protocol: 'openai', baseURL: 'https://api.openai.com/v1', secretName: 'model.openai.key', useProxy: true, region: 'global',
    capabilities: ['llm', 'vision', 'ocr', 'image', 'tts', 'asr', 'embedding'],
    models: { llm: 'gpt-4.1-mini', vision: 'gpt-4.1-mini', ocr: 'gpt-4.1-mini', image: 'gpt-image-1', tts: 'gpt-4o-mini-tts', asr: 'whisper-1', embedding: 'text-embedding-3-small' },
    imageEditModel: 'gpt-image-1', ttsVoice: 'alloy', jsonMode: 'json_schema', supportsSeed: true, contextWindow: 1_000_000, maxOutputTokens: 32768,
  },
  {
    id: 'anthropic', label: 'Anthropic Claude（经代理）', protocol: 'anthropic', baseURL: 'https://api.anthropic.com/v1', secretName: 'model.anthropic.key', useProxy: true, region: 'global',
    capabilities: ['llm', 'vision', 'ocr'], models: {}, maxOutputTokens: 8192, contextWindow: 200_000,
  },
  {
    id: 'gemini', label: 'Google Gemini（OpenAI 兼容，经代理）', protocol: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', secretName: 'model.gemini.key', useProxy: true, region: 'global',
    capabilities: ['llm', 'vision', 'ocr', 'embedding'], models: { embedding: 'text-embedding-004' }, jsonMode: 'json_schema', supportsSeed: true,
  },
  {
    id: 'elevenlabs', label: 'ElevenLabs（语音，经代理）', protocol: 'elevenlabs', baseURL: 'https://api.elevenlabs.io/v1', secretName: 'model.elevenlabs.key', useProxy: true, region: 'global',
    capabilities: ['tts'], models: { tts: 'eleven_multilingual_v2' },
  },
  {
    id: 'ollama', label: 'Ollama（本地）', protocol: 'openai', baseURL: 'http://localhost:11434/v1', secretName: '', useProxy: false, local: true, region: 'local',
    capabilities: ['llm', 'vision', 'ocr', 'embedding'], models: {}, jsonMode: 'json_object', supportsSeed: true,
  },
  {
    id: 'comfyui', label: 'ComfyUI（本地工作流）', protocol: 'comfyui', baseURL: 'http://127.0.0.1:8188', secretName: '', useProxy: false, local: true, region: 'local',
    capabilities: ['image'], models: { image: 'workflow' },
  },
];
