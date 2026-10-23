/** 1.1.0 模型归一：resolveModel 五级优先级、能力自动识别、覆盖一览、v3→v4 迁移与降级（D4 / D6 / D12 的 shared 部分）。 */
import { describe, expect, it } from 'vitest';
import { resolveModel, resolveTarget, coverage, inferRoles, upV3toV4, downV4toV3, pickMain, ModelsMigrator, addModelEntry, bindRole, emptyModelsV3, CAPS, capsOfEntry, callRole, type ModelsStateV3 } from '../src/index.js';
import { acct, stateWith, fakeTransport, deps, ok } from './helpers.js';

function multi(): ModelsStateV3 {
  // MiMo：一个对话+思考+看图的主模型，同服务商一个配音模型；百炼：生图
  const s = stateWith([
    { acc: acct('mi', 'mimo'), model: 'mimo-v2.5', roles: ['chat', 'reason', 'vision'] },
    { acc: acct('mi', 'mimo'), model: 'mimo-v2-tts', roles: ['tts'] },
    { acc: acct('ds', 'dashscope'), model: 'qwen-image', roles: ['image'] },
    { acc: acct('ds', 'dashscope'), model: 'cosyvoice-v3', roles: ['tts'] },
  ]);
  const e = s.accounts[0]!.models[0]!;
  s.main = { accountId: 'mi', modelEntryId: e.id, model: e.model };
  return s;
}

describe('resolveModel 五级优先级（唯一选模型链）', () => {
  it('① 按任务指定（任务级优先于能力级）', () => {
    const s = multi();
    const img = s.accounts[1]!.models[0]!;
    const tts2 = s.accounts[1]!.models[1]!;
    s.roles.tts.tasks = { voiceover: { accountId: 'ds', modelEntryId: tts2.id, model: tts2.model } };
    expect(resolveModel(s, 'voiceover', 'tts')!.via).toBe('task');
    expect(resolveModel(s, 'voiceover', 'tts')!.target.model).toBe('cosyvoice-v3');
    const s2 = bindRole(s, 'image', 'primary', img);
    expect(resolveModel(s2, undefined, 'image')!.via).toBe('primary');
  });
  it('② 主模型覆盖该能力时用主模型', () => {
    const r = resolveModel(multi(), 'write', 'vision')!;
    expect(r.via).toBe('main'); expect(r.target.model).toBe('mimo-v2.5');
    expect(resolveModel(multi(), undefined, 'reason')!.via).toBe('main');
  });
  it('③ 主模型不覆盖时先找同服务商', () => {
    const r = resolveModel(multi(), undefined, 'tts')!;
    expect(r.via).toBe('same-vendor'); expect(r.target.model).toBe('mimo-v2-tts');
  });
  it('④ 再找其他已接入且覆盖该能力的模型', () => {
    const r = resolveModel(multi(), undefined, 'image')!;
    expect(r.via).toBe('other'); expect(r.target.model).toBe('qwen-image');
  });
  it('⑤ 没有任何模型覆盖 → null（界面提示“补一个”）', () => {
    expect(resolveModel(multi(), undefined, 'video')).toBeNull();
    expect(resolveModel(emptyModelsV3(), undefined, 'chat')).toBeNull();
  });
  it('思考是档位：只有对话模型时 reason 落到对话模型并开思考；省钱档关掉时 fast 用主模型', () => {
    const s = stateWith([{ acc: acct('k', 'kimi'), model: 'moonshot-v1-8k', roles: ['chat'] }]);
    const e = s.accounts[0]!.models[0]!; s.main = { accountId: 'k', modelEntryId: e.id, model: e.model };
    const r = resolveModel(s, undefined, 'reason')!;
    expect(r.via).toBe('role-fallback'); expect(r.thinking).toBe(true);
    expect(resolveModel(s, undefined, 'reason', { strict: true })).toBeNull();
    s.economy = { mode: 'off' };
    expect(resolveModel(s, 'title', 'fast')!.target.model).toBe('moonshot-v1-8k');
  });
  it('resolveTarget 只是 resolveModel 的别名（单一调用链）', () => {
    const s = multi();
    expect(resolveTarget(s, 'tts')).toEqual(resolveModel(s, undefined, 'tts'));
  });
  it('思考开关：关闭时请求不带思考、计费按实际返回记账', async () => {
    const s = multi();
    const tr = fakeTransport(() => ok({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const usage: unknown[] = [];
    const r = await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: 'x' }], thinking: false }, deps(s, tr, { onUsage: (u) => { usage.push(u); } }));
    expect(r.ok).toBe(true);
    const body = JSON.parse(tr.calls[0]!.body!);
    expect(JSON.stringify(body)).not.toMatch(/"thinking":\s*\{\s*"type":\s*"enabled"/);
    expect(usage).toHaveLength(1);
  });
});

