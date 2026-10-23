/**
 * 1.1.0：“本地模拟（演示，免费）”服务商在对话 / 写作链路上的确定性回复（地址 mock://local，不联网、不需要 Key）。
 * 之前只有“试一试”（runner）认 mock://，对话与写稿走 OpenAI 兼容 fetch，新用户选了模拟服务商一开口就报“地址不对”。
 * 这里把 mock:// 请求就地变成一个 OpenAI 格式的整段响应：
 * - 带 tools：用户要写 → 调 draft_write；要适配（说了平台名 + 草稿号）→ 调 draft_adapt；工具结果回来 → 一句话总结；
 * - 不带 tools（写稿要 JSON）：按要求生成标题 / 正文 / 标签 / 配图提示的 JSON；
 * - 其他：普通文字回复。用量按字数估算，花费为 0（模拟服务商没有单价）。
 */
export const isMockURL = (u: string | undefined | null): boolean => /^mock:\/\//i.test((u ?? '').trim());

type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };
const textOf = (m?: Msg): string => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? (m!.content as { text?: string }[]).map((c) => c.text ?? '').join('') : '');
const PLATFORM_WORDS: [RegExp, string][] = [[/小红书/, 'xiaohongshu'], [/抖音/, 'douyin_script'], [/视频号/, 'channels'], [/公众号/, 'wechat_article'], [/知乎/, 'zhihu_answer'], [/闲鱼/, 'xianyu'], [/\bX\b|推特/, 'x_post']];

function topicOf(raw: string): string {
  const u = raw.replace(/\[[A-Z_]+:[^\]]*\]\s*/g, '');
  const sel = /选题标题：([\s\S]*?)(?:\n角度：|$)/.exec(u)?.[1];
  if (sel && /^把下面这篇母稿/.test(sel.trim())) { const t = /标题：(.+)/.exec(sel.split('\n').slice(1).join('\n')); if (t) return t[1]!.replace(/：三件小事$/, '').trim(); }
  if (sel) return topicOf(sel.split('\n')[0]!);
  const first = u.split('\n').map((l) => l.trim()).find((l) => l && !/^(把下面|本篇标准|参考|角度|标题：|正文：)/.test(l)) ?? u;
  const m = /标题：(.+)/.exec(u);
  const base = (/^把下面/.test(u.trim()) && m ? m[1]! : first).replace(/^(请|帮我|给我)?(写|写一篇|来一篇)(一篇)?(关于)?/, '').replace(/的?(短文|文章|笔记|内容)$/, '').trim();
  return base || '今天的想法';
}

function draftJson(u: string): string {
  const topic = topicOf(u);
  const short = [...topic].slice(0, 14).join('');
  const body = [
    `${topic}，其实可以拆成三件小事。`,
    '第一，先找出每天固定空出来的那段时间，哪怕只有十五分钟。',
    '第二，给这段时间只安排一件事：听一期播客、背二十个单词，或者把昨天的想法写成三行笔记。',
    '第三，每周回看一次，留下真的做到的那一件，其余的划掉。',
    '时间不会变多，但被认真对待的那一小段，会慢慢变成你的习惯。',
  ].join('\n');
  return JSON.stringify({
    title: `${short}：三件小事`, body, tags: ['时间管理', '日常', '自我提升', '习惯', '效率'],
    image_prompts: [`${short} 封面，简洁留白`, '通勤路上的手机与耳机，暖色', '一页手写笔记特写'], voiceover: body.split('\n')[0], revenue_hypothesis: '（模拟）先看收藏率，不预设收入',
  });
}

type Call = { id?: string; function?: { name?: string; arguments?: string } };
const lastCall = (after: Msg[]): Call | undefined => [...after].reverse().flatMap((m) => (m.tool_calls ?? []) as Call[])[0];
const lastToolName = (after: Msg[]): string | undefined => lastCall(after)?.function?.name;

