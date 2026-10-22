export const CAPABILITIES = ['llm', 'vision', 'image', 'tts', 'asr', 'video', 'embedding', 'ocr'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  llm: '文本/对话',
  vision: '视觉理解',
  image: '图像生成与编辑',
  tts: '语音合成 TTS',
  asr: '语音转写 ASR',
  video: '视频生成',
  embedding: '向量与重排序',
  ocr: '多模态 OCR',
};

export function isCapability(s: string): s is Capability {
  return (CAPABILITIES as readonly string[]).includes(s);
}

export type Protocol = 'openai' | 'anthropic' | 'dashscope' | 'zhipu' | 'minimax' | 'elevenlabs' | 'comfyui' | 'mock';

export interface ProviderDef {
  id: string;
  label: string;
  protocol: Protocol;
  baseURL: string;
  /** 原生接口基础地址（如百炼 DashScope 原生、MiniMax） */
  nativeBaseURL?: string;
  capabilities: Capability[];
  secretName: string; // 空字符串表示无需密钥（mock、本地）
  useProxy: boolean;
  local?: boolean;
  region: 'cn' | 'global' | 'local' | 'test';
  /** 每个能力的默认模型名 */
  models: Partial<Record<Capability, string>>;
  /** 图像编辑默认模型名（属于 image 能力；为空表示该提供方未接图像编辑） */
  imageEditModel?: string;
  /** 语音合成默认音色 */
  ttsVoice?: string;
  /** 结构化输出能力：json_schema（原生 Schema 约束）/ json_object（只保证是 JSON）/ 未填为不传 response_format */
  jsonMode?: 'json_schema' | 'json_object';
  /** 是否支持 seed 参数（确定性评测） */
  supportsSeed?: boolean;
  /** 上下文窗口（token，默认 128000），用于请求前预检 */
  contextWindow?: number;
  /** 单次最大输出 token 上限（默认值会被它截断） */
  maxOutputTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Usage {
  /** token | image | char | second | call */
  unit: 'token' | 'image' | 'char' | 'second' | 'call';
  /** 输入总量（token 单位时包含缓存命中部分） */
  input: number;
  output: number;
  /** 输入中命中服务商上下文缓存的 token 数（取得到才有） */
  cachedInput?: number;
}

/** 结构化输出约束：原生 Schema 或仅 JSON 模式。 */
export type ResponseFormat =
  | { type: 'json_schema'; name: string; schema: Record<string, unknown> }
  | { type: 'json_object' };

/** 统一请求参数（适配器各自翻译成服务商协议）。 */
export interface ChatOptions {
  responseFormat?: ResponseFormat;
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  /** 思考模式（影响 max_tokens 默认值；思考内容进 reasoning，不进成稿） */
  thinking?: boolean;
}

export interface BaseResult {
  provider: string;
  model: string;
  ms: number;
  mock: boolean;
  usage: Usage;
}

export interface ChatResult extends BaseResult {
  content: string;
  /** 思考内容：只供调试查看，不进入成稿与日志正文 */
  reasoning?: string;
}
export interface ImageResult extends BaseResult { images: { url?: string; b64?: string }[] }
export interface AudioResult extends BaseResult { audio: Buffer; mime: string }
export interface Segment { start: number; end: number; text: string }
export interface AsrResult extends BaseResult { text: string; segments: Segment[] }
export interface VideoResult extends BaseResult { taskId: string; status: 'pending' | 'running' | 'succeeded' | 'failed'; url?: string; message?: string }
export interface EmbedResult extends BaseResult { vectors: number[][] }
export interface RerankResult extends BaseResult { scores: { index: number; score: number }[] }

export interface ImageInput { url?: string; b64?: string; mime?: string }
export interface ImageEditOptions { n?: number; size?: string; negativePrompt?: string }

/** 每个协议适配器实现其支持能力对应的方法，未实现的方法为 undefined。 */
export interface ProviderAdapter {
  chat?(messages: ChatMessage[], model: string, opts?: ChatOptions): Promise<ChatResult>;
  vision?(images: ImageInput[], prompt: string, model: string): Promise<ChatResult>;
  image?(prompt: string, model: string, opts?: { n?: number; size?: string }): Promise<ImageResult>;
  /** 图像编辑：输入 1-3 张图 + 编辑指令，输出编辑后的图像 */
  imageEdit?(images: ImageInput[], instruction: string, model: string, opts?: ImageEditOptions): Promise<ImageResult>;
  tts?(text: string, model: string, opts?: { voice?: string }): Promise<AudioResult>;
  asr?(audio: { url?: string; data?: Buffer; mime?: string }, model: string): Promise<AsrResult>;
  video?(prompt: string, model: string, opts?: { imageUrl?: string }): Promise<VideoResult>;
  videoStatus?(taskId: string, model: string): Promise<VideoResult>;
  embed?(texts: string[], model: string): Promise<EmbedResult>;
  rerank?(query: string, docs: string[], model: string): Promise<RerankResult>;
}

export class NotConfiguredError extends Error {
  constructor(public readonly capability: Capability, detail: string) {
    super(`未配置：${CAPABILITY_LABELS[capability]}（${detail}）`);
    this.name = 'NotConfiguredError';
  }
}

export class NotSupportedError extends Error {
  constructor(provider: string, capability: Capability) {
    super(`提供方 ${provider} 的 ${CAPABILITY_LABELS[capability]} 适配器尚未实现`);
    this.name = 'NotSupportedError';
  }
}
