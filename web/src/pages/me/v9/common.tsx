/** 0.9.0 “我的”新页面的共用小件：异步读取 + 订阅、分段标签、下载、时间格式。文案一律经 useT()（集中 i18n，见 ADR-007）。 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ModelsStateV3 } from '@content-agent/shared';
import { useStoreChange } from '../../../local/useStore';
import type { StoreKey } from '../../../local/db';
import { getModelsV3 } from '../../../local/store';
import { useT } from '../../../i18n';
import { Icon } from '../../../icons';

/** 读一次 + 监听存储变化重读；失败时给出白话错误。 */
export function useAsync<T>(fn: () => Promise<T>, keys: StoreKey[] = [], deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { fn().then((v) => { setData(v); setError(null); }).catch((e) => setError((e as Error)?.message ?? String(e))); }, deps);
  useEffect(reload, [reload]);
  useStoreChange(keys, reload);
  return { data, error, reload };
}
export const useModelsV3 = () => useAsync<ModelsStateV3>(getModelsV3, ['kv:models', 'kv:models_v3']);

export function SegTabs<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  const { t } = useT();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={value === v} className="v9-tab" onClick={() => onChange(v)} data-testid={`tab-${v}`}>{t(l)}</button>)}
    </div>
  );
}
export function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  const { t } = useT();
  return <div className="flex items-center gap-2"><button type="button" className="ghost v9-touch" aria-label={t('返回')} onClick={onBack}><Icon name="arrowLeft" size={18} /></button><h2 className="m-0 grow text-[17px]">{label}</h2></div>;
}
export function Section({ title, children, actions, testId }: { title?: string; children: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <section className="card v9-card flex flex-col gap-2" data-testid={testId}>
      {(title || actions) && <div className="flex flex-wrap items-center justify-between gap-2">{title && <h3 className="m-0 text-[15px] font-semibold">{title}</h3>}{actions}</div>}
      {children}
    </section>
  );
}
export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' }) {
  return <p className={`m-0 text-[13px] ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{children}</p>;
}
export function download(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const fmtTime = (iso?: string): string => (iso ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-') : '');
export const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;
