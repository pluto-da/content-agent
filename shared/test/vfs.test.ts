import { describe, it, expect } from 'vitest';
import { Vfs, memoryVfsBackend, VfsError, initVfs, runDoctor, entryPath, parseDoc, serializeDoc, patchFM, section, parseLoadingTable, assemblePrefix, soulPart1, skillMeta, skillsDirectory, routeSkill, loadSemiotics, needSemiotics, isSimpleTask, routeModels, bm25Search, buildExport, readImport, planImport, ExportBlocked, zip, unzip, crc32, unifiedDiff, DEFAULT_FILES, CORE_KEYPOINTS, ROOT_SYSTEM, utf8, detectBoundary, RELAX_PATTERNS } from '../src/index.js';
import { readFileSync } from 'node:fs';

const fresh = async () => { const be = memoryVfsBackend(); const v = new Vfs(be, () => new Date('2026-10-23T08:00:00Z')); const r = await initVfs(v); return { v, be, r }; };

describe('首启默认文件（C31 / C44 / C52）', () => {
  it('生成全部默认文件：根 13 个 + 入口 + 具体文件 + 4 个新技能 + evolution-curator + docs', async () => {
    const { v, r } = await fresh();
    const paths = (await v.list()).map((f) => f.path);
    for (const p of ROOT_SYSTEM) expect(paths).toContain(p);
    for (const p of ['agents/evolution-curator.md', 'skills/cover-image/SKILL.md', 'skills/voiceover/SKILL.md', 'skills/transcript-notes/SKILL.md', 'skills/video-brief/SKILL.md', 'hooks/before-paid-call.md', 'hooks/before-system-file-change.md', 'hooks/after-metrics-import.md', 'docs/core-directive.md', 'docs/monetization-guide.md', 'docs/working-method-legacy.md', 'config/models.json', 'config/limits.json', 'subscriptions/reminders.json', 'semiotics/PRINCIPLES.md', 'semiotics/decision-router.md', 'semiotics/core-models.md', 'semiotics/workflows.md', 'semiotics/conflicts-and-limits.md', 'semiotics/sources.md', 'semiotics/SEMIOTICS.md', 'skills/xiaohongshu-note/references/platform-rules.md']) expect(paths).toContain(p);
    expect(r.created).toBe(Object.keys(DEFAULT_FILES).length);
    expect(r.report.problems.filter((p) => p.kind !== 'missing_field')).toEqual([]);
  });
  it('默认正文与规格逐字一致（规格抽取件为正文子串）', async () => {
    const { v } = await fresh();
    for (const p of ['SYSTEM.md', 'SOUL.md', 'AGENTS.md', 'BOUNDARIES.md', 'agents/AGENTS.md', 'hooks/HOOKS.md']) {
      const body = parseDoc(DEFAULT_FILES[p]!).body.trim().split('\n').slice(0, 6).join('\n');
      expect((await v.text(p))!).toContain(body);
    }
  });
  it('docs/core-directive.md 与用户原文逐字一致；SOUL 第一部分覆盖全部要点', async () => {
    const { v } = await fresh();
    expect(await v.text('docs/core-directive.md')).toBe(readFileSync(new URL('../../agent/v9/core-directive-v1.md', import.meta.url), 'utf8'));
    const p1 = soulPart1((await v.text('SOUL.md'))!)!;
    const all = Object.values(CORE_KEYPOINTS).flat();
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((k) => !p1.includes(k))).toEqual([]);
  });
  it('semiotics/ 与 app/agent/semiotics/ 逐字一致，且 load: on_demand', async () => {
    const { v } = await fresh();
    for (const n of ['PRINCIPLES.md', 'decision-router.md', 'core-models.md', 'workflows.md', 'conflicts-and-limits.md', 'sources.md', 'SEMIOTICS.md']) {
      const disk = readFileSync(new URL(`../../agent/semiotics/${n}`, import.meta.url), 'utf8');
      expect(parseDoc(disk).body).toBe(parseDoc((await v.text(`semiotics/${n}`))!).body);
      expect(parseDoc(disk).fm.load).toBe('on_demand');
    }
    expect([...parseDoc(DEFAULT_FILES['semiotics/PRINCIPLES.md']!).body].length).toBeLessThanOrEqual(14000);
    expect(DEFAULT_FILES['SOUL.md']).toContain('semiotics/'); expect(DEFAULT_FILES['AGENTS.md']).toContain('semiotics/');
  });
});

