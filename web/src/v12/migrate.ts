/**
 * 1.2.0 迁移（PROMPT-v1.2 第十二部分）：现有 Agent → 超级 Agent，数据原样保留；幂等；迁移前自动快照，可整体回滚。
 * 1）super/SUPER.md（指挥职责，非核心）缺失则补上；2）config/super.json 控制平面缺失则建空状态；
 * 3）内置平台 → 只读模板副本 platforms/<id>/PLATFORM.md（readonly: true，source: builtin；写法仍只在技能里）；
 * 4）AGENTS.md 的“指挥职责”引用（proposals-v1.2 P1）以“核心文件修订”进审批收件箱，等你确认，不直接改；
 * 5）用户平台并入 PLATFORMS 注册表；一次性子任务机制不变（agent.subtasks 开关照旧）。
 */
import { DEFAULT_FILES, PLATFORM_TEMPLATES, serializePlatformMd, platformPath, emptySuperState, writeSuperState, newApproval, readSuperState, registerUserPlatforms, parsePlatformMd } from '@content-agent/shared';
import { db } from '../local/db';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';
import { CENTERS } from '../data/platforms';

const DONE = 'migrations.v12';
const SNAP = 'v12_snapshot';
const STATE = 'config/super.json';
export const P1_MARK = '0. 指挥：多步目标先按 super/SUPER.md';
export function agentsWithDuties(agents: string): string {
  if (agents.includes(P1_MARK)) return agents;
  return agents.replace('## 每一轮的顺序\n', `## 每一轮的顺序\n${P1_MARK} 拆解、选执行者（自己做 / 交给子 Agent / 提议新建子 Agent）、交接、验收并对结果负责。\n`);
}
export interface V12Report { created: string[]; proposal: boolean; skipped: boolean }
export async function migrateV12(): Promise<V12Report> {
  const done = await db.getKV<{ at?: string } | null>(DONE);
  const v = await getVfs();
  // 每次启动都把用户平台并入注册表（注册表在内存里）
  const user = (await v.list('platforms')).filter((f) => /\/PLATFORM\.md$/.test(f.path)).map((f) => parsePlatformMd(f.content)).filter((p) => p.source === 'user');
  registerUserPlatforms(user.map((p) => ({ id: p.id, label: p.name, url: p.url, publishUrl: p.publishUrl, hosts: p.hosts, android: p.android, ios: p.ios })));
  if (done?.at) return { created: [], proposal: false, skipped: true };
  const targets = ['super/SUPER.md', STATE, ...PLATFORM_TEMPLATES.filter((t) => CENTERS.some((c) => c.id === t.id)).map((t) => platformPath(t.id))];
  // 快照：记录迁移前这些路径是否存在、内容是什么（回滚时据此还原 / 删除）
  const snap: Record<string, string | null> = {};
  for (const p of targets) snap[p] = (await v.read(p))?.content ?? null;
  await db.setKV(SNAP, { at: new Date().toISOString(), files: snap });
  const created: string[] = [];
  if (snap['super/SUPER.md'] === null && DEFAULT_FILES['super/SUPER.md']) { await v.write('super/SUPER.md', DEFAULT_FILES['super/SUPER.md'], { author: 'system', note: '1.2.0 迁移：超级 Agent 指挥职责' }); created.push('super/SUPER.md'); }
  let state = snap[STATE] === null ? emptySuperState() : readSuperState(snap[STATE]);
  for (const t of PLATFORM_TEMPLATES) {
    if (!CENTERS.some((c) => c.id === t.id)) continue;
    const p = platformPath(t.id);
    if (snap[p] !== null) continue;
    await v.write(p, serializePlatformMd({ ...t, readonly: true, source: 'builtin' }), { author: 'system', note: '1.2.0 迁移：内置平台只读模板副本' });
    created.push(p);
  }
  const agents = (await v.read('AGENTS.md'))?.content;
  let proposal = false;
  if (agents && !agents.includes(P1_MARK) && !state.approvals.some((a) => (a.payload as { proposal?: string })?.proposal === 'v1.2-P1')) {
    state = { ...state, approvals: [...state.approvals, newApproval({ kind: 'core_file', from: 'super', why: 'AGENTS.md 增加“指挥职责”引用（修订建议 P1）', impact: '只是引用 super/SUPER.md，不改变任何权限与边界；拒绝也不影响 1.2 功能', estCost: null, preview: agentsWithDuties(agents), payload: { action: 'core_file', path: 'AGENTS.md', proposal: 'v1.2-P1' } })] };
    proposal = true;
  }
  await v.write(STATE, writeSuperState(state), { author: 'system', allowLarge: true });
  if (snap[STATE] === null) created.push(STATE);
  await db.setKV(DONE, { at: new Date().toISOString(), created });
  await audit({ kind: 'migration', actor: 'system', summary: `1.2.0 迁移：现有 Agent 升级为超级 Agent；新建 ${created.length} 个文件（指挥职责、控制平面、${created.filter((p) => p.startsWith('platforms/')).length} 个内置平台只读模板）${proposal ? '；AGENTS.md 修订建议已进审批收件箱' : ''}；原有数据未改动`, outcome: 'ok', detail: { created } });
  return { created, proposal, skipped: false };
}
/** 降级 / 回滚：按快照还原——迁移新建的文件删除（进回收站），原有文件恢复原文；标记清除，下次启动可重新迁移。 */
export async function rollbackV12(): Promise<string[]> {
  const s = await db.getKV<{ files: Record<string, string | null> } | null>(SNAP);
  const out: string[] = [];
  if (!s) return out;
  const v = await getVfs();
  for (const [p, c] of Object.entries(s.files)) {
    const cur = await v.read(p);
    if (c === null) { if (cur) { await v.softDelete(p, 'system'); out.push(p); } }
    else if (cur && cur.content !== c) { await v.write(p, c, { author: 'system', note: '1.2.0 迁移回滚', allowLarge: true }); out.push(p); }
  }
  await db.setKV(DONE, {});
  await audit({ kind: 'migration', actor: 'user', summary: `1.2.0 迁移已回滚：${out.length} 个文件还原`, outcome: 'ok', detail: { files: out } });
  return out;
}
