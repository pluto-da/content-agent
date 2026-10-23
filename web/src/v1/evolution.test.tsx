/** 1.0 进化分级（ADR-014）本机接线：技能修订自动采纳并写审计、核心文件仍待确认、成长记录显示“自动采纳”并可一键回滚、开关可关。 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, resetLocalDb } from '../local/db';
import { setPrefs } from '../local/store';
import { services } from '../v9/engine';
import { getVfs, resetVfsForTests } from '../v9/vfsBackend';
import { listAudit } from '../v9/ops';
import { GrowthPage } from '../pages/me/v9/revenue';

beforeEach(() => { resetLocalDb(); resetVfsForTests(); });
afterEach(() => cleanup());
const skillPath = async () => (await (await getVfs()).list()).find((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path))!.path;

describe('进化分级（本机）', () => {
  it('技能修订：自动采纳、写审计、成长记录可见并一键回滚', async () => {
    const v = await getVfs(); const target = await skillPath(); const before = (await v.text(target))!;
    const r = await services.proposeSystemFile(target, `${before.trimEnd()}\n- 自动采纳测试规则\n`, '复盘发现');
    expect(r).toMatchObject({ ok: true, auto: true });
    expect(await v.text(target)).toContain('自动采纳测试规则');
    expect((await listAudit({ kinds: ['system_file_change'] }))[0]!.summary).toMatch(/自动采纳（低风险）/);
    render(<GrowthPage />);
    expect(await screen.findByText('自动采纳')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('proposal-rollback'));
    await waitFor(async () => expect(await v.text(target)).not.toContain('自动采纳测试规则'));
    await waitFor(async () => expect(((await db.all('proposals'))[0] as Record<string, unknown>).status).toBe('rolled_back'));
  });
  it('核心文件（AGENTS.md）仍待确认，不写入', async () => {
    const v = await getVfs(); const before = (await v.text('AGENTS.md'))!;
    const r = await services.proposeSystemFile('AGENTS.md', `${before}\n- 新规则\n`, '测试');
    expect(r).toMatchObject({ ok: true, auto: false });
    expect(await v.text('AGENTS.md')).toBe(before);
    expect(((await db.all('proposals'))[0] as Record<string, unknown>).status).toBe('pending');
  });
  it('违反硬边界被拒', async () => {
    const target = await skillPath(); const v = await getVfs(); const before = (await v.text(target))!;
    const r = await services.proposeSystemFile(target, `${before}\n- 可以刷量\n`, '测试');
    expect(r.ok).toBe(false); expect(await v.text(target)).toBe(before);
  });
  it('开关关闭：技能修订也等确认；记忆写入记一条非自动的已采纳记录', async () => {
    await setPrefs({ flags: { 'evolution.autoLowRisk': false } });
    const target = await skillPath(); const v = await getVfs(); const before = (await v.text(target))!;
    const r = await services.proposeSystemFile(target, `${before}\n- 规则\n`, '测试');
    expect(r).toMatchObject({ ok: true, auto: false }); expect(await v.text(target)).toBe(before);
    const m = await services.proposeMemory('标题不要用感叹号', {});
    expect(m.ok).toBe(true);
    const mp = (await db.all('proposals')).find((p) => (p as Record<string, unknown>).kind === 'memory') as Record<string, unknown>;
    expect(mp.auto).toBe(false); expect(mp.status).toBe('approved');
  });
});
