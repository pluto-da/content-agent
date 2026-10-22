import { useT, type Lang } from '../i18n';
import { Icon } from '../icons';
import { SETTINGS_GROUPS, SETTINGS_NAV, type Layout } from '../nav';
import type { Device } from '../runtime';
import { cn } from '../components/ui/utils';
import { Status } from './content';
import { SettingsSection, type Theme } from './settings';
import { AgentFiles, Improve, Plugins, Tasks } from './system';

/** 设置中心：运行状态、任务与日志、系统文件、改进与评测、插件、通用/密钥/模型/备份 分组收纳。手机先列表后全屏；平板/电脑 左列表 | 右内容。 */
export function SettingsCenter({ section, go, lay, device, theme, setTheme, lang, setLang }: {
  section: string; go: (p: string) => void; lay: Layout; device: Device; theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void;
}) {
  const { t } = useT();
  const isPhone = lay === 'phone';
  const cur = section || (isPhone ? '' : 'general');

  const nav = (
    <nav aria-label={t('设置分组')} className={cn(isPhone ? 'px-4 pb-4' : 'w-[232px] shrink-0 overflow-y-auto border-r border-line px-3 py-4')}>
      {SETTINGS_GROUPS.map((g) => (
        <div key={g} className="mb-4">
          <div className={cn('pb-1 text-[12px] font-medium text-muted', isPhone ? 'px-1' : 'px-2')}>{t(g)}</div>
          <ul className={cn('m-0 list-none p-0', isPhone ? 'overflow-hidden rounded-card border border-line bg-surface' : 'flex flex-col gap-0.5')}>
            {SETTINGS_NAV.filter((n) => n.group === g).map((n) => (
              <li key={n.id} className={cn(isPhone && 'border-t border-line first:border-t-0')}>
                <a
                  href={`#${n.id}`} aria-current={cur === n.section ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); go(n.id); }}
                  className={cn(
                    'flex items-center gap-3 text-fg-2 no-underline hover:no-underline',
                    isPhone ? 'min-h-14 px-4 py-2 active:bg-surface-2' : 'h-9 rounded-ctl px-2 text-sm hover:bg-surface-2 hover:text-fg',
                    !isPhone && cur === n.section && 'bg-surface-2 font-medium text-fg',
                  )}
                >
                  <Icon name={n.icon} size={isPhone ? 18 : 16} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', isPhone && 'text-[15px] text-fg')}>{t(n.label)}</span>
                    {isPhone && <span className="block truncate text-[12px] text-muted">{t(n.desc)}</span>}
                  </span>
                  {isPhone && <Icon name="chevronRight" size={16} className="text-faint" />}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className={cn('m-0 text-[12px] text-muted', isPhone ? 'px-1' : 'px-2')}>{t('硬边界写在代码中，设置不能放宽。')}</p>
    </nav>
  );

  const body = (() => {
    switch (cur) {
      case 'status': return <Status go={go} />;
      case 'agent': return <AgentFiles />;
      case 'improve': return <Improve />;
      case 'plugins': return <Plugins device={device} />;
      case 'tasks': return <Tasks />;
      case 'general': case 'secrets': case 'models': case 'backup':
        return <SettingsSection section={cur} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />;
      default: return null;
    }
  })();

  if (isPhone) return cur ? <div className="px-4 pt-1">{body}</div> : nav;
  const item = SETTINGS_NAV.find((n) => n.section === cur);
  return (
    <div className="flex min-h-0 flex-1 border-t border-line">
      {nav}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1100px] px-6 py-5">
          {item && <h2 className="m-0 mb-4 text-base">{t(item.label)}<span className="ml-2 text-[13px] font-normal text-muted">{t(item.desc)}</span></h2>}
          {body}
        </div>
      </div>
    </div>
  );
}
