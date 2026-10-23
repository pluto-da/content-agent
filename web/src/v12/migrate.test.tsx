/** 1.2.0 E19：六个历史版本（0.9 / 0.10 / 0.11 / 1.0 / 1.1 / 1.2）备份 → 恢复 → 迁移 → 使用 → 降级；迁移前快照、幂等、原数据不动。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { buildExport, DEFAULT_FILES, readSuperState, isAgentPath } from '@content-agent/shared';
import { resetLocalDb, db } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { saveModels } from '../local/store';
import { resetVfsForTests, getVfs } from '../v9/vfsBackend';
import { restoreBackup } from '../v9/backup';
import { migrateV12, rollbackV12, agentsWithDuties, P1_MARK } from './migrate';
import { enableTemplate, delegate, getState, decide, registry } from './store';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); registry.resume(); });
async function mockModel() { await saveModels({ providers: [{ id: 'mock', label: '模拟', protocol: 'openai', baseURL: 'mock://local', apiKey: '', model: 'mock-omni' }], defaultProvider: 'mock', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } } as never); }
function backup(ver: string): Uint8Array {
  const extra: Record<string, string> = {
    'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu'], onboarded: true, backupHinted: true, hotSources: ['baidu'], schemaVersion: 2, flags: {} }),
    'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: `${ver} 的旧草稿`, body: '正文', status: 'pending' }]),
  };
  const files = [{ path: 'vfs/SOUL.md', content: DEFAULT_FILES['SOUL.md']! }, { path: 'vfs/AGENTS.md', content: DEFAULT_FILES['AGENTS.md']! }, { path: 'vfs/memory/preferences.md', content: `# 偏好\n- ${ver} 时记下的偏好：标题不要用问号\n` }];
  if (ver === '1.2.0') {
    files.push({ path: 'vfs/agents/reply-drafter/AGENT.md', content: '---\nid: reply-drafter\nname: 评论回复草稿员\ndescription: 只起草回复\nicon: chat\nversion: 3\npermissions: [L0, L1]\ntools: [reply_draft]\nskills: []\nbudget:\n  month: 5\n  perRun: 1\nmemory: shared\nplatforms: []\ndataSources: []\ncreatedBy: user\nenabled: true\n---\n# 评论回复草稿员\n只生成草稿。\n' });
    files.push({ path: 'vfs/config/super.json', content: JSON.stringify({ schemaVersion: 1, paused: false, concurrency: 2, goals: [{ id: 'g1', title: '涨粉 500', metric: 'followers', target: 500, unit: '粉', from: '2026-10-01', to: '2026-10-31', createdAt: '2026-10-01' }] }) });
  }
  return buildExport(files, { appVersion: ver, extra }).zip;
}

describe('E19 六个历史版本备份：恢复 → 迁移 → 使用 → 降级', () => {
  for (const ver of ['0.9.0', '0.10.0', '0.11.0', '1.0.0', '1.1.0', '1.2.0']) {
    it(`${ver} 备份`, async () => {
      const r = await act(async () => restoreBackup(backup(ver)));
      expect(r.errors).toEqual([]);
      const v = await getVfs();
      // 迁移：控制平面、指挥职责、内置平台只读模板；原数据不动
      expect((await v.read('super/SUPER.md'))?.content).toMatch(/指挥职责/);
      const s = await getState();
      expect(s.schemaVersion).toBe(1);
      expect((await v.read('platforms/xiaohongshu/PLATFORM.md'))?.content).toMatch(/readonly: true/);
      expect((await v.read('memory/preferences.md'))?.content).toContain(`${ver} 时记下的偏好`);
      expect((await v.read('AGENTS.md'))?.content).not.toContain(P1_MARK);
      expect((await db.all('drafts')).length).toBe(1);
      if (ver === '1.2.0') { expect(s.concurrency).toBe(2); expect(s.goals[0]!.title).toBe('涨粉 500'); expect((await v.list('agents')).some((f) => isAgentPath(f.path))).toBe(true); }
      // AGENTS.md 修订建议进收件箱（核心文件不直接改）
      const p1 = s.approvals.find((a) => a.kind === "core_file");
      expect(p1?.preview).toContain(P1_MARK);
      // 使用：启用子 Agent 并交办一次
      await mockModel(); await enableTemplate('topic-researcher');
      expect((await delegate('topic-researcher', '给三个选题')).ok).toBe(true);
      // 幂等
      expect((await migrateV12()).skipped).toBe(true);
      // 降级：迁移新建的文件进回收站，原有文件还原；用户之后新建的子 Agent 保留在 VFS（不属于迁移）
      const rolled = await rollbackV12();
      expect(rolled).toContain('platforms/xiaohongshu/PLATFORM.md');
      expect(await v.read('platforms/xiaohongshu/PLATFORM.md')).toBeUndefined();
      if (ver === '1.2.0') expect(readSuperState((await v.read('config/super.json'))?.content).concurrency).toBe(2);
      else expect(await v.read('config/super.json')).toBeUndefined();
      expect((await v.read('memory/preferences.md'))?.content).toContain(`${ver} 时记下的偏好`);
      expect((await db.all('drafts')).length).toBe(1);
    });
  }
  it('批准 P1 才写 AGENTS.md（用户确认后的版本，可回滚）', async () => {
    await act(async () => restoreBackup(backup('1.1.0')));
    const s = await getState();
    const p1 = s.approvals.find((a) => a.kind === 'core_file')!;
    await decide(p1.id, { type: 'approve' });
    const v = await getVfs();
    expect((await v.read('AGENTS.md'))?.content).toContain(P1_MARK);
    expect(agentsWithDuties((await v.read('AGENTS.md'))!.content)).toBe((await v.read('AGENTS.md'))!.content);
    expect((await v.read('AGENTS.md'))?.author).toBe('user_approved');
  });
});
