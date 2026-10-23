import { describe, expect, it } from 'vitest';
import { mockChatCompletion, mockResponse } from '../local/mockLlm';
import { checkBaseURL } from '../local/llm';

const tools = [{ type: 'function', function: { name: 'draft_write' } }, { type: 'function', function: { name: 'draft_adapt' } }];
const msg = (body: object) => (mockChatCompletion(JSON.stringify(body)).choices as { message: { content: string; tool_calls?: { function: { name: string; arguments: string } }[] } }[])[0]!.message;

describe('1.1.0 模拟服务商在对话 / 写作链路可用（新用户选“本地模拟”不再报“地址不对”）', () => {
  it('mock:// 地址通过检查，请求就地返回 OpenAI 格式', async () => {
    expect(checkBaseURL('mock://local')).toBeNull();
    const r = mockResponse('mock://local/chat/completions', { body: JSON.stringify({ messages: [{ role: 'user', content: '只回复两个字' }] }) });
    expect(((await r.json()) as { choices: { message: { content: string } }[] }).choices[0]!.message.content).toBe('你好');
  });
  it('要写 → draft_write（不指定平台 = 自由创作）；说了草稿号与平台 → draft_adapt', () => {
    const w = msg({ tools, messages: [{ role: 'user', content: '写一篇关于通勤时间怎么利用的短文' }] });
    expect(w.tool_calls![0]!.function.name).toBe('draft_write');
    expect(JSON.parse(w.tool_calls![0]!.function.arguments)).toEqual({ topic: '通勤时间怎么利用' });
    const a = msg({ tools, messages: [{ role: 'user', content: '把草稿 #3 适配到小红书和公众号' }] });
    expect(JSON.parse(a.tool_calls![0]!.function.arguments)).toEqual({ draftId: 3, platforms: ['xiaohongshu', 'wechat_article'] });
  });
  it('写稿请求返回可通过 Schema 的 JSON', () => {
    const j = JSON.parse(msg({ response_format: { type: 'json_object' }, messages: [{ role: 'user', content: '[TASK:rewrite] [PLATFORM:free]\n选题标题：通勤时间怎么利用\n角度：\n请输出 JSON' }] }).content);
    expect(j.title).toBe('通勤时间怎么利用：三件小事');
    expect([...j.title].length).toBeLessThanOrEqual(20);
    expect(j.image_prompts).toHaveLength(3);
  });
});
