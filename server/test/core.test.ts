import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDb, getSetting, setSetting, parseJson } from '../src/db.js';
import { encrypt, decrypt, loadMasterKey, SecretVault, redact } from '../src/crypto.js';
import { isPublicHttpUrl, HostRateLimiter } from '../src/http.js';
import { HARD_BOUNDARIES, isAllowedSourceKind, filterTools, containsForbidden, boundaryPreamble } from '../src/boundaries.js';
import { normalizeUrl, titleFingerprint, autoTags, ingest, listItems, getItems } from '../src/modules/library.js';
import { checkCompliance } from '../src/modules/compliance.js';
import { parseCsv, mapColumns, importCsv, summarize } from '../src/modules/analytics.js';
import { Logger } from '../src/logger.js';
import { TaskQueue, PermanentError, backoffDelay } from '../src/queue.js';
import { tmp } from './helpers.js';

describe('硬边界', () => {
  it('包含核心条款且被冻结', () => {
    expect(HARD_BOUNDARIES.length).toBeGreaterThanOrEqual(9);
    expect(Object.isFrozen(HARD_BOUNDARIES)).toBe(true);
    expect(boundaryPreamble()).toContain('以此为准');
  });
  it('信息源与工具白名单', () => {
    expect(isAllowedSourceKind('rss')).toBe(true);
    expect(isAllowedSourceKind('xhs_scraper')).toBe(false);
    expect(filterTools(['llm.chat', 'auto_click'])).toEqual({ allowed: ['llm.chat'], rejected: ['auto_click'] });
    expect(containsForbidden('this does auto_like and Fingerprint')).toEqual(['auto_like', 'fingerprint']);
  });
});

describe('加密密钥库', () => {
  it('加解密往返且密文不含明文', () => {
    const key = loadMasterKey('/nonexistent', 'pass');
    const c = encrypt(key, 'sk-secret-123456');
    expect(c).not.toContain('secret');
    expect(decrypt(key, c)).toBe('sk-secret-123456');
    expect(() => decrypt(key, 'bad')).toThrow();
  });
  it('落盘为密文、只回显掩码', () => {
    const dir = tmp();
    const key = loadMasterKey(join(dir, 'master.key'), '');
    const v = new SecretVault(join(dir, 's.json'), key);
    v.set('x.bearer', 'AAAABBBBCCCC9999');
    expect(readFileSync(join(dir, 's.json'), 'utf8')).not.toContain('AAAABBBB');
    expect(v.describe(['x.bearer', 'nope'])).toEqual({ 'x.bearer': { configured: true, hint: '••••9999' }, nope: { configured: false, hint: '' } });
    const v2 = new SecretVault(join(dir, 's.json'), loadMasterKey(join(dir, 'master.key'), ''));
    expect(v2.get('x.bearer')).toBe('AAAABBBBCCCC9999');
    v2.set('x.bearer', '');
    expect(v2.has('x.bearer')).toBe(false);
  });
  it('日志脱敏', () => {
    expect(redact('{"apiKey":"abc123","x":1} sk-abcdefghijk')).toBe('{"apiKey":"[REDACTED]","x":1} sk-[REDACTED]');
  });
});

describe('网络安全与限速', () => {
  it('拒绝内网地址', () => {
    expect(isPublicHttpUrl('https://example.com/a')).toBe(true);
    for (const u of ['http://127.0.0.1', 'http://localhost:8080', 'http://192.168.1.2', 'http://10.0.0.1', 'ftp://x.com', 'http://[::1]/', 'not a url', 'http://172.20.0.1'])
      expect(isPublicHttpUrl(u)).toBe(false);
  });
  it('同域名最小间隔', async () => {
    let now = 0;
    const waits: number[] = [];
    const lim = new HostRateLimiter(5000, () => now, async (ms) => { waits.push(ms); now += ms; });
    await lim.wait('https://a.com/1');
    now += 1000;
    await lim.wait('https://a.com/2');
    await lim.wait('https://b.com/1');
    expect(waits).toEqual([4000]);
  });
});

describe('数据库与设置', () => {
  it('设置读写与 JSON 容错', () => {
    const db = openDb(':memory:');
    expect(getSetting(db, 'a', 1)).toBe(1);
    setSetting(db, 'a', { b: 2 });
    expect(getSetting(db, 'a', {})).toEqual({ b: 2 });
    expect(parseJson('x', [])).toEqual([]);
    expect(parseJson(5, 'd')).toBe('d');
  });
});

