/**
 * 1.1.0 我的 → 模型（PROMPT-v1.1 5.2）：以“服务商 / 模型”为中心。
 * 1 主模型卡（未配置时只有一个主按钮“接入第一个模型”）→ 2 能力覆盖一览（8 个能力，点亮写明由谁覆盖，未覆盖“补一个”）
 * → 3 我的服务商（每个模型的能力标签、健康、本月花费）→ 4 高级（默认收起）：按任务指定、备用模型、省钱档、检索、Key 共用方式、自定义服务商 / ComfyUI。
 * 选模型只走 shared resolveModel；这里写入的 main / roles[r].primary / roles[r].tasks / economy 就是它读取的那一份。
 */
import { useMemo, useState } from 'react';
import {
  ADAPTERS, adapterOf, CAPS, RETRIEVAL_CAPS, capsOfEntry, coverage, mainOf, inferRoles, entryCovers, displayModel, findEntry, bindRole, addModelEntry, flagOn, vendorsFor, resolveModel,
  type RoleId, type ModelsStateV3, type ModelEntry, type ProviderAccount,
} from '@content-agent/shared';
import { useT } from '../i18n';
import { saveModelsV3, getModelsV3, setPrefs, getPrefs } from '../local/store';
import { setSecret } from '../local/secrets';
import { probe, fetchList, flags } from '../v9/models';
import { modelStats, audit } from '../v9/ops';
import { GroupList, ListRow, Problem, StatusDot, Busy, useToast } from '../ui';
import { Icon } from '../icons';
import { ROUTING_TASKS, setTaskRoute } from '../v10/RoutingPage';
import { useAsync, useModelsV3, BackBar, Section, Note } from '../pages/me/v9/common';
import { entryTone } from '../pages/me/v9/roles';

const TONE_TEXT = { ok: '已实测', warn: '未实测', bad: '最近测试失败', neutral: '未测试' } as const;
const capText = (e: Pick<ModelEntry, 'roles'>, t: (k: string) => string) => capsOfEntry(e).map((c) => t(CAPS.find((x) => x.id === c)!.label)).join(' · ');
const hasAny = (s: ModelsStateV3) => s.accounts.some((a) => a.models.length > 0);

/* ---------------- 一级页 ---------------- */
export function ModelsIndex({ go, openAdvanced }: { go: (to: string) => void; openAdvanced?: boolean }) {
  const { t } = useT();
  const { data: s, error } = useModelsV3();
  if (error) return <div className="page page-narrow"><Problem title={t('ui.failed_to_read_model_settings')} advice={error} /></div>;
  if (!s) return null;
  if (!hasAny(s)) {
    return (
      <div className="page page-narrow flex flex-col gap-3" data-testid="models-index">
        <section className="card flex flex-col gap-3" data-testid="main-card-empty">
          <h2 className="m-0 text-[17px]">{t('ui.no_model_connected_yet')}</h2>
          <p className="m-0 text-[14px] text-fg-2">{t('ui.connect_one_model_and_its')}</p>
          <button type="button" className="primary !min-h-12" onClick={() => go('me/models/connect')} data-testid="connect-first">{t('ui.connect_your_first_model')}</button>
        </section>
      </div>
    );
  }
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="models-index">
      <MainCard s={s} go={go} />
      <CoverageStrip s={s} go={go} />
      <Providers s={s} go={go} />
      <Advanced s={s} go={go} open={openAdvanced} />
    </div>
  );
}

