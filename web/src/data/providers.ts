/**
 * 模型服务商目录（0.6.0 本机模式）。地址与 server/src/models/providers.ts 一致（2026-10-22 核实）。
 * 常用 6 家在上面，其余收进“更多”；用户可添加自定义服务（OpenAI 兼容 / Anthropic 兼容）。
 */
export type Protocol = 'openai' | 'anthropic';
export interface ProviderPreset {
  id: string; label: string; baseURL: string; protocol: Protocol; models: string[]; common?: boolean;
  keyHint?: string; docs?: string; noKey?: boolean;
  /** MiMo：max_completion_tokens + thinking:{type} */
  dialect?: { maxTokensParam?: 'max_tokens' | 'max_completion_tokens'; thinkingType?: boolean; jsonObject?: boolean };
  prices?: Record<string, { input: number; output: number }>;
  baseURLPresets?: { label: string; url: string }[];
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'mimo', label: '小米 MiMo', baseURL: 'https://api.xiaomimimo.com/v1', protocol: 'openai', common: true,
    models: ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'], keyHint: 'sk-…（Token Plan 为 tp-…）',
    dialect: { maxTokensParam: 'max_completion_tokens', thinkingType: true, jsonObject: true },
    prices: { 'mimo-v2.6-flash': { input: 1, output: 2 }, 'mimo-v2.6-pro': { input: 3, output: 6 }, 'mimo-v2.6-pro-ultraspeed': { input: 30, output: 60 } },
    baseURLPresets: [{ label: '按量付费（sk- Key）', url: 'https://api.xiaomimimo.com/v1' }, { label: 'Token Plan（tp- Key）', url: 'https://token-plan-cn.xiaomimimo.com/v1' }],
  },
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', protocol: 'openai', common: true, models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro'], dialect: { jsonObject: true } },
  { id: 'dashscope', label: '通义千问（阿里云百炼）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', common: true, models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], dialect: { jsonObject: true } },
  { id: 'kimi', label: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1', protocol: 'openai', common: true, models: ['kimi-latest', 'moonshot-v1-8k'], dialect: { jsonObject: true } },
  { id: 'zhipu', label: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai', common: true, models: ['glm-4-flash', 'glm-4-plus'], dialect: { jsonObject: true } },
  { id: 'ark', label: '豆包（火山方舟）', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'openai', common: true, models: [], keyHint: '模型填接入点 ID（ep-…）' },
  { id: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimaxi.com/v1', protocol: 'openai', models: ['MiniMax-M1'] },
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', protocol: 'openai', models: ['gpt-4.1-mini', 'gpt-4.1'], dialect: { jsonObject: true } },
  { id: 'anthropic', label: 'Anthropic Claude', baseURL: 'https://api.anthropic.com/v1', protocol: 'anthropic', models: ['claude-sonnet-4-5'] },
  { id: 'gemini', label: 'Google Gemini（OpenAI 兼容）', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', models: ['gemini-2.5-flash'] },
  { id: 'ollama', label: 'Ollama（电脑本地）', baseURL: 'http://localhost:11434/v1', protocol: 'openai', models: [], noKey: true, keyHint: '不需要 Key；手机上请填电脑的局域网地址' },
];

export const presetOf = (id: string) => PROVIDERS.find((p) => p.id === id);
