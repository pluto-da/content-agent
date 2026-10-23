/**
 * 0.11.0 检索评测（ROADMAP 0.11「向量检索转正」）：30 条样例，前 5 命中率。同时报 BM25、纯向量、混合三种，结果写 out/search-v11.json。
 * 向量 = 本机轻量嵌入 localEmbed（无向量 Key；哈希 n-gram + 领域同义词表，不是语义模型）。验收线：混合 ≥ 0.8。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bm25Search, hybridSearch, localEmbed, cosine, FLAGS } from '../shared/src/index.js';
import { SEARCH_CORPUS, SEARCH_CASES } from './search-cases.js';

const here = dirname(fileURLToPath(import.meta.url));
const result: Record<string, unknown> = {};
afterAll(() => { const d = join(here, '..', 'out'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'search-v11.json'), JSON.stringify(result, null, 2)); });

describe('检索评测 30 条（前 5 命中率）', () => {
  it('BM25 / 纯向量 / 混合：混合 ≥ 0.8', async () => {
    expect(SEARCH_CASES).toHaveLength(30);
    const rows = [];
    for (const c of SEARCH_CASES) {
      const kw = bm25Search(SEARCH_CORPUS, c.q, { k: 5 }).map((h) => h.path);
      const vec = (await hybridSearch(SEARCH_CORPUS, c.q, { k: 5, vectorOnly: true })).hits.map((h) => h.path);
      const hy = await hybridSearch(SEARCH_CORPUS, c.q, { k: 5 });
      rows.push({ q: c.q, kind: c.kind, expect: c.expect, bm25: kw.includes(c.expect), vector: vec.includes(c.expect), hybrid: hy.hits.map((h) => h.path).includes(c.expect), hybridRank: hy.hits.findIndex((h) => h.path === c.expect) + 1 || null, mode: hy.mode });
    }
    const rate = (k: 'bm25' | 'vector' | 'hybrid', kind?: string) => { const r = rows.filter((x) => !kind || x.kind === kind); return Math.round((r.filter((x) => x[k]).length / r.length) * 1000) / 1000; };
    Object.assign(result, {
      version: '0.11.0', embedder: 'localEmbed（本机轻量嵌入：哈希 n-gram + 领域同义词表，非语义模型）', fusion: 'RRF k0=60，BM25 与向量各取前 20', corpus: SEARCH_CORPUS.length, cases: rows.length,
      top5: { bm25: rate('bm25'), vector: rate('vector'), hybrid: rate('hybrid') },
      byKind: Object.fromEntries(['exact', 'para', 'fuzzy'].map((k) => [k, { bm25: rate('bm25', k), vector: rate('vector', k), hybrid: rate('hybrid', k) }])),
      misses: rows.filter((r) => !r.hybrid).map((r) => ({ q: r.q, kind: r.kind, expect: r.expect })), rows,
    });
    expect(rate('hybrid')).toBeGreaterThanOrEqual(0.8);
    expect(rate('hybrid')).toBeGreaterThanOrEqual(rate('bm25'));
  });
  it('localEmbed：确定性、L2 归一、近义词比无关词更近', () => {
    const a = localEmbed('怎么快速涨粉'), b = localEmbed('增粉的方法'), c = localEmbed('婴儿推车转卖');
    expect(localEmbed('怎么快速涨粉')).toEqual(a);
    expect(Math.abs(a.reduce((s, x) => s + x * x, 0) - 1)).toBeLessThan(1e-9);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
  it('向量失败时退回关键词并标明 keyword-fallback', async () => {
    const r = await hybridSearch(SEARCH_CORPUS, '目标受众', { k: 5, embed: async () => { throw new Error('未接向量模型'); } });
    expect(r.mode).toBe('keyword-fallback');
    expect(r.hits[0]!.path).toBe('memory/preferences.md#audience');
  });
  it('search.vector 开关：beta，默认关', () => {
    expect(FLAGS.get('search.vector')).toMatchObject({ stage: 'beta', default: false });
  });
});