function MainCard({ s, go }: { s: ModelsStateV3; go: (to: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [toast, show] = useToast();
  const m = mainOf(s);
  const auto = !m ? resolveModel(s, undefined, 'chat') : null;
  const shown = m ?? (auto ? { ...findEntry(s, auto.target.modelEntryId)!, target: auto.target } : null);
  const chatEntries = s.accounts.flatMap((a) => a.models.filter((e) => e.roles.includes('chat')).map((e) => ({ a, e })));
  const setMain = async (id: string) => {
    const cur = await getModelsV3(); const f = findEntry(cur, id); if (!f) return;
    cur.main = { accountId: f.account.id, modelEntryId: f.entry.id, model: f.entry.model };
    await saveModelsV3(cur); await audit({ kind: 'setting_change', actor: 'user', summary: `主模型：${f.entry.model}（${f.account.label}）`, outcome: 'ok' });
    setChanging(false); show(t('ui.saved'));
  };
  const test = async () => { if (!shown) return; setBusy(true); try { const r = await probe(shown.account.id, shown.entry.id); const bad = r.find((x) => !x.result.ok && x.result.kind !== 'needs_confirm'); show(bad ? (bad.result.reason ?? t('ui.test_failed')) : t('ui.test_passed')); } finally { setBusy(false); } };
  const tone = shown ? entryTone(shown.entry) : 'neutral';
  return (
    <section className="card flex flex-col gap-2" data-testid="main-card" aria-label={t('ui.main_model')}>
      {toast}
      <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-muted">{t('ui.main_model')}</span>{shown && <StatusDot tone={tone}>{t(TONE_TEXT[tone])}</StatusDot>}</div>
      {shown ? <>
        <strong className="break-words text-[17px]" data-testid="main-name">{displayModel(shown.entry)}</strong>
        <span className="text-[13px] text-fg-2">{shown.account.label}</span>
        <div className="flex flex-wrap gap-1" data-testid="main-caps">{capsOfEntry(shown.entry).map((c) => <span key={c} className="v9-chip on">{t(CAPS.find((x) => x.id === c)!.label)}</span>)}</div>
      </> : <Note tone="warn">{t('ui.no_chat_model_yet_add')}</Note>}
      {changing && (
        <label className="field !m-0"><span>{t('ui.choose_main_model')}</span>
          <select value={m?.entry.id ?? ''} onChange={(e) => void setMain(e.target.value)} data-testid="main-select">
            <option value="" disabled>{t('ui.choose_main_model')}</option>
            {chatEntries.map(({ a, e }) => <option key={e.id} value={e.id}>{displayModel(e)} · {a.label}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setChanging((x) => !x)} data-testid="main-change">{t('ui.change')}</button>
        <button type="button" onClick={() => void test()} disabled={busy || !shown} data-testid="main-test">{busy ? <Busy label={t('ui.testing_2')} /> : t('ui.test')}</button>
        <button type="button" className="ghost" onClick={() => go('me/models/connect')} data-testid="connect-more">{t('ui.connect_another_model')}</button>
      </div>
    </section>
  );
}

function CoverageStrip({ s, go }: { s: ModelsStateV3; go: (to: string) => void }) {
  const { t } = useT();
  const cov = coverage(s);
  return (
    <GroupList title={t('ui.what_your_models_can_do')}>
      <li><ul className="cap-strip m-0 grid list-none grid-cols-2 gap-2 p-3 sm:grid-cols-4" data-testid="coverage">
        {CAPS.map((c) => {
          const by = cov[c.id];
          return (
            <li key={c.id}>
              <button type="button" className={`cap-cell w-full !min-h-14 !flex-col !items-start !justify-center !gap-0.5 !text-left ${by ? 'on' : 'off'}`} data-testid={`cap-${c.id}`} data-on={by ? '1' : '0'}
                title={by ? `${t(c.label)}：${displayModel(by.entry)} · ${by.account.label}` : `${t(c.label)}：${t('ui.add_one')}`}
                onClick={() => go(by ? `me/models/${c.role}` : `me/models/connect?cap=${c.role}`)}>
                <span className="flex items-center gap-1 text-[14px] font-medium"><Icon name={c.icon} size={16} />{t(c.label)}</span>
                <span className="line-clamp-2 break-all text-[12px] text-muted">{by ? `${displayModel(by.entry)}` : `${t('ui.add_one')} ›`}</span>
              </button>
            </li>
          );
        })}
      </ul></li>
    </GroupList>
  );
}

function Providers({ s, go }: { s: ModelsStateV3; go: (to: string) => void }) {
  const { t } = useT();
  const day = new Date().getDate();
  const { data } = useAsync(() => modelStats(day), ['usage_log']);
  const costOf = (a: ProviderAccount, e: ModelEntry) => (data?.stats ?? []).filter((x) => (x.vendor === a.vendor || x.vendor === a.id) && x.model === e.model).reduce((n, x) => n + x.cost, 0);
  return (
    <>
      {s.accounts.filter((a) => a.models.length).map((a) => (
        <GroupList key={a.id} title={`${a.label}${a.hasKey || adapterOf(a.vendor)?.keyRequired === false ? '' : ` · ${t('ui.no_key')}`}`}>
          {a.models.map((e) => {
            const tone = entryTone(e);
            return <ListRow key={e.id} label={displayModel(e)} hint={`${capText(e, t) || t('ui.not_set')} · ${t('ui.this_month')} ¥${costOf(a, e).toFixed(2)}`} value={<StatusDot tone={tone}>{t(TONE_TEXT[tone])}</StatusDot>} onClick={() => go(`me/models/acc-${a.id}`)} testId={`prov-${e.model}`} />;
          })}
        </GroupList>
      ))}
    </>
  );
}

/* ---------------- 高级（默认收起） ---------------- */
function Advanced({ s, go, open }: { s: ModelsStateV3; go: (to: string) => void; open?: boolean }) {
  const { t } = useT();
  const fl = useAsync(flags, ['kv:prefs']).data ?? {};
  const prefs = useAsync(getPrefs, ['kv:prefs']).data;
  const [toast, show] = useToast();
  const cands = (role: RoleId) => s.accounts.flatMap((a) => a.models.filter((e) => entryCovers(e, role, { soft: role === 'fast' })).map((e) => ({ a, e })));
  const autoText = (role: RoleId, task?: string) => {
    const cur = structuredClone(s);
    if (task) { if (cur.roles[role]?.tasks) delete cur.roles[role].tasks![task]; } else delete cur.roles[role].primary;
    const r = resolveModel(cur, task, role);
    return r ? `${t('ui.automatic')}（${r.target.model}${r.thinking ? ` · ${t('ui.deep_thinking')}` : ''}）` : `${t('ui.automatic')}（${t('ui.none_add_one')}）`;
  };
  const pinCap = async (role: RoleId, id: string) => {
    const cur = await getModelsV3();
    if (!id) delete cur.roles[role].primary;
    const f = id ? findEntry(cur, id) : null;
    const next = f ? bindRole(cur, role, 'primary', f.entry) : cur;
    await saveModelsV3(next); show(t('ui.saved'));
  };
  const pinTask = async (role: RoleId, task: string, id: string) => { await saveModelsV3(setTaskRoute(await getModelsV3(), role, task, id || null)); show(t('ui.saved')); };
  const setFallback = async (id: string) => {
    const cur = await getModelsV3();
    if (!id) delete cur.roles.chat.fallback;
    const f = id ? findEntry(cur, id) : null;
    await saveModelsV3(f ? bindRole(cur, 'chat', 'fallback', f.entry) : cur); show(t('ui.saved'));
  };
  const setEconomy = async (on: boolean) => { const cur = await getModelsV3(); cur.economy = { mode: on ? 'auto' : 'off' }; await saveModelsV3(cur); show(t('ui.saved')); };
  const setKeyPolicy = async (p: 'account' | 'per-role') => { await setPrefs({ keyPolicy: p }); const m = await getModelsV3(); m.keyPolicy = { scope: p }; await saveModelsV3(m); await audit({ kind: 'setting_change', actor: 'user', summary: `Key 共用方式：${p}`, outcome: 'ok' }); };
  const row = (key: string, label: string, hint: string, role: RoleId, value: string, onChange: (v: string) => void, list = cands(role), auto = '') => (
    <li key={key}><div className="list-row static flex-wrap">
      <span className="row-text"><span className="row-label">{t(label)}</span><span className="row-hint">{t(hint)}</span></span>
      <select aria-label={t(label)} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-full" data-testid={`adv-${key}`}>
        <option value="">{auto}</option>
        {list.map(({ a, e }) => <option key={e.id} value={e.id}>{displayModel(e)} · {a.label}</option>)}
      </select>
    </div></li>
  );
  return (
    <details className="card !p-0" open={open} data-testid="models-advanced">
      <summary className="list-row cursor-pointer !min-h-12"><span className="row-text"><span className="row-label">{t('ui.advanced')}</span><span className="row-hint">{t('ui.per_task_models_fallback_economy')}</span></span></summary>
      {toast}
      <div className="flex flex-col gap-1 px-2 pb-3">
        <GroupList title={t('ui.per_task_models')}>
          {CAPS.map((c) => row(`cap-${c.id}`, c.label, 'ui.leave_on_automatic_to_follow', c.role, s.roles[c.role]?.primary?.modelEntryId ?? '', (v) => void pinCap(c.role, v), undefined, autoText(c.role)))}
          {row('cap-fast', 'ui.short_tasks_titles_keywords_summaries', 'ui.economy_mode_hint', 'fast', s.roles.fast?.primary?.modelEntryId ?? '', (v) => void pinCap('fast', v), undefined, autoText('fast'))}
          {ROUTING_TASKS.map((x) => row(`task-${x.task}`, x.label, x.hint, x.role, s.roles[x.role]?.tasks?.[x.task]?.modelEntryId ?? '', (v) => void pinTask(x.role, x.task, v), undefined, autoText(x.role, x.task)))}
        </GroupList>
        <GroupList title={t('ui.fallback_model')}>
          {row('fallback', 'ui.when_the_chat_model_fails', 'ui.fallback_only_kicks_in_on', 'chat', s.roles.chat?.fallback?.modelEntryId ?? '', (v) => void setFallback(v), undefined, t('ui.none'))}
        </GroupList>
        <GroupList title={t('ui.economy_mode')}>
          <li><label className="list-row cursor-pointer"><input type="checkbox" checked={s.economy?.mode !== 'off'} onChange={(e) => void setEconomy(e.target.checked)} data-testid="economy" /><span className="row-text"><span className="row-label">{t('ui.use_a_cheaper_model_for')}</span><span className="row-hint">{t('ui.economy_mode_hint')}</span></span></label></li>
        </GroupList>
        {flagOn('search.vector', fl) && (
          <GroupList title={t('ui.retrieval')}>
            {RETRIEVAL_CAPS.map((c) => row(`cap-${c.id}`, c.label, 'ui.leave_on_automatic_to_follow', c.role, s.roles[c.role]?.primary?.modelEntryId ?? '', (v) => void pinCap(c.role, v), undefined, autoText(c.role)))}
          </GroupList>
        )}
        <GroupList title={t('ui.key_sharing')}>
          {([['account', '同一服务商一个 Key，各能力通用（默认）', '例如百炼填一次，文本、生图、配音、转写都能用；某一类仍可单独改'], ['per-role', '每类单独填写', '每个能力页都要填自己的地址与 Key']] as const).map(([v, l, h]) => (
            <li key={v}><label className="list-row cursor-pointer"><input type="radio" name="keypolicy" checked={(prefs?.keyPolicy ?? 'account') === v} onChange={() => void setKeyPolicy(v)} /><span className="row-text"><span className="row-label">{t(l)}</span><span className="row-hint">{t(h)}</span></span></label></li>
          ))}
        </GroupList>
        <GroupList title={t('ui.more')}>
          <ListRow icon="key" label={t('ui.accounts_keys')} hint={t('ui.custom_providers_and_comfyui_workflows')} onClick={() => go('me/models/accounts')} testId="accounts-link" />
          <ListRow icon="activity" label={t('ui.usage_cost')} hint={t('ui.latency_cost_cache_hits_error')} onClick={() => go('me/records?filter=cost')} />
        </GroupList>
      </div>
    </details>
  );
}

/* ---------------- 接入一个模型：选服务商 → 填 Key → 自动拉取模型列表并推荐 ---------------- */
const EXAMPLES: Record<string, string> = { mimo: 'mimo-v2.6-flash', dashscope: 'qwen3.7-plus', deepseek: 'deepseek-flash', zhipu: 'glm-5.3-flash', ark: 'doubao-seed-2-1-lite-260915', kimi: 'kimi-k2.6', minimax: 'MiniMax-M3.1-Flash', mock: 'mock-omni' }; // 2026-10-24 按 docs/models-v1.1.md 核对
/** 推荐：优先覆盖所需能力；对话类优先“对话+思考+看图”都有、且不是省钱小型号的那个。 */
export function recommend(vendor: string, ids: string[], need?: RoleId): string | null {
  const scored = ids.map((id) => { const r = inferRoles(vendor, id); const score = (need && r.includes(need) ? 100 : 0) + (r.includes('chat') ? 10 : 0) + (r.includes('reason') ? 4 : 0) + (r.includes('vision') ? 4 : 0) - (r.includes('fast') ? 3 : 0) - (/preview|beta|exp/i.test(id) ? 2 : 0); return { id, score }; });
  return scored.sort((a, b) => b.score - a.score)[0]?.id ?? null;
}
export function ConnectWizard({ go, cap, onDone, embedded }: { go: (to: string) => void; cap: RoleId | null; onDone?: () => void; embedded?: boolean }) {
  const { t } = useT();
  const all = useMemo(() => ADAPTERS.list(), []);
  const vendors = cap ? all.filter((v) => vendorsFor(cap, all).includes(v.id)) : all.filter((v) => v.id !== 'mock');
  const [vendor, setVendor] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [acc, setAcc] = useState<string | null>(null);
  const [listed, setListed] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ad = vendor ? adapterOf(vendor) : undefined;
  const capLabel = (v: { roles: RoleId[] }) => CAPS.filter((c) => v.roles.includes(c.role)).map((c) => t(c.label)).join(' · ');
  const step = !vendor ? 1 : !acc ? 2 : 3;
  const saveKey = async () => {
    setErr(null);
    const baseURL = (url || ad?.defaultBaseURL || '').trim();
    if (vendor !== 'mock' && !/^https?:\/\//.test(baseURL)) { setErr(t('ui.url_must_start_with_http')); return; }
    if (/154\.8\.183\.93/.test(baseURL)) { setErr(t('ui.this_server_is_not_allowed')); return; }
    if (ad?.keyRequired && !key.trim()) { setErr(t('ui.this_service_needs_a_key')); return; }
    setBusy(true);
    try {
      const cur = await getModelsV3();
      const id = `a${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;
      const a: ProviderAccount = { id, vendor: vendor!, label: ad?.label ?? vendor!, baseURL, region: ad?.region ?? 'cn', models: [], secretRef: `secret:${id}`, hasKey: false };
      if (key.trim()) { const r = await setSecret(a.secretRef!, key); a.hasKey = true; a.keyTail = r.tail; }
      cur.accounts.push(a); await saveModelsV3(cur); setKey(''); setAcc(id);
      const l = await fetchList(id);
      if (l.ok) { const ids = l.models.map((m) => m.id); setListed(ids); setPick(recommend(vendor!, ids, cap ?? undefined) ?? ''); }
      else { setListed([]); setPick(EXAMPLES[vendor!] ?? ''); }
    } catch (e) { setErr(`${t('ui.not_saved')}：${(e as Error).message}`); } finally { setBusy(false); }
  };
  const finish = async () => {
    setErr(null); setBusy(true);
    try {
      const cur = await getModelsV3(); const a = cur.accounts.find((x) => x.id === acc); if (!a) return;
      const roles = inferRoles(a.vendor, pick);
      const r = addModelEntry(a, { model: pick, roles, source: listed?.includes(pick) ? 'fetched' : 'manual' });
      if (!r.ok) { setErr(r.error === 'duplicate' ? t('ui.this_model_is_already_added') : t('ui.check_the_model_name')); return; }
      if (!cur.main && roles.includes('chat')) cur.main = { accountId: a.id, modelEntryId: r.entry.id, model: r.entry.model };
      await saveModelsV3(cur);
      await audit({ kind: 'setting_change', actor: 'user', summary: `接入模型 ${pick}（${a.label}，自动识别：${roles.join('、')}）`, outcome: 'ok' });
      void probe(a.id, r.entry.id).catch(() => {});
      if (onDone) onDone(); else go('me/models');
    } finally { setBusy(false); }
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="connect-wizard">
      {!embedded ? <BackBar label={t('ui.connect_a_model')} onBack={() => (step === 1 ? go('me/models') : step === 2 ? setVendor(null) : go('me/models'))} /> : step === 2 ? <button type="button" className="ghost self-start" onClick={() => setVendor(null)}>‹ {t('ui.choose_provider')}</button> : null}
      <ol className="steps m-0 flex list-none gap-2 p-0 text-[13px] text-muted" aria-label={t('ui.steps')}>
        {[t('ui.choose_provider'), t('ui.enter_key'), t('ui.choose_model')].map((x, i) => <li key={x} aria-current={step === i + 1 ? 'step' : undefined} className={step === i + 1 ? 'font-semibold text-fg' : ''}>{i + 1}. {x}</li>)}
      </ol>
      {step === 1 && (
        <GroupList title={cap ? `${t('ui.providers_that_can')} ${t(CAPS.find((c) => c.role === cap)?.label ?? '')}` : t('ui.choose_provider')}>
          {vendors.map((v) => <ListRow key={v.id} label={v.label} hint={capLabel(v)} onClick={() => setVendor(v.id)} testId={`vendor-${v.id}`} />)}
          {!cap && <ListRow label={t('ui.local_mock_demo_testing_free')} hint={capLabel(adapterOf('mock')!)} onClick={() => setVendor('mock')} testId="vendor-mock" />}
        </GroupList>
      )}
      {step === 2 && ad && (
        <Section title={ad.label} testId="connect-key">
          <Note>{t('ui.key_is_stored_only_on')}</Note>
          {ad.keyRequired !== false && <label className="field !m-0"><span>{t('ui.api_key_stored_only_in')}</span><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} data-testid="connect-key-input" /></label>}
          <details><summary className="text-[13px] text-muted">{t('ui.custom_url_optional')}</summary>
            <label className="field !m-0 mt-2"><span>{t('ui.url')}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={ad.defaultBaseURL || 'https://…/v1'} spellCheck={false} /></label>
            {!!ad.baseURLPresets?.length && <div className="mt-2 flex flex-wrap gap-2">{ad.baseURLPresets.map((p) => <button key={p.url} type="button" className="ghost" onClick={() => setUrl(p.url)}>{p.label}</button>)}</div>}
          </details>
          {err && <Problem title={err} />}
          <button type="button" className="primary !min-h-12" onClick={() => void saveKey()} disabled={busy} data-testid="connect-next">{busy ? <Busy label={t('ui.fetching')} /> : t('ui.next_step')}</button>
        </Section>
      )}
      {step === 3 && (
        <Section title={t('ui.choose_model')} testId="connect-model">
          {listed && listed.length > 0 ? (
            <label className="field !m-0"><span>{t('ui.recommended_for_you_you_can')}</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="connect-pick">{listed.map((id) => <option key={id} value={id}>{id}{id === recommend(vendor!, listed, cap ?? undefined) ? ` · ${t('ui.recommended')}` : ''}</option>)}</select>
            </label>
          ) : (
            <label className="field !m-0"><span>{t('ui.this_service_doesnt_list_models')}</span><input value={pick} onChange={(e) => setPick(e.target.value)} spellCheck={false} autoCapitalize="off" data-testid="connect-pick-input" /></label>
          )}
          {pick && <Note>{t('ui.detected_capabilities')}：{CAPS.filter((c) => inferRoles(vendor!, pick).includes(c.role)).map((c) => t(c.label)).join(' · ') || '—'}</Note>}
          {err && <Problem title={err} />}
          <button type="button" className="primary !min-h-12" disabled={!pick.trim() || busy} onClick={() => void finish()} data-testid="connect-finish">{t('ui.done')}</button>
        </Section>
      )}
    </div>
  );
}
