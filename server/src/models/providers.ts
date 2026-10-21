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
    imageEditModel: 'mock-image-edit', ttsVoice: 'mock-voice',
  },
  {
    id: 'dashscope', label: '通义·阿里云百炼（千问/万相/CosyVoice/Paraformer）', protocol: 'dashscope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', nativeBaseURL: 'https://dashscope.aliyuncs.com/api/v1',
    secretName: 'model.dashscope.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision', 'ocr', 'embedding', 'image', 'video', 'asr', 'tts'],
    models: { llm: 'qwen-plus', vision: 'qwen-vl-plus', ocr: 'qwen-vl-ocr', embedding: 'text-embedding-v4', image: 'wan2.6-t2i', video: 'wan2.6-t2v', asr: 'paraformer-v2', tts: 'cosyvoice-v3-flash' },
    imageEditModel: 'qwen-image-2.0-pro', ttsVoice: 'longanyang',
  },
  {
    id: 'deepseek', label: 'DeepSeek', protocol: 'openai', baseURL: 'https://api.deepseek.com', secretName: 'model.deepseek.key', useProxy: false, region: 'cn',
    capabilities: ['llm'], models: { llm: 'deepseek-v4-pro' },
  },
  {
    id: 'zhipu', label: '智谱（GLM/CogView/CogVideoX）', protocol: 'zhipu', baseURL: 'https://open.bigmodel.cn/api/paas/v4', secretName: 'model.zhipu.key', useProxy: false, region: 'cn',
    capabilities: ['llm', 'vision', 'ocr', 'image', 'video', 'embedding', 'tts', 'asr'],
    models: { llm: 'glm-4-flash', vision: 'glm-4v-flash', ocr: 'glm-4v-flash', image: 'cogview-3-flash', video: 'cogvideox-flash', embedding: 'embedding-3', tts: 'cogtts', asr: 'glm-asr' },
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
    capabilities: ['llm', 'vision'], models: { llm: 'kimi-latest', vision: 'kimi-latest' },
  },
  {
    id: 'openai', label: 'OpenAI（经代理）', protocol: 'openai', baseURL: 'https://api.openai.com/v1', secretName: 'model.openai.key', useProxy: true, region: 'global',
    capabilities: ['llm', 'vision', 'ocr', 'image', 'tts', 'asr', 'embedding'],
    models: { llm: 'gpt-4.1-mini', vision: 'gpt-4.1-mini', ocr: 'gpt-4.1-mini', image: 'gpt-image-1', tts: 'gpt-4o-mini-tts', asr: 'whisper-1', embedding: 'text-embedding-3-small' },
    imageEditModel: 'gpt-image-1', ttsVoice: 'alloy',
  },
  {
    id: 'anthropic', label: 'Anthropic Claude（经代理）', protocol: 'anthropic', baseURL: 'https://api.anthropic.com/v1', secretName: 'model.anthropic.key', useProxy: true, region: 'global',
    capabilities: ['llm', 'vision', 'ocr'], models: {},
  },
  {
    id: 'gemini', label: 'Google Gemini（OpenAI 兼容，经代理）', protocol: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', secretName: 'model.gemini.key', useProxy: true, region: 'global',
    capabilities: ['llm', 'vision', 'ocr', 'embedding'], models: { embedding: 'text-embedding-004' },
  },
  {
    id: 'elevenlabs', label: 'ElevenLabs（语音，经代理）', protocol: 'elevenlabs', baseURL: 'https://api.elevenlabs.io/v1', secretName: 'model.elevenlabs.key', useProxy: true, region: 'global',
    capabilities: ['tts'], models: { tts: 'eleven_multilingual_v2' },
  },
  {
    id: 'ollama', label: 'Ollama（本地）', protocol: 'openai', baseURL: 'http://localhost:11434/v1', secretName: '', useProxy: false, local: true, region: 'local',
    capabilities: ['llm', 'vision', 'ocr', 'embedding'], models: {},
  },
  {
    id: 'comfyui', label: 'ComfyUI（本地工作流）', protocol: 'comfyui', baseURL: 'http://127.0.0.1:8188', secretName: '', useProxy: false, local: true, region: 'local',
    capabilities: ['image'], models: { image: 'workflow' },
  },
];
