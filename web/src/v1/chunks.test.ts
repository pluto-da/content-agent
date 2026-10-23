import { describe, it, expect } from 'vitest';
import { splitChunks, assembleAll, CHUNK_CHARS } from '../local/db';

describe('1.0 VFS 大值分片（防御性：单条值 < 64 KB）', () => {
  it('小文件不分片，原样存', () => {
    const v = { path: 'a.md', content: 'x'.repeat(10) };
    expect(splitChunks('a.md', v)).toEqual({ head: v, chunks: [] });
  });
  it('大文件分片后每片不超过上限，拼回与原文一致', () => {
    const content = '测'.repeat(CHUNK_CHARS * 2 + 123);
    const { head, chunks } = splitChunks('core.md', { path: 'core.md', content, version: 3 });
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
    expect((head as { content: string }).content).toBe('');
    const rows = [head, ...chunks.map((s, i) => ({ __caChunkOf: 'core.md', i, s })), { path: 'b.md', content: 'b' }];
    const out = assembleAll(rows.reverse()) as { path: string; content: string; version?: number }[];
    expect(out.length).toBe(2);
    const big = out.find((r) => r.path === 'core.md')!;
    expect(big.content).toBe(content);
    expect(big.version).toBe(3);
    expect(Object.keys(big)).not.toContain('__caChunks');
  });
  it('非对象 / 没有 content 的值不动', () => {
    expect(splitChunks('k', 'str').chunks).toEqual([]);
    expect(splitChunks('k', { n: 1 }).chunks).toEqual([]);
    expect(assembleAll([1, 'a', { n: 1 }])).toEqual([1, 'a', { n: 1 }]);
  });
});
