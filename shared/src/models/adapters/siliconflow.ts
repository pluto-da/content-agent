/** 硅基流动（refs-v9）：对话、/images/generations（图片 URL 1 小时有效）、/audio/speech（二进制）、/audio/transcriptions、/embeddings、/rerank。 */
import { makeOpenAICompatible, parseImages } from './openai-compatible.js';
const base = makeOpenAICompatible({ id: 'siliconflow', label: '硅基流动', defaultBaseURL: 'https://api.siliconflow.cn/v1' });
export default makeOpenAICompatible({
  id: 'siliconflow', label: '硅基流动 SiliconFlow', defaultBaseURL: 'https://api.siliconflow.cn/v1', region: 'cn', docs: 'https://docs.siliconflow.cn/',
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'tts', 'asr', 'embed', 'rerank'],
  declare: (role) => ({ verified: 'doc', ...(role === 'image' ? { resultTTLHours: 1 } : {}) }),
  parse: (req, res, ctx) => (req.role === 'image' ? parseImages(res, 1) : base.parse(req, res, ctx)),
});
