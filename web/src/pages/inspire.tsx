import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import type { Device } from '../runtime';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../components/ui/utils';
import { Hot, Library, Topics } from './content';

const TABS: [string, string, string][] = [['hot', '热点', 'hot'], ['library', '内容库', 'library'], ['topics', '选题', 'topics']];

/** 灵感：热点 / 内容库 / 选题 三个标签合并。热点一键转选题，内容库勾选生成选题，选题改写为多平台草稿后进入“创作”。 */
export function Inspire({ tab, go, device, lay }: { tab: string; go: (p: string) => void; device: Device; lay: Layout }) {
  const { t } = useT();
  return (
    <Tabs value={tab} onValueChange={(v) => go(`inspire/${v}`)} className="page">
      <div className={cn('sticky z-10 -mx-1 bg-canvas px-1 pb-3', lay === 'phone' ? 'top-14' : 'top-0')}>
        <TabsList aria-label={t('灵感')} className={cn(lay === 'phone' && 'flex w-full')}>
          {TABS.map(([id, label, icon]) => (
            <TabsTrigger key={id} value={id} className={cn(lay === 'phone' && 'h-10 min-h-10 flex-1')}>
              <Icon name={icon} size={14} />{t(label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="hot" className="outline-none">{tab === 'hot' && <Hot device={device} go={go} />}</TabsContent>
      <TabsContent value="library" className="outline-none">{tab === 'library' && <Library go={go} />}</TabsContent>
      <TabsContent value="topics" className="outline-none">{tab === 'topics' && <Topics device={device} go={go} />}</TabsContent>
    </Tabs>
  );
}
