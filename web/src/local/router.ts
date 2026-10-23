/**
 * 本机“接口”：按路径分派到 IndexedDB 与本机执行层，路径与返回形状尽量与服务端一致（/api/drafts、/api/local-apps …），
 * 页面因此只认 get/post/put/del，不关心数据在手机里还是在服务器上。
 */
import { db, type Row } from './db';
import { generateDraft, reviseDraft } from './generate';
import { fetchHot, type HotEntry, type SourceResult } from './hot';
import { getModels, getPrefs, log, saveModels, setPrefs, type ModelsState } from './store';
import { KNOWN_APPS } from '../data/platforms';

export class LocalError extends Error {
  constructor(public code: string, message: string, public advice = '', public status = 400) { super(message); }
}

type Handler = (m: RegExpMatchArray, body: any, q: URLSearchParams) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, re: RegExp, h: Handler) => routes.push([method, re, h]);
const num = (s: string | undefined) => Number(s);
const byNewest = (a: Row, b: Row) => b.id - a.id;
const TRANSITIONS: Record<string, string[]> = { pending: ['approved', 'rejected'], rejected: ['pending'], approved: ['handed_off', 'pending'], handed_off: ['approved'] };

on('GET', /^\/api\/health$/, async () => ({ ok: true, version: '1.0.0', mode: 'local' }));

/* ---------- 草稿 ---------- */
on('GET', /^\/api\/drafts$/, async (_m, _b, q) => {
  const status = q.get('status');
  const all = (await db.all('drafts')).sort(byNewest);
  return { drafts: status ? all.filter((d) => d.status === status) : all };
});
on('GET', /^\/api\/drafts\/(\d+)$/, async (m) => {
  const d = await db.get('drafts', num(m[1]));
  if (!d) throw new LocalError('not_found', '这篇草稿不存在了', '回到“写内容”列表看看', 404);
  return { draft: d, edits: [] };
});
on('PUT', /^\/api\/drafts\/(\d+)$/, async (m, b) => {
  if (typeof b?.body !== 'string' || !b.body.trim()) throw new LocalError('bad_request', '正文不能为空', '写点内容再保存');
  await db.update('drafts', num(m[1]), { body: b.body, ...(typeof b.title === 'string' ? { title: b.title } : {}), ...(b.platform ? { platform: b.platform } : {}) });
  return { ok: true };
});
on('DELETE', /^\/api\/drafts\/(\d+)$/, async (m) => { await db.del('drafts', num(m[1])); return { ok: true }; });
on('POST', /^\/api\/drafts\/(\d+)\/status$/, async (m, b) => {
  const d = await db.get('drafts', num(m[1]));
  if (!d) throw new LocalError('not_found', '这篇草稿不存在了', '', 404);
  const to = String(b?.status);
  if (!TRANSITIONS[String(d.status)]?.includes(to)) throw new LocalError('bad_transition', '现在不能改成这个状态', '先审核通过，再去发布');
  await db.update('drafts', d.id, { status: to, ...(to === 'handed_off' ? { published_at: new Date().toISOString() } : {}) });
  return { ok: true };
});
on('POST', /^\/api\/drafts\/(\d+)\/handoff\/copy$/, async (m) => {
  const d = await db.get('drafts', num(m[1]));
  if (!d) throw new LocalError('not_found', '这篇草稿不存在了', '', 404);
  if (d.status !== 'approved' && d.status !== 'handed_off') throw new LocalError('bad_transition', '还没审核通过', '先在“写内容”里点“通过”');
  await db.update('drafts', d.id, { status: 'handed_off', published_at: new Date().toISOString() });
  return { ok: true, lastStep: '请在官方 App 里粘贴，并由你本人点击发布' };
});
on('POST', /^\/api\/compose$/, async (_m, b) => {
  const r = await generateDraft(String(b?.idea ?? ''), String(b?.platform ?? 'xiaohongshu'), { providerId: b?.providerId, model: b?.model });
  const prefs = await getPrefs();
  return { draftId: r.draft.id, draft: r.draft, firstPass: r.firstPass, warnings: r.warnings, ms: r.ms, cost: r.cost, suggestBackup: !prefs.backupHinted };
});
on('POST', /^\/api\/drafts\/(\d+)\/revise$/, async (m, b) => {
  const d = await db.get('drafts', num(m[1]));
  if (!d) throw new LocalError('not_found', '这篇草稿不存在了', '', 404);
  const r = await reviseDraft(d, String(b?.instruction ?? ''), { providerId: b?.providerId, model: b?.model });
  return { draft: r.draft, ms: r.ms, cost: r.cost, warnings: r.warnings };
});

/* ---------- 选题与热点 ---------- */
on('GET', /^\/api\/topics$/, async () => ({ topics: (await db.all('topics')).sort(byNewest) }));
on('GET', /^\/api\/hot$/, async () => (await db.getKV<{ items: HotEntry[]; sources: SourceResult[]; at: string }>('hot')) ?? { items: [], sources: [], at: null });
on('POST', /^\/api\/hot\/fetch$/, async () => {
  const prefs = await getPrefs();
  const r = await fetchHot(prefs.hotSources);
  const at = new Date().toISOString();
  const prev = (await db.getKV<{ items: HotEntry[] }>('hot'))?.items ?? [];
  // 全部失败时保留上一次的结果，并如实返回失败原因
  await db.setKV('hot', { items: r.items.length ? r.items : prev, sources: r.sources, at });
  await log(r.items.length ? 'info' : 'warn', `读取热点：${r.sources.map((s) => `${s.label}${s.ok ? ` ${s.count} 条` : `失败（${s.reason}）`}`).join('；')}`);
  return { items: r.items.length ? r.items : prev, sources: r.sources, at, fresh: r.items.length > 0 };
});

