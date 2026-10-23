/**
 * 我的 → 模型（0.9.0，9.1）：11 个能力角色按 5 组显示；角色二级页（设置 | 试一试 | 用量）；账号与 Key；账号详情（模型名手填、获取列表、按能力测试）。
 * 规则：模型名原样保存、原样发送；Key 只进安全存储（只显示末 4 位）；同一服务商一个 Key 默认各能力通用，可按角色覆盖地址与 Key。
 */
import { useMemo, useState } from 'react';
import {
  ROLE_GROUPS, ROLE_IDS, ADAPTERS, adapterOf, roleDef, roleLabel, isRoleId, configuredRoles, candidatesFor, displayModel, findEntry, bindRole, addModelEntry, referencesOf,
  removeModelEntry, markAgainstList, MODEL_NAME_MESSAGES, PROBES, VERIFIED_LABEL, mergeDecl,
  type RoleId, type ModelsStateV3, type ModelEntry, type ProviderAccount, type ProbeResult, type CallResult,
} from '@content-agent/shared';
import { useT } from '../../../i18n';
import type { Layout } from '../../../nav';
import { saveModelsV3, getModelsV3 } from '../../../local/store';
import { setSecret, deleteSecret, secretTails, secretStorageInfo, secretStorageInfoAsync, undecryptableSecrets } from '../../../local/secrets';
import { call, probe, fetchList, saveMedia } from '../../../v9/models';
import { modelStats } from '../../../v9/ops';
import { addInbox } from '../../../agent/store';
import { db } from '../../../local/db';
import { GroupList, ListRow, Problem, StatusDot, Busy, useToast } from '../../../ui';
import { ModelsPage } from '../models';
import { RoutingPage } from '../../../v10/RoutingPage';
import { useAsync, useModelsV3, SegTabs, BackBar, Section, Note, pct } from './common';

const ROLE_ICON: Record<RoleId, string> = { chat: 'bot', reason: 'compass', fast: 'activity', vision: 'eye', image: 'wand', imageEdit: 'edit', tts: 'mic', asr: 'list', video: 'creator', embed: 'search', rerank: 'kanban' };
type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
export function entryTone(e: ModelEntry | undefined, role?: RoleId): Tone {
  if (!e) return 'neutral';
  const p = role ? e.probes?.[role] : undefined;
  if (p) return p.ok ? 'ok' : p.kind === 'needs_confirm' ? 'warn' : 'bad';
  return e.status === 'ok' ? 'ok' : ['failed', 'not_found', 'not_enabled'].includes(e.status) ? 'bad' : 'warn';
}
const TONE_TEXT: Record<Tone, string> = { ok: '已实测', warn: '未实测', bad: '最近测试失败', neutral: '未接' };

export function RolesPage({ id, go, lay }: { id: string | null; go: (to: string) => void; lay: Layout }) {
  if (!id) return <RolesIndex go={go} />;
  if (id === 'accounts') return <Accounts go={go} />;
  if (id === 'routing') return <RoutingPage go={go} />;
  if (id === 'legacy') return <ModelsPage id={null} go={go} lay={lay} />;
  if (id.startsWith('acc-')) return <AccountDetail accountId={id.slice(4)} go={go} />;
  if (isRoleId(id)) return <RoleDetail role={id} go={go} />;
  return <ModelsPage id={id} go={go} lay={lay} />;   // 0.6–0.8 服务商快速连接（#me/models/mimo 等旧链接）
}

