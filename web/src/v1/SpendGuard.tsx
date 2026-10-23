/**
 * 1.0 费用护栏设置（“我的 → 花钱与实验功能”）：月度预算、按角色日上限、异常花费提醒阈值；本月 / 今天已花与提醒列表。
 * 规则在 shared/agent/policy.ts（代码强制）：超预算一定先问、不能“记住此类”；异常花费只提醒。
 */
import { useState } from 'react';
import { ROLE_IDS, roleLabel, readSpendGuard, type SpendGuard } from '@content-agent/shared';
import { useT } from '../i18n';
import { Problem, useToast } from '../ui';
import { useAsync, Section, Note } from '../pages/me/v9/common';
import { getGuard, saveGuard, spendSummary, seenAlerts, currentAlerts } from '../v9/spend';
import { audit } from '../v9/ops';

export function SpendGuardSection() {
  const { t } = useT();
  const { data: g } = useAsync(getGuard, ['kv:prefs']);
  const { data: sum } = useAsync(() => spendSummary(), ['usage_log']);
  const { data: alerts } = useAsync(async () => { const seen = await seenAlerts(); const cur = await currentAlerts(); return [...cur, ...seen.filter((s) => !cur.some((c) => c.id === s.id))].slice(-20).reverse(); }, ['usage_log', 'kv:spend.alerts']);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  if (!g) return null;
  const val = (k: string, d: number | undefined) => draft[k] ?? (d === undefined ? '' : String(d));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setErr(null);
    const n = (k: string, d: number) => { const v = draft[k]; if (v === undefined) return d; if (v.trim() === '') return 0; return Number(v); };
    const month = n('month', g.monthBudgetYuan);
    const caps: Record<string, number> = {};
    for (const r of ROLE_IDS) { const v = n(`cap.${r}`, g.roleDayCapYuan[r] ?? 0); if (!(v >= 0)) { setErr(t('ui.cap_must_be_0_or')); return; } if (v > 0) caps[r] = v; }
    const dayFactor = n('dayFactor', g.anomaly.dayFactor), single = n('single', g.anomaly.singleCallYuan);
    if (!(month >= 0 && month <= 100000) || !(dayFactor >= 1.5) || !(single >= 0)) { setErr(t('ui.budget_0_100000_factor_at')); return; }
    const next: SpendGuard = readSpendGuard({ monthBudgetYuan: month, roleDayCapYuan: caps, anomaly: { ...g.anomaly, dayFactor, singleCallYuan: single } });
    await saveGuard(next);
    await audit({ kind: 'setting_change', actor: 'user', summary: `费用护栏：月度预算 ¥${next.monthBudgetYuan || '不设'}；日上限 ${Object.entries(next.roleDayCapYuan).map(([r, v]) => `${roleLabel(r as never)} ¥${v}`).join('、') || '未设'}；异常提醒 ${next.anomaly.dayFactor} 倍 / 单笔 ¥${next.anomaly.singleCallYuan}`, target: 'spend.guard', outcome: 'ok' });
    setDraft({}); show(t('ui.saved_applies_to_the_next'));
  };
  const pctUsed = g.monthBudgetYuan > 0 && sum ? Math.min(100, Math.round((sum.spentMonth / g.monthBudgetYuan) * 100)) : 0;
  return (
    <Section title={t('ui.spending_guardrails')} testId="spend-guard">
      {toast}
      {sum && <div className="flex flex-col gap-1" data-testid="spend-month">
        <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] text-muted">{t('ui.spent_this_month')}</span><strong className="tabular-nums text-[18px]">¥{sum.spentMonth.toFixed(2)}{g.monthBudgetYuan > 0 ? ` / ¥${g.monthBudgetYuan}` : ''}</strong></div>
        {g.monthBudgetYuan > 0 && <div className="v1-meter" role="progressbar" aria-label={t('ui.monthly_budget_usage')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctUsed}><span style={{ width: `${pctUsed}%` }} data-tone={pctUsed >= 100 ? 'bad' : pctUsed >= 80 ? 'warn' : 'ok'} /></div>}
        <Note>{t('ui.spent_today_2')} ¥{sum.spentToday.toFixed(3)} · {t('ui.calls_this_month')} {sum.calls} {t('ui.calls')}</Note>
      </div>}
      <div className="form-row">
        <label className="field"><span>{t('ui.monthly_budget_0_none')}</span><input inputMode="decimal" value={val('month', g.monthBudgetYuan)} onChange={set('month')} data-testid="guard-month" /></label>
      </div>
      <Note>{t('ui.once_the_monthly_budget_or')}</Note>
      <details className="v1-details" data-testid="guard-caps">
        <summary>{t('ui.daily_caps_per_capability_empty')}</summary>
        <div className="grid gap-2 pt-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {ROLE_IDS.map((r) => <label key={r} className="field"><span>{t(roleLabel(r))}{sum?.spentTodayByRole[r] ? ` · ${t('ui.today')} ¥${sum.spentTodayByRole[r]!.toFixed(3)}` : ''}</span><input inputMode="decimal" value={val(`cap.${r}`, g.roleDayCapYuan[r])} onChange={set(`cap.${r}`)} data-testid={`guard-cap-${r}`} aria-label={`${t(roleLabel(r))} ${t('ui.daily_cap')}`} /></label>)}
        </div>
      </details>
      <div className="form-row">
        <label className="field"><span>{t('ui.alert_when_todays_spend_exceeds')}</span><input inputMode="decimal" value={val('dayFactor', g.anomaly.dayFactor)} onChange={set('dayFactor')} data-testid="guard-dayfactor" /></label>
        <label className="field"><span>{t('ui.alert_when_a_single_call')}</span><input inputMode="decimal" value={val('single', g.anomaly.singleCallYuan)} onChange={set('single')} data-testid="guard-single" /></label>
      </div>
      <Note>{t('ui.unusual_spend_only_triggers_an')}</Note>
      {err && <Problem title={err} advice={t('ui.fix_it_then_save')} />}
      <button type="button" className="primary self-start" onClick={() => void save()} data-testid="guard-save">{t('ui.save')}</button>
      {!!alerts?.length && <ul className="item-list" data-testid="spend-alerts" aria-label={t('ui.spend_alerts')}>{alerts.map((a) => <li key={a.id}><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{a.text}</span><span className="item-meta">{a.at.slice(0, 16).replace('T', ' ')}</span></span></li>)}</ul>}
    </Section>
  );
}
