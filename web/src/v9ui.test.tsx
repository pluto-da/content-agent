/** 0.9.0 界面测试：我的 → 模型（11 角色 5 组、账号与 Key、模型名手填原样发送、获取列表、错误白话）、试一试、Agent 设定（diff 确认 / 版本 / 恢复默认 / 只读）、记忆、技能、收益（表单 + CSV）、成长记录（采纳 / 回滚）、运行状态、审计、设置、提醒、备份。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ROLE_IDS, addModelEntry, bindRole, sha256, type ModelsStateV3, type RoleId, type Proposal } from '@content-agent/shared';
import { resetLocalDb, db } from './local/db';
import { resetSecureKey } from './local/secure';
import { getModelsV3, saveModelsV3, getPrefs } from './local/store';
import { resetVfsForTests, getVfs } from './v9/vfsBackend';
import { setSecret } from './local/secrets';
import { recordUsage, audit } from './v9/ops';
import { RolesPage } from './pages/me/v9/roles';
import { AgentSettingsPage, MemoryPage, SkillsPage } from './pages/me/v9/agentfiles';
import { RevenuePage, GrowthPage } from './pages/me/v9/revenue';
import { StatusPage, AuditPage, SettingsV9Page, RemindersPage, BackupV9Page } from './pages/me/v9/ops';
import { due, tick, listReminders } from './v9/reminders';
import { ME_GROUPS } from './nav';
import { parseHash } from './route';

const go = vi.fn();
beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); go.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

async function mockRoles(roles: RoleId[] = [...ROLE_IDS]): Promise<ModelsStateV3> {
  let s = await getModelsV3();
  s.accounts.push({ id: 'mock', vendor: 'mock', label: '模拟', baseURL: 'mock://local', region: 'test', models: [], hasKey: true });
  for (const r of roles) { const e = addModelEntry(s.accounts.find((x) => x.id === 'mock')!, { model: `mock-${r}`, roles: [r] }); if (e.ok) s = bindRole(s, r, 'primary', e.entry); }
  await saveModelsV3(s);
  return s;
}
function stubFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}
const typeIn = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

describe('导航与路由', () => {
  it('“我的”新增 Agent 组与运维项；#me/<新子页> 可直达', () => {
    expect(ME_GROUPS.map((g) => g.title)).toEqual(['工作', 'Agent', '通用']);
    for (const s of ['files', 'memory', 'skills', 'revenue', 'growth', 'reminders', 'status', 'audit', 'settings']) expect(parseHash(`#me/${s}`).sub).toBe(s);
    expect(parseHash('#me/models/image')).toEqual({ space: 'me', sub: 'models', id: 'image' });
  });
});

describe('C2 我的 → 模型：11 角色 5 组', () => {
  it('分组、顺序、状态与“已接 N / 11 类”', async () => {
    render(<RolesPage id={null} go={go} lay="phone" />);
    expect((await screen.findByTestId('roles-count')).textContent).toContain('0 / 11');
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups.slice(0, 5)).toEqual(['文字', '看与画', '声音', '视频', '检索']);
    for (const r of ROLE_IDS) expect(screen.getByTestId(`role-${r}`).textContent).toContain('未接');
    await act(async () => { await mockRoles(['chat', 'image', 'tts']); });
    await waitFor(() => expect(screen.getByTestId('roles-count').textContent).toContain('3 / 11'));
    expect(screen.getByTestId('role-image').textContent).toContain('mock-image');
  });
});

describe('C3 / C41 / C43 账号与 Key、模型名手填原样发送、错误白话', () => {
  it('添加 OpenAI 兼容服务商 → Key 只存加密存储（只显示末 4 位）→ 手填怪名字 → 自动测试的请求体 model 逐字相同', async () => {
    const calls = stubFetch(() => ({ status: 200, body: { id: 'x', model: 'served-other-name', choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } } }));
    const { unmount } = render(<RolesPage id="accounts" go={go} lay="phone" />);
    await screen.findByTestId('accounts');
    fireEvent.change(screen.getByTestId('vendor-select'), { target: { value: 'openai-compatible' } });
    typeIn(screen.getByTestId('acc-url'), 'https://llm.example.test/v1');
    typeIn(screen.getByTestId('acc-key'), 'sk-test-ui-ABCDEFGH9876');
    await act(async () => { fireEvent.click(screen.getByTestId('acc-add')); });
    await waitFor(() => expect(go).toHaveBeenCalledWith(expect.stringMatching(/^me\/models\/acc-/)));
    const s = await getModelsV3();
    expect(JSON.stringify(s)).not.toContain('ABCDEFGH9876');
    expect(s.accounts[0]!.keyTail).toBe('9876');
    unmount();
    const accId = s.accounts[0]!.id;
    render(<RolesPage id={`acc-${accId}`} go={go} lay="phone" />);
    await screen.findByTestId('account-detail');
    const weird = 'Qwen/Qwen3.7-Plus:Latest.V2';
    typeIn(screen.getByTestId('model-name'), `  ${weird}  `);
    await act(async () => { fireEvent.click(screen.getByTestId('add-model')); });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect((calls[0]!.body as { model: string }).model).toBe(weird);
    expect(calls[0]!.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(JSON.stringify(calls[0]!.body)).not.toContain('ABCDEFGH9876');
    await waitFor(async () => expect((await getModelsV3()).accounts[0]!.models[0]!.status).toBe('ok'));
    expect(await screen.findByText(/请求 Qwen\/Qwen3\.7-Plus:Latest\.V2 → 实际 served-other-name/)).toBeTruthy();
  });

  it('同一服务商添加 ≥3 个模型名并各勾不同能力；错误模型名白话报错 + 获取列表 / 改模型名，不切备用', async () => {
    stubFetch((_u, init) => {
      const b = JSON.parse(String(init.body ?? '{}'));
      if (b.model === 'qwen3.7-plsu') return { status: 404, body: { error: { message: 'The model `qwen3.7-plsu` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } } };
      return { status: 200, body: { choices: [{ message: { content: 'ok' } }], usage: {} } };
    });
    const s = await getModelsV3();
    s.accounts.push({ id: 'ds', vendor: 'dashscope', label: '百炼', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', region: 'cn', models: [], hasKey: true, secretRef: 'secret:ds' });
    await saveModelsV3(s);
    await setSecret('secret:ds', 'sk-test-ds-AAAABBBBCCCCDDDD');
    render(<RolesPage id="acc-ds" go={go} lay="phone" />);
    await screen.findByTestId('account-detail');
    const add = async (name: string, roles: RoleId[]) => {
      for (const r of ROLE_IDS) { const box = screen.getByTestId(`new-role-${r}`) as HTMLInputElement; if (box.checked !== roles.includes(r)) fireEvent.click(box); }
      typeIn(screen.getByTestId('model-name'), name);
      await act(async () => { fireEvent.click(screen.getByTestId('add-model')); });
    };
    await add('qwen-a', ['chat']); await add('qwen-b', ['fast']); await add('qwen-c', ['vision', 'reason']);
    await waitFor(async () => expect((await getModelsV3()).accounts[0]!.models.map((m) => [m.model, m.roles.join()])).toEqual([['qwen-a', 'chat'], ['qwen-b', 'fast'], ['qwen-c', 'reason,vision']]));
    await add('qwen3.7-plsu', ['chat']);
    const err = await screen.findByTestId('probe-error-qwen3.7-plsu-chat', {}, { timeout: 4000 });
    expect(err.textContent).toContain('模型名「qwen3.7-plsu」在这家服务里不存在');
    expect(within(err).getByRole('button', { name: '获取列表' })).toBeTruthy();
    expect(within(err).getByRole('button', { name: '改模型名' })).toBeTruthy();
    const st = await getModelsV3();
    expect(st.accounts[0]!.models.find((m) => m.model === 'qwen3.7-plsu')!.status).toBe('not_found');
  });

  it('C42 获取列表：可搜索多选添加；列表外的已加名字标黄“可能已下线或改名”；404 时提示手填且不阻塞', async () => {
    let listStatus = 200;
    stubFetch((url) => (url.endsWith('/models') ? (listStatus === 200 ? { status: 200, body: { data: [{ id: 'kimi-k3' }, { id: 'kimi-k3-thinking' }, { id: 'moonshot-x' }] } } : { status: 404, body: { error: { message: 'not found' } } }) : { status: 200, body: { choices: [{ message: { content: 'ok' } }] } }));
    const s = await getModelsV3();
    s.accounts.push({ id: 'k', vendor: 'kimi', label: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', region: 'cn', models: [], hasKey: true, secretRef: 'secret:k' });
    addModelEntry(s.accounts[0]!, { model: 'old-gone-model', roles: ['chat'] });
    await saveModelsV3(s);
    await setSecret('secret:k', 'sk-test-k-AAAABBBBCCCCDDDD');
    render(<RolesPage id="acc-k" go={go} lay="phone" />);
    await screen.findByTestId('account-detail');
    await act(async () => { fireEvent.click(screen.getByTestId('fetch-list')); });
    const list = await screen.findByTestId('model-list');
    typeIn(within(list).getByRole('textbox'), 'k3');
    expect(within(list).getAllByRole('checkbox').length).toBe(2);
    fireEvent.click(within(list).getAllByRole('checkbox')[0]!);
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: /添加所选/ })); });
    await waitFor(async () => expect((await getModelsV3()).accounts[0]!.models.map((m) => m.model)).toContain('kimi-k3'));
    expect((await getModelsV3()).accounts[0]!.models.find((m) => m.model === 'old-gone-model')!.status).toBe('not_in_list');
    expect(JSON.stringify(await getModelsV3())).not.toContain('moonshot-x');   // 列表缓存不进配置 / 导出
    listStatus = 404;
    await act(async () => { fireEvent.click(screen.getByTestId('fetch-list')); });
    expect((await screen.findByTestId('list-error')).textContent).toContain('这家服务没有提供模型列表，请手动填写');
  });
});

describe('C7 试一试（Mock）：直接调用能力层，共用记账与标识', () => {
  it('生图先确认花钱 → 出图（AI 生成标识）→ 记账；文本返回模型名与耗时', { timeout: 30000 }, async () => {
    await mockRoles();
    render(<RolesPage id="image" go={go} lay="desktop" />);
    await screen.findByTestId('role-detail-image');
    fireEvent.click(screen.getByTestId('tab-try'));
    typeIn(screen.getByTestId('try-input'), '一只橘猫');
    fireEvent.click(screen.getByTestId('try-run'));
    expect(await screen.findByTestId('try-confirm')).toBeTruthy();
    await act(async () => { fireEvent.click(within(screen.getByTestId('try-confirm')).getByRole('button', { name: '确认并调用' })); });
    const res = await screen.findByTestId('try-result', {}, { timeout: 5000 });
    expect(res.textContent).toContain('mock-image');
    await waitFor(() => expect(screen.getByTestId('try-result').textContent).toContain('AI 生成'), { timeout: 6000 });
    expect((await db.all('usage_log')).some((u) => u.role === 'image')).toBe(true);
    expect((await db.all('media')).length).toBe(1);
    cleanup();
    for (const r of ['chat', 'tts', 'embed', 'rerank'] as RoleId[]) {
      render(<RolesPage id={r} go={go} lay="desktop" />);
      await screen.findByTestId(`role-detail-${r}`);
      fireEvent.click(screen.getByTestId('tab-try'));
      typeIn(screen.getByTestId('try-input'), r === 'rerank' ? '猫' : '你好');
      await act(async () => { fireEvent.click(screen.getByTestId('try-run')); });
      if (r === 'tts') await act(async () => { fireEvent.click(within(await screen.findByTestId('try-confirm')).getByRole('button', { name: '确认并调用' })); });
      expect((await screen.findByTestId('try-result', {}, { timeout: 5000 })).textContent).toContain(`mock-${r}`);
      cleanup();
    }
  });
  it('角色页设置：默认 / 备用下拉来自勾选了该能力的模型名，切换后保存；未配置时给出下一步', async () => {
    render(<RolesPage id="video" go={go} lay="phone" />);
    expect((await screen.findByTestId('problem')).textContent).toContain('还没有能做这件事的模型名');
    cleanup();
    await mockRoles(['chat']);
    const s = await getModelsV3(); const r = addModelEntry(s.accounts[0]!, { model: 'mock-chat-2', roles: ['chat'] }); await saveModelsV3(s);
    render(<RolesPage id="chat" go={go} lay="phone" />);
    const sel = await screen.findByTestId('slot-fallback-select');
    await act(async () => { fireEvent.change(sel, { target: { value: r.ok ? r.entry.id : '' } }); });
    await waitFor(async () => expect((await getModelsV3()).roles.chat.fallback?.model).toBe('mock-chat-2'));
    expect(screen.getByTestId('return-chat').getAttribute('href')).toBe('#agent');
  });
});

describe('C30 Agent 设定：编辑先看 diff、版本、恢复默认、只读、加载预览', () => {
  it('编辑 SOUL.md → 显示改动 → 确认保存 → 版本 +1 且审计；恢复默认同样走确认；BOUNDARIES 只读', async () => {
    render(<AgentSettingsPage go={go} />);
    fireEvent.click(await screen.findByTestId('file-USER.md', {}, { timeout: 8000 }));
    const ta = await screen.findByTestId('file-text') as HTMLTextAreaElement;
    const before = ta.value;
    typeIn(ta, `${before}\n- 测试偏好：标题不要感叹号\n`);
    fireEvent.click(screen.getByTestId('file-save'));
    expect((await screen.findByTestId('diff')).textContent).toContain('+ - 测试偏好：标题不要感叹号');
    await act(async () => { fireEvent.click(screen.getByTestId('confirm-save')); });
    await waitFor(async () => expect((await (await getVfs()).text('USER.md'))).toContain('测试偏好'));
    expect((await (await getVfs()).read('USER.md'))!.version).toBe(2);
    expect((await db.all('audit')).some((a) => a.kind === 'system_file_change' && String(a.summary).includes('USER.md'))).toBe(true);
    fireEvent.click(await screen.findByTestId('file-reset'));
    await act(async () => { fireEvent.click(await screen.findByTestId('confirm-save')); });
    await waitFor(async () => expect((await (await getVfs()).text('USER.md'))).not.toContain('测试偏好'));
    cleanup();
    render(<AgentSettingsPage go={go} />);
    fireEvent.click(await screen.findByTestId('file-BOUNDARIES.md', {}, { timeout: 8000 }));
    expect(((await screen.findByTestId('file-text')) as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByTestId('file-save')).toBeNull();
  });
  it('加载预览：顺序来自 SYSTEM.md；选题类句子按需加载 semiotics，简单任务不加载', async () => {
    render(<AgentSettingsPage go={go} />);
    await screen.findByTestId('agent-settings', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('tab-preview'));
    const p = await screen.findByTestId('load-preview');
    const items = within(p).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items[0]).toContain('SYSTEM.md'); expect(items.findIndex((x) => x.includes('BOUNDARIES.md'))).toBeLessThan(items.findIndex((x) => x.includes('SOUL.md')));
    expect(p.textContent).toContain('semiotics/PRINCIPLES.md');
    typeIn(within(p).getByRole('textbox'), '改短');
    expect(p.textContent).toContain('简单任务不加载');
  });
});

describe('C16 / C35 记忆、C15 技能', () => {
  it('记忆可编辑、删除；“忘掉”后复查命中 0 并写入不要记住', async () => {
    await db.insert('memories', { id: 'm1', text: '大哥喜欢短标题', scope: 'global', source: 'user_said', confidence: 'stated', active: true, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' });
    await db.insert('memories', { id: 'm2', text: '可能偏好早上发布', scope: 'global', source: 'inferred', confidence: 'inferred', active: true, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' });
    render(<MemoryPage />);
    expect(await screen.findByText('大哥喜欢短标题')).toBeTruthy();
    expect(screen.getAllByText(/推断/).length).toBeGreaterThan(0);
    typeIn(screen.getByLabelText('搜索记忆'), '短标题');
    await act(async () => { fireEvent.click(screen.getByTestId('forget')); });
    await waitFor(async () => expect((await db.all('memories')).length).toBe(1));
    expect(await db.getKV('memory.dontRemember')).toEqual(['短标题']);
    expect((await (await getVfs()).text('MEMORY.md'))).toContain('短标题');
  });
  it('技能列表：内置技能可停用 / 启用（写版本并审计）', async () => {
    render(<SkillsPage go={go} />);
    const page = await screen.findByTestId('skills-page', {}, { timeout: 8000 });
    const box = within(page).getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => { fireEvent.click(box); });
    await waitFor(async () => expect((await db.all('audit')).some((a) => String(a.summary).startsWith('停用技能'))).toBe(true));
  });
});

describe('C46 / C47 收益：表单 + CSV（预览 → 确认 → hash 去重）+ 归因', () => {
  it('表单录入带凭据；CSV 导入预览后确认；同一文件再导入提示已导入过', async () => {
    render(<RevenuePage />);
    expect(await screen.findByText('还没有收入数据')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tab-form'));
    typeIn(screen.getByTestId('rev-amount'), '12.5');
    await act(async () => { fireEvent.click(screen.getByTestId('rev-save')); });
    expect((await screen.findByTestId('revenue-total')).textContent).toContain('¥12.50');
    const rec = (await db.all('revenue'))[0]!;
    expect((rec.source as { kind: string }).kind).toBe('user_entered');
    fireEvent.click(screen.getByTestId('tab-import'));
    const csv = '日期,金额,平台,作品ID\n2026-10-20,30,xiaohongshu,d1\n2026-10-21,"1,000.00",douyin,d2\n坏行,x,,\n';
    const file = new File([csv], 'export.csv', { type: 'text/csv' });
    await act(async () => { fireEvent.change(screen.getByTestId('rev-file'), { target: { files: [file] } }); });
    await act(async () => { fireEvent.click(await screen.findByTestId('rev-preview')); });
    expect((await screen.findByTestId('rev-preview-result')).textContent).toContain('可导入 2 条');
    await act(async () => { fireEvent.click(screen.getByTestId('rev-confirm')); });
    await waitFor(async () => expect((await db.all('revenue')).length).toBe(3));
    expect((await screen.findByTestId('attr-direct')).textContent).toContain('1030.00');
    expect(screen.getAllByText(/分摊估计/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('tab-import'));
    await act(async () => { fireEvent.change(screen.getByTestId('rev-file'), { target: { files: [new File([csv], 'export.csv')] } }); });
    await act(async () => { fireEvent.click(await screen.findByTestId('rev-preview')); });
    expect(await screen.findByText('这个文件已经导入过')).toBeTruthy();
  });
});

describe('C49 / C51 成长记录：先看 diff 再采纳，可一键回滚；页顶诚实声明', () => {
  it('采纳 → 目标文件版本 +1、EVOLUTION 追加；回滚恢复原文', async () => {
    const v = await getVfs();
    const before = (await v.text('TOOLS.md'))!;
    const after = `${before}\n- 标题先给 3 个候选\n`;
    const p: Proposal = { id: `P-20261023-${sha256(after).slice(0, 6)}`, kind: 'system_file', target: 'TOOLS.md', before, after, basedOn: [], evidenceLevel: 'user', status: 'pending', reason: '你说过标题要多给几个', createdAt: new Date().toISOString() };
    await db.insert('proposals', p as unknown as Record<string, unknown>);
    render(<GrowthPage />);
    expect((await screen.findByTestId('growth-disclaimer')).textContent).toContain('不是模型本身在变化');
    expect((await screen.findByTestId('diff')).textContent).toContain('标题先给 3 个候选');
    expect(await v.text('TOOLS.md')).toBe(before);   // 未确认不生效
    await act(async () => { fireEvent.click(screen.getByTestId('proposal-approve')); });
    await waitFor(async () => expect(await v.text('TOOLS.md')).toContain('标题先给 3 个候选'));
    expect(await v.text('EVOLUTION.md')).toContain(`采纳 ${p.id}`);
    await act(async () => { fireEvent.click(await screen.findByTestId('proposal-rollback')); });
    await waitFor(async () => expect(await v.text('TOOLS.md')).not.toContain('标题先给 3 个候选'));
    for (const tab of ['board', 'trend', 'learned']) { fireEvent.click(screen.getByTestId(`tab-${tab}`)); }
    expect(screen.getByTestId('growth-learned').textContent).toContain('还没有经过验证');
  });
});

describe('运行状态 / 审计 / 设置 / 提醒 / 备份', () => {
  it('运行状态用 modelStats：调用、延迟、费用、缓存命中、错误率', async () => {
    const at = new Date().toISOString();
    await recordUsage({ at, role: 'chat', vendor: 'mimo', model: 'mimo-v2.6-flash', requestedModel: 'mimo-v2.6-flash', usage: { input: 10, output: 5 }, cost: 0.002, ms: 1200, ok: true });
    await recordUsage({ at, role: 'chat', vendor: 'mimo', model: 'mimo-v2.6-flash', requestedModel: 'mimo-v2.6-flash', usage: {}, cost: 0, ms: 0, ok: false, errorKind: 'timeout' });
    await recordUsage({ at, role: 'chat', vendor: 'mimo', model: 'mimo-v2.6-flash', requestedModel: 'mimo-v2.6-flash', usage: {}, cost: 0, ms: 3, ok: true, fromCache: true });
    render(<StatusPage go={go} />);
    const totals = await screen.findByTestId('status-totals');
    expect(totals.textContent).toContain('3'); expect(totals.textContent).toContain('33.3%');
    expect((await screen.findByTestId('status-models')).textContent).toMatch(/mimo-v2\.6-flash.*p50 1\.2s.*最近错误 timeout/);
  });
  it('审计日志：筛选 + 导出 CSV（打码、不含 Key）', async () => {
    await audit({ kind: 'approval', actor: 'user', summary: '允许生图 sk-test-should-redact-1234567890', outcome: 'ok' });
    await audit({ kind: 'tool_call', actor: 'agent', summary: 'image_generate：成功', outcome: 'ok' });
    let blob: Blob | null = null;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { blob = b; return 'blob:x'; }, revokeObjectURL: () => {} }));
    render(<AuditPage />);
    expect((await screen.findByTestId('audit-list')).querySelectorAll('li').length).toBe(2);
    fireEvent.change(screen.getByTestId('audit-kind'), { target: { value: 'approval' } });
    await waitFor(() => expect(screen.getByTestId('audit-list').querySelectorAll('li').length).toBe(1));
    expect(screen.getByTestId('audit-list').textContent).not.toContain('should-redact-1234567890');
    await act(async () => { fireEvent.click(screen.getByTestId('audit-csv')); });
    const text = await blob!.text();
    expect(text).toContain('approval'); expect(text).not.toContain('1234567890');
  });
  it('设置：花钱阈值默认 ¥1 / ¥10，可改并同步到模型预算；视频确认锁定；预留开关不可开', async () => {
    render(<SettingsV9Page />);
    expect(((await screen.findByTestId('spend-call')) as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('spend-day') as HTMLInputElement).value).toBe('10');
    typeIn(screen.getByTestId('spend-call'), '0.5'); typeIn(screen.getByTestId('spend-day'), '20');
    await act(async () => { fireEvent.click(screen.getByTestId('spend-save')); });
    await waitFor(async () => expect((await getPrefs()).spend).toEqual({ perCallConfirmYuan: 0.5, perDayConfirmYuan: 20 }));
    expect((await getModelsV3()).budget.perDayConfirmYuan).toBe(20);
    expect((screen.getByLabelText('视频每次确认') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('flag-sync.server') as HTMLInputElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByTestId('flag-search.vector')); });
    await waitFor(async () => expect((await getPrefs()).flags?.['search.vector']).toBe(true));
  });
  it('提醒：新建、到点只发通知（不执行动作）、重复提醒排下一次', async () => {
    render(<RemindersPage />);
    typeIn(await screen.findByTestId('rem-text'), '看昨天的数据');
    typeIn(screen.getByTestId('rem-when'), '明早 9 点');
    await act(async () => { fireEvent.click(screen.getByTestId('rem-add')); });
    expect((await screen.findByTestId('rem-list')).textContent).toContain('看昨天的数据');
    const list = await listReminders();
    const later = new Date(Date.parse(list[0]!.at!) + 60000);
    expect(due(list, new Date()).fire.length).toBe(0);
    expect(due(list, later).fire.length).toBe(1);
    const sent: string[] = [];
    expect(await tick(later, async (_t, b) => { sent.push(b); return true; })).toBe(1);
    expect(sent).toEqual(['看昨天的数据']);
    expect((await listReminders())[0]!.status).toBe('fired');
    expect(await tick(new Date(later.getTime() + 864e5), async () => true)).toBe(0);
  });
  it('备份页：zip 导出（不再提供“同时导出 API Key”）', async () => {
    render(<BackupV9Page />);
    await screen.findByTestId('backup-v9');
    expect(screen.queryByText(/同时导出 API Key/)).toBeNull();
    expect(screen.getByTestId('export-zip').textContent).toContain('.zip');
  });
});
