/** 统一能力层的本机接线：配置（v3）+ 安全存储里的 Key + 传输 + 健康 + 记账 + 缓存；媒体结果立即下载入库（结果链接常 1–24 小时失效）。 */
import { resolveModel, callRole, pollJob, listModels, probeEntry, statusFromProbes, configuredRoles, findEntry, estimateCost, priceOf, flagOn, type CallDeps, type RoleId, type RoleRequest, type RoleTarget, type MediaOut, type Parsed, type ModelsStateV3, type ProviderAccount, type ModelEntry } from '@content-agent/shared';
import { getModelsV3, saveModelsV3, getPrefs } from '../local/store';
import { getSecret } from '../local/secrets';
import { db, type Row } from '../local/db';
import { noteMediaSaved } from './media/store';
import { webTransport, isWeb, online } from './transport';
import { health, recordUsage, audit } from './ops';
import { labelExplicit, labelImplicit } from './aigc';

const cacheMem = new Map<string, Parsed>();
export async function flags(): Promise<Record<string, boolean>> { return ((await getPrefs()) as unknown as { flags?: Record<string, boolean> }).flags ?? {}; }
export async function deps(state?: ModelsStateV3): Promise<CallDeps> {
  const s = state ?? (await getModelsV3());
  const f = await flags();
  return {
    state: s, transport: webTransport, web: isWeb(), online, health, healthRouting: flagOn('models.healthRouting', f),
    getKey: async (a: ProviderAccount, t: RoleTarget) => getSecret(t.overrideSecretRef ?? a.secretRef),
    onUsage: (r) => recordUsage(r),
    cache: { get: async (k) => cacheMem.get(k) ?? (await db.getKV<Parsed>(`cache:${k}`)), set: async (k, v) => { cacheMem.set(k, v); if (v.value.type === 'vectors') await db.setKV(`cache:${k}`, v); } },
  };
}
export async function call(role: RoleId, req: RoleRequest, o: Parameters<typeof callRole>[3] = {}) { return callRole(role, req, await deps(), o); }
export async function poll(target: RoleTarget, jobId: string, signal?: AbortSignal) { return pollJob(target, jobId, await deps(), { signal }); }
export async function isRoleConfigured(role: RoleId): Promise<boolean> { return configuredRoles(await getModelsV3()).includes(role); }
export async function estimate(role: RoleId, est: { chars?: number; images?: number; seconds?: number }): Promise<number | null> {
  const s = await getModelsV3(); const t = resolveModel(s, undefined, role)?.target; const e = t ? findEntry(s, t.modelEntryId) : null;
  return estimateCost(role, e ? priceOf(e.account.vendor, e.entry.model, s.prices) : undefined, est);
}

export interface MediaRow { id: number; kind: 'image' | 'audio' | 'video'; mime: string; dataUrl: string; model: string; prompt: string; role: RoleId; aiLabel: { explicit: boolean; implicit: boolean; reason?: string }; created_at?: string; sourceUrl?: string; note?: string }
async function download(url: string): Promise<{ base64: string; mime: string } | null> {
  try { const r = await webTransport.send({ method: 'GET', url, headers: {}, responseType: 'binary' }, { timeoutMs: 60000 }); return r.base64 ? { base64: r.base64, mime: r.mime ?? 'application/octet-stream' } : null; } catch { return null; }
}
export async function saveMedia(items: MediaOut[], meta: { role: RoleId; model: string; prompt: string; vendor?: string }): Promise<MediaRow[]> {
  const out: MediaRow[] = [];
  const f = await flags();
  for (const it of items) {
    let b64 = it.base64, mime = it.mime;
    let note: string | undefined;
    if (!b64 && it.url) { const d = await download(it.url); if (d) { b64 = d.base64; mime = d.mime.startsWith('application/') ? it.mime : d.mime; } else note = `结果链接未能下载（${it.ttlHours ? `约 ${it.ttlHours} 小时内有效` : '可能很快失效'}），请尽快在卡片上打开保存`; }
    const kind: MediaRow['kind'] = meta.role === 'tts' ? 'audio' : meta.role === 'video' || mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';
    let implicit = false, explicit = false;
    let dataUrl = b64 ? `data:${mime};base64,${b64}` : it.url ?? '';
    let implicitReason: string | undefined;
    if (b64) {
      // 0.10.0：图片 / 音频 / 视频都写隐式标识（服务商已有标识保留）；写不进去时记下白话原因，发布检查提醒在平台勾选声明
      const contentId = `ca-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const im = labelImplicit(b64, mime, { model: meta.model, provider: meta.vendor, contentId, at: new Date().toISOString() }, { beep: kind === 'audio' && flagOn('media.audioCue', f) });
      implicit = im.implicit; implicitReason = im.reason; if (im.note) note = note ? `${note}；${im.note}` : im.note;
      dataUrl = `data:${mime};base64,${im.base64}`;
      if (kind === 'image' && flagOn('media.aiLabel', f)) { const ex = await labelExplicit(dataUrl); explicit = ex.explicit; if (ex.explicit) dataUrl = ex.dataUrl; }
    }
    const row = await db.insert('media', { kind, mime, dataUrl, model: meta.model, prompt: meta.prompt.slice(0, 200), role: meta.role, aiLabel: { explicit, implicit, ...(implicitReason ? { reason: implicitReason } : {}) }, sourceUrl: b64 ? undefined : it.url, note });
    out.push(row as unknown as MediaRow);
  }
  await noteMediaSaved(out as unknown as Row[]).catch(() => {});
  return out;
}
export async function getMedia(id: string | number): Promise<MediaRow | null> {
  const n = Number(String(id).replace(/^media-/, ''));
  return ((await db.get('media', n)) as unknown as MediaRow | undefined) ?? null;
}
/** 探测并把结果写回模型名条目（状态 / lastProbe）。 */
export async function probe(accountId: string, entryId: string, o: { allowPaid?: boolean; roles?: RoleId[] } = {}) {
  const s = await getModelsV3();
  const a = s.accounts.find((x) => x.id === accountId); const e = a?.models.find((x) => x.id === entryId);
  if (!a || !e) return [];
  const res = await probeEntry(a, e, await deps(s), o);
  const s2 = await getModelsV3();
  const e2 = s2.accounts.find((x) => x.id === accountId)?.models.find((x) => x.id === entryId) as ModelEntry | undefined;
  if (e2) { e2.probes = { ...(e2.probes ?? {}), ...Object.fromEntries(res.map((r) => [r.role, r.result])) }; e2.status = statusFromProbes(res); e2.lastProbe = res.find((r) => r.result.kind !== 'needs_confirm')?.result ?? e2.lastProbe; e2.updatedAt = Date.now(); await saveModelsV3(s2); }
  await audit({ kind: 'tool_call', actor: 'user', summary: `测试模型 ${e.model}（${res.map((r) => `${r.role}:${r.result.ok ? '通过' : r.result.kind ?? '失败'}`).join('、')}）`, target: `${accountId}/${e.model}`, outcome: res.every((r) => r.result.ok || r.result.kind === 'needs_confirm') ? 'ok' : 'failed' });
  return res;
}
export async function fetchList(accountId: string) {
  const s = await getModelsV3(); const a = s.accounts.find((x) => x.id === accountId);
  if (!a) return { ok: false as const, error: { reason: '账号不存在' } };
  return listModels(a, { transport: webTransport, web: isWeb(), apiKey: await getSecret(a.secretRef) });
}
export { pollJob };
