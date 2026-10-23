/** 阶跃星辰（refs-v9）：https://api.stepfun.com/v1 —— /chat/completions、/audio/speech（input ≤1000 字符）、/audio/transcriptions（multipart）、图像生成与编辑（OpenAI 形态，字段执行时以官方文档为准，标“按文档接入”）。 */
import { makeOpenAICompatible } from './openai-compatible.js';
export default makeOpenAICompatible({
  id: 'stepfun', label: '阶跃星辰', defaultBaseURL: 'https://api.stepfun.com/v1', region: 'cn', docs: 'https://platform.stepfun.com/docs',
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr'],
  declare: (role) => ({ verified: 'doc', ...(role === 'tts' ? { maxChars: 1000 } : {}) }),
});
