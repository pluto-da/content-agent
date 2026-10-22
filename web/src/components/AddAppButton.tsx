import { useT } from '../i18n';
import { Icon } from '../icons';
import { useAddApp } from './addAppContext';
import { Tip } from './ui/tooltip';
import { cn } from './ui/utils';

/**
 * 悬浮“添加软件”按钮。
 * - side：侧栏底部（电脑/平板展开）——墨色胶囊、40px 高、左“＋”、右上角数量角标；
 * - rail：侧栏折叠成图标栏时——40×40 圆形“＋”，悬停提示“添加软件”；
 * - drawer：手机“更多”抽屉底部——同胶囊样式，占满宽度、44px 触控高度。
 * 外层容器负责 sticky 置底与发丝线分隔（见 App.tsx）。
 */
export function AddAppButton({ variant }: { variant: 'side' | 'rail' | 'drawer' }) {
  const { t } = useT();
  const { open, count } = useAddApp();
  const badge = count > 0 && (
    <span
      className={cn('absolute grid h-[18px] min-w-[18px] place-items-center rounded-full border border-ink bg-surface px-1 text-[13px] font-semibold leading-none tabular-nums text-fg', variant === 'rail' ? '-right-1 -top-1' : '-right-1.5 -top-1.5')}
      aria-hidden="true"
    >{count}</span>
  );
  const label = count > 0 ? `${t('添加软件')}（${t('已登记')} ${count}）` : t('添加软件');
  if (variant === 'rail') return (
    <Tip label={t('添加软件')}>
      <button type="button" onClick={() => open()} aria-label={label} data-testid="add-app" className="add-app-fab !relative !h-10 !min-h-10 !w-10 !rounded-full !p-0">
        <Icon name="plus" size={18} strokeWidth={1.75} />{badge}
      </button>
    </Tip>
  );
  return (
    <button
      type="button" onClick={() => open()} aria-label={label} data-testid="add-app"
      className={cn('add-app-fab !relative w-full !justify-start !gap-2 !rounded-full !px-[14px] text-sm', variant === 'drawer' ? '!h-11 !min-h-11' : '!h-10 !min-h-10')}
    >
      <Icon name="plus" size={16} strokeWidth={1.75} />
      <span className="flex-1 text-left">{t('添加软件')}</span>
      {badge}
    </button>
  );
}
