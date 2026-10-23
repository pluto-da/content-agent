/**
 * 0.10.0：提醒到点时的 App 内提示（没有通知权限、或 App 正开着时也能看到）。只显示，不执行任何动作。
 */
import { useEffect, useState } from 'react';
import { useT } from '../i18n';

export function ReminderBanner() {
  const { t } = useT();
  const [list, setList] = useState<{ id: number; text: string; link?: string }[]>([]);
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent).detail as { id: number; text: string; link?: string }; setList((l) => [...l.filter((x) => x.id !== d.id), d].slice(-3)); };
    window.addEventListener('ca:reminder-fired', f);
    return () => window.removeEventListener('ca:reminder-fired', f);
  }, []);
  if (!list.length) return null;
  return (
    <div className="fixed inset-x-0 z-50 mx-auto flex w-[min(560px,calc(100%-24px))] flex-col gap-2" style={{ top: 'calc(var(--sa-top, 0px) + 12px)' }} role="status" aria-live="polite" data-testid="reminder-banner">
      {list.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-[16px] border border-line bg-surface px-3 py-2 shadow-lg">
          <span className="min-w-0 flex-1 text-[14px] text-fg">{t('ui.reminders')}：{r.text}</span>
          {r.link && <a className="button !min-h-11 !px-3 !text-[14px]" href={r.link.startsWith('#') ? r.link : `#${r.link}`} onClick={() => setList((l) => l.filter((x) => x.id !== r.id))}>{t('ui.open')}</a>}
          <button type="button" className="ghost !min-h-11 !px-3 !text-[14px]" onClick={() => setList((l) => l.filter((x) => x.id !== r.id))}>{t('ui.got_it')}</button>
        </div>
      ))}
    </div>
  );
}