/* ---------------- 一级页：5 组 11 个角色 ---------------- */
function RolesIndex({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { data: s, error } = useModelsV3();
  if (error) return <div className="page page-narrow"><Problem title={t('ui.failed_to_read_model_settings')} advice={error} /></div>;
  if (!s) return null;
  const done = configuredRoles(s);
  return (
    <div className="page page-narrow" data-testid="roles-index">
      <p className="m-0 mb-2 text-[15px] text-fg-2" data-testid="roles-count">{t('ui.connected_2')} {done.length} / {ROLE_IDS.length} {t('ui.roles')}</p>
      {ROLE_GROUPS.map((g) => (
        <GroupList key={g.id} title={t(g.label)}>
          {g.roles.map((r) => {
            const b = s.roles[r]; const f = b.primary ? findEntry(s, b.primary.modelEntryId) : null;
            const tone: Tone = done.includes(r) ? entryTone(f?.entry, r) : 'neutral';
            return <ListRow key={r} icon={ROLE_ICON[r]} label={t(roleLabel(r))} hint={f ? `${displayModel(f.entry)} · ${f.account.label}` : t('ui.not_set')} value={<StatusDot tone={tone}>{t(TONE_TEXT[tone])}</StatusDot>} onClick={() => go(`me/models/${r}`)} href={`#me/models/${r}`} testId={`role-${r}`} />;
          })}
        </GroupList>
      ))}
      <GroupList title={t('ui.more')}>
        <ListRow icon="key" label={t('ui.accounts_keys')} hint={t('ui.one_key_per_provider_shared')} onClick={() => go('me/models/accounts')} testId="accounts-link" />
        <ListRow icon="activity" label={t('ui.usage_cost')} hint={t('ui.latency_cost_cache_hits_error')} onClick={() => go('me/status')} />
        <ListRow icon="kanban" label={t('ui.advanced_per_task_routing')} hint={t('ui.pick_models_for_covers_ocr')} onClick={() => go('me/models/routing')} testId="routing-link" />
        <ListRow icon="cpu" label={t('ui.quick_connect')} hint={t('ui.6_popular_providers_enter_key')} onClick={() => go('me/models/legacy')} testId="legacy-link" />
      </GroupList>
    </div>
  );
}

/* ---------------- 角色二级页 ---------------- */
function RoleDetail({ role, go }: { role: RoleId; go: (to: string) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<'settings' | 'try' | 'usage'>('settings');
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid={`role-detail-${role}`}>
      <BackBar label={t(roleLabel(role))} onBack={() => go('me/models')} />
      <a className="v9-return" href="#agent" data-testid="return-chat">{t('ui.back_to_chat_when_done')} ›</a>
      <Note>{t(roleDef(role).io)}</Note>
      <SegTabs value={tab} onChange={setTab} label={t('ui.capability_tabs')} options={[['settings', '设置'], ['try', '试一试'], ['usage', '用量']]} />
      {tab === 'settings' && <RoleSettings role={role} go={go} />}
      {tab === 'try' && <Playground role={role} go={go} />}
      {tab === 'usage' && <RoleUsage role={role} />}
    </div>
  );
}

function probeLine(p: ProbeResult | undefined, t: (k: string) => string): string {
  if (!p) return t('ui.not_tested');
  if (p.ok) return `${t('ui.test_passed')}${p.ms ? ` · ${(p.ms / 1000).toFixed(1)}s` : ''}${p.respondedModel ? ` · ${t('ui.request')} ${p.requestedModel} → ${t('ui.actual')} ${p.respondedModel}` : ''}`;
  return `${p.reason ?? t('ui.test_failed')}`;
}

function RoleSettings({ role, go }: { role: RoleId; go: (to: string) => void }) {
  const { t } = useT();
  const { data: s } = useModelsV3();
  const tails = useAsync(secretTails, ['kv:secrets']).data ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  const [ovURL, setOvURL] = useState<string | null>(null);
  const [ovKey, setOvKey] = useState('');
  if (!s) return null;
  const cands = candidatesFor(s, role);
  const b = s.roles[role];
  const save = async (n: ModelsStateV3) => { await saveModelsV3(n); };
  const setSlot = async (slot: 'primary' | 'fallback', entryId: string) => {
    const cur = await getModelsV3();
    if (!entryId) { const n = structuredClone(cur); delete n.roles[role][slot]; await save(n); return; }
    const f = findEntry(cur, entryId); if (!f) return;
    const keep = cur.roles[role][slot];
    const n = bindRole(cur, role, slot, f.entry);
    if (keep?.overrideSecretRef || keep?.overrideBaseURL) Object.assign(n.roles[role][slot]!, { overrideSecretRef: keep.overrideSecretRef, overrideBaseURL: keep.overrideBaseURL });
    await save(n); show(t('ui.saved'));
  };
  const test = async (slot: 'primary' | 'fallback', allowPaid = false) => {
    const tg = s.roles[role][slot]; if (!tg) return;
    setBusy(slot);
    try { const r = await probe(tg.accountId, tg.modelEntryId, { roles: [role], allowPaid }); show(r[0]?.result.ok ? t('ui.test_passed') : (r[0]?.result.reason ?? t('ui.test_failed'))); } finally { setBusy(null); }
  };
  const saveOverride = async () => {
    const cur = await getModelsV3(); const p = cur.roles[role].primary; if (!p) return;
    const ref = `secret:role:${role}`;
    if (ovKey.trim()) { await setSecret(ref, ovKey); p.overrideSecretRef = ref; }
    if (ovURL !== null) p.overrideBaseURL = ovURL.trim() || undefined;
    await save(cur); setOvKey(''); show(t('ui.saved_a_separate_url_and'));
  };
  const clearOverride = async () => { const cur = await getModelsV3(); const p = cur.roles[role].primary; if (!p) return; await deleteSecret(`secret:role:${role}`); delete p.overrideSecretRef; delete p.overrideBaseURL; await save(cur); setOvURL(null); show(t('ui.switched_back_to_the_shared')); };
  const slotCard = (slot: 'primary' | 'fallback', title: string) => {
    const tg = b[slot]; const f = tg ? findEntry(s, tg.modelEntryId) : null;
    const p = f ? (f.entry.probes?.[role] ?? f.entry.lastProbe) : undefined;
    return (
      <Section title={t(title)} testId={`slot-${slot}`}>
        <select aria-label={`${t(title)}${t('ui.models')}`} value={tg?.modelEntryId ?? ''} onChange={(e) => void setSlot(slot, e.target.value)} data-testid={`slot-${slot}-select`}>
          <option value="">{t('ui.not_set_2')}</option>
          {cands.map((c) => <option key={c.entry.id} value={c.entry.id}>{c.text}</option>)}
        </select>
        {f && <>
          <Note tone={p?.ok ? 'ok' : p ? 'warn' : 'muted'}>{probeLine(p, t)}</Note>
          {f.entry.status === 'not_in_list' && <Note tone="warn">{t('ui.may_be_retired_or_renamed_2')}</Note>}
          {p && !p.ok && p.kind === 'model_not_found' && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => go(`me/models/acc-${f.account.id}`)}>{t('ui.fetch_list')}</button><button type="button" onClick={() => go(`me/models/acc-${f.account.id}`)}>{t('ui.rename_model')}</button></div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void test(slot)} disabled={!!busy} data-testid={`slot-${slot}-test`}>{busy === slot ? <Busy label={t('ui.testing_2')} /> : t('ui.test')}</button>
            {p?.kind === 'needs_confirm' && <button type="button" className="primary" onClick={() => void test(slot, true)}>{t('ui.confirm_cost_and_test')}</button>}
          </div>
          <Note>{t('ui.test_method')}：{t(PROBES[role].describe)}{PROBES[role].paid ? `（${t('ui.costs_money')}）` : ''}</Note>
        </>}
      </Section>
    );
  };
  const supported = s.accounts.map((a) => ({ a, ok: !!adapterOf(a.vendor)?.roles.includes(role) })).sort((x, y) => Number(y.ok) - Number(x.ok));
  const pri = b.primary;
  return (
    <>
      {toast}
      {!cands.length && <Problem title={t('ui.no_model_name_can_do')} advice={t('ui.add_a_provider_in_accounts')} action={t('ui.add_3')} onAction={() => go('me/models/accounts')} />}
      {slotCard('primary', '默认')}
      {slotCard('fallback', '备用')}
      <Note>{t('ui.fallback_only_kicks_in_on')}</Note>
      {pri && (
        <Section title={t('ui.separate_url_and_key_for')} testId="role-override">
          <Note>{s.keyPolicy.scope === 'account' ? t('ui.shares_the_account_key_by') : t('ui.currently_set_to_separate_key')}</Note>
          {pri.overrideSecretRef && <Note tone="ok">{t('ui.using_a_separate_key')} ••••{tails[pri.overrideSecretRef]?.tail ?? ''}</Note>}
          <label className="field !m-0"><span>{t('ui.url_empty_account_url')}</span><input value={ovURL ?? pri.overrideBaseURL ?? ''} onChange={(e) => setOvURL(e.target.value)} spellCheck={false} placeholder="https://…" /></label>
          <label className="field !m-0"><span>{t('ui.key_stored_only_in_this')}</span><input type="password" autoComplete="off" value={ovKey} onChange={(e) => setOvKey(e.target.value)} data-testid="override-key" /></label>
          <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void saveOverride()}>{t('ui.save')}</button>{(pri.overrideSecretRef || pri.overrideBaseURL) && <button type="button" onClick={() => void clearOverride()}>{t('ui.use_shared_key')}</button>}</div>
        </Section>
      )}
      <GroupList title={t('ui.providers')}>
        {supported.map(({ a, ok }) => <ListRow key={a.id} label={a.label} hint={`${ok ? t('ui.supports_this_capability') : t('ui.not_in_the_capability_declaration')} · ${a.models.length} ${t('ui.model_names_2')}`} onClick={() => go(`me/models/acc-${a.id}`)} />)}
        <ListRow icon="plus" label={t('ui.custom_openai_compatible')} hint={t('ui.any_compatible_endpoint_model_name')} onClick={() => go('me/models/accounts')} testId="add-custom-role" />
      </GroupList>
    </>
  );
}

