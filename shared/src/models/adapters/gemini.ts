/** Google Gemini（OpenAI 兼容 …/v1beta/openai/）：对话、向量、images.generate（gemini-2.5-flash-image 等；Imagen 已在 Gemini API 关闭）。 */
import { makeOpenAICompatible } from './openai-compatible.js';
export default makeOpenAICompatible({
  id: 'gemini', label: 'Google Gemini', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', region: 'global', docs: 'https://ai.google.dev/gemini-api/docs/openai',
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'embed'],
  declare: () => ({ verified: 'doc' }),
});
