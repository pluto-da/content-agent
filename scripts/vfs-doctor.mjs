#!/usr/bin/env node
/**
 * vfs:doctor（C31 / C34 / C44 / C47 / C52）：在内存 VFS 上做一次“首启 → 自检 → 人为破坏 → 自动修复”，输出 out/vfs-doctor-report.json。
 *  1. 首启生成全部默认文件，目录守护器 0 问题；
 *  2. 默认正文与仓库来源逐字一致：semiotics/ ↔ agent/semiotics/，docs/core-directive.md ↔ agent/v9/core-directive-v1.md，agent/v9/defaults/**（规格抽取件为正文子串）；
 *  3. SOUL.md 第一部分覆盖 core-directive-keypoints 全部要点；SOUL / AGENTS 含指向 semiotics/PRINCIPLES.md 的一段；
 *  4. 删掉入口文件 → 自动恢复；新增文件 → 入口索引段同步；
 *  5. 每个文件夹都有入口文件；revenue 无凭据记录会被报告。
 * 依赖 shared/dist（npm ci 的 postinstall 会构建）。用法：node scripts/vfs-doctor.mjs [--json]；有未修复问题时退出码 1。
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(join(root, 'shared/dist/index.js'));
const { Vfs, memoryVfsBackend, initVfs, runDoctor, DEFAULT_FILES, CORE_KEYPOINTS, soulPart1, entryPath } = S;

const checks = [];
const check = (id, ok, detail) => { checks.push({ id, ok: !!ok, detail }); };

const be = memoryVfsBackend();
const vfs = new Vfs(be);
const init = await initVfs(vfs);
const files = await vfs.list();
check('init.created', init.created === Object.keys(DEFAULT_FILES).length, `生成 ${init.created} / ${Object.keys(DEFAULT_FILES).length} 个文件`);
check('init.doctor_clean', init.report.problems.filter((p) => !p.fixed).length === 0, `首启自检问题 ${init.report.problems.length}（未修复 ${init.report.problems.filter((p) => !p.fixed).length}）`);

// 2. 逐字一致
const read = (p) => readFileSync(join(root, p), 'utf8');
const semDir = join(root, 'agent/semiotics');
const semNames = readdirSync(semDir);
const semBad = semNames.filter((n) => (DEFAULT_FILES[`semiotics/${n}`] ?? '') !== read(`agent/semiotics/${n}`));
check('verbatim.semiotics', semBad.length === 0 && semNames.length >= 7, `semiotics ${semNames.length} 个文件，不一致 ${semBad.length}${semBad.length ? `：${semBad.join('、')}` : ''}`);
check('verbatim.core_directive', DEFAULT_FILES['docs/core-directive.md'] === read('agent/v9/core-directive-v1.md'), 'docs/core-directive.md ↔ agent/v9/core-directive-v1.md');
const specFiles = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else specFiles.push(relative(join(root, 'agent/v9/defaults'), p).replace(/\\/g, '/')); } };
walk(join(root, 'agent/v9/defaults'));
const strip = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const specBad = specFiles.filter((p) => { const spec = strip(read(`agent/v9/defaults/${p}`)); const cur = DEFAULT_FILES[p] ?? ''; return !cur.includes(spec.split('\n').slice(0, 3).join('\n')) || !cur.includes(spec.split('\n').slice(-2).join('\n')); });
check('verbatim.spec_defaults', specBad.length === 0, `规格抽取件 ${specFiles.length} 个，开头 / 结尾不一致 ${specBad.length}${specBad.length ? `：${specBad.slice(0, 5).join('、')}` : ''}`);

// 3. 核心指令要点、semiotics 指向段
const p1 = soulPart1(DEFAULT_FILES['SOUL.md'] ?? '') ?? '';
const missing = Object.entries(CORE_KEYPOINTS).flatMap(([k, pts]) => pts.filter((x) => !p1.includes(x)).map((x) => `${k}:${x}`));
check('core.keypoints', missing.length === 0, `要点 ${Object.values(CORE_KEYPOINTS).flat().length} 条，缺失 ${missing.length}${missing.length ? `：${missing.slice(0, 5).join('；')}` : ''}`);
check('semiotics.pointer', ['SOUL.md', 'AGENTS.md'].every((p) => (DEFAULT_FILES[p] ?? '').includes('semiotics/PRINCIPLES.md')), 'SOUL.md 与 AGENTS.md 各含指向 semiotics/PRINCIPLES.md 的一段（deviations-v9 D-SEM 补入）');
check('semiotics.on_demand', semNames.every((n) => /\nload: on_demand\n/.test(DEFAULT_FILES[`semiotics/${n}`] ?? '')), 'semiotics/* front matter 均为 load: on_demand');

// 5. 每个文件夹都有入口文件
const dirs = [...new Set(files.filter((f) => f.path.includes('/')).map((f) => f.path.split('/').slice(0, -1).join('/')))];
const top = [...new Set(dirs.map((d) => d.split('/')[0]))];
const noEntry = top.filter((d) => !files.some((f) => f.path === entryPath(d)));
check('folders.entry', noEntry.length === 0, `顶层文件夹 ${top.length} 个，缺入口 ${noEntry.length}${noEntry.length ? `：${noEntry.join('、')}` : ''}`);

// 4. 人为破坏 → 自动修复 / 同步
const victim = entryPath('skills');
await be.deleteFile(victim);
const r1 = await runDoctor(vfs, { fix: true });
check('doctor.restore_entry', !!(await vfs.read(victim)) && r1.fixed >= 1, `删除 ${victim} 后自动恢复（修复 ${r1.fixed} 处）`);
await vfs.write('skills/doctor-probe/SKILL.md', '---\nname: doctor-probe\ndescription: 守护器测试技能\nversion: 1\nsource: user\n---\n# 测试\n', { author: 'user' });
const r2 = await runDoctor(vfs, { fix: true });
check('doctor.index_sync', ((await vfs.text(victim)) ?? '').includes('doctor-probe'), `新增 skills/doctor-probe/SKILL.md 后入口索引同步（修复 ${r2.fixed}）`);
const r3 = await runDoctor(vfs, { fix: false, revenue: [{ id: 'rev-x' }] });
check('doctor.revenue_no_source', r3.problems.some((p) => p.kind === 'revenue_no_source'), '无来源凭据的收入记录被报告（C47）');
const final = await runDoctor(vfs, { fix: true });
check('doctor.final_clean', final.problems.filter((p) => !p.fixed).length === 0, `最终未修复问题 ${final.problems.filter((p) => !p.fixed).length}`);

const report = { at: new Date().toISOString(), files: files.length, folders: dirs.length, pass: checks.every((c) => c.ok), checks, firstRun: init.report };
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/vfs-doctor-report.json'), JSON.stringify(report, null, 1));
for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.id} — ${c.detail}`);
console.log(`vfs:doctor ${report.pass ? '0 问题' : '有问题'}（${files.length} 个文件，${dirs.length} 个文件夹）→ out/vfs-doctor-report.json`);
if (!report.pass) process.exit(1);