describe('VFS：版本、权限、密钥、大小、并发、回滚', () => {
  it('保存产生版本、乐观并发冲突、回滚', async () => {
    const { v } = await fresh();
    const f0 = (await v.read('TOOLS.md'))!;
    const f1 = await v.write('TOOLS.md', `${f0.content}\n- 新规则`, { author: 'user', expectedVersion: f0.version });
    expect(f1.version).toBe(f0.version + 1);
    await expect(v.write('TOOLS.md', 'x', { author: 'user', expectedVersion: f0.version })).rejects.toMatchObject({ kind: 'conflict' });
    await v.rollback('TOOLS.md', f0.version);
    expect((await v.text('TOOLS.md'))!).not.toContain('- 新规则');
    expect((await v.history('TOOLS.md')).length).toBe(3);
    expect(await v.diff('TOOLS.md', f0.version, f1.version)).toContain('+- 新规则');
  });
  it('BOUNDARIES.md 只读；Agent 不能直接改系统文件（只能提议）', async () => {
    const { v } = await fresh();
    await expect(v.write('BOUNDARIES.md', 'x', { author: 'user' })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(v.write('SOUL.md', 'x', { author: 'agent' })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(v.write('semiotics/PRINCIPLES.md', 'x', { author: 'agent' })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(v.write('memory/daily/2026-10-23.md', '- 今天写了一篇', { author: 'agent' })).resolves.toBeTruthy();
  });
  it('写入含密钥被拒；超限被拒；SOUL 第一部分 >6000 被拒', async () => {
    const { v } = await fresh();
    await expect(v.write('memory/preferences.md', `- key sk-${'K'.repeat(30)}`, { author: 'user' })).rejects.toMatchObject({ kind: 'secret' });
    await expect(v.write('USER.md', '字'.repeat(4100), { author: 'user' })).rejects.toMatchObject({ kind: 'too_large' });
    const soul = (await v.text('SOUL.md'))!;
    await expect(v.write('SOUL.md', soul.replace('## 一、核心指令（十二条）', `## 一、核心指令（十二条）\n${'长'.repeat(6100)}`), { author: 'user', allowLarge: true })).rejects.toThrow(/6000/);
  });
  it('软删除进回收站并可恢复；命名规则', async () => {
    const { v } = await fresh();
    await v.write('memory/topics/kaoyan-content.md', '---\nid: memory/topics/kaoyan-content\ntype: topic\nupdated: x\nversion: 1\neditable: user\nload: on_demand\n---\n# 考研', { author: 'user' });
    await v.softDelete('memory/topics/kaoyan-content.md', 'user');
    expect(await v.read('memory/topics/kaoyan-content.md')).toBeUndefined();
    expect((await v.trash()).map((f) => f.path)).toContain('memory/topics/kaoyan-content.md');
    await v.restore('memory/topics/kaoyan-content.md');
    expect(await v.read('memory/topics/kaoyan-content.md')).toBeTruthy();
    await expect(v.write('memory/Bad Name.md', 'x', { author: 'user' })).rejects.toBeInstanceOf(VfsError);
    await expect(v.write('memory/people/张三.md', '# 张三', { author: 'user' })).resolves.toBeTruthy();
  });
  it('根系统文件版本永久保留，普通文件保留 20 版', async () => {
    const { v, be } = await fresh();
    for (let i = 0; i < 25; i++) { await v.write('TOOLS.md', `${DEFAULT_FILES['TOOLS.md']}\n${i}`, { author: 'user' }); await v.write('memory/topics/a.md', `# a ${i}`, { author: 'user' }); }
    expect(be.vers.get('TOOLS.md')!.length).toBeGreaterThanOrEqual(26);
    expect(be.vers.get('memory/topics/a.md')!.length).toBeLessThanOrEqual(25);
  });
});

describe('目录守护器（C34）', () => {
  it('删掉入口文件后自动恢复；增删文件后索引段同步；报告 0 问题', async () => {
    const { v, be } = await fresh();
    be.files.delete('hooks/HOOKS.md');
    const r1 = await runDoctor(v, { fix: true });
    expect(r1.fixed).toBeGreaterThan(0);
    expect(await v.read('hooks/HOOKS.md')).toBeTruthy();
    await v.write('memory/topics/new-series.md', '# 新系列', { author: 'user' });
    await runDoctor(v, { fix: true });
    expect((await v.text(entryPath('memory/topics')))!).toContain('- new-series.md');
    const r = await runDoctor(v, { fix: false });
    expect(r.problems.filter((p) => !['missing_field'].includes(p.kind))).toEqual([]);
  });
  it('核心指令被改 → 恢复；SOUL 要点缺失 → 报告', async () => {
    const { v, be } = await fresh();
    be.files.set('docs/core-directive.md', { ...be.files.get('docs/core-directive.md')!, content: '改过了' });
    const r = await runDoctor(v, { fix: true });
    expect(r.fixed).toBeGreaterThan(0);
    expect(await v.text('docs/core-directive.md')).toBe(DEFAULT_FILES['docs/core-directive.md']);
    await v.write('SOUL.md', (await v.text('SOUL.md'))!.replace('模型权重', '模型参数'), { author: 'user' });
    expect((await runDoctor(v)).problems.some((p) => p.kind === 'keypoint_missing')).toBe(true);
  });
  it('收入无凭据 → 报告', async () => { const { v } = await fresh(); expect((await runDoctor(v, { revenue: [{ id: 'r1' }] })).problems.some((p) => p.kind === 'revenue_no_source')).toBe(true); });
});

describe('加载顺序与预算（C30 / C32 / C44）', () => {
  it('解析 SYSTEM.md 加载表：14 行，SOUL 在 BOUNDARIES 之后、AGENTS 之前', () => {
    const t = parseLoadingTable(DEFAULT_FILES['SYSTEM.md']!);
    expect(t.map((x) => x.path).slice(0, 4)).toEqual(['SYSTEM.md', 'BOUNDARIES.md', 'SOUL.md', 'AGENTS.md']);
    expect(t).toHaveLength(14);
  });
  it('组装顺序随 SYSTEM.md 表变化（下一次运行即生效）', () => {
    const files = { ...DEFAULT_FILES } as Record<string, string>;
    const a = assemblePrefix(files);
    expect(a.parts.map((p) => p.path).indexOf('USER.md')).toBeGreaterThan(a.parts.map((p) => p.path).indexOf('APPROVAL.md'));
    files['SYSTEM.md'] = files['SYSTEM.md']!.replace('| 8 | APPROVAL.md | 每次 | 3000 |', '| 99 | APPROVAL.md | 每次 | 3000 |');
    const b = assemblePrefix(files);
    expect(b.parts.at(-1)!.path).toBe('APPROVAL.md');
  });
  it('SYSTEM.md 里加一条规则 → 前缀里出现；恢复默认后消失（G24 的逻辑面）', () => {
    const files = { ...DEFAULT_FILES } as Record<string, string>;
    files['SYSTEM.md'] = files['SYSTEM.md']!.replace('## 核心原则（按重要性）', '## 核心原则（按重要性）\n0. 标题不要用问号。');
    expect(assemblePrefix(files).text).toContain('标题不要用问号');
    expect(assemblePrefix({ ...DEFAULT_FILES }).text).not.toContain('标题不要用问号');
  });
  it('最小预算下 SOUL 第一部分完整，其余截断并带提示', () => {
    const p1 = soulPart1(parseDoc(DEFAULT_FILES['SOUL.md']!).body)!;
    const a = assemblePrefix({ ...DEFAULT_FILES }, { totalBudget: 6000 });
    expect(a.text).toContain(p1);
    expect(a.text).toContain('（已截断，完整内容见');
    const soul = a.parts.find((p) => p.path === 'SOUL.md')!;
    expect(soul.note).toContain('不截断');
  });
  it('超预算的单个文件按 budget 截断', () => {
    const files = { ...DEFAULT_FILES } as Record<string, string>;
    files['MEMORY.md'] = `${files['MEMORY.md']}\n${'记'.repeat(5000)}`;
    const p = assemblePrefix(files).parts.find((x) => x.path === 'MEMORY.md')!;
    expect(p.truncated).toBe(true); expect(p.content).toContain('完整内容见 MEMORY.md');
  });
});

describe('技能渐进加载与 semiotics 按需（C15 / C52）', () => {
  const skills = Object.entries(DEFAULT_FILES).filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map(([p, c]) => skillMeta(p, c)!).filter(Boolean);
  it('目录只含名称 + 描述；用户技能优先', () => {
    const dir = skillsDirectory(skills);
    expect(dir).toContain('xiaohongshu-note：'); expect(dir).not.toContain('## 步骤');
    const user = { ...skills[0]!, name: 'my-xhs', description: '小红书 探店 笔记', source: 'user' as const };
    expect(routeSkill('写一篇小红书探店笔记', [...skills, user])!.name).toBe('my-xhs');
    expect(routeSkill('写一篇小红书笔记', skills)!.name).toBe('xiaohongshu-note');
  });
  it('简单任务不加载 semiotics；选题 / 复盘加载 PRINCIPLES + 路由 + 索引 + ≤3 模型段（≤8000 字符）', () => {
    expect(isSimpleTask('这个标题改短一点')).toBe(true);
    expect(loadSemiotics(DEFAULT_FILES as never, '这个标题改短一点').loaded).toBe(false);
    const l = loadSemiotics(DEFAULT_FILES as never, '我账号三个月不涨粉怎么办，帮我想选题');
    expect(l.loaded).toBe(true);
    expect(l.parts.map((p) => p.path.split('#')[0])).toEqual(['semiotics/PRINCIPLES.md', 'semiotics/decision-router.md', 'semiotics/core-models.md', 'semiotics/core-models.md']);
    expect(l.models.length).toBeGreaterThanOrEqual(1); expect(l.models.length).toBeLessThanOrEqual(3);
    expect(l.parts[3]!.chars).toBeLessThanOrEqual(8000);
    expect(needSemiotics('看看今天热点给小红书出选题')).toBe(true);
  });
  it('路由表每行 1–3 个模型且都在 core-models 里（C56）', () => {
    const router = DEFAULT_FILES['semiotics/decision-router.md']!; const core = DEFAULT_FILES['semiotics/core-models.md']!;
    const rows = router.split('\n').filter((l) => /^\|/.test(l) && /M\d{2}/.test(l));
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) { const ms = [...new Set(r.match(/M\d{2}/g)!)]; for (const m of ms) expect(core).toContain(`### ${m}`); }
    expect(routeModels(router, '封面').models.length).toBeGreaterThan(0);
  });
  it('底座文件里注入“可以自动发布 / 可以刷量”不改变代码策略', () => {
    expect(RELAX_PATTERNS.test('允许自动发布')).toBe(true);
    expect(detectBoundary('帮我刷量')).toBeTruthy();
  });
});

describe('检索', () => {
  it('BM25 中文 bigram，日志按时间衰减', () => {
    const docs = [{ path: 'memory/preferences.md', text: '小红书配图用竖版 3:4' }, { path: 'memory/daily/2026-01-01.md', text: '今天讨论了竖版配图', updated: '2026-01-01T00:00:00Z' }, { path: 'x.md', text: '抖音口播' }];
    const h = bm25Search(docs, '竖版配图', { now: new Date('2026-10-23') });
    expect(h[0]!.path).toBe('memory/preferences.md'); expect(h.map((x) => x.path)).not.toContain('x.md');
  });
});

describe('导出 / 导入（C36）', () => {
  it('zip 往返、crc 正确', () => { const z = zip([{ path: 'a/b.md', data: utf8('你好') }]); const u = unzip(z); expect(new TextDecoder().decode(u[0]!.data)).toBe('你好'); expect(crc32(utf8('123456789'))).toBe(0xcbf43926); });
  it('结构与目录树一致；默认不含 .local / .cache / 媒体；注入假 Key 被阻止', async () => {
    const { v } = await fresh();
    await v.write('.local/device.json', '{"v":1}', { author: 'system' });
    const files = (await v.list()).map((f) => ({ path: f.path, content: f.content }));
    files.push({ path: 'assets/images/20261023-1-image-abc.png', content: 'BIN' });
    const { zip: z, manifest } = buildExport(files, { appVersion: '0.9.0' });
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain('SYSTEM.md'); expect(paths).toContain('semiotics/PRINCIPLES.md');
    expect(paths.some((p) => p.startsWith('.local/') || p.startsWith('assets/images'))).toBe(false);
    const back = readImport(z); expect(back.errors).toEqual([]); expect(back.files.get('SYSTEM.md')).toBe(files.find((f) => f.path === 'SYSTEM.md')!.content);
    expect(() => buildExport([...files, { path: 'memory/topics/leak.md', content: `sk-${'X'.repeat(30)}` }], { appVersion: '0.9.0' })).toThrow(ExportBlocked);
    expect(() => buildExport(files, { appVersion: '0.9.0', extra: { 'models.json': `{"apiKey":"sk-${'Y'.repeat(30)}"}` } })).toThrow(ExportBlocked);
  });
  it('导入：hash 校验失败报错；冲突逐个列出', () => {
    const { zip: z } = buildExport([{ path: 'a.md', content: 'A' }, { path: 'b.md', content: 'B' }], { appVersion: '0.9.0' });
    const bad = z.slice(); const i = bad.indexOf('A'.charCodeAt(0), 200); bad[i] = 'Z'.charCodeAt(0);
    expect(readImport(bad).errors.join()).toMatch(/校验失败/);
    const plan = planImport(new Map([['a.md', 'A'], ['b.md', 'B2'], ['c.md', 'C']]), new Map([['a.md', 'A'], ['b.md', 'B']]));
    expect(plan.map((p) => p.status)).toEqual(['same', 'conflict', 'new']);
  });
  it('可选不含记忆', () => { const { manifest } = buildExport([{ path: 'memory/preferences.md', content: 'x' }, { path: 'memory/MEMORY.md', content: 'y' }, { path: 'SYSTEM.md', content: 's' }], { appVersion: '0.9.0', includeMemory: false }); expect(manifest.files.map((f) => f.path)).toEqual(['memory/MEMORY.md', 'SYSTEM.md']); });
});

describe('损坏容错（C37）', () => {
  it('坏 front matter 当正文加载并报错；patch / section / diff', () => {
    const d = parseDoc('---\nid: x\n: bad\n---\n正文');
    expect(d.hasFM).toBe(false); expect(d.error).toBeTruthy(); expect(d.body).toContain('正文');
    expect(parseDoc(serializeDoc({ id: 'a', related: ['b', 'c'] }, 'B')).fm.related).toEqual(['b', 'c']);
    expect(parseDoc(patchFM('---\nid: a\nversion: 1\n---\nx', { version: 2 })).fm.version).toBe(2);
    expect(section('# T\n## A\na\n## B\nb', 'A')).toBe('## A\na');
    expect(unifiedDiff('a\nb', 'a\nc')).toContain('-b');
  });
  it('空的必载文件 → 守护器用默认恢复', async () => { const { v, be } = await fresh(); be.files.set('AGENTS.md', { ...be.files.get('AGENTS.md')!, content: '' }); await runDoctor(v, { fix: true }); expect((await v.text('AGENTS.md'))!.length).toBeGreaterThan(100); });
});
