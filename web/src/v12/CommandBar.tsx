/** 1.2.0 首页顶部“指挥条”：运行中的子 Agent 数、待你批准数、本月花费 / 预算、全部暂停（暂停后变“恢复”）。 */
import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { getGuard, spendSummary } from '../v9/spend';
import { onSuperChange, overview, pauseAll, resumeAll, type Overview12 } from './store';
import { groupOverview, onGroupChange, type GroupOverview } from '../v13/store';

export function CommandBar({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [o, setO] = useState<Overview12 | null>(null);
  const [g, setG] = useState<GroupOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { void Promise.all([getGuard(), spendSummary()]).then(([g, s]) => overview(g.monthBudgetYuan, s.spentMonth)).then(setO).catch(() => undefined); void groupOverview().then(setG).catch(() => undefined); }, []);
  useEffect(() => { load(); const off = onSuperChange(load); const off2 = onGroupChange(load); const iv = setInterval(load, 4000); return () => { off(); off2(); clearInterval(iv); }; }, [load]);
  if (!o) return null;
  const chip = 'inline-flex !min-h-11 items-center gap-1 !rounded-full !border !border-line !bg-surface !px-3 !text-[13px] !font-normal';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1" data-testid="cmdbar" role="region" aria-label={t('ui.v12_command_bar')}>
      <button type="button" className={chip} data-testid="cmdbar-running" onClick={() => go('command?tab=board')}><Icon name="activity" size={14} />{t('ui.v12_running')} {o.running}</button>
      <button type="button" className={chip} data-testid="cmdbar-pending" onClick={() => go('command?tab=inbox')}><Icon name="bell" size={14} />{t('ui.v12_pending_short')} {o.pending}</button>
      {g?.enabled && <button type="button" className={chip} data-testid="cmdbar-group-live" onClick={() => go('group?tab=sessions')}><Icon name="team" size={14} />{t('ui.v13_live_short')} {g.liveSessions + g.liveMeetings}</button>}
      {g?.enabled && <button type="button" className={chip} data-testid="cmdbar-group-docs" onClick={() => go('group?tab=docs')}><Icon name="tasks" size={14} />{t('ui.v13_pending_docs')} {g.pendingDocs}</button>}
      <button type="button" className={chip} data-testid="cmdbar-spend" onClick={() => go('me/spend')}><Icon name="coin" size={14} />¥{o.spentMonth.toFixed(2)}{o.budget > 0 ? ` / ¥${o.budget}` : ''}</button>
      <span className="grow" />
      {msg && <span className="text-[12px] text-muted" role="status">{msg}</span>}
      {o.paused
        ? <button type="button" className="primary !min-h-11" data-testid="cmdbar-resume" disabled={busy} onClick={() => { setBusy(true); void resumeAll().then(() => { setMsg(t('ui.v12_resumed')); load(); }).finally(() => setBusy(false)); }}>{t('ui.v12_resume')}</button>
        : <button type="button" className="!min-h-11 !border-warn !text-warn" data-testid="cmdbar-pause" disabled={busy} onClick={() => { setBusy(true); void pauseAll().then((r) => { setMsg(`${t('ui.v12_paused_toast')} · ${r.ms} ms`); load(); }).finally(() => setBusy(false)); }}><Icon name="pause" size={14} />{t('ui.v12_pause_all')}</button>}
    </div>
  );
}
