import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { cn } from './ui/utils';

/** 页内标签（每页最多 3 个），放在标题区下方一行，不与按钮挤在一起。 */
export function PageTabs({ value, onChange, tabs, lay, label, children }: {
  value: string; onChange: (v: string) => void; tabs: [string, string, string][]; lay: Layout; label: string; children: ReactNode;
}) {
  const { t } = useT();
  return (
    <Tabs value={value} onValueChange={onChange} className="page">
      <div className={cn('sticky z-10 -mx-1 bg-canvas px-1 pb-3', lay === 'phone' ? 'top-14' : 'top-0')}>
        <TabsList aria-label={t(label)} className={cn(lay === 'phone' && 'flex w-full')}>
          {tabs.map(([id, l, icon]) => (
            <TabsTrigger key={id} value={id} className={cn(lay === 'phone' && 'h-10 min-h-10 flex-1')}><Icon name={icon} size={14} />{t(l)}</TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value={value} className="outline-none">{children}</TabsContent>
    </Tabs>
  );
}
