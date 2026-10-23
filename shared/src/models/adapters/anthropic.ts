/** Anthropic 兼容（/messages）：文本、推理、看图。 */
import { ParseError, json, trimURL, type Adapter } from './types.js';
const adapter: Adapter = {
  id: 'anthropic', label: 'Anthropic 兼容', defaultBaseURL: 'https://api.anthropic.com/v1', region: 'global', keyRequired: true,
  roles: ['chat', 'reason', 'fast', 'vision'],
  declare: () => ({ verified: 'doc', tools: 'native', stream: true }),
  build(req, ctx) {
    if (req.role !== 'chat' && req.role !== 'reason' && req.role !== 'fast' && req.role !== 'vision') throw new ParseError('Anthropic 兼容只支持文本类');
    const messages = req.role === 'vision'
      ? [{ role: 'user', content: [{ type: 'image', source: /^data:/.test(req.image) ? { type: 'base64', media_type: req.image.slice(5, req.image.indexOf(';')), data: req.image.slice(req.image.indexOf(',') + 1) } : { type: 'url', url: req.image } }, { type: 'text', text: req.question }] }]
      : req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'text', text: '' })) }));
    const system = req.role === 'vision' ? undefined : req.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n') || undefined;
    const body: Record<string, unknown> = { model: ctx.target.model, max_tokens: req.maxTokens ?? 4096, messages, ...(system ? { system } : {}) };
    if (req.role === 'reason') body.thinking = { type: 'enabled', budget_tokens: 2048 };
    return { method: 'POST', url: `${trimURL(ctx.baseURL)}/messages`, headers: { 'content-type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body), responseType: 'json' };
  },
  parse(_req, res) {
    const j = json(res);
    const blocks = (j.content ?? []) as any[];
    return { value: { type: 'text', text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''), reasoning: blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('') || undefined, toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })) }, usage: { input: j.usage?.input_tokens, output: j.usage?.output_tokens, cached: j.usage?.cache_read_input_tokens }, respondedModel: j.model };
  },
};
export default adapter;
