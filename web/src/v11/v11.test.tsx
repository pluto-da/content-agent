/** 1.1.0 验收测试（D7 / D8 / D9 / D10 / D12）：写作助手迁移为技能修订、自由创作默认、一稿多适配保留母稿、“我的”12 项与旧路由、硬边界同源、四个历史版本备份恢复 → 迁移 → 使用 → 降级。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { buildExport, DEFAULT_FILES, ModelsMigrator, resolveModel, type ModelsStateV3 } from '@content-agent/shared';
import { resetLocalDb, db } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { getModelsV3 } from '../local/store';
import { resetVfsForTests, getVfs } from '../v9/vfsBackend';
import { restoreBackup } from '../v9/backup';
import { migrateV11, rollbackV11, skillWithBody, profileFromMd, PROFILE_PATH } from './migrate';
import { platformSkill } from '../local/platformSkill';
import { routeSkill, toWritePlatform, TOOLS } from '../agent/tools';
import { getProfile, saveProfile, EMPTY_PROFILE } from '../agent/store';
import { HardBoundaries, boundaryLines } from './MePages';
import { ME_GROUPS, NAV } from '../nav';
import { parseHash, toHash } from '../route';
import { writePlatform, WRITE_TARGETS } from '../data/platforms';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); });

const XHS = 'skills/xiaohongshu-note/SKILL.md';

describe('D7 旧写作助手删除；覆盖迁移为技能修订（可回滚）', () => {
  it('覆盖正文 → 技能用户修订（保留 front matter 与 Schema），模型覆盖 → 按任务指定，写审计与成长记录；幂等', async () => {
    const s = await getModelsV3();
    s.accounts.push({ id: 'mimo', vendor: 'mimo', label: 'MiMo', baseURL: 'https://api.xiaomimimo.com/v1', region: 'cn', hasKey: true, models: [{ id: 'm1', accountId: 'mimo', model: 'mimo-v2.5', roles: ['chat', 'reason', 'vision'], source: 'manual', status: 'ok', addedAt: 0, updatedAt: 0 }] });
    await db.setKV('models_v3', s);
    await db.setKV('assistants', { xiaohongshu: { body: '## 步骤\n1. 我自己的小红书写法：开头先讲结论。', providerId: 'mimo', model: 'mimo-v2.5' }, unknown_platform: { body: 'x' } });
    const r = await migrateV11();
    expect(r.assistants.skills).toEqual([XHS]);
    expect(r.assistants.models).toEqual(['write:xiaohongshu']);
    const text = (await (await getVfs()).text(XHS))!;
    expect(text).toContain('我自己的小红书写法');
    expect(text).toContain('```json schema');
    expect(text).toMatch(/\nsource: user/);
    expect((await platformSkill('xiaohongshu'))!.userEdited).toBe(true);
    expect((await routeSkill('xiaohongshu')).name).toContain('你修订过的版本');
    expect(resolveModel(await getModelsV3(), 'write:xiaohongshu', 'chat')!.via).toBe('task');
    expect(await db.getKV('assistants')).toBeNull();
    expect((await db.all('proposals')).some((p) => (p as { target?: string }).target === XHS)).toBe(true);
    expect((await db.all('audit')).some((a) => /写作助手迁移/.test(String((a as { summary?: string }).summary)))).toBe(true);
    // 幂等：再跑一次不重复写
    const v = (await (await getVfs()).read(XHS))!.version;
    await migrateV11();
    expect((await (await getVfs()).read(XHS))!.version).toBe(v);
    // 技能版本历史可回滚到迁移前；kv 快照可整体回滚
    const vfs = await getVfs();
    await vfs.rollback(XHS, v - 1, 'user');
    expect((await vfs.text(XHS))).not.toContain('我自己的小红书写法');
    expect(await rollbackV11()).toContain('assistants');
    expect(await db.getKV('assistants')).toMatchObject({ xiaohongshu: { model: 'mimo-v2.5' } });
  });
  it('skillWithBody 只替换步骤正文', () => {
    const out = skillWithBody(DEFAULT_FILES[XHS]!, '新写法');
    expect(out).toContain('新写法'); expect(out).toContain('name: xiaohongshu-note'); expect(out).toContain('json schema');
  });
});

describe('D8 自由创作为默认；指定平台按技能；一稿多适配保留母稿', () => {
  it('不指定平台 = 自由创作；平台名 → 对应技能；技能文案是“发到××时怎么写”', async () => {
    expect(toWritePlatform(undefined)).toBe('free');
    expect(toWritePlatform('随便写写')).toBe('free');
    expect(toWritePlatform('小红书')).toBe('xiaohongshu');
    expect(WRITE_TARGETS[0]!.id).toBe('free');
    expect(writePlatform('free').skill).toBe('free-writing');
    expect((await routeSkill('free')).name).toBe('自由创作');
    expect((await platformSkill('free'))!.description).toMatch(/^自由创作/);
    for (const p of ['xiaohongshu', 'douyin_script', 'wechat_article', 'x_post']) expect((await platformSkill(p))!.description).toMatch(/^发到.+时怎么写/);
    const dw = TOOLS.find((t) => t.name === 'draft_write')!;
    expect((dw.parameters as { required: string[] }).required).toEqual(['topic']);
    expect(TOOLS.some((t) => t.name === 'draft_adapt')).toBe(true);
  });
  it('适配到两个平台：母稿不变，两篇适配稿 parent_id 指向母稿', async () => {
    const { adaptDraft } = await import('../local/generate');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: '适配标题', body: '适配正文'.repeat(20), tags: ['a', 'b', 'c'], image_prompts: ['1', '2', '3'], revenue_hypothesis: '假设' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await db.setKV('models', { providers: [{ id: 'x', label: 'X', protocol: 'openai', baseURL: 'https://x.test/v1', apiKey: 'sk-test-0000000000000000', model: 'x-chat' }], defaultProvider: 'x', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } });
    const mother = await db.insert('drafts', { platform: 'free', title: '母稿', body: '这是母稿正文', status: 'pending' });
    const out = await adaptDraft(Number(mother.id), ['xiaohongshu', 'x_post', 'free']);
    expect(out.map((r) => r.draft.platform)).toEqual(['xiaohongshu', 'x_post']);
    for (const r of out) expect(r.draft.parent_id).toBe(mother.id);
    expect(await db.get('drafts', Number(mother.id))).toMatchObject({ title: '母稿', body: '这是母稿正文', platform: 'free' });
  });
});

describe('D9 “我的”≤12 项，旧路由重定向，命令面板旧词可搜', () => {
  it('12 项；旧子页都重定向；旧名称能搜到', () => {
    const items = ME_GROUPS.flatMap((g) => g.items);
    expect(items.length).toBeLessThanOrEqual(12);
    const map: Record<string, string> = { '#me/agent': 'me/memory?tab=skills', '#me/sources': 'me/platforms?tab=sources', '#me/skills': 'me/memory?tab=skills', '#me/revenue': 'me/growth?tab=revenue', '#me/status': 'me/records?tab=status', '#me/audit': 'me/records?filter=recent', '#me/logs': 'me/records', '#me/settings': 'me/spend', '#me/backup': 'me/data', '#me/storage': 'me/data?tab=storage', '#settings/backup': 'me/data', '#agent/files': 'me/memory?tab=skills' };
    for (const [from, to] of Object.entries(map)) expect(toHash(parseHash(from))).toBe(to);
    expect(toHash(parseHash('#me/status/cards'))).toBe('me/status/cards');
    const find = (q: string) => NAV.filter((n) => `${n.label}${n.desc}${n.keywords ?? ''}`.includes(q)).map((n) => n.id);
    for (const w of ['写作助手', '审计', '运行状态', '存储', '数据源', '收益', '技能', '日志', '备份', '实验']) expect(find(w).length, w).toBeGreaterThan(0);
  });
});

describe('D10 硬边界只读，与 BOUNDARIES.md 同源', () => {
  it('界面逐条显示 BOUNDARIES.md 的编号条目；改文件（系统写入）后界面跟着变', async () => {
    const want = boundaryLines(DEFAULT_FILES['BOUNDARIES.md']!);
    expect(want.length).toBeGreaterThanOrEqual(15);
    render(<HardBoundaries />);
    await waitFor(() => expect(screen.getAllByTestId('boundary-line').length).toBe(want.length));
    expect(screen.getAllByTestId('boundary-line')[0]!.textContent).toBe(want[0]);
    await expect((await getVfs()).write('BOUNDARIES.md', 'x', { author: 'user' })).rejects.toThrow();
  });
});

describe('画像与 USER 同源', () => {
  it('保存画像 → 写 user/profile.md（带版本）；读取来自文件', async () => {
    await saveProfile({ ...EMPTY_PROFILE, positioning: '通勤效率', audience: '上班族' });
    const f = (await (await getVfs()).read(PROFILE_PATH))!;
    expect(f.content).toContain('通勤效率');
    expect(profileFromMd(f.content)!.audience).toBe('上班族');
    expect((await getProfile()).positioning).toBe('通勤效率');
    await saveProfile({ ...EMPTY_PROFILE, positioning: '二版' });
    expect((await (await getVfs()).read(PROFILE_PATH))!.version).toBe(f.version + 1);
  });
});

/* ---------------- D12：0.9 / 0.10 / 0.11 / 1.0 备份 → 恢复 → 迁移 → 使用 → 降级 ---------------- */
function legacyModels(ver: string): ModelsStateV3 {
  const acc = { id: 'ds', vendor: 'dashscope', label: '百炼', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', region: 'cn' as const, hasKey: true, keyTail: 'ABCD', secretRef: 'secret:ds', models: [
    { id: 'e1', accountId: 'ds', model: 'qwen3.7-plus', roles: ['chat', 'reason'] as never, source: 'manual' as const, status: 'ok' as const, addedAt: 0, updatedAt: 0 },
    { id: 'e2', accountId: 'ds', model: 'qwen-image', roles: ['image'] as never, source: 'manual' as const, status: 'ok' as const, addedAt: 0, updatedAt: 0 },
    { id: 'e3', accountId: 'ds', model: 'qwen-flash', roles: ['fast'] as never, source: 'manual' as const, status: 'untested' as const, addedAt: 0, updatedAt: 0 },
  ] };
  const t = (e: string, m: string) => ({ accountId: 'ds', modelEntryId: e, model: m });
  const roles = Object.fromEntries(['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'].map((r) => [r, { role: r, enabled: true }])) as ModelsStateV3['roles'];
  roles.chat.primary = t('e1', 'qwen3.7-plus'); roles.reason.primary = t('e1', 'qwen3.7-plus'); roles.image.primary = t('e2', 'qwen-image'); roles.fast.primary = t('e3', 'qwen-flash');
  if (ver !== '0.9.0') roles.image.tasks = { cover: t('e2', 'qwen-image') };   // 0.10 起有按任务路由
  return { schemaVersion: 3, accounts: [acc], roles, prices: {}, budget: { perCallConfirmYuan: 1, perDayConfirmYuan: 10, videoAlwaysConfirm: true, unknownPriceMediaConfirm: true }, keyPolicy: { scope: 'account' }, advanced: { thinking: 'off', temperature: null } };
}
function legacyBackup(ver: string): Uint8Array {
  const extra: Record<string, string> = {
    'kv/models_v3.json': JSON.stringify(legacyModels(ver)),
    'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu'], onboarded: true, backupHinted: true, hotSources: ['baidu', 'sspai'], schemaVersion: 2, flags: {} }),
    'kv/profile.json': JSON.stringify({ ...EMPTY_PROFILE, positioning: `${ver} 的定位`, redlines: ['不碰医疗'] }),
    'kv/assistants.json': JSON.stringify({ wechat_article: { body: `## 步骤\n1. ${ver} 时我改过的公众号写法` } }),
    'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: `${ver} 的旧草稿`, body: '正文', status: 'pending' }]),
  };
  const files = [{ path: 'vfs/SOUL.md', content: DEFAULT_FILES['SOUL.md']! }];
  return buildExport(files, { appVersion: ver, extra }).zip;
}

