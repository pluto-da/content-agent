/** 1.4.0 G22：8 个历史版本（0.8 / 0.9 / 0.10 / 0.11 / 1.0 / 1.1 / 1.2 / 1.3）备份 → 恢复 → 迁移 → 启用上市公司模式 → 使用 → 降级；迁移前快照、幂等、原数据不动；1.3 复盘转为案例卡。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { buildExport, DEFAULT_FILES, readListedState, findSecrets } from '@content-agent/shared';
import { resetLocalDb, db } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { saveModels } from '../local/store';
import { resetVfsForTests, getVfs } from '../v9/vfsBackend';
import { restoreBackup } from '../v9/backup';
import { registry } from '../v12/store';
import { enableGroup, getGroup } from '../v13/store';
import { migrateV14, rollbackV14 } from './migrate';
import { getListed, enableListed, conveneBoard, decideMotion, runInternalAudit, quarterBestPractice } from './store';

beforeEach(() => { cleanup(); resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); registry.resume(); });
async function mockModel() { await saveModels({ providers: [{ id: 'mock', label: '模拟', protocol: 'openai', baseURL: 'mock://local', apiKey: '', model: 'mock-omni' }], defaultProvider: 'mock', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } } as never); }
function backup(ver: string): Uint8Array {
  const extra: Record<string, string> = {
    'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu'], onboarded: true, backupHinted: true, hotSources: ['baidu'], schemaVersion: 2, flags: {} }),
    'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: `${ver} 的旧草稿`, body: '正文', status: 'pending' }]),
  };
  const files = [{ path: 'vfs/SOUL.md', content: DEFAULT_FILES['SOUL.md']! }, { path: 'vfs/AGENTS.md', content: DEFAULT_FILES['AGENTS.md']! }, { path: 'vfs/memory/preferences.md', content: `# 偏好\n- ${ver} 时记下的偏好：标题不要用问号\n` }];
  if (ver === '1.3.0') files.push({ path: 'vfs/config/group.json', content: JSON.stringify({ version: 1, enabled: true, name: '长鱼集团', okrCycle: 'bimonth', okrs: [{ id: 'okr-year', level: 'year', owner: 'chairman', title: '一年 1 万粉', krs: [], cycle: 'bimonth', period: '2026', public: true }], retros: [{ id: 'retro-1', subject: 'Q3 口播复盘', steps: { 目标回顾: '周更 3 条', 结果对比: '完成 2 条', 原因分析: '选题储备不足', 经验沉淀: '每周一储备 5 个选题' }, lessons: [{ text: '每周一先储备 5 个选题' }], at: '2026-09-30T00:00:00Z' }] }) });
  return buildExport(files, { appVersion: ver, extra }).zip;
}

describe('G22 8 个历史版本备份：恢复 → 迁移 → 使用 → 降级', () => {
  for (const ver of ['0.8.0', '0.9.0', '0.10.0', '0.11.0', '1.0.0', '1.1.0', '1.2.0', '1.3.0']) {
    it(`${ver} 备份`, async () => {
      const r = await act(async () => restoreBackup(backup(ver)));
      expect(r.errors).toEqual([]);
      expect((await db.getKV<{ at?: string }>('migrations.v14'))?.at).toBeTruthy();
      expect((await db.getKV<{ state: string | null }>('v14_snapshot'))).toBeTruthy();
      const v = await getVfs();
      const s0 = await getListed();
      expect(s0.enabled).toBe(false);
      if (ver === '1.3.0') {
        expect(s0.cases.map((c) => c.source)).toEqual(['retro:retro-1']);
        const g = await getGroup(); expect(g.okrs.map((o) => o.id)).toEqual(['okr-year']); expect(g.okrCycle).toBe('bimonth');
        expect(s0.board.reportsFrom).toEqual(['经营管理委员会', '人力资源委员会']);
      }
      expect((await v.read('memory/preferences.md'))?.content).toContain(`${ver} 时记下的偏好`);
      expect((await db.all('drafts')).length).toBe(1);
      // 使用：启用集团 + 上市公司模式，开董事会、批一项、内审、评一次最佳实践
      await mockModel();
      await enableGroup(ver === '1.3.0' ? '长鱼集团' : '我的集团');
      await enableListed();
      const ids = await conveneBoard();
      await decideMotion(ids[0]!, true);
      await runInternalAudit();
      if (ver === '1.3.0') expect(await quarterBestPractice()).toBe(1);
      expect(findSecrets(JSON.stringify(await getListed()), { strict: true })).toHaveLength(0);
      expect((await migrateV14()).skipped).toBe(true);
      // 降级：listed.json 按快照还原（这里是删除进回收站），最佳实践技能进回收站；原数据不动
      const rolled = await rollbackV14();
      expect(rolled).toContain('config/listed.json');
      expect(await v.read('config/listed.json')).toBeUndefined();
      if (ver === '1.3.0') expect(rolled.some((p) => p.startsWith('skills/best-practice-'))).toBe(true);
      expect(readListedState((await v.read('config/listed.json'))?.content).enabled).toBe(false);
      expect((await v.read('memory/preferences.md'))?.content).toContain(`${ver} 时记下的偏好`);
      expect((await db.all('drafts')).length).toBe(1);
      expect((await getGroup()).enabled).toBe(true);
    });
  }
});
