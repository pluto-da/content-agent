/** 1.3.0 F19：8 个历史版本（0.8 / 0.9 / 0.10 / 0.11 / 1.0 / 1.1 / 1.2 / 1.3）备份 → 恢复 → 迁移 → 启用集团 → 使用 → 降级；迁移前快照、幂等、原数据不动。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { buildExport, DEFAULT_FILES, readGroupState, findSecrets } from '@content-agent/shared';
import { resetLocalDb, db } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { saveModels } from '../local/store';
import { resetVfsForTests, getVfs } from '../v9/vfsBackend';
import { restoreBackup } from '../v9/backup';
import { registry } from '../v12/store';
import { migrateV13, rollbackV13 } from './migrate';
import { enableGroup, getGroup, createMeeting, runMeetingNow } from './store';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); registry.resume(); });
async function mockModel() { await saveModels({ providers: [{ id: 'mock', label: '模拟', protocol: 'openai', baseURL: 'mock://local', apiKey: '', model: 'mock-omni' }], defaultProvider: 'mock', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } } as never); }
function backup(ver: string): Uint8Array {
  const extra: Record<string, string> = {
    'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu'], onboarded: true, backupHinted: true, hotSources: ['baidu'], schemaVersion: 2, flags: {} }),
    'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: `${ver} 的旧草稿`, body: '正文', status: 'pending' }]),
  };
  const files = [{ path: 'vfs/SOUL.md', content: DEFAULT_FILES['SOUL.md']! }, { path: 'vfs/AGENTS.md', content: DEFAULT_FILES['AGENTS.md']! }, { path: 'vfs/memory/preferences.md', content: `# 偏好\n- ${ver} 时记下的偏好：标题不要用问号\n` }];
  if (ver === '1.2.0' || ver === '1.3.0') files.push({ path: 'vfs/agents/reply-drafter/AGENT.md', content: '---\nid: reply-drafter\nname: 评论回复草稿员\ndescription: 只起草回复\nicon: chat\nversion: 3\npermissions: [L0, L1]\ntools: [reply_draft]\nskills: []\nbudget:\n  month: 5\n  perRun: 1\nmemory: shared\nplatforms: []\ndataSources: []\ncreatedBy: user\nenabled: true\n---\n# 评论回复草稿员\n只生成草稿。\n' });
  if (ver === '1.3.0') files.push({ path: 'vfs/config/group.json', content: JSON.stringify({ version: 1, enabled: true, name: '长鱼集团', okrCycle: 'bimonth' }) });
  return buildExport(files, { appVersion: ver, extra }).zip;
}

describe('F19 8 个历史版本备份：恢复 → 迁移 → 使用 → 降级', () => {
  for (const ver of ['0.8.0', '0.9.0', '0.10.0', '0.11.0', '1.0.0', '1.1.0', '1.2.0', '1.3.0']) {
    it(`${ver} 备份`, async () => {
      const r = await act(async () => restoreBackup(backup(ver)));
      expect(r.errors).toEqual([]);
      // 恢复备份后已自动迁移（快照、默认关闭）
      expect((await db.getKV<{ at?: string }>('migrations.v13'))?.at).toBeTruthy();
      const v = await getVfs();
      const s0 = await getGroup();
      expect(s0.enabled).toBe(ver === '1.3.0');
      if (ver === '1.3.0') { expect(s0.name).toBe('长鱼集团'); expect(s0.okrCycle).toBe('bimonth'); }
      expect((await v.read('memory/preferences.md'))?.content).toContain(`${ver} 时记下的偏好`);
      expect((await db.all('drafts')).length).toBe(1);
      // 使用：启用集团、开一次会
      await mockModel();
      await enableGroup(ver === '1.3.0' ? '长鱼集团' : '我的集团');
      const g = await getGroup();
      if (ver === '1.2.0' || ver === '1.3.0') expect(g.org.depts.find((d) => d.id === 'user-ops')?.members).toContain('reply-drafter');
      const id = await createMeeting({ roomId: 'review', title: '选题评审', participants: ['bu-video-head', 'legal-head'] });
      expect((await runMeetingNow(id)).status).toBe('closed');
      expect(findSecrets(JSON.stringify(await getGroup()), { strict: true })).toHaveLength(0);
      // 幂等
      expect((await migrateV13()).skipped).toBe(true);
      // 降级：company/ 进回收站；group.json 按快照还原；原数据不动
      const rolled = await rollbackV13();
      expect(rolled.length).toBeGreaterThan(0);
      expect((await v.list('company')).length).toBe(0);
      if (ver === '1.3.0') expect(readGroupState((await v.read('config/group.json'))?.content).name).toBe('长鱼集团');
      else expect(await v.read('config/group.json')).toBeUndefined();
      expect((await v.read('memory/preferences.md'))?.content).toContain(`${ver} 时记下的偏好`);
      expect((await db.all('drafts')).length).toBe(1);
    });
  }
});
