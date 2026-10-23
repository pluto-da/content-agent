/** DeepSeek（refs-v9）：OpenAI 格式 https://api.deepseek.com；deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用（见 config/model-deprecations.json）。 */
import { makeOpenAICompatible } from './openai-compatible.js';
export default makeOpenAICompatible({ id: 'deepseek', label: 'DeepSeek', defaultBaseURL: 'https://api.deepseek.com', region: 'cn', roles: ['chat', 'reason', 'fast', 'vision'], docs: 'https://api-docs.deepseek.com/', declare: () => ({ verified: 'doc', tools: 'native', jsonMode: 'json_object', thinking: 'toggle' }) });
