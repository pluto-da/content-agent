/** 1.0 存储治理：媒体配额与清理（引用 / 最近 / 保留不清；默认只提醒）、索引（不读正文）、版本修剪预览与执行、存储页。 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetLocalDb } from '../local/db';
import { dataUrlBytes, planCleanup, readQuota, referencedIds, prunePreview, usageOf, DEFAULT_MEDIA_QUOTA, MB, type MediaIndexEntry } from '../v9/media/policy';
import { mediaIndex, noteMediaSaved, runCleanup, cleanupTick, saveQuota, versionPreview, pruneVersions, setKeep } from '../v9/media/store';
import { listAudit } from '../v9/ops';
import { StoragePage } from './StoragePage';

beforeEach(() => { resetLocalDb(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const NOW = Date.parse('2026-10-23T12:00:00+08:00');
const day = (d: number) => new Date(NOW - d * 864e5).toISOString();
const e = (id: number, mb: number, age: number, o: Partial<MediaIndexEntry> = {}): MediaIndexEntry => ({ id, kind: 'image', bytes: mb * MB, created_at: day(age), ...o });
const b64 = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

describe('配额规则（纯函数）', () => {
  it('dataUrl 字节估算', () => { expect(dataUrlBytes(`data:image/png;base64,${'QUJD'}`)).toBe(3); expect(dataUrlBytes('data:x;base64,QQ==')).toBe(1); expect(dataUrlBytes('https://x/y.png')).toBe(15); expect(dataUrlBytes(undefined)).toBe(0); });
  it('默认配额 1 GB、7 天内不清、清到 80%、默认不自动清；读设置夹紧', () => {
    expect(DEFAULT_MEDIA_QUOTA).toEqual({ quotaBytes: 1024 ** 3, keepDays: 7, targetRatio: 0.8, autoClean: false });
    expect(readQuota({ quotaBytes: 1, keepDays: 999, autoClean: 'yes' })).toEqual({ quotaBytes: 50 * MB, keepDays: 365, targetRatio: 0.8, autoClean: false });
  });
  it('在配额内不清', () => { expect(planCleanup([e(1, 10, 30)], { ...DEFAULT_MEDIA_QUOTA, quotaBytes: 100 * MB }, new Set(), NOW).remove).toEqual([]); });
  it('超配额：最旧的先清，清到目标线；被引用 / 最近 / 保留的不清', () => {
    const idx = [e(1, 40, 60), e(2, 40, 50, { keep: true }), e(3, 40, 40), e(4, 40, 30), e(5, 40, 1)];
    const p = planCleanup(idx, { ...DEFAULT_MEDIA_QUOTA, quotaBytes: 150 * MB }, new Set([3]), NOW);
    expect(p.over).toBe(true); expect(p.remove.map((x) => x.id)).toEqual([1, 4]); expect(p.after).toBe(120 * MB); expect(p.reason).toBe('ok');
    expect(p.protectedBytes).toBe(120 * MB);
  });
  it('全部受保护时如实报告', () => { const p = planCleanup([e(1, 200, 1)], { ...DEFAULT_MEDIA_QUOTA, quotaBytes: 100 * MB }, new Set(), NOW); expect(p.remove).toEqual([]); expect(p.reason).toBe('all_protected'); });
  it('引用识别', () => { expect([...referencedIds(['{"cards":[{"media":["media-12","media-3"]}]}', '{"mediaId": 7}'])].sort((a, b) => a - b)).toEqual([3, 7, 12]); });
  it('按类型汇总', () => { expect(usageOf([e(1, 1, 1), e(2, 2, 1, { kind: 'video' })]).byKind.video).toEqual({ bytes: 2 * MB, count: 1 }); });
  it('版本修剪预览与 Vfs 写入规则一致：永久保留不动；其他保留最近 20 版 + 90 天内', () => {
    const vs = Array.from({ length: 30 }, (_, i) => ({ version: i + 1, updated: day(i < 25 ? 200 - i : 10), size: 100 }));
    const p = prunePreview('memory/topics/a.md', vs, false, NOW);
    expect(p.dropCount).toBe(10); expect(p.versions.slice(0, 10).every((v) => v.drop)).toBe(true); expect(p.keepCount).toBe(20);
    expect(prunePreview('SOUL.md', vs, true, NOW).dropCount).toBe(0);
  });
});

describe('本机接线', () => {
  async function seed(n: number, mb: number, ageDays: number) {
    for (let i = 0; i < n; i++) await db.insert('media', { kind: 'image', mime: 'image/png', dataUrl: `data:image/png;base64,${b64(mb * MB)}`, created_at: day(ageDays + i) });
  }
  it('索引：旧数据没有索引时用游标重建；新保存的增量写入；不需要整表读取', async () => {
    await seed(3, 1, 20);
    const spy = vi.spyOn(db, 'all');
    const idx = await mediaIndex();
    expect(idx.length).toBe(3); expect(Math.round(idx[0]!.bytes / MB)).toBe(1);
    expect(spy.mock.calls.filter(([c]) => c === 'media').length).toBe(0);
    const row = await db.insert('media', { kind: 'audio', mime: 'audio/wav', dataUrl: 'data:audio/wav;base64,QUJD' });
    await noteMediaSaved([row]);
    expect((await mediaIndex()).length).toBe(4);
  });
  it('超配额 + 默认不自动清：清理任务只提醒，不删任何东西', async () => {
    await seed(4, 20, 20); await saveQuota({ quotaBytes: 50 * MB });
    const r = await cleanupTick(NOW);
    expect(r.over).toBe(true); expect(r.removed).toBe(0); expect(r.note).toMatch(/等你在“我的 → 存储”确认/);
    expect((await db.all('media')).length).toBe(4);
  });
  it('打开自动清理后任务会删；被对话引用 / 标了保留的不删；写审计', async () => {
    await seed(4, 20, 20); await saveQuota({ quotaBytes: 50 * MB, autoClean: true });
    const ids = (await db.all('media')).map((r) => r.id);
    await db.insert('messages', { conversationId: 1, role: 'assistant', content: '', cards: [{ type: 'image', media: [`media-${ids[3]}`] }] });
    await setKeep(ids[2]!, true);
    const r = await cleanupTick(NOW);
    expect(r.removed).toBe(2);
    expect((await db.all('media')).map((x) => x.id).sort()).toEqual([ids[2], ids[3]].sort());
    expect((await listAudit({ kinds: ['storage'] }))[0]!.summary).toMatch(/清理媒体 2 个/);
  });
  it('手动立即清理', async () => { await seed(3, 30, 20); await saveQuota({ quotaBytes: 50 * MB }); const r = await runCleanup({ actor: 'user', now: NOW }); expect(r.removed).toBe(2); expect((await mediaIndex()).length).toBe(1); });
  it('版本修剪：只删可修剪的旧版本，根系统文件不动', async () => {
    for (let v = 1; v <= 25; v++) { await db.kput('vfs_versions', `memory/topics/x.md#${v}`, { path: 'memory/topics/x.md', version: v, content: 'x'.repeat(10), updated: day(200 - v), author: 'user' }); await db.kput('vfs_versions', `SOUL.md#${v}`, { path: 'SOUL.md', version: v, content: 's', updated: day(200 - v), author: 'user' }); }
    const prev = await versionPreview(NOW);
    expect(prev.find((f) => f.path === 'memory/topics/x.md')!.dropCount).toBe(5);
    expect(prev.find((f) => f.path === 'SOUL.md')!.forever).toBe(true);
    const r = await pruneVersions(NOW);
    expect(r.versions).toBe(5);
    expect((await db.kall<{ path: string }>('vfs_versions')).filter((v) => v.path === 'SOUL.md').length).toBe(25);
  });
});

describe('存储页', () => {
  it('显示用量与配额；超配额时“立即清理”可用并先确认', async () => {
    for (let i = 0; i < 3; i++) await db.insert('media', { kind: i ? 'image' : 'video', mime: 'image/png', dataUrl: `data:image/png;base64,${b64(30 * MB)}`, created_at: day(30 + i) });
    await saveQuota({ quotaBytes: 50 * MB });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StoragePage />);
    expect(await screen.findByTestId('storage-used')).toHaveProperty('textContent', '90.0 MB / 50.0 MB');
    expect(screen.getByRole('progressbar', { name: '媒体配额用量' }).getAttribute('aria-valuenow')).toBe('100');
    fireEvent.click(screen.getByTestId('storage-clean'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(async () => expect((await db.all('media')).length).toBe(1));
  });
});
