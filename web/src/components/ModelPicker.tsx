import { useEffect, useState } from 'react';
import { apiMode } from '../api';
import { useT } from '../i18n';
import { getModels, type ModelsState } from '../local/store';
import { presetOf } from '../data/providers';

export interface Pick { providerId: string | null; model: string | null }

/** 生成时就地切换模型（借鉴 chatbox 移动端“随手切模型”）：只列已连通的服务；服务端模式下由服务器决定。 */
export function ModelPicker({ value, onChange, go }: { value: Pick; onChange: (p: Pick) => void; go: (to: string) => void }) {
  const { t } = useT();
  const [m, setM] = useState<ModelsState | null>(null);
  useEffect(() => { void getModels().then(setM); }, []);
  if (apiMode() === 'server') return <span className="kbd-hint">{t('模型：由你的服务器决定')}</span>;
  if (!m) return null;
  const ok = m.providers.filter((p) => p.check?.ok);
  if (!ok.length) return <button type="button" onClick={() => go('me/models')}>{t('先连接一个模型')}</button>;
  const cur = value.providerId ?? m.defaultProvider ?? ok[0]!.id;
  const prov = ok.find((p) => p.id === cur) ?? ok[0]!;
  const options = [...new Set([prov.model, ...(presetOf(prov.id)?.models ?? [])].filter(Boolean))];
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select aria-label={t('用哪个模型服务')} className="!w-auto" value={prov.id} onChange={(e) => onChange({ providerId: e.target.value, model: null })}>
        {ok.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select aria-label={t('模型')} className="!w-auto" value={value.model ?? prov.model} onChange={(e) => onChange({ providerId: prov.id, model: e.target.value })}>
        {options.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}
