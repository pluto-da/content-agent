import type { Lang } from '../i18n';
import type { Layout } from '../nav';
import { PageTabs } from '../components/PageTabs';
import { Backup, General, type Theme } from './settings';
import { Tasks } from './system';

/** 偏好：通用（主题、语言、连接、代理、采集）/ 备份 / 日志（任务与日志）。 */
export function PrefsPage({ tab, id, go, lay, theme, setTheme, lang, setLang }: {
  tab: string; id: string | null; go: (p: string) => void; lay: Layout; theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void;
}) {
  return (
    <PageTabs value={tab} onChange={(v) => go(`prefs/${v}`)} lay={lay} label="偏好" tabs={[['general', '通用', 'sliders'], ['backup', '备份', 'backup'], ['logs', '日志', 'tasks']]}>
      {tab === 'general' && <General theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />}
      {tab === 'backup' && <div className="grid"><Backup /></div>}
      {tab === 'logs' && <Tasks focus={id && /^\d+$/.test(id) ? Number(id) : null} onClear={() => go('prefs/logs')} />}
    </PageTabs>
  );
}
