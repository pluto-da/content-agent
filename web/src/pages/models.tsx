import type { Layout } from '../nav';
import { PageTabs } from '../components/PageTabs';
import { useT } from '../i18n';
import { Status } from './content';
import { Models as Routes, Secrets } from './settings';

/** 模型：路由 / 密钥 / 用量（原设置中心的“模型”“密钥”“运行状态”）。 */
export function ModelsPage({ tab, go, lay }: { tab: string; go: (p: string) => void; lay: Layout }) {
  const { t } = useT();
  return (
    <PageTabs value={tab} onChange={(v) => go(`models/${v}`)} lay={lay} label="模型" tabs={[['routes', '路由', 'cpu'], ['keys', '密钥', 'key'], ['usage', '用量', 'activity']]}>
      {tab === 'routes' && <div className="grid"><Routes /></div>}
      {tab === 'keys' && <Secrets />}
      {tab === 'usage' && (
        <>
          <p className="m-0 mb-3 text-[13px] text-muted">{t('花了多少钱、模型是否稳定、内容流转到哪一步。下面的专业指标都附有白话说明。')}</p>
          <Status go={go} />
        </>
      )}
    </PageTabs>
  );
}
