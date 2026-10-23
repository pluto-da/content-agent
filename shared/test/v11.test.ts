/** 0.11.0：MiMo ASR 按音频时长计费（WAV 头部算时长）、TTS 限时免费价目、verified 由真实调用改为 live；agent.runtime.v9 开关已移除。 */
import { describe, it, expect } from 'vitest';
import { adapterOf, priceOf, costOf, mergeDecl, FLAGS, flagOn, bytesToBase64 } from '../src/index.js';
import { audioSeconds } from '../src/models/adapters/mimo.js';

function wav(seconds: number, rate = 24000): string {
  const n = Math.round(seconds * rate) * 2, b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
  b.set([82, 73, 70, 70]); dv.setUint32(4, 36 + n, true); b.set([87, 65, 86, 69, 102, 109, 116, 32], 8); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); b.set([100, 97, 116, 97], 36); dv.setUint32(40, n, true);
  return bytesToBase64(b);
}
describe('0.11.0 MiMo 价目与时长', () => {
  it('audioSeconds：WAV 按字节率算时长；非 WAV 返回 null', () => {
    expect(audioSeconds(wav(5.12), 'wav')).toBeCloseTo(5.12, 2);
    expect(audioSeconds(wav(1), 'mp3')).toBeNull();
    expect(audioSeconds('bm90IGEgd2F2', 'wav')).toBeNull();
  });
  it('ASR ¥0.5/小时、TTS 限时免费', () => {
    expect(costOf(priceOf('mimo', 'mimo-v2.5-asr'), { seconds: 3600 })).toBeCloseTo(0.5, 6);
    expect(costOf(priceOf('mimo', 'mimo-v2.5-tts'), { chars: 1000 })).toBe(0);
  });
  it('ASR 解析带上 seconds 用量', () => {
    const a = adapterOf('mimo')!;
    const p = a.parse({ role: 'asr', audio: { base64: wav(2), format: 'wav', mime: 'audio/wav' } }, { status: 200, text: JSON.stringify({ choices: [{ message: { content: '你好' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }) }, {} as never);
    expect(p.value).toMatchObject({ type: 'transcript', text: '你好' });
    expect(p.usage.seconds).toBeCloseTo(2, 2);
  });
  it('verified：mimo-v2.5-tts / mimo-v2.5-asr 为 live（真实调用过），voiceclone 与 vision 仍为 doc', () => {
    const a = adapterOf('mimo')!;
    expect(mergeDecl('tts', 'mimo', 'mimo-v2.5-tts', a.declare('tts', 'mimo-v2.5-tts')).verified).toBe('live');
    expect(mergeDecl('asr', 'mimo', 'mimo-v2.5-asr', a.declare('asr', 'mimo-v2.5-asr')).verified).toBe('live');
    expect(mergeDecl('tts', 'mimo', 'mimo-v2.5-tts-voiceclone', a.declare('tts', 'mimo-v2.5-tts-voiceclone')).verified).toBe('doc');
    expect(mergeDecl('vision', 'mimo', 'mimo-v2.6-flash', a.declare('vision', 'mimo-v2.6-flash')).verified).toBe('doc');
  });
  it('未实测的服务商保持 doc（百炼 / 智谱 / 方舟 / MiniMax 未提供 Key）', () => {
    for (const [v, r] of [['dashscope', 'chat'], ['zhipu', 'chat'], ['ark', 'chat'], ['minimax', 'tts']] as const) {
      const a = adapterOf(v)!;
      expect(mergeDecl(r, v, 'x', a.declare(r, 'x')).verified, v).not.toBe('live');
    }
  });
  it('agent.runtime.v9 开关已到期移除（0.8 循环删除）', () => {
    expect(FLAGS.get('agent.runtime.v9')).toBeUndefined();
    expect(flagOn('agent.runtime.v9', { 'agent.runtime.v9': true })).toBe(false);
  });
});
