/** Ollama（本地）：OpenAI 兼容 http://<局域网IP>:11434/v1（对话、看图、向量）；模型列表 GET /api/tags（根地址，不带 /v1）。不需要 Key。 */
import { makeOpenAICompatible } from './openai-compatible.js';
import { json, trimURL } from './types.js';
export default makeOpenAICompatible({
  id: 'ollama', label: 'Ollama（本地）', defaultBaseURL: 'http://192.168.1.10:11434/v1', region: 'local', keyRequired: false,
  roles: ['chat', 'reason', 'fast', 'vision', 'embed'],
  listModels: {
    build: (ctx) => ({ method: 'GET', url: `${trimURL(ctx.baseURL).replace(/\/v1$/, '')}/api/tags`, headers: {}, responseType: 'json' }),
    parse: (res) => ((json(res).models ?? []) as any[]).map((m) => ({ id: String(m.name ?? m.model) })),
  },
});