describe('内容库', () => {
  it('规范化链接去掉追踪参数', () => {
    expect(normalizeUrl('http://WWW.Example.com/a/?utm_source=x&b=2&a=1#h')).toBe('https://example.com/a?a=1&b=2');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('nope')).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
  });
  it('标题指纹忽略标点与空白', () => {
    expect(titleFingerprint('大模型 降价了！')).toBe(titleFingerprint('大模型降价了'));
  });
  it('入库去重与标签', () => {
    const db = openDb(':memory:');
    const s1 = ingest(db, null, [
      { title: 'DeepSeek 发布新模型', url: 'https://a.com/1?utm_source=rss' },
      { title: 'DeepSeek 发布新模型', url: 'https://a.com/1' },
      { title: '考研报名开始', url: 'https://b.com/2' },
      { title: '   ' },
    ]);
    expect(s1).toEqual({ fetched: 4, inserted: 2, duplicates: 1 });
    expect(ingest(db, null, [{ title: '考研报名开始！' }]).duplicates).toBe(1);
    const all = listItems(db);
    expect(all.find((i) => i.title.includes('DeepSeek'))!.tags).toContain('AI');
    expect(listItems(db, { tag: '教育' })).toHaveLength(1);
    expect(listItems(db, { search: 'DeepSeek' })).toHaveLength(1);
    expect(getItems(db, [all[0]!.id])).toHaveLength(1);
    expect(getItems(db, [])).toEqual([]);
    expect(autoTags('闲鱼二手')).toEqual(['电商']);
  });
});

describe('合规自检', () => {
  it('识别极限词、引流、隐私', () => {
    const r = checkCompliance('全网最低价，加微信领取，电话 13812345678');
    const rules = r.map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(['极限用语', '站外引流', '隐私信息', 'AI 生成标识']));
    expect(checkCompliance('普通内容').filter((i) => i.level === 'warn')).toHaveLength(0);
  });
});

describe('CSV 复盘', () => {
  it('解析引号与列名映射', () => {
    expect(parseCsv('a,b\n"x,1","y""z"\n')).toEqual([['a', 'b'], ['x,1', 'y"z']]);
    expect(parseCsv('\uFEFFa\tb\r\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(mapColumns(['作品标题', '播放量', '点赞', '评论量', '收藏', '分享', '发布时间'])).toMatchObject({ title: 0, views: 1, likes: 2, comments: 3, favorites: 4, shares: 5, published_at: 6 });
  });
  it('导入与汇总', () => {
    const db = openDb(':memory:');
    const r = importCsv(db, '标题,播放量,点赞,评论\nA,1000,50,5\nB,1.2万,100,20\n', 'douyin');
    expect(r.rows).toBe(2);
    const s = summarize(db, r.batch);
    expect(s.totals.views).toBe(13000);
    expect(s.top[0]!.title).toBe('A');
    expect(s.note).toContain('样本量');
    expect(() => importCsv(db, '只有表头', 'x')).toThrow();
    expect(() => importCsv(db, 'x,y\n1,2', 'x')).toThrow('标题');
  });
});

describe('任务队列', () => {
  it('退避计算', () => {
    expect(backoffDelay(0, 1000)).toBe(1000);
    expect(backoffDelay(3, 1000)).toBe(8000);
    expect(backoffDelay(10, 1000)).toBe(60000);
  });
  it('重试后成功、永久错误不重试、并发上限', async () => {
    const db = openDb(':memory:');
    const sleeps: number[] = [];
    const q = new TaskQueue(db, new Logger(), 1, async (ms) => { sleeps.push(ms); });
    let n = 0;
    const r1 = await q.run({ kind: 't', label: 'flaky', retries: 2, baseDelayMs: 10 }, async () => { if (++n < 3) throw new Error('boom'); return 'ok'; });
    expect(r1).toMatchObject({ ok: true, result: 'ok' });
    expect(sleeps).toEqual([10, 20]);
    let m = 0;
    const r2 = await q.run({ kind: 't', label: 'perm' }, async () => { m++; throw new PermanentError('未配置'); });
    expect(r2.ok).toBe(false);
    expect(m).toBe(1);
    let active = 0;
    let peak = 0;
    await Promise.all([1, 2, 3].map(() => q.run({ kind: 't', label: 'c' }, async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
    expect(peak).toBe(1);
    expect(q.stats()).toMatchObject({ succeeded: 4, failed: 1 });
    expect(q.list(10, 'failed')).toHaveLength(1);
  });
  it('超时', async () => {
    const q = new TaskQueue(openDb(':memory:'), new Logger(), 2, async () => {});
    const r = await q.run({ kind: 't', label: 'slow', retries: 0, timeoutMs: 10 }, () => new Promise((res) => setTimeout(res, 100)));
    expect(r.error).toContain('超时');
  });
});

describe('结构化日志', () => {
  it('环形缓冲与脱敏', () => {
    const l = new Logger(join(tmp(), 'log.jsonl'), 2);
    l.info('m', 'a', { token: 'xyz' });
    l.warn('m', 'b');
    l.error('m', 'c');
    expect(l.recent()).toHaveLength(2);
    expect(l.recent(10, 'error')[0]!.msg).toBe('c');
    expect(JSON.stringify(new Logger().info('m', 'x', { secret: 'abc' }))).toContain('[REDACTED]');
  });
});
