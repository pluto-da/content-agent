import { useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { presetOf } from '../data/providers';
import { checkBaseURL, maskKey, ModelError, testConnection, type ProviderConfig } from '../local/llm';
import { upsertProvider } from '../local/store';
import { Busy, Problem } from '../ui';

/**
 * 服务商表单（LobeHub / Cherry Studio 式）：只有 Key、Base URL、模型三项；自定义服务多“名称、协议”。
 * 大按钮“测试连接”：成功显示“已连通，用时 x 秒”，失败显示白话原因 + 建议。测试成功才保存为可用。
 */
export function ProviderForm({ initial, onConnected, onChecked, compact }: { initial: ProviderConfig; onConnected?: (cfg: ProviderConfig) => void; onChecked?: () => void; compact?: boolean }) {
  const { t } = useT();
  const preset = presetOf(initial.id);
  const [v, setV] = useState<ProviderConfig>(initial);
  const [editingKey, setEditingKey] = useState(!initial.apiKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; advice?: string } | null>(null);
  const [ok, setOk] = useState<{ ms: number; model: string } | null>(initial.check?.ok ? { ms: initial.check.ms ?? 0, model: initial.check.model ?? initial.model } : null);
  const set = (k: keyof ProviderConfig, x: string) => { setV({ ...v, [k]: x }); setOk(null); setErr(null); };
  const models = preset?.models ?? [];

  const test = async () => {
    setBusy(true); setErr(null); setOk(null);
    const bad = checkBaseURL(v.baseURL);
    if (bad) { setErr({ message: bad.reason, advice: bad.advice }); setBusy(false); return; }
    try {
      const r = await testConnection(v);
      const saved: ProviderConfig = { ...v, check: { ok: true, at: new Date().toISOString(), ms: r.ms, model: v.model } };
      await upsertProvider(saved);
      setOk(r); setEditingKey(false);
      onConnected?.(saved);
    } catch (e) {
      const f = e instanceof ModelError ? { message: e.reason, advice: e.advice } : { message: '测试失败', advice: e instanceof Error ? e.message : String(e) };
      setErr(f);
      await upsertProvider({ ...v, check: { ok: false, at: new Date().toISOString(), reason: f.message } }).catch(() => {});
      onChecked?.();
    } finally { setBusy(false); }
  };

  return (
    <form className="flex flex-col gap-1" aria-label={`${v.label} ${t('ui.connection_settings')}`} onSubmit={(e) => { e.preventDefault(); void test(); }}>
      {v.custom && (
        <>
          <label className="field"><span>{t('ui.name')}</span><input value={v.label} onChange={(e) => set('label', e.target.value)} placeholder={t('ui.e_g_my_relay_service')} /></label>
          <label className="field"><span>{t('ui.api_format')}</span>
            <select value={v.protocol} onChange={(e) => set('protocol', e.target.value)}>
              <option value="openai">{t('ui.openai_compatible_most_services')}</option>
              <option value="anthropic">{t('ui.anthropic_compatible')}</option>
            </select>
          </label>
        </>
      )}
      <label className="field"><span>API Key</span>
        {editingKey || !v.apiKey
          ? <input type="password" autoComplete="off" spellCheck={false} value={v.apiKey} placeholder={preset?.noKey ? t('ui.no_key_needed') : (preset?.keyHint ?? 'sk-…')} onChange={(e) => set('apiKey', e.target.value)} data-testid="key-input" />
          : <span className="flex items-center gap-2"><input readOnly value={maskKey(v.apiKey)} aria-label={t('ui.saved_keys_last_4_shown')} /><button type="button" onClick={() => { setEditingKey(true); set('apiKey', ''); }}>{t('ui.change_2')}</button></span>}
      </label>
      <label className="field"><span>Base URL</span>
        <input value={v.baseURL} spellCheck={false} onChange={(e) => set('baseURL', e.target.value)} placeholder="https://api.example.com/v1" data-testid="base-input" />
        {preset && v.baseURL !== preset.baseURL && !compact && <button type="button" className="ghost self-start" onClick={() => set('baseURL', preset.baseURL)}>{t('ui.restore_official_url')}</button>}
        {preset?.baseURLPresets && !compact && (
          <span className="flex flex-wrap gap-2 pt-1">{preset.baseURLPresets.map((p) => <button key={p.url} type="button" className="ghost" aria-pressed={v.baseURL === p.url} onClick={() => set('baseURL', p.url)}>{p.label}</button>)}</span>
        )}
      </label>
      <label className="field"><span>{t('ui.models')}</span>
        <input list={`models-${v.id}`} value={v.model} spellCheck={false} onChange={(e) => set('model', e.target.value)} placeholder={models[0] ?? t('ui.model_name_from_the_providers')} data-testid="model-input" />
        <datalist id={`models-${v.id}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <div className="flex flex-col gap-3 pt-2">
        <button type="submit" className="primary !min-h-12 w-full text-[16px]" disabled={busy} data-testid="test-connection">{busy ? <Busy label={t('ui.testing')} /> : t('ui.test_connection')}</button>
        {ok && <p className="ok-line m-0" role="status" data-testid="test-ok"><Icon name="check" size={18} />{t('ui.connected')}，{t('ui.time_taken')} {(ok.ms / 1000).toFixed(1)} {t('ui.s')}<span className="muted">· {ok.model}</span></p>}
        {err && <Problem title={err.message} advice={err.advice} testId="test-error" />}
      </div>
    </form>
  );
}
