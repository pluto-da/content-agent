/** OpenAI：/chat/completions、/images/generations、/images/edits（multipart）、/audio/speech、/audio/transcriptions、/embeddings。图像模型名由用户填写。 */
import { makeOpenAICompatible } from './openai-compatible.js';
export default makeOpenAICompatible({ id: 'openai', label: 'OpenAI', defaultBaseURL: 'https://api.openai.com/v1', region: 'global', roles: ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'embed'], docs: 'https://platform.openai.com/docs' });
