import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { HARD_BOUNDARIES } from './boundaries.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const dataDir = resolve(process.env.CA_DATA_DIR ?? resolve(root, 'data'));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

console.log('【硬边界】');
HARD_BOUNDARIES.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));

const { app, ctx } = await buildApp({
  dataDir,
  agentDefaultsDir: resolve(process.env.CA_AGENT_DEFAULTS ?? resolve(root, 'agent')),
  webDist: resolve(process.env.CA_WEB_DIST ?? resolve(root, 'web', 'dist')),
  logEcho: process.env.CA_LOG_ECHO === '1',
});
if (process.env.CA_SCHEDULER === '1') ctx.scheduler.start();
await app.listen({ port, host });
console.log(`Content Agent 已启动：http://${host}:${port}（数据目录 ${dataDir}）`);