describe('D12 四个历史版本备份：恢复 → 迁移 → 使用 → 降级', () => {
  for (const ver of ['0.9.0', '0.10.0', '0.11.0', '1.0.0']) {
    it(`${ver} 备份`, async () => {
      const r = await act(async () => restoreBackup(legacyBackup(ver)));
      expect(r.errors).toEqual([]);
      // 迁移：模型 v3 → v4（主模型 = 出现最多的对话模型）；写作助手 → 技能修订；画像 → user/profile.md
      const s = await getModelsV3();
      expect(s.schemaVersion).toBe(4);
      expect(s.main!.model).toBe('qwen3.7-plus');
      expect(s.roles.fast.primary!.model).toBe('qwen-flash');
      expect((await getProfile()).positioning).toBe(`${ver} 的定位`);
      const wa = await platformSkill('wechat_article');
      expect(wa!.userEdited).toBe(true); expect(wa!.body).toContain(`${ver} 时我改过的公众号写法`);
      // 使用：各能力实际选中的模型与迁移前一致
      const before = legacyModels(ver);
      for (const role of ['chat', 'reason', 'image', 'fast'] as const) expect(resolveModel(s, undefined, role)!.target.model).toBe(resolveModel(before, undefined, role)!.target.model);
      if (ver !== '0.9.0') expect(resolveModel(s, 'cover', 'image')!.via).toBe('task');
      expect((await db.all('drafts')).length).toBe(1);
      // 降级：模型配置回到 v3 原样；kv 快照回滚写作助手覆盖与画像
      const down = ModelsMigrator.migrate<ModelsStateV3>(s, 3).doc;
      expect(down.schemaVersion).toBe(3);
      expect(down.roles).toEqual(before.roles);
      const rolled = await rollbackV11();
      expect(rolled).toEqual(expect.arrayContaining(['assistants']));
      expect(await db.getKV('assistants')).toMatchObject({ wechat_article: {} });
    });
  }
});
