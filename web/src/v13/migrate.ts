/**
 * 1.3.0 迁移（PROMPT-v1.3-conglomerate 第十七部分）：迁移前自动快照；集团模式默认关闭（config/group.json 缺失则建关闭状态）；
 * 1.2 的超级 Agent 即 CEO、子 Agent 在启用集团模式时按职责归入默认部门（其余进“待分配”）；1.2 的目标在启用后由董事长确认是否作为年度目标；
 * 幂等；原有数据不动；降级：按快照还原 config/group.json，company/ 下的文件进回收站（30 天可恢复）。
 */
import { emptyGroupState, writeGroupState, readGroupState } from '@content-agent/shared';
import { db } from '../local/db';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';

const DONE = 'migrations.v13';
const SNAP = 'v13_snapshot';
const STATE = 'config/group.json';
export interface V13Report { created: string[]; skipped: boolean; enabled: boolean }
export async function migrateV13(): Promise<V13Report> {
  const done = await db.getKV<{ at?: string } | null>(DONE);
  const v = await getVfs();
  if (done?.at) return { created: [], skipped: true, enabled: readGroupState((await v.read(STATE))?.content).enabled };
  const prev = (await v.read(STATE))?.content ?? null;
  const company = (await v.list('company')).map((f) => f.path);
  await db.setKV(SNAP, { at: new Date().toISOString(), state: prev, company });
  const created: string[] = [];
  if (prev === null) { await v.write(STATE, writeGroupState(emptyGroupState()), { author: 'system', note: '1.3.0 迁移：集团模式默认关闭', allowLarge: true }); created.push(STATE); }
  await db.setKV(DONE, { at: new Date().toISOString(), created });
  const enabled = readGroupState(prev).enabled;
  await audit({ kind: 'migration', actor: 'system', summary: `1.3.0 迁移：集团模式${enabled ? '保持已启用（来自备份）' : '默认关闭'}；子 Agent 在启用时按职责归入默认部门；原有数据未改动`, outcome: 'ok', detail: { created } });
  return { created, skipped: false, enabled };
}
/** 降级 / 回滚：还原 config/group.json；迁移之后才出现的 company/ 文件进回收站；标记清除。 */
export async function rollbackV13(): Promise<string[]> {
  const s = await db.getKV<{ state: string | null; company: string[] } | null>(SNAP);
  const out: string[] = [];
  if (!s) return out;
  const v = await getVfs();
  const cur = await v.read(STATE);
  if (s.state === null) { if (cur) { await v.softDelete(STATE, 'system'); out.push(STATE); } }
  else if (cur && cur.content !== s.state) { await v.write(STATE, s.state, { author: 'system', note: '1.3.0 迁移回滚', allowLarge: true }); out.push(STATE); }
  for (const f of await v.list('company')) if (!s.company.includes(f.path)) { await v.softDelete(f.path, 'system'); out.push(f.path); }
  await db.setKV(DONE, {});
  await audit({ kind: 'migration', actor: 'user', summary: `1.3.0 迁移已回滚：${out.length} 个文件还原或进回收站`, outcome: 'ok', detail: { files: out.length } });
  return out;
}
