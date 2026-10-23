/** Kimi（月之暗面）：OpenAI 兼容 https://api.moonshot.cn/v1；GET /models 返回 context_length、supports_image_in、supports_reasoning（可预填能力声明）。 */
import { makeOpenAICompatible } from './openai-compatible.js';
export default makeOpenAICompatible({ id: 'kimi', label: 'Kimi', defaultBaseURL: 'https://api.moonshot.cn/v1', region: 'cn', roles: ['chat', 'reason', 'fast', 'vision'], docs: 'https://platform.kimi.com/docs' });
