/** 1.4.0 指挥页（首页）只增加“董事长简报”卡片和“待你拍板”数量（上市公司模式启用时才出现）。 */
import { useCallback, useEffect, useState } from 'react';
import type { ListedState } from '@content-agent/shared';
import { useT } from '../i18n';
import { getListed, onListedChange } from './store';

function useListed(): ListedState | null {
  const [s, setS] = useState<ListedState | null>(null);
  const load = useCallback(() => { void getListed().then(setS).catch(() => undefined); }, []);
  useEffect(() => { load(); return onListedChange(load); }, [load]);
  return s;
}
/** 指挥页（首页）的董事长简报卡片：只在上市公司模式启用时出现，显示“待你拍板”数量。 */
export function BriefCard({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const s = useListed();
  if (!s?.enabled) return null;
  const pending = s.motions.filter((m) => m.status === 'voting').length;
  return (
    <button type="button" className="card v9-card flex !min-h-11 flex-wrap items-center gap-x-2 gap-y-0 text-left" data-testid="open-brief" onClick={() => go('group?tab=gov&sec=disclosure')}>
      <strong className="min-w-0 grow whitespace-normal break-words">{t('ui.v14_brief')}</strong>
      <span className="text-[13px] text-muted" data-testid="brief-pending">{t('ui.v14_pending')} {pending}</span>
      {s.brief && <span className="w-full whitespace-pre-wrap text-[12.5px] text-muted">{s.brief.text.split('\n\n')[0]}</span>}
    </button>
  );
}