export function mockChatCompletion(bodyText: string): Record<string, unknown> {
  let req: { model?: string; messages?: Msg[]; tools?: { function?: { name?: string } }[]; response_format?: unknown } = {};
  try { req = JSON.parse(bodyText || '{}'); } catch { /* 空请求按普通回复 */ }
  const msgs = req.messages ?? [];
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
  const u = textOf(msgs[lastUserIdx]);
  const after = msgs.slice(lastUserIdx + 1);
  const toolNames = new Set((req.tools ?? []).map((t) => t.function?.name));
  const sys = msgs.filter((m) => m.role === 'system').map(textOf).join('\n');
  let message: Record<string, unknown>;
  if (toolNames.size && !after.some((m) => m.role === 'tool')) {
    const platforms = PLATFORM_WORDS.filter(([r]) => r.test(u)).map(([, id]) => id);
    const draftNo = /#\s*(\d+)|草稿\s*(\d+)/.exec(u);
    const nums: Record<string, number> = {};
    for (const [re, k] of [[/(?:阅读|浏览|播放)\D{0,3}(\d+)/, 'views'], [/点赞\D{0,3}(\d+)/, 'likes'], [/评论\D{0,3}(\d+)/, 'comments'], [/收藏\D{0,3}(\d+)/, 'collects'], [/(?:转发|分享)\D{0,3}(\d+)/, 'shares']] as [RegExp, string][]) { const m = re.exec(u); if (m) nums[k] = Number(m[1]); }
    if (toolNames.has('publish_check') && /发布/.test(u) && draftNo) {
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'mock-call-1', type: 'function', function: { name: 'publish_check', arguments: JSON.stringify({ draftId: Number(draftNo[1] ?? draftNo[2]) }) } }] };
    } else if (toolNames.has('metrics_record') && /数据/.test(u) && draftNo) {
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'mock-call-1', type: 'function', function: { name: 'metrics_record', arguments: JSON.stringify({ draftId: Number(draftNo[1] ?? draftNo[2]), ...nums }) } }] };
    } else if (toolNames.has('draft_adapt') && /适配|发到|改成/.test(u) && draftNo && platforms.length) {
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'mock-call-1', type: 'function', function: { name: 'draft_adapt', arguments: JSON.stringify({ draftId: Number(draftNo[1] ?? draftNo[2]), platforms }) } }] };
    } else if (toolNames.has('draft_write') && /写|稿|文章|笔记/.test(u)) {
      const platform = platforms.length === 1 && /写成|发到|按.*(写|格式)/.test(u) ? platforms[0] : undefined;
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'mock-call-1', type: 'function', function: { name: 'draft_write', arguments: JSON.stringify({ topic: topicOf(u), ...(platform ? { platform } : {}) }) } }] };
    } else message = { role: 'assistant', content: `（模拟回复）收到：${u}` };
  } else if (after.some((m) => m.role === 'tool') && toolNames.has('publish_prepare') && lastToolName(after) === 'publish_check' && !/"blocking":\s*true/.test(textOf([...after].reverse().find((m) => m.role === 'tool')))) {
    const args = JSON.parse(lastCall(after)?.function?.arguments ?? '{}') as { draftId?: number };
    message = { role: 'assistant', content: '', tool_calls: [{ id: 'mock-call-2', type: 'function', function: { name: 'publish_prepare', arguments: JSON.stringify({ draftId: args.draftId }) } }] };
  } else if (after.some((m) => m.role === 'tool')) {
    const last = textOf([...after].reverse().find((m) => m.role === 'tool'));
    let note = '已完成。';
    try { const j = JSON.parse(last) as { draftId?: number; title?: string; motherId?: number; adapted?: unknown[] }; note = (j as { copied?: boolean }).copied !== undefined ? '文案已复制、发布页已打开：粘贴 → 检查 → 由你本人点击发布。' : (j as { saved?: boolean }).saved ? '数据已记下，可以在“成长”里看趋势。' : j.adapted ? `已把草稿 #${j.motherId} 适配成 ${j.adapted.length} 篇，母稿保留不变。` : j.draftId ? `草稿 #${j.draftId}「${j.title ?? ''}」写好了，在“草稿”里审一下；要发到哪个平台告诉我，我按那个平台适配。` : note; } catch { /* 原样总结 */ }
    message = { role: 'assistant', content: `（模拟）${note}` };
  } else if (req.response_format || /JSON|json/.test(sys) || /请输出 JSON/.test(u)) {
    const src = msgs.filter((m) => m.role === 'user').map(textOf).find((x) => /选题标题：/.test(x)) ?? u;
    message = { role: 'assistant', content: draftJson(src) };
  } else message = { role: 'assistant', content: /只回复两个字/.test(u) ? '你好' : `（模拟回复）${u}` };
  const outText = typeof message.content === 'string' ? message.content : '';
  return {
    id: 'mock-chatcmpl', object: 'chat.completion', model: req.model ?? 'mock-omni',
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: Math.ceil(JSON.stringify(msgs).length / 4), completion_tokens: Math.ceil([...outText].length / 2) + 8 },
  };
}

/** 把发往 mock:// 的请求变成本地响应（只认 /chat/completions 与 /models）。 */
export function mockResponse(url: string, init: RequestInit): Response {
  const headers = { 'content-type': 'application/json' };
  if (/\/models\/?$/.test(url)) return new Response(JSON.stringify({ object: 'list', data: [{ id: 'mock-omni' }, { id: 'mock-chat' }] }), { status: 200, headers });
  if (/\/chat\/completions\/?$/.test(url)) return new Response(JSON.stringify(mockChatCompletion(typeof init.body === 'string' ? init.body : '')), { status: 200, headers });
  return new Response(JSON.stringify({ error: { message: 'mock: unsupported endpoint' } }), { status: 404, headers });
}
