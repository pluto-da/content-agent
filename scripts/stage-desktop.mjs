#!/usr/bin/env node
/**
 * 1.0 桌面安装包暂存：把后端打成单文件（esbuild，含 fastify / cheerio / undici / shared），连同 web/dist、agent/ 放到 desktop/stage/，
 * 安装包只带这些（不再整份复制根 node_modules：0.x 的 extraResources 会把 electron、vite 等开发依赖一并打进去）。
 * 先 npm run build。用法：node scripts/stage-desktop.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'desktop', 'stage');
for (const p of ['server/dist/index.js', 'web/dist/index.html', 'agent']) if (!existsSync(join(root, p))) { console.error(`缺少 ${p}：先运行 npm run build`); process.exit(1); }
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'server', 'dist'), { recursive: true });
await build({
  entryPoints: [join(root, 'server/dist/index.js')], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: join(stage, 'server/dist/index.mjs'), logLevel: 'warning', legalComments: 'none',
  banner: { js: "import { createRequire as __caRequire } from 'node:module'; const require = __caRequire(import.meta.url);" },
});
cpSync(join(root, 'web/dist'), join(stage, 'web/dist'), { recursive: true });
cpSync(join(root, 'agent'), join(stage, 'agent'), { recursive: true });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const size = (p) => { const s = statSync(p); if (!s.isDirectory()) return s.size; let n = 0; for (const f of readdirSync(p)) n += size(join(p, f)); return n; };
const manifest = { version, at: new Date().toISOString(), server: size(join(stage, 'server')), web: size(join(stage, 'web')), agent: size(join(stage, 'agent')) };
writeFileSync(join(stage, 'stage-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`desktop/stage：server ${(manifest.server / 1e6).toFixed(1)} MB、web ${(manifest.web / 1e6).toFixed(1)} MB、agent ${(manifest.agent / 1e6).toFixed(1)} MB（${version}）`);
