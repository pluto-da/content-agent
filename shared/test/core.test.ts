import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256, bytesToBase64, base64ToBytes, Registry, Migrator, MigrationError, compatRead, flagOn, resolveFlags, sanitizeFlagOverrides, FLAGS, t, missingIds, findSecrets, redact, redactDeep, makeAudit, filterAudit, auditToCsv, auditToJsonl, decideSync, DisabledSync, parseWhenZh, nextWeekly, shDateTime, ALL_MIGRATORS, BackupMigrator, PrefsMigrator, EXTENSION_POINTS, registerPlatforms, PLATFORMS } from '../src/index.js';

describe('hash / base64', () => {
  it('sha256 与 node:crypto 一致（含中文、空串、长串）', () => {
    for (const s of ['', 'abc', '超级工作台', 'x'.repeat(1000), '🙂'.repeat(70)]) expect(sha256(s)).toBe(createHash('sha256').update(s).digest('hex'));
  });
  it('base64 往返', () => { const u = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256); expect(base64ToBytes(bytesToBase64(u))).toEqual(u); expect(bytesToBase64(new Uint8Array([104, 105]))).toBe(Buffer.from('hi').toString('base64')); });
});

describe('Registry（扩展点）', () => {
  it('重复注册报错、冻结后不能注册、id 校验', () => {
    const r = new Registry<{ id: string }>('测试');
    r.register({ id: 'a' });
    expect(() => r.register({ id: 'a' })).toThrow(/重复/);
    expect(() => r.register({ id: 'bad id' })).toThrow(/不合法/);
    r.freeze();
    expect(() => r.register({ id: 'b' })).toThrow(/冻结/);
    expect(r.must('a').id).toBe('a');
    expect(() => r.must('zz')).toThrow();
  });
  it('平台注册只有打开官方页 / App、复制、检查能力（无自动发布）', () => {
    registerPlatforms([{ id: 'xhs-test', label: '小红书', url: 'https://creator.xiaohongshu.com/', publishUrl: 'https://creator.xiaohongshu.com/publish/publish', hosts: [] }]);
    expect(PLATFORMS.get('xhs-test')!.capabilities).not.toContain('publish' as never);
    expect(EXTENSION_POINTS.map((e) => e.id)).toEqual(expect.arrayContaining(['model-adapter', 'model-role', 'agent-tool', 'skill', 'platform', 'feature-flag', 'migration', 'sync', 'locale']));
  });
});

describe('迁移框架（前滚 / 回滚 / 未来版本只读）', () => {
  const m = new Migrator<{ schemaVersion: 3; a: number; b: string; c: boolean }>('t', 3, 1)
    .add({ from: 1, to: 2, name: 'add b', up: (d: any) => ({ ...d, b: 'x' }), down: (d: any) => { const { b: _b, ...r } = d; return r; } })
    .add({ from: 2, to: 3, name: 'add c', up: (d: any) => ({ ...d, c: true }), down: (d: any) => { const { c: _c, ...r } = d; return r; } });
  it('1→3 前滚、3→1 回滚、down(up(x)) 等于 x', () => {
    const up = m.migrate({ schemaVersion: 1, a: 1 });
    expect(up.doc).toEqual({ schemaVersion: 3, a: 1, b: 'x', c: true });
    expect(up.applied).toEqual(['↑add b', '↑add c']);
    const down = m.migrate(up.doc, 1);
    expect(down.doc).toEqual({ schemaVersion: 1, a: 1 });
  });
  it('幂等：重复迁移到最新不再变化', () => { const a = m.migrate({ schemaVersion: 1, a: 1 }).doc; expect(m.migrate(a).doc).toEqual(a); expect(m.migrate(a).applied).toEqual([]); });
  it('未来版本：migrate 报错，compatRead 只读', () => {
    expect(() => m.migrate({ schemaVersion: 9 })).toThrow(MigrationError);
    const r = compatRead(m, { schemaVersion: 9, z: 1 });
    expect(r.readOnly).toBe(true);
    expect((r.doc as any).z).toBe(1);
  });
  it('缺步骤与非相邻步骤被拒', () => {
    expect(() => new Migrator('x', 3).add({ from: 1, to: 3, name: 'skip', up: (d) => d, down: (d) => d })).toThrow(/相邻/);
    const gap = new Migrator('x', 3).add({ from: 1, to: 2, name: 'a', up: (d) => d, down: (d) => d });
    expect(gap.validate()).toEqual(['2→3']);
    expect(() => gap.migrate({ schemaVersion: 1 })).toThrow(/缺少/);
  });
  it('所有注册的迁移器步骤连续', () => { for (const mm of ALL_MIGRATORS) expect(mm.validate()).toEqual([]); });
  it('备份 v1→v3 去掉任何 apiKeys 字段，v3→v1 回滚', () => {
    const v3 = BackupMigrator.migrate<any>({ schemaVersion: 1, drafts: [1], apiKeys: { x: 'sk-xxx' } }).doc;
    expect(v3.apiKeys).toBeUndefined(); expect(v3.conversations).toEqual([]); expect(v3.vfs).toBeNull();
    const v1 = BackupMigrator.migrate<any>(v3, 1).doc; expect(v1.vfs).toBeUndefined(); expect(v1.drafts).toEqual([1]);
  });
  it('偏好 v1↔v2：默认花钱阈值 ¥1 / ¥10、Key 默认按账号共用', () => {
    const v2 = PrefsMigrator.migrate<any>({ platforms: ['xiaohongshu'] }).doc;
    expect(v2.spend).toEqual({ perCallConfirmYuan: 1, perDayConfirmYuan: 10 }); expect(v2.keyPolicy).toBe('account');
    expect(PrefsMigrator.migrate<any>(v2, 1).doc).toEqual({ platforms: ['xiaohongshu'], schemaVersion: 1 });
  });
});

