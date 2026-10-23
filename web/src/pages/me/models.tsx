import { useEffect, useState } from 'react';
import { apiMode } from '../../api';
import { useT } from '../../i18n';
import { Icon } from '../../icons';
import type { Layout } from '../../nav';
import { PROVIDERS } from '../../data/providers';
import type { ProviderConfig } from '../../local/llm';
import { getModels, newProviderConfig, removeProvider, saveModels, type ModelsState } from '../../local/store';
import { GroupList, ListRow, StatusDot } from '../../ui';
import { useStoreChange } from '../../local/useStore';
import { ProviderForm } from '../../components/ProviderForm';

/**
 * 模型（LobeHub / Cherry Studio 式）：左侧服务商列表（常用 6 家 + 更多 + 添加自定义服务），右侧三字段表单 + 测试连接。
 * 手机上是“列表页 → 详情页”。顶部只有一个设置：默认写作模型；备用、思考、温度收进“高级”。
 */
export function ModelsPage({ id, go, lay }: { id: string | null; go: (to: string) => void; lay: Layout }) {
  const { t } = useT();
  const [m, setM] = useState<ModelsState | null>(null);
  const [more, setMore] = useState(false);
  const reload = () => void getModels().then(setM);
  useEffect(reload, []);
  useStoreChange(['kv:models'], reload);
  if (!m) return null;
  const cfgOf = (pid: string): ProviderConfig => m.providers.find((p) => p.id === pid) ?? newProviderConfig(pid);
  const ok = m.providers.filter((p) => p.check?.ok);
  const customs = m.providers.filter((p) => p.custom);
  const status = (pid: string) => {
    const c = m.providers.find((p) => p.id === pid);
    if (!c?.check) return undefined;
    return c.check.ok ? <StatusDot tone="ok">{t('ui.connected')}</StatusDot> : <StatusDot tone="bad">{t('ui.not_connected')}</StatusDot>;
  };
  const openId = (pid: string) => go(`me/models/${pid}`);
  const newCustom = () => {
    const cid = `custom-${Date.now().toString(36)}`;
    const cfg: ProviderConfig = { id: cid, label: t('ui.custom_service'), protocol: 'openai', baseURL: '', apiKey: '', model: '', custom: true };
    void saveModels({ ...m, providers: [...m.providers, cfg] }).then(getModels).then((n) => { setM(n); openId(cid); });
  };
  const common = PROVIDERS.filter((p) => p.common);
  const rest = PROVIDERS.filter((p) => !p.common);

  const list = (
    <div className="flex min-w-0 flex-col">
      {apiMode() === 'server' && <p className="mb-3 rounded-[12px] bg-surface-2 px-4 py-3 text-[14px] text-fg-2">{t('ui.connected_to_your_server_generation')}</p>}
      <GroupList title={t('ui.default_writing_model')}>
        <li className="px-[18px] py-3">
          {ok.length ? (
            <select aria-label={t('ui.default_writing_model')} value={m.defaultProvider ?? ok[0]!.id} onChange={(e) => { const n = { ...m, defaultProvider: e.target.value }; setM(n); void saveModels(n); }}>
              {ok.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.model}</option>)}
            </select>
          ) : <span className="text-[15px] text-muted">{t('ui.no_connected_service_yet_pick')}</span>}
        </li>
      </GroupList>
      <GroupList title={t('ui.frequent')}>
        {common.map((p) => <ListRow key={p.id} label={p.label} value={status(p.id)} onClick={() => openId(p.id)} testId={`provider-${p.id}`} />)}
      </GroupList>
      <GroupList title={t('ui.more')}>
        {!more ? <ListRow label={t('ui.show_more_providers')} hint={rest.map((p) => p.label).join('、')} onClick={() => setMore(true)} />
          : rest.map((p) => <ListRow key={p.id} label={p.label} value={status(p.id)} onClick={() => openId(p.id)} />)}
        {customs.map((p) => <ListRow key={p.id} icon="wand" label={p.label} value={status(p.id)} onClick={() => openId(p.id)} />)}
        <ListRow icon="plus" label={t('ui.add_custom_service')} hint={t('ui.any_openai_or_anthropic_compatible')} onClick={newCustom} testId="add-custom" />
      </GroupList>
      <details className="mt-1">
        <summary className="cursor-pointer px-1 py-2 text-[14px] text-muted">{t('ui.advanced')}</summary>
        <div className="card mt-2 flex flex-col gap-1">
          <label className="field"><span>{t('ui.thinking_mode')}</span>
            <select value={m.advanced.thinking} onChange={(e) => { const n = { ...m, advanced: { ...m.advanced, thinking: e.target.value as 'on' | 'off' } }; setM(n); void saveModels(n); }}>
              <option value="off">{t('ui.off_faster_cheaper')}</option><option value="on">{t('ui.on_supported_models_think_first')}</option>
            </select>
          </label>
          <label className="field"><span>{t('ui.temperature_empty_provider_default')}</span>
            <input inputMode="decimal" value={m.advanced.temperature ?? ''} onChange={(e) => { const x = e.target.value.trim(); const n = { ...m, advanced: { ...m.advanced, temperature: x === '' ? null : Math.max(0, Math.min(2, Number(x) || 0)) } }; setM(n); void saveModels(n); }} />
          </label>
          <p className="m-0 text-[13px] text-muted">{t('ui.prices_xiaomi_mimo_spend_is')}</p>
        </div>
      </details>
    </div>
  );

  const detail = id && (
    <section className="card flex flex-col gap-2" aria-label={t('ui.provider_settings')}>
      <div className="flex items-center gap-2">
        {lay === 'phone' && <button type="button" className="ghost !px-1" aria-label={t('ui.back')} onClick={() => go('me/models')}><Icon name="arrowLeft" size={18} /></button>}
        <h2 className="grow">{cfgOf(id).label}</h2>
        {m.providers.some((p) => p.id === id) && <button type="button" className="ghost danger" onClick={() => void removeProvider(id).then((n) => { setM(n); go('me/models'); })}>{t('ui.remove_2')}</button>}
      </div>
      <ProviderForm key={`${id}-${m.providers.some((p) => p.id === id)}`} initial={cfgOf(id)} onConnected={() => reload()} onChecked={() => reload()} />
    </section>
  );

  if (lay === 'phone') return <div className="page">{detail || list}</div>;
  return (
    <div className="page grid gap-6" style={{ gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)' }}>
      {list}
      <div className="min-w-0">{detail || <div className="card text-[15px] text-muted">{t('ui.pick_a_provider_on_the')}</div>}</div>
    </div>
  );
}