/* ---------- 本地软件（添加软件） ---------- */
on('GET', /^\/api\/local-apps$/, async () => ({ apps: (await db.all('apps')).sort((a, b) => a.id - b.id), known: KNOWN_APPS, os: ['android', 'ios', 'windows', 'mac'] }));
on('PUT', /^\/api\/local-apps$/, async (_m, b) => {
  if (!b?.platform || !b?.os) throw new LocalError('bad_local_app', '缺少平台或系统', '回到第一步重新选平台');
  if (b.os === 'android' && b.package_name && !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(b.package_name)) throw new LocalError('bad_local_app', '包名格式不对', '例如 com.xingin.xhs');
  const exist = (await db.all('apps')).find((a) => a.platform === b.platform && a.os === b.os);
  const row = { platform: b.platform, os: b.os, label: b.label ?? b.platform, package_name: b.package_name ?? null, deep_link: b.deep_link ?? null, url_scheme: b.url_scheme ?? null, exec_path: b.exec_path ?? null, protocol: b.protocol ?? null };
  const app = exist ? await db.update('apps', exist.id, row) : await db.insert('apps', row);
  await log('info', `添加软件：${row.label}（${row.os}）`);
  return { app };
});
on('DELETE', /^\/api\/local-apps\/(\d+)$/, async (m) => { await db.del('apps', num(m[1])); return { ok: true }; });

/* ---------- 看效果 ---------- */
on('GET', /^\/api\/metrics$/, async () => ({ metrics: await db.all('metrics') }));
on('PUT', /^\/api\/metrics\/(\d+)$/, async (m, b) => {
  const draftId = num(m[1]);
  const vals = Object.fromEntries(['views', 'likes', 'comments', 'collects', 'shares'].map((k) => [k, Math.max(0, Math.floor(Number(b?.[k]) || 0))]));
  const exist = (await db.all('metrics')).find((x) => x.draft_id === draftId);
  const row = exist ? await db.update('metrics', exist.id, vals) : await db.insert('metrics', { draft_id: draftId, ...vals });
  return { metric: row };
});

/* ---------- 通知、日志、备份 ---------- */
on('GET', /^\/api\/notifications$/, async () => ({ pendingDrafts: (await db.all('drafts')).filter((d) => d.status === 'pending').length, hotMatches: [] }));
on('GET', /^\/api\/logs$/, async () => ({ logs: (await db.all('logs')).sort(byNewest).slice(0, 200) }));
on('GET', /^\/api\/backup\/export$/, async (_m, _b, q) => {
  const withKeys = q.get('keys') === '1';
  const models = await getModels();
  const withInbox = q.get('inbox') !== '0';
  // 备份 version 2（0.8.0）：多了会话、消息、素材箱（可取消勾选）、任务检查点与账号画像；数据源密钥永不导出
  const data: Record<string, unknown> = { format: 'content-agent-local-backup', version: 2, exportedAt: new Date().toISOString(), includesKeys: withKeys };
  for (const c of ['drafts', 'topics', 'apps', 'metrics', 'conversations', 'messages', 'tasks'] as const) data[c] = await db.all(c);
  if (withInbox) data.inbox = await db.all('inbox');
  data.profile = (await db.getKV('profile')) ?? null;
  data.prefs = await getPrefs();
  data.assistants = (await db.getKV('assistants')) ?? {};
  // 默认不含密钥：只保留服务商、地址与模型名
  data.models = { ...models, providers: models.providers.map((p) => ({ ...p, apiKey: withKeys ? p.apiKey : '' })) };
  await setPrefs({ backupHinted: true });
  return data;
});
on('POST', /^\/api\/backup\/import$/, async (_m, b) => {
  if (!b || b.format !== 'content-agent-local-backup') throw new LocalError('import_failed', '这不是本应用导出的备份文件', '请选择“我的 → 备份”导出的 .json 文件');
  let n = 0;
  // 兼容 version 1（只有 drafts / topics / apps / metrics）与 version 2
  for (const c of ['drafts', 'topics', 'apps', 'metrics', 'conversations', 'messages', 'tasks', 'inbox'] as const) {
    if (!Array.isArray(b[c])) continue;
    await db.clear(c);
    for (const r of b[c]) { await db.insert(c, r); n++; }
  }
  if (b.prefs) await setPrefs(b.prefs);
  if (b.assistants) await db.setKV('assistants', b.assistants);
  if (b.profile) await db.setKV('profile', b.profile);
  if (b.models) {
    const cur = await getModels();
    const incoming = b.models as ModelsState;
    // 备份里没有 Key 时保留本机已有的 Key
    incoming.providers = (incoming.providers ?? []).map((p) => ({ ...p, apiKey: p.apiKey || cur.providers.find((x) => x.id === p.id)?.apiKey || '' }));
    await saveModels({ ...cur, ...incoming });
  }
  await log('info', `从备份恢复 ${n} 条记录`);
  return { ok: true, restored: n };
});

export async function localApi(path: string, method: string, body: unknown): Promise<unknown> {
  const [p, qs = ''] = path.split('?');
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = p!.match(re);
    if (match) return h(match, body, new URLSearchParams(qs));
  }
  throw new LocalError('needs_server', '这项功能需要连接服务器', '配音、配图、合成视频等重活需要在“我的 → 连接服务器”里连上你自己的服务器', 501);
}