describe('特性开关', () => {
  it('默认值、覆盖、reserved 强制关闭、未知 id 关闭', () => {
    expect(flagOn('agent.planner')).toBe(true);
    expect(flagOn('agent.planner', { 'agent.planner': false })).toBe(false);
    expect(flagOn('sync.server', { 'sync.server': true })).toBe(false);
    expect(flagOn('no.such.flag', { 'no.such.flag': true })).toBe(false);
    expect(Object.keys(resolveFlags()).length).toBe(FLAGS.list().length);
    expect(sanitizeFlagOverrides({ 'sync.server': true, 'agent.planner': false, x: true } as never)).toEqual({ 'agent.planner': false });
  });
});

describe('文案集中 i18n', () => {
  it('插值、英文缺失回退中文、未知 id 原样', () => {
    expect(t('err.model_not_found', { model: 'qwen3.7-plsu' })).toContain('模型名「qwen3.7-plsu」在这家服务里不存在');
    expect(t('agent.stopped', {}, 'en')).toMatch(/Stopped/);
    expect(t('err.quota', { vendor: '智谱' }, 'en')).toContain('智谱余额不足');
    expect(t('nope.id')).toBe('nope.id');
    expect(missingIds('en').length).toBeGreaterThan(0);
  });
});

describe('密钥识别与打码', () => {
  const key = 'sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
  it('识别常见密钥并打码', () => {
    expect(findSecrets(`key=${key}`).length).toBeGreaterThan(0);
    expect(redact(`Authorization: Bearer ${key}`)).not.toContain(key);
    expect(redact('普通文本 qwen3.7-plus')).toBe('普通文本 qwen3.7-plus');
    expect(redactDeep({ apiKey: key, nested: { msg: `用 ${key}` } })).toEqual({ apiKey: '***', nested: { msg: '用 ***' } });
  });
});

describe('审计日志', () => {
  it('打码、筛选、导出 CSV / JSONL', () => {
    const k = 'sk-' + 'Z'.repeat(24);
    const list = [makeAudit({ kind: 'tool_call', actor: 'agent', summary: `调用 image_generate ${k}`, tool: 'image_generate', cost: 0.2 }), makeAudit({ kind: 'approval', actor: 'user', summary: '允许视频生成', outcome: 'ok' })];
    expect(list[0]!.summary).not.toContain(k);
    expect(filterAudit(list, { kinds: ['approval'] })).toHaveLength(1);
    expect(filterAudit(list, { text: 'image' })).toHaveLength(1);
    expect(auditToCsv(list).split('\n')[0]).toBe('at,kind,actor,summary,outcome,tool,cost,target,runId');
    expect(auditToJsonl(list).trim().split('\n')).toHaveLength(2);
  });
});

describe('同步（预留，默认关闭）', () => {
  it('DisabledSync 不做任何事', async () => { expect((await DisabledSync.status()).enabled).toBe(false); expect(await DisabledSync.push([])).toEqual({ ok: false, reason: 'disabled' }); });
  it('冲突裁决：单边修改同步、双边修改出 conflict 副本、system_only 本机为准', () => {
    const base = { hash: 'h0' };
    expect(decideSync({ path: 'a.md', version: 2, hash: 'h1', updated: '' }, { path: 'a.md', version: 1, hash: 'h0', updated: '' }, base)).toEqual({ action: 'push' });
    expect(decideSync({ path: 'a.md', version: 1, hash: 'h0', updated: '' }, { path: 'a.md', version: 2, hash: 'h2', updated: '' }, base)).toEqual({ action: 'pull' });
    const c = decideSync({ path: 'a.md', version: 2, hash: 'h1', updated: '' }, { path: 'a.md', version: 2, hash: 'h2', updated: '' }, base, new Date('2026-10-23T08:00:00Z'));
    expect(c).toEqual({ action: 'conflict', conflictPath: 'a.conflict-20261023T080000.md' });
    expect(decideSync({ path: 'x', version: 1, hash: 'a', updated: '', editable: 'system_only' }, { path: 'x', version: 1, hash: 'b', updated: '' }, base).action).toBe('push');
  });
});

describe('时间（Asia/Shanghai，相对日期由代码计算）', () => {
  const now = new Date('2026-10-23T07:33:00Z'); // 北京时间 周五 15:33
  it('明早 9 点', () => { const r = parseWhenZh('明早9点提醒我发这篇', now)!; expect(shDateTime(r.at!)).toBe('2026-10-24 09:00'); expect(r.text).toContain('2026-10-24（周六）09:00'); });
  it('下周一上午十点', () => { const r = parseWhenZh('下周一上午十点', now)!; expect(shDateTime(r.at!)).toBe('2026-10-26 10:00'); });
  it('今晚 8 点半', () => { expect(shDateTime(parseWhenZh('今晚8点半', now)!.at!)).toBe('2026-10-23 20:30'); });
  it('30 分钟后', () => { expect(parseWhenZh('30分钟后', now)!.at!.getTime() - now.getTime()).toBe(30 * 60000); });
  it('每周一 9 点 → rrule，下一次是 10-26', () => { const r = parseWhenZh('每周一9点提醒我看数据', now)!; expect(r.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0'); expect(shDateTime(nextWeekly(r.rrule!, now)!)).toBe('2026-10-26 09:00'); });
  it('解析不出返回 null（让 Agent 问）', () => { expect(parseWhenZh('过阵子', now)).toBeNull(); });
  it('3 点（已过）→ 明天 3 点', () => { expect(shDateTime(parseWhenZh('3点提醒我', now)!.at!)).toBe('2026-10-24 03:00'); });
});