/* ---------------- 试一试（不经 Agent，直接调用统一能力层；与 Agent 共用记账与标识） ---------------- */
const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
function Playground({ role, go }: { role: RoleId; go: (to: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CallResult | null>(null);
  const [media, setMedia] = useState<{ id: number; dataUrl: string; kind: string }[]>([]);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [toast, show] = useToast();
  const paid = roleDef(role).paid !== 'cheap';
  const needFile = role === 'vision' || role === 'imageEdit' || role === 'asr';
  const run = async () => {
    if (paid && !confirmPaid) { setConfirmPaid(true); return; }
    setBusy(true); setRes(null); setMedia([]); setConfirmPaid(false);
    const lines = extra.split('\n').map((x) => x.trim()).filter(Boolean);
    const req = role === 'chat' || role === 'reason' || role === 'fast' ? { role, messages: [{ role: 'user' as const, content: text }], thinking: role === 'reason' }
      : role === 'vision' ? { role, image: file ?? '', question: text || '这张图里有什么？' }
      : role === 'image' ? { role, prompt: text, n: 1 }
      : role === 'imageEdit' ? { role, images: file ? [file] : [], instruction: text }
      : role === 'tts' ? { role, text }
      : role === 'asr' ? { role, audio: { base64: (file ?? '').split(',')[1] ?? '', format: /wav/.test(file ?? '') ? 'wav' : 'mp3', mime: (/^data:([^;]+)/.exec(file ?? '')?.[1]) ?? 'audio/wav' } }
      : role === 'video' ? { role, prompt: text, duration: 5 }
      : role === 'embed' ? { role, input: [text, ...lines].filter(Boolean) }
      : { role, query: text, documents: lines };
    try {
      const r = await call(role, req as never);
      setRes(r);
      if (r.ok && r.value.type === 'media') {
        const rows = await saveMedia(r.value.items, { role, model: r.target.model, prompt: text, vendor: r.account.vendor });
        setMedia(rows.map((x) => ({ id: x.id, dataUrl: x.dataUrl, kind: x.kind })));
      }
    } finally { setBusy(false); }
  };
  const resultText = res?.ok ? (res.value.type === 'text' ? res.value.text : res.value.type === 'transcript' ? res.value.text : res.value.type === 'vectors' ? `${t('ui.vector_dimensions')} ${res.value.dims} × ${res.value.vectors.length}` : res.value.type === 'ranking' ? res.value.results.map((x) => `#${x.index} ${x.score.toFixed(3)}`).join('  ') : res.value.type === 'job' ? `${t('ui.task_submitted')}：${res.value.jobId}（${res.value.status}）` : '') : '';
  const toInbox = async () => { await addInbox({ kind: media[0] ? 'image' : 'text', text: resultText || text, image: media[0]?.dataUrl, title: `${t('ui.try_it')} · ${t(roleLabel(role))}`, channel: 'paste' }); show(t('ui.sent_to_agent_asset_box')); };
  const toDraft = async () => { const d = await db.insert('drafts', { platform: 'xiaohongshu', title: text.slice(0, 20) || t(roleLabel(role)), body: resultText, status: 'pending', images: media.map((m) => m.dataUrl) }); show(t('ui.inserted_into_draft')); go(`agent/drafts/${d.id}`); };
  return (
    <Section testId="playground">
      {toast}
      <label className="field !m-0"><span>{role === 'rerank' ? t('ui.look_up') : role === 'tts' ? t('ui.text_to_voice') : role === 'asr' ? t('ui.description_optional') : t('ui.prompt_question')}</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid="try-input" /></label>
      {(role === 'embed' || role === 'rerank') && <label className="field !m-0"><span>{role === 'rerank' ? t('ui.candidates_one_per_line') : t('ui.more_text_one_per_line')}</span><textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} /></label>}
      {needFile && <label className="field !m-0"><span>{role === 'asr' ? t('ui.choose_audio') : t('ui.choose_an_image_your_own')}</span><input type="file" accept={role === 'asr' ? 'audio/*' : 'image/*'} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setFile(await readFile(f)); }} /></label>}
      {confirmPaid && <Problem title={t('ui.this_call_costs_money')} advice={role === 'video' ? t('ui.always_ask_before_video_your') : t('ui.estimated_from_public_provider_prices')} action={t('ui.confirm_and_call')} onAction={() => void run()} secondary={<button type="button" onClick={() => setConfirmPaid(false)}>{t('ui.cancel')}</button>} testId="try-confirm" />}
      <button type="button" className="primary" disabled={busy || (!text.trim() && !file)} onClick={() => void run()} data-testid="try-run">{busy ? <Busy label={t('ui.calling')} /> : t('ui.try_it')}</button>
      {res && !res.ok && <Problem title={res.error.reason} advice={res.error.advice} action={res.error.actions.includes('fetch_list') || res.error.actions.includes('fix_key') ? t('ui.check_account') : res.error.actions.includes('configure') ? t('ui.configure') : undefined} onAction={() => go(res.target ? `me/models/acc-${res.target.accountId}` : `me/models/${role}`)} testId="try-error" />}
      {res?.ok && (
        <div className="flex flex-col gap-2" data-testid="try-result">
          {resultText && <p className="m-0 whitespace-pre-wrap text-[15px]">{resultText}</p>}
          {res.value.type === 'text' && res.value.reasoning && <details><summary className="text-[13px] text-muted">{t('ui.reasoning_2')}</summary><p className="m-0 whitespace-pre-wrap text-[13px] text-muted">{res.value.reasoning}</p></details>}
          <div className="flex flex-wrap gap-2">{media.map((m) => m.kind === 'audio' ? <audio key={m.id} controls src={m.dataUrl} /> : m.kind === 'video' ? <video key={m.id} controls src={m.dataUrl} className="max-h-60" /> : <figure key={m.id} className="m-0"><img src={m.dataUrl} alt="" className="h-32 w-32 rounded-[10px] object-cover" /><figcaption className="text-[11px] text-muted">{t('ui.ai_generated')}</figcaption></figure>)}</div>
          <Note>{t('ui.models')}：{res.target.model}{res.respondedModel && res.respondedModel !== res.target.model ? `（${t('ui.request')} ${res.target.model} → ${t('ui.actual')} ${res.respondedModel}）` : ''} · {(res.ms / 1000).toFixed(1)}s{res.cost !== null ? ` · ¥${res.cost.toFixed(4)}` : ` · ${t('ui.price_unknown')}`}{res.fromCache ? ` · ${t('ui.cache_hits')}` : ''}</Note>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void toInbox()}>{t('ui.save_to_assets_send_to')}</button><button type="button" onClick={() => void toDraft()}>{t('ui.insert_into_draft')}</button></div>
        </div>
      )}
    </Section>
  );
}

