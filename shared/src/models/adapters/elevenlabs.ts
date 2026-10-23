/** ElevenLabs：POST /v1/text-to-speech/{voice_id}（xi-api-key 头，返回音频二进制）。 */
import { ParseError, trimURL, type Adapter } from './types.js';
const adapter: Adapter = {
  id: 'elevenlabs', label: 'ElevenLabs', defaultBaseURL: 'https://api.elevenlabs.io/v1', region: 'global', keyRequired: true, roles: ['tts'],
  declare: () => ({ verified: 'doc', audioFormats: ['mp3'] }),
  build(req, ctx) {
    if (req.role !== 'tts') throw new ParseError('ElevenLabs 只支持配音');
    return { method: 'POST', url: `${trimURL(ctx.baseURL)}/text-to-speech/${encodeURIComponent(req.voice ?? '21m00Tcm4TlvDq8ikWAM')}`, headers: { 'content-type': 'application/json', 'xi-api-key': ctx.apiKey, accept: 'audio/mpeg' }, body: JSON.stringify({ text: req.text, model_id: ctx.target.model }), responseType: 'binary' };
  },
  parse(req, res) {
    if (req.role !== 'tts' || !res.base64) throw new ParseError('没有收到音频数据');
    return { value: { type: 'media', items: [{ base64: res.base64, mime: 'audio/mpeg' }] }, usage: { chars: [...req.text].length } };
  },
};
export default adapter;
