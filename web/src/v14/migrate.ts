/**
 * 1.4.0 迁移（PROMPT-v1.4 第十四部分）：迁移前自动快照；上市公司模式默认关闭（config/listed.json 缺失则建关闭状态）；
 * 1.3 集团平滑升级：经管会、HR 委员会在董事会之下继续存在并向董事会报告（board.reportsFrom）；原有 OKR、制度、案例不动；1.3 的复盘结论自动转为集团大学案例卡。
 * 幂等；降级：按快照还原 config/listed.json，迁移之后才出现的 skills/best-practice-* 进回收站（30 天可恢复）。
 */
import { emptyListedState, writeListedState, readListedState, readGroupState, fromRetro, addCase } from '@content-agent/shared';
import { db } from '../local/db';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';

const DONE = 'migrations.v14';
const SNAP = 'v14_snapshot';
const STATE = 'config/listed.json';
const isBp = (p: string) => /^skills\/best-practice-[^/]+\/SKILL\.md$/.test(p);
export interface V14Report { created: string[]; skipped: boolean; enabled: boolean; casesFromRetros: number }
export async function migrateV14(): Promise<V14Report> {
  const done = await db.getKV<{ at?: string } | null>(DONE);
  const v = await getVfs();
  if (done?.at) return { created: [], skipped: true, enabled: readListedState((await v.read(STATE))?.content).enabled, casesFromRetros: 0 };
  const prev = (await v.read(STATE))?.content ?? null;
  const skills = (await v.list('skills')).map((f) => f.path).filter(isBp);
  await db.setKV(SNAP, { at: new Date().toISOString(), state: prev, skills });
  const created: string[] = [];
  let s = prev === null ? emptyListedState() : readListedState(prev);
  const g = readGroupState((await v.read('config/group.json'))?.content);
  const before = s.cases.length;
  for (const r of g.retros) s = { ...s, cases: addCase(s.cases, fromRetro({ id: r.id, subject: r.subject, steps: r.steps, lessons: r.lessons }, new Date().toISOString())) };
  const casesFromRetros = s.cases.length - before;
  if (prev === null || casesFromRetros) { await v.write(STATE, writeListedState(s), { author: 'system', note: '1.4.0 迁移：上市公司模式默认关闭；1.3 复盘转为案例卡', allowLarge: true }); if (prev === null) created.push(STATE); }
  await db.setKV(DONE, { at: new Date().toISOString(), created });
  await audit({ kind: 'migration', actor: 'system', summary: `1.4.0 迁移：上市公司模式${s.enabled ? '保持已启用（来自备份）' : '默认关闭'}；1.3 复盘转为案例卡 ${casesFromRetros} 张；经管会、HR 委员会向董事会报告；原有数据未改动`, outcome: 'ok', detail: { created, casesFromRetros } });
  return { created, skipped: false, enabled: s.enabled, casesFromRetros };
}
export async function rollbackV14(): Promise<string[]> {
  const snap = await db.getKV<{ state: string | null; skills: string[] } | null>(SNAP);
  const out: string[] = [];
  if (!snap) return out;
  const v = await getVfs();
  const cur = await v.read(STATE);
  if (snap.state === null) { if (cur) { await v.softDelete(STATE, 'system'); out.push(STATE); } }
  else if (cur && cur.content !== snap.state) { await v.write(STATE, snap.state, { author: 'system', note: '1.4.0 迁移回滚', allowLarge: true }); out.push(STATE); }
  for (const f of await v.list('skills')) if (isBp(f.path) && !snap.skills.includes(f.path)) { await v.softDelete(f.path, 'system'); out.push(f.path); }
  await db.setKV(DONE, {});
  await audit({ kind: 'migration', actor: 'user', summary: `1.4.0 迁移已回滚：${out.length} 个文件还原或进回收站`, outcome: 'ok', detail: { files: out.length } });
  return out;
}