function RoleUsage({ role }: { role: RoleId }) {
  const { t } = useT();
  const { data } = useAsync(() => modelStats(30), ['usage_log']);
  const rows = (data?.stats ?? []).filter((x) => x.role === role);
  if (!rows.length) return <Note>{t('ui.no_calls_of_this_kind')}</Note>;
  return (
    <ul className="item-list" data-testid="role-usage">
      {rows.map((r) => <li key={r.key}><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{r.model} · {r.vendor}</span><span className="item-meta">{r.calls} {t('ui.calls')} · p50 {(r.p50 / 1000).toFixed(1)}s · ¥{r.cost.toFixed(3)} · {t('ui.error_rate')} {pct(r.errorRate)} · {t('ui.cache_hits')} {pct(r.cacheRate)}</span></span></li>)}
    </ul>
  );
}

/* ---------------- 账号与 Key ---------------- */
function Accounts({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { data: s } = useModelsV3();
  const tails = useAsync(secretTails, ['kv:secrets']).data ?? {};
  const vendors = useMemo(() => ADAPTERS.list(), []);
  const [vendor, setVendor] = useState('openai-compatible');
  const ad = adapterOf(vendor);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const info: { where: string; risk?: string; warn?: string } = useAsync(secretStorageInfoAsync, ['kv:secrets']).data ?? secretStorageInfo();
  const broken = useAsync(undecryptableSecrets, ['kv:secrets']).data ?? [];
  const add = async () => {
    setErr(null);
    const baseURL = (url || ad?.defaultBaseURL || '').trim();
    if (!/^https?:\/\//.test(baseURL) && vendor !== 'mock') { setErr(t('ui.url_must_start_with_http')); return; }
    if (/154\.8\.183\.93/.test(baseURL)) { setErr(t('ui.this_server_is_not_allowed')); return; }
    if (ad?.keyRequired && !key.trim()) { setErr(t('ui.this_service_needs_a_key')); return; }
    const cur = await getModelsV3();
    const id = `a${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;   // 短 id：避免 “secret:<id>” 被密钥扫描误判
    const acc: ProviderAccount = { id, vendor, label: label.trim() || ad?.label || vendor, baseURL, region: ad?.region ?? 'cn', models: [], secretRef: `secret:${id}`, hasKey: false };
    try {
      if (key.trim()) { const r = await setSecret(acc.secretRef!, key); acc.hasKey = true; acc.keyTail = r.tail; }
      cur.accounts.push(acc);
      await saveModelsV3(cur);
    } catch (e) { setErr(`${t('ui.not_saved')}：${(e as Error).message}`); return; }
    setKey(''); setLabel(''); setUrl('');
    go(`me/models/acc-${id}`);
  };
  if (!s) return null;
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="accounts">
      <BackBar label={t('ui.accounts_keys')} onBack={() => go('me/models')} />
      <Note>{t('ui.one_key_per_provider_shared_2')}</Note>
      <Note>{t('ui.location')}：{t(info.where)}{info.risk ? ` · ${t(info.risk)}` : ''}</Note>
      {info.warn && <Note tone="warn">{t(info.warn)}</Note>}
      {!!broken.length && <Problem testId="keys-undecryptable" title={`${broken.length} ${t('ui.keys_cannot_be_decrypted_on')}`} advice={t('ui.this_is_normal_after_reinstalling')} />}
      <GroupList title={t('ui.added_providers')}>
        {!s.accounts.length && <li className="p-4 text-[14px] text-muted">{t('ui.none_yet_add_one_below')}</li>}
        {s.accounts.map((a) => <ListRow key={a.id} label={a.label} hint={`${adapterOf(a.vendor)?.label ?? a.vendor} · ${a.models.length} ${t('ui.model_names_2')} · ${a.hasKey ? `Key ••••${tails[a.secretRef ?? '']?.tail ?? a.keyTail ?? ''}` : t('ui.no_key')}`} onClick={() => go(`me/models/acc-${a.id}`)} testId={`acc-${a.vendor}`} />)}
      </GroupList>
      <Section title={t('ui.add_provider')} testId="add-account">
        <label className="field !m-0"><span>{t('ui.type')}</span>
          <select value={vendor} onChange={(e) => { setVendor(e.target.value); setUrl(''); }} data-testid="vendor-select">
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.id === 'mock' ? t('ui.local_mock_demo_testing_free') : v.label}</option>)}
          </select>
        </label>
        <label className="field !m-0"><span>{t('ui.name_optional')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={ad?.label} /></label>
        <label className="field !m-0"><span>{t('ui.url')}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={ad?.defaultBaseURL || 'https://…/v1'} spellCheck={false} data-testid="acc-url" /></label>
        {!!ad?.baseURLPresets?.length && <div className="flex flex-wrap gap-2">{ad.baseURLPresets.map((p) => <button key={p.url} type="button" className="ghost" onClick={() => setUrl(p.url)}>{p.label}</button>)}</div>}
        {ad?.keyRequired !== false && <label className="field !m-0"><span>{t('ui.api_key_stored_only_in')}</span><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} data-testid="acc-key" /></label>}
        {err && <Problem title={err} advice={t('ui.fix_it_then_tap_add')} />}
        <button type="button" className="primary" onClick={() => void add()} data-testid="acc-add">{t('ui.add')}</button>
      </Section>
    </div>
  );
}

/* ---------------- 账号详情：模型名（手填 / 获取列表）、能力勾选、测试 ---------------- */
const EXAMPLES: Record<string, string> = { mimo: 'mimo-v2.6-flash', dashscope: 'qwen3.7-plus', deepseek: 'deepseek-v4-pro', zhipu: 'glm-4.7-flash', ark: 'ep-2026…', kimi: '点“获取列表”选择', mock: 'Mock/Model:v1.0' };
function AccountDetail({ accountId, go }: { accountId: string; go: (to: string) => void }) {
  const { t } = useT();
  const { data: s } = useModelsV3();
  const tails = useAsync(secretTails, ['kv:secrets']).data ?? {};
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [roles, setRoles] = useState<RoleId[]>(['chat']);
  const [err, setErr] = useState<string | null>(null);
  const [listed, setListed] = useState<{ id: string }[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [toast, show] = useToast();
  const a = s?.accounts.find((x) => x.id === accountId);
  if (!s) return null;
  if (!a) return <div className="page page-narrow"><Problem title={t('ui.this_provider_has_been_deleted')} action={t('ui.back')} onAction={() => go('me/models/accounts')} /></div>;
  const ad = adapterOf(a.vendor);
  const mutate = async (fn: (acc: ProviderAccount, st: ModelsStateV3) => void | ModelsStateV3) => { const cur = await getModelsV3(); const acc = cur.accounts.find((x) => x.id === accountId)!; const r = fn(acc, cur); await saveModelsV3(r ?? cur); };
  const runProbe = async (e: ModelEntry, allowPaid = false) => { setBusy(e.id); try { const r = await probe(a.id, e.id, { allowPaid }); const bad = r.find((x) => !x.result.ok && x.result.kind !== 'needs_confirm'); show(bad ? `${t(roleLabel(bad.role))}：${bad.result.reason ?? ''}` : t('ui.test_finished')); } finally { setBusy(null); } };
  const addOne = async (model: string, rs: RoleId[], lbl?: string): Promise<ModelEntry | null> => {
    let made: ModelEntry | null = null; let bad: string | null = null;
    await mutate((acc) => { const r = addModelEntry(acc, { model, roles: rs, label: lbl, source: listed?.some((x) => x.id === model) ? 'fetched' : 'manual' }); if (r.ok) made = r.entry; else bad = r.error === 'no_roles' ? t('ui.tick_at_least_one_capability') : t(MODEL_NAME_MESSAGES[r.error]); });
    if (bad) setErr(bad);
    return made;
  };
  const addManual = async () => {
    setErr(null);
    const e = await addOne(name, roles, label);
    if (e) { setName(''); setLabel(''); show(t('ui.added_running_an_automatic_test')); await runProbe(e); }
  };
  const doFetch = async () => {
    setBusy('list'); setListErr(null);
    try {
      const r = await fetchList(a.id);
      if (!r.ok) { setListErr('unsupported' in r && r.unsupported || ('error' in r && (r.error as { status?: number }).status === 404) ? t('ui.this_service_doesnt_list_models') : `${(r.error as { reason: string }).reason}`); return; }
      setListed(r.models);
      await mutate((acc) => { markAgainstList(acc, r.models.map((m) => m.id)); acc.listSupport = 'yes'; acc.listFetchedAt = Date.now(); });
    } finally { setBusy(null); }
  };
  const addPicked = async () => { for (const m of picked) await addOne(m, roles); setPicked([]); show(t('ui.added_the_selected_model_names')); };
  const delEntry = async (e: ModelEntry) => {
    const refs = referencesOf(s, e.id);
    if (refs.length && !window.confirm(`${t('ui.this_model_name_is_in')}：${refs.map((r) => `${t(roleLabel(r.role))}·${t(r.slot)}`).join('、')}。${t('ui.these_places_will_become_not')}`)) return;
    await saveModelsV3(removeModelEntry(await getModelsV3(), e.id));
  };
  const toggleRole = async (e: ModelEntry, r: RoleId) => mutate((acc) => { const x = acc.models.find((m) => m.id === e.id)!; x.roles = x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r]; if (!x.roles.length) x.roles = [r]; x.updatedAt = Date.now(); });
  const replaceKey = async () => { if (!newKey.trim()) return; const r = await setSecret(a.secretRef ?? `secret:${a.id}`, newKey); await mutate((acc) => { acc.secretRef ??= `secret:${acc.id}`; acc.hasKey = true; acc.keyTail = r.tail; }); setNewKey(''); show(t('ui.key_updated')); };
  const removeKey = async () => { await deleteSecret(a.secretRef ?? `secret:${a.id}`); await mutate((acc) => { acc.hasKey = false; acc.keyTail = undefined; }); show(t('ui.key_deleted')); };
  const removeAccount = async () => { if (!window.confirm(t('ui.delete_this_provider_and_all'))) return; let cur = await getModelsV3(); for (const e of a.models) cur = removeModelEntry(cur, e.id); cur.accounts = cur.accounts.filter((x) => x.id !== a.id); await deleteSecret(a.secretRef ?? `secret:${a.id}`); await saveModelsV3(cur); go('me/models/accounts'); };
  const shown = (listed ?? []).filter((m) => m.id.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="account-detail">
      {toast}
      <BackBar label={a.label} onBack={() => go('me/models/accounts')} />
      <Note>{ad?.label ?? a.vendor} · {a.baseURL || t('ui.no_url')}</Note>
      <Section title={t('Key')}>
        <Note tone={a.hasKey || ad?.keyRequired === false ? 'ok' : 'warn'}>{ad?.keyRequired === false ? t('ui.this_service_needs_no_key') : a.hasKey ? `${t('ui.saved')} ••••${tails[a.secretRef ?? '']?.tail ?? a.keyTail ?? ''}${tails[a.secretRef ?? '']?.encrypted === false ? ` · ${t('ui.not_encrypted_browser_doesnt_support')}` : ''}` : t('ui.no_key_yet')}</Note>
        <div className="flex flex-wrap items-end gap-2"><label className="field !m-0 grow"><span>{t('ui.use_another_key')}</span><input type="password" autoComplete="off" value={newKey} onChange={(e) => setNewKey(e.target.value)} /></label><button type="button" onClick={() => void replaceKey()}>{t('ui.save_key')}</button>{a.hasKey && <button type="button" className="danger" onClick={() => void removeKey()}>{t('ui.delete_key')}</button>}</div>
      </Section>
      <Section title={t('ui.model_names')} testId="entries">
        {!a.models.length && <Note>{t('ui.no_model_names_yet_type')}</Note>}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {a.models.map((e) => {
            const tone = entryTone(e);
            return (
              <li key={e.id} className="v9-entry" data-testid={`entry-${e.model}`}>
                <div className="flex flex-wrap items-center gap-2"><strong className="break-all text-[15px]">{displayModel(e)}</strong><StatusDot tone={tone}>{e.status === 'not_in_list' ? t('ui.may_be_retired_or_renamed') : t(TONE_TEXT[tone])}</StatusDot></div>
                <div className="mt-1 flex flex-wrap gap-1">{ROLE_IDS.map((r) => <label key={r} className={`v9-chip ${e.roles.includes(r) ? 'on' : ''}`}><input type="checkbox" checked={e.roles.includes(r)} onChange={() => void toggleRole(e, r)} />{t(roleDef(r).short)}{ad && !ad.roles.includes(r) && e.roles.includes(r) ? '?' : ''}</label>)}</div>
                {Object.entries(e.probes ?? {}).filter(([, p]) => p && !p.ok).map(([r, p]) => (
                  <div key={r} className="mt-2"><Problem title={`${t(roleLabel(r as RoleId))}：${p!.reason ?? t('ui.test_failed')}`} advice={p!.kind === 'model_not_found' ? t('ui.it_wont_switch_to_another') : undefined} action={p!.kind === 'needs_confirm' ? t('ui.confirm_cost_and_test') : p!.kind === 'model_not_found' ? t('ui.fetch_list') : undefined} onAction={() => (p!.kind === 'needs_confirm' ? void runProbe(e, true) : void doFetch())} secondary={p!.kind === 'model_not_found' ? <button type="button" onClick={() => { setName(e.model); void delEntry(e); }}>{t('ui.rename_model')}</button> : undefined} testId={`probe-error-${e.model}-${r}`} /></div>
                ))}
                {Object.values(e.probes ?? {}).some((p) => p?.respondedModel) && <Note>{t('ui.request')} {e.model} → {t('ui.actual')} {Object.values(e.probes ?? {}).find((p) => p?.respondedModel)?.respondedModel}</Note>}
                <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => void runProbe(e)} disabled={!!busy} data-testid={`test-${e.model}`}>{busy === e.id ? <Busy label={t('ui.testing_2')} /> : t('ui.test')}</button><button type="button" className="ghost danger" onClick={() => void delEntry(e)}>{t('ui.delete')}</button></div>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={t('ui.add_model_name')} testId="add-entry">
        <label className="field !m-0"><span>{t('ui.model_name_required_sent_as')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t('ui.for_example')} ${EXAMPLES[a.vendor] ?? 'model-name'}`} spellCheck={false} autoCapitalize="off" data-testid="model-name" /></label>
        <label className="field !m-0"><span>{t('ui.display_name_optional')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-[13px] font-medium">{t('ui.what_this_model_name_can')}</legend>
          <div className="flex flex-wrap gap-1">{ROLE_IDS.map((r) => <label key={r} className={`v9-chip ${roles.includes(r) ? 'on' : ''}`}><input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))} data-testid={`new-role-${r}`} />{t(roleDef(r).short)}</label>)}</div>
        </fieldset>
        {roles.map((r) => { const d = mergeDecl(r, a.vendor, name || 'x', ad?.declare(r, name || 'x')); return d.verified !== 'unverified' ? null : <Note key={r} tone="warn">{t(roleLabel(r))}：{t(VERIFIED_LABEL[d.verified])}{t('ui.use_it_after_the_test')}</Note>; })}
        {err && <Problem title={err} />}
        <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void addManual()} data-testid="add-model">{t('ui.add_test')}</button><button type="button" onClick={() => void doFetch()} disabled={busy === 'list'} data-testid="fetch-list">{busy === 'list' ? <Busy label={t('ui.fetching')} /> : t('ui.fetch_list')}</button></div>
        {listErr && <Problem title={listErr} advice={t('ui.saving_still_works_you_can')} testId="list-error" />}
        {listed && (
          <div className="flex flex-col gap-2" data-testid="model-list">
            <input placeholder={t('ui.search_model_names')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('ui.search_model_names')} />
            <Note>{t('ui.total')} {listed.length} {t('ui.items')}{t('ui.the_list_is_cached_only')}</Note>
            <ul className="m-0 max-h-72 list-none overflow-auto p-0">{shown.map((m) => <li key={m.id}><label className="list-row cursor-pointer !min-h-11"><input type="checkbox" checked={picked.includes(m.id)} onChange={() => setPicked((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))} /><span className="row-text break-all">{m.id}</span></label></li>)}</ul>
            <button type="button" className="primary" disabled={!picked.length} onClick={() => void addPicked()}>{t('ui.add_selected')}（{picked.length}）</button>
          </div>
        )}
      </Section>
      <button type="button" className="danger self-start" onClick={() => void removeAccount()}>{t('ui.delete_this_provider')}</button>
    </div>
  );
}
