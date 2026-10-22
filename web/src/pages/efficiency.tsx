import { useState } from 'react';
import { get, put } from '../api';
import { useT } from '../i18n';
import { Badge, Card, Empty, ErrorBox, SkeletonLines, useLoad, useToast } from '../ui';
import { PLATFORM_LABEL } from './publish';

const pct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const ms = (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const yuan = (v: number | null | undefined) => (v == null ? '—' : `¥${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`);
const TIER: Record<string, string> = { high: '高置信', medium: '中置信', low: '低置信' };

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface px-4 py-3">
      <div className="truncate text-[13px] text-muted">{label}</div>
      <div className={`num mt-1 text-[22px] font-semibold leading-tight ${tone === 'warn' ? 'text-warn' : 'text-fg'}`}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-muted" title={hint}>{hint}</div>}
    </div>
  );
}

/** 推理效率（运行状态页）：单篇成本、缓存命中率、一次通过率、返工放大系数、p50/p95、各服务商失败率；草稿-验证分档与健康路由开关。 */
export function EfficiencyPanel() {
  const { t } = useT();
  const [days, setDays] = useState(30);
  const m = useLoad(() => get(`/api/metrics/efficiency?days=${days}`), [days]);
  const ps = useLoad(() => get('/api/pipeline/settings'));
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  // 只在返回结构完整时渲染（旧版后端或空响应时不崩溃）
  const d = m.data && typeof m.data.drafts === 'number' && m.data.cache && m.data.firstPass && m.data.amplification && m.data.latency ? m.data : null;
  const save = async (body: unknown, msg: string) => { setErr(null); try { await put('/api/pipeline/settings', body); ps.reload(); say(msg); } catch (e) { setErr(e); } };
  const dv = !!ps.data?.draftVerify?.enabled;
  const hr = ps.data?.health?.enabled !== false;
  const hit = d?.cache?.hitRate;
  const amp = d?.amplification?.factor;

  return (
    <>
      <Card className="span-12" title={t('推理效率')} subtitle={t('每一份调用只做一次有效的工作')} actions={
        <select aria-label={t('统计区间')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>{t('近 1 天')}</option><option value={7}>{t('近 7 天')}</option><option value={30}>{t('近 30 天')}</option>
        </select>
      }>
        <ErrorBox error={m.error} />
        {m.loading && !d ? <SkeletonLines lines={3} /> : d ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Metric label={t('单篇成本')} value={yuan(d.costPerDraft)} hint={`${d.drafts} ${t('篇')} · ${t('生成类调用')} ${yuan(d.generationCost)}`} />
              <Metric label={t('缓存命中率')} value={pct(hit)} tone={hit != null && hit < 0.5 ? 'warn' : undefined} hint={hit == null ? t('服务商未返回命中字段') : `${t('目标')} > 50% · ${d.cache.reportedCalls} ${t('次')}`} />
              <Metric label={t('一次通过率')} value={pct(d.firstPass.rate)} hint={`${d.firstPass.passed}/${d.firstPass.measured} ${t('篇 Schema 一次通过')}`} />
              <Metric label={t('返工放大系数')} value={amp == null ? '—' : `${amp.toFixed(2)}×`} tone={amp != null && amp > 1.5 ? 'warn' : undefined} hint={`${d.amplification.calls} / ${d.amplification.minCalls} ${t('次调用')}`} />
              <Metric label="p50" value={ms(d.latency.p50)} hint={`${d.latency.calls} ${t('次成功调用')}`} />
              <Metric label="p95" value={ms(d.latency.p95)} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-2 text-[13px] font-medium">{t('各服务商')}</div>
                {(d.providers ?? []).length ? (
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>{t('服务商')}</th><th>{t('调用')}</th><th>{t('失败率')}</th><th>p50</th><th>p95</th></tr></thead>
                    <tbody>{(d.providers ?? []).map((p: any) => (
                      <tr key={p.provider}><td>{p.provider}</td><td className="num">{p.calls}</td>
                        <td>{p.failRate > 0 ? <Badge tone={p.failRate >= 0.5 ? 'bad' : 'warn'}>{pct(p.failRate, 1)}</Badge> : <span className="num muted">0%</span>}</td>
                        <td className="num">{ms(p.p50)}</td><td className="num">{ms(p.p95)}</td></tr>
                    ))}</tbody>
                  </table></div>
                ) : <Empty icon="activity">{t('暂无调用记录')}</Empty>}
              </div>
              <div className="min-w-0">
                <div className="mb-2 text-[13px] font-medium">{t('按平台单篇成本')}</div>
                {(d.byPlatform ?? []).length ? (
                  <ul className="list rows">{(d.byPlatform ?? []).map((p: any) => (
                    <li key={p.platform} className="row between small"><span className="ellipsis">{PLATFORM_LABEL[p.platform] ?? p.platform}</span><span className="num muted nowrap">{yuan(p.costPerDraft)} · {p.drafts} {t('篇')}</span></li>
                  ))}</ul>
                ) : <Empty icon="coin">{t('暂无草稿')}</Empty>}
                {(d.confidence ?? []).some((c: any) => c.n > 0) && (
                  <p className="small mt-3">{t('置信度分布')}：{(d.confidence ?? []).map((c: any) => <Badge key={c.tier} tone={c.tier === 'high' ? 'ok' : c.tier === 'medium' ? 'info' : 'warn'}>{t(TIER[c.tier] ?? c.tier)} {c.n}</Badge>)}</p>
                )}
              </div>
            </div>
            <p className="muted small mt-3">{t('单篇成本按任务归集估算（改写/草稿/复核的文本、配图、配音、字幕）；返工放大系数 = 实际调用次数 ÷ 理论最少调用次数，越接近 1 越好。')}</p>
          </>
        ) : !m.loading && !m.error ? <Empty icon="activity">{t('暂无调用记录')}</Empty> : null}
      </Card>

      <Card className="span-12" title={t('推理策略')}>
        {toast}
        <ErrorBox error={err ?? ps.error} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="row top gap-3 rounded-card border border-line px-4 py-3">
            <input type="checkbox" checked={dv} onChange={(e) => save({ draftVerify: { enabled: e.target.checked } }, e.target.checked ? '已开启草稿-验证分档' : '已关闭草稿-验证分档')} />
            <span className="grow min-w-0">
              <b>{t('草稿-验证分档')}</b> {dv ? <Badge tone="ok">{t('已开启')}</Badge> : <Badge>{t('默认关闭')}</Badge>}
              <span className="block muted small">{t('草稿模型（路由 llm → 任务 draft）出稿；高置信直接进待审，中置信只复核标题与合规，低置信才用强模型重写。')}</span>
              {ps.data?.draftModel && <span className="block muted small">{t('草稿')}：{ps.data.draftModel.provider}/{ps.data.draftModel.model} · {t('强模型')}：{ps.data.strongModel?.provider}/{ps.data.strongModel?.model}{ps.data.priceRatio != null && ` · ${t('单价比')} ${pct(ps.data.priceRatio)}`}</span>}
              {ps.data?.warning && <span className="block small text-warn">{ps.data.warning}</span>}
            </span>
          </label>
          <label className="row top gap-3 rounded-card border border-line px-4 py-3">
            <input type="checkbox" checked={hr} onChange={(e) => save({ health: { enabled: e.target.checked } }, e.target.checked ? '已开启健康路由' : '已关闭健康路由')} />
            <span className="grow min-w-0">
              <b>{t('健康路由')}</b> {hr ? <Badge tone="ok">{t('已开启')}</Badge> : <Badge>{t('已关闭')}</Badge>}
              <span className="block muted small">{t('主路失败时切备用；主路近')} {ps.data?.health?.windowMin ?? 30} {t('分钟失败率')} ≥ {pct(ps.data?.health?.maxFailRate ?? 0.5)}（{t('至少')} {ps.data?.health?.minSamples ?? 4} {t('次')}）{t('时先走备用。')}</span>
            </span>
          </label>
        </div>
      </Card>
    </>
  );
}