describe('能力自动识别与覆盖一览', () => {
  it('按模型名推断能力，并与适配器声明取交集', () => {
    expect(inferRoles('mimo', 'mimo-v2.5')).toEqual(expect.arrayContaining(['chat', 'reason', 'vision']));
    expect(inferRoles('mimo', 'mimo-v2-tts')).toEqual(['tts']);
    expect(inferRoles('dashscope', 'wan2.6-t2v')).toEqual(['video']);
    expect(inferRoles('dashscope', 'qwen-image-edit')).toEqual(['imageEdit']);
    expect(inferRoles('deepseek', 'deepseek-v4-flash')).toEqual(expect.arrayContaining(['chat', 'reason', 'fast']));
    expect(inferRoles('mimo', 'wan2.6-t2v')).toEqual(['chat']);   // MiMo 适配器不声明视频 → 不臆测
  });
  it('接入一个多能力模型后，覆盖一览自动点亮对应能力', () => {
    const s = emptyModelsV3();
    const a = acct('mi', 'mimo'); s.accounts.push(a);
    const r = addModelEntry(a, { model: 'mimo-v2.5', roles: inferRoles('mimo', 'mimo-v2.5') });
    if (!r.ok) throw new Error('add');
    s.main = { accountId: 'mi', modelEntryId: r.entry.id, model: r.entry.model };
    const c = coverage(s);
    expect(c.chat?.entry.model).toBe('mimo-v2.5');
    expect(c.think?.entry.model).toBe('mimo-v2.5');
    expect(c.vision?.entry.model).toBe('mimo-v2.5');
    expect(c.image).toBeNull(); expect(c.video).toBeNull();
    expect(capsOfEntry(r.entry)).toEqual(['chat', 'think', 'vision']);
    expect(CAPS.map((x) => x.label)).toEqual(['对话', '思考', '看图', '生图', '改图', '配音', '转写', '视频']);
  });
});

describe('schemaVersion 3 → 4 迁移与降级', () => {
  function v3(): ModelsStateV3 {
    let s = stateWith([
      { acc: acct('mi', 'mimo'), model: 'mimo-v2.5', roles: ['chat', 'reason', 'vision'] },
      { acc: acct('ds', 'dashscope'), model: 'qwen3.7-plus', roles: ['chat'] },
      { acc: acct('ds', 'dashscope'), model: 'qwen-image', roles: ['image'] },
    ]);
    const [mi] = s.accounts[0]!.models; const [qw, img] = s.accounts[1]!.models;
    s = bindRole(s, 'chat', 'primary', mi!); s = bindRole(s, 'reason', 'primary', mi!); s = bindRole(s, 'vision', 'primary', mi!);
    s = bindRole(s, 'fast', 'primary', qw!); s = bindRole(s, 'image', 'primary', img!);
    (s as { schemaVersion: number }).schemaVersion = 3; delete s.economy;
    return s;
  }
  it('出现次数最多的对话模型成为主模型，其余绑定转为按任务指定', () => {
    const before = v3();
    expect(pickMain(before)!.model).toBe('mimo-v2.5');
    const after = upV3toV4(before);
    expect(after.schemaVersion).toBe(4);
    expect(after.main!.model).toBe('mimo-v2.5');
    expect(after.roles.chat.primary).toBeUndefined();
    expect(after.roles.fast.primary!.model).toBe('qwen3.7-plus');
    expect(after.roles.image.primary!.model).toBe('qwen-image');
    // 迁移前后每个能力实际选中的模型不变
    for (const r of ['chat', 'reason', 'vision', 'fast', 'image'] as const) expect(resolveModel(after, undefined, r)!.target.model).toBe(resolveModel(before, undefined, r)!.target.model);
  });
  it('幂等，可降级回 v3 原样', () => {
    const before = v3();
    const once = upV3toV4(before);
    expect(upV3toV4(once)).toEqual(once);
    const back = downV4toV3(once);
    expect(back.schemaVersion).toBe(3);
    expect(back.roles).toEqual(before.roles);
    expect(ModelsMigrator.migrate<ModelsStateV3>(before).doc.main!.model).toBe('mimo-v2.5');
    expect(ModelsMigrator.migrate<ModelsStateV3>(once, 3).doc.roles.chat.primary!.model).toBe('mimo-v2.5');
  });
});
