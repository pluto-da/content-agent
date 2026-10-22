import { useState } from 'react';
import { get, put } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown';
import { useLoad, useToast } from '../ui';

interface Opt { provider: string; providerLabel: string; model: string; price: number | null }

/** 单价（元/百万输出 token）：用户自定义单价优先，其次内置默认价；都没有时返回 null。 */
function outPrice(prices: Record<string, any>, defaults: Record<string, any>, provider: string, model: string): number | null {
  for (const k of [`${provider}:${model}`, provider]) {
    const v = prices?.[k]?.output ?? defaults?.[k]?.output;
    if (typeof v === 'number') return v;
  }
  return null;
}

/**
 * 生成面板里的“当前模型”：显示文本模型（llm 路由主模型），点一下就地切换（例如 MiMo flash → pro），并显示大致成本差异。
 * 只改 llm 路由的主模型，保留思考模式、备用等其他配置；高级配置仍在“模型”页。
 */
export function ModelSwitch({ go }: { go?: (p: string) => void }) {
  const { t } = useT();
  const m = useLoad(() => get('/api/models'));
  const [toast, say] = useToast();
  const [busy, setBusy] = useState(false);
  const d = m.data;
  if (!d || !Array.isArray(d.providers)) return null;
  const routes: Record<string, any> = d.routes ?? {};
  const cur = routes.llm?.default;
  const provs: any[] = d.providers.filter((p: any) => Array.isArray(p.capabilities) && p.capabilities.includes('llm'));
  const curProv = provs.find((p) => p.id === cur?.provider);
  const curModel: string = cur?.model || curProv?.models?.llm || '';
  const opts: Opt[] = [];
  for (const p of provs) {
    if (p.id !== cur?.provider && !(p.ready?.ok)) continue;
    const models: string[] = p.id === cur?.provider ? (p.modelOptions?.length ? p.modelOptions : [p.models?.llm].filter(Boolean)) : [p.models?.llm].filter(Boolean);
    for (const model of models) opts.push({ provider: p.id, providerLabel: p.label, model, price: outPrice(d.prices, d.defaultPrices, p.id, model) });
  }
  const curPrice = cur ? outPrice(d.prices, d.defaultPrices, cur.provider, curModel) : null;
  const diff = (o: Opt) => {
    if (o.price == null) return t('单价未知');
    const base = `¥${o.price}/${t('百万输出')}`;
    if (curPrice && curPrice > 0 && !(o.provider === cur?.provider && o.model === curModel)) return `${base} · ${t('约为当前')} ${(o.price / curPrice).toFixed(o.price / curPrice >= 10 ? 0 : 1)}×`;
    return base;
  };
  const choose = async (o: Opt) => {
    setBusy(true);
    try {
      const llm = { ...(routes.llm ?? {}), default: { ...(routes.llm?.default ?? {}), provider: o.provider, model: o.model } };
      await put('/api/models/routes', { routes: { ...routes, llm } });
      say(`${t('已切换为')} ${o.providerLabel} ${o.model}`);
      m.reload();
    } catch (e) { say(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const label = cur ? `${curProv?.label ?? cur.provider} ${curModel}`.trim() : t('未配置');
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
      {toast}
      <span>{t('当前模型')}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={busy} aria-label={`${t('当前模型')}：${label}，${t('点击切换')}`} className="!text-fg">
            <Icon name="cpu" size={14} />{label}<Icon name="chevronRight" size={12} className="rotate-90" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {opts.map((o) => (
            <DropdownMenuItem key={`${o.provider}:${o.model}`} hint={diff(o)} icon={o.provider === cur?.provider && o.model === curModel ? <Icon name="check" size={14} /> : <span className="inline-block w-[14px]" />} onSelect={() => void choose(o)}>
              {o.providerLabel} {o.model}
            </DropdownMenuItem>
          ))}
          {go && <DropdownMenuItem hint={t('备用模型、单价、思考模式')} onSelect={() => go('models/routes')}>{t('更多模型设置…')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {curPrice != null && <span className="tabular">¥{curPrice}/{t('百万输出')}</span>}
    </div>
  );
}
