import type { Layout } from '../nav';
import { PageTabs } from '../components/PageTabs';
import { AgentFiles, Improve } from './system';

/** Agent：文件（soul、规则、skills、记忆）/ 改进（评测与改进日志）。 */
export function AgentPage({ tab, go, lay }: { tab: string; go: (p: string) => void; lay: Layout }) {
  return (
    <PageTabs value={tab} onChange={(v) => go(`agent/${v}`)} lay={lay} label="Agent" tabs={[['files', '文件', 'agent'], ['improve', '改进', 'improve']]}>
      {tab === 'files' ? <AgentFiles /> : <Improve />}
    </PageTabs>
  );
}
