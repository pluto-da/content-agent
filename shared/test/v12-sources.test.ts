import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KNOWN_TOOLS, validateAppEntry, validateDataSource, canFetchPublicPage, canUseDataSource, grantDataSource, guessMapping, parseCsvRows, parseXlsx, applyMapping, MAPPING_TEMPLATES, DATA_SOURCE_TEXT, fromTemplate, type DataSource } from '../src/index.js';

const ds = (p: Partial<DataSource>): DataSource => ({ id: 'd1', kind: 'rss', label: '少数派 RSS', url: 'https://sspai.com/feed', grants: [], enabled: true, ...p });

describe('E13 自定义软件入口与四类数据源', () => {
  it('软件入口：属于某个平台或独立工具，能力只有“打开”', () => {
    for (const t of KNOWN_TOOLS) expect(validateAppEntry({ ...t, capabilities: ['open'] })).toEqual([]);
    expect(validateAppEntry({ id: 'bili-app', label: 'B站', platformId: 'bilibili', standalone: false, android: 'tv.danmaku.bili', capabilities: ['open'] }, ['bilibili'])).toEqual([]);
    expect(validateAppEntry({ id: 'x', label: 'X', platformId: 'nope', standalone: true, url: 'https://a.com', capabilities: ['open'] }).length).toBeGreaterThan(0);
    expect(validateAppEntry({ id: 'x', label: 'X', platformId: null, standalone: true, url: 'https://a.com', capabilities: ['open', 'auto_post'] as unknown as ['open'] }).join()).toMatch(/只能“打开”/);
  });
  it('四类数据源校验：RSS / 公开页（限频、只抓指定 URL、不抓登录后页面）/ CSV（需映射）/ 官方接口（只存 secretRef）', () => {
    expect(Object.keys(DATA_SOURCE_TEXT)).toEqual(['rss', 'public_page', 'csv', 'official_api']);
    expect(validateDataSource(ds({}))).toEqual([]);
    expect(validateDataSource(ds({ kind: 'public_page', url: 'https://example.com/top', minIntervalMin: 60 }))).toEqual([]);
    expect(validateDataSource(ds({ kind: 'public_page', url: 'https://example.com/top', minIntervalMin: 5 })).join()).toMatch(/限频/);
    expect(validateDataSource(ds({ kind: 'public_page', url: 'https://example.com/*', minIntervalMin: 60 })).join()).toMatch(/通配符/);
    expect(validateDataSource(ds({ kind: 'public_page', url: 'https://creator.example.com/data', minIntervalMin: 60 })).join()).toMatch(/登录后/);
    expect(validateDataSource(ds({ kind: 'csv', url: undefined })).join()).toMatch(/映射/);
    expect(validateDataSource(ds({ kind: 'csv', url: undefined, mapping: MAPPING_TEMPLATES.xiaohongshu }))).toEqual([]);
    expect(validateDataSource(ds({ kind: 'official_api', url: 'https://open.douyin.com/' })).join()).toMatch(/Key/);
    expect(validateDataSource(ds({ kind: 'official_api', url: 'https://open.douyin.com/', secretRef: 'secret:douyin-open' }))).toEqual([]);
    expect(validateDataSource(ds({ kind: 'official_api', url: 'https://open.douyin.com/', secretRef: 'sk-abcdefghijklmnopqrstuvwxyz123456' })).join()).toMatch(/Key|secretRef/);
  });
  it('公开页抓取：robots 不允许就不抓；限频生效；读不到 robots 按不允许', () => {
    const d = ds({ kind: 'public_page', url: 'https://example.com/hot', minIntervalMin: 60 });
    expect(canFetchPublicPage(d, 'User-agent: *\nAllow: /').ok).toBe(true);
    expect(canFetchPublicPage(d, 'User-agent: *\nDisallow: /hot').ok).toBe(false);
    expect(canFetchPublicPage(d, null).ok).toBe(false);
    const now = Date.parse('2026-10-24T10:00:00Z');
    expect(canFetchPublicPage({ ...d, lastFetchedAt: '2026-10-24T09:30:00Z' }, '', now).why).toMatch(/限频/);
  });
  it('数据源授权给子 Agent：父级授予 ∩ 子级声明，两边都要有', () => {
    const a = { ...fromTemplate('data-analyst'), dataSources: ['d1'] };
    let d = ds({ kind: 'csv', url: undefined, mapping: MAPPING_TEMPLATES.generic });
    expect(canUseDataSource(a, d)).toBe(false);
    d = grantDataSource(d, a.id, true);
    expect(canUseDataSource(a, d)).toBe(true);
    expect(canUseDataSource({ ...a, dataSources: [] }, d)).toBe(false);
    expect(canUseDataSource(a, grantDataSource(d, a.id, false))).toBe(false);
  });
  it('CSV / Excel 导入映射：按平台模板猜列；只填表里有的数字', async () => {
    const rows = parseCsvRows('\uFEFF笔记标题,发布时间,观看量,点赞,备注\n"通勤, 三件小事",2026-10-20,"1,200",85,\n第二篇,2026-10-21,,12,x\n');
    const m = guessMapping(rows[0]!, 'xiaohongshu');
    expect(m).toEqual({ 笔记标题: 'title', 发布时间: 'date', 观看量: 'views', 点赞: 'likes', 备注: 'ignore' });
    const r = applyMapping(rows, m);
    expect(r.rows[0]).toEqual({ title: '通勤, 三件小事', date: '2026-10-20', views: 1200, likes: 85 });
    expect(r.rows[1]).toEqual({ title: '第二篇', date: '2026-10-21', likes: 12 });
    expect(r.unmapped).toEqual(['备注']);
    const x = await parseXlsx(new Uint8Array(readFileSync(new URL('./fixtures/metrics-v12.xlsx', import.meta.url))));
    expect(x).toEqual([['笔记标题', '发布时间', '观看量', '点赞'], ['通勤三件小事', '2026-10-20', '1200', '85']]);
    expect(applyMapping(x, guessMapping(x[0]!, 'xiaohongshu')).rows[0]).toEqual({ title: '通勤三件小事', date: '2026-10-20', views: 1200, likes: 85 });
  });
});
