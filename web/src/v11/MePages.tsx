/**
 * 1.1.0 “我的”合并页（PROMPT-v1.1 第七部分）：同一概念一个入口。
 * 记忆与技能（两个标签）· 成长（含收益标签）· 花钱 · 记录（日志 + 审计，运行健康摘要在顶部）· 数据（备份恢复 + 存储）· 硬边界（只读，与 BOUNDARIES.md 同源）。
 */
import { useState } from 'react';
import { DEFAULT_FILES, parseDoc } from '@content-agent/shared';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { getVfs } from '../v9/vfsBackend';
import { GroupList } from '../ui';
import { useAsync, SegTabs } from '../pages/me/v9/common';
import { MemoryPage, SkillsPage } from '../pages/me/v9/agentfiles';
import { GrowthPage, RevenuePage } from '../pages/me/v9/revenue';
import { StatusMain, AuditPage, SettingsV9Page, BackupV9Page } from '../pages/me/v9/ops';
import { StoragePage } from '../v1/StoragePage';

type Q = Record<string, string> | undefined;
const pick = <T extends string>(v: string | undefined, all: readonly T[], d: T): T => (all as readonly string[]).includes(v ?? '') ? (v as T) : d;

/** 硬边界：读 Agent 文件 BOUNDARIES.md（代码强制、只读），不在界面代码里另存一份。 */
export function boundaryLines(text: string): string[] {
  return parseDoc(text).body.split('\n').map((l) => /^\s*\d+[.、]\s*(.+)$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);
}
export function HardBoundaries() {
  const { t } = useT();
  const { data } = useAsync(async () => (await (await getVfs()).text('BOUNDARIES.md')) ?? DEFAULT_FILES['BOUNDARIES.md'] ?? '', ['kv:vfs_files']);
  const lines = boundaryLines(data ?? DEFAULT_FILES['BOUNDARIES.md'] ?? '');
  return (
    <GroupList title={t('ui.hard_boundaries_not_editable')}>
      {lines.map((b, i) => <li key={i}><div className="list-row static" data-testid="boundary-line"><span className="row-ico"><Icon name="lock" size={18} /></span><span className="row-text"><span className="row-hint !text-[14px] !text-fg-2">{b}</span></span></div></li>)}
    </GroupList>
  );
}

export function MemorySkillsPage({ go, query }: { go: (to: string) => void; query?: Q }) {
  const { t } = useT();
  const [tab, setTab] = useState(pick(query?.tab, ['memory', 'skills'] as const, 'memory'));
  return (
    <div className="flex flex-col" data-testid="memory-skills">
      <div className="page page-narrow !pb-0"><SegTabs value={tab} onChange={setTab} label={t('ui.memory_and_skills')} options={[['memory', '记忆'], ['skills', '技能']]} /></div>
      {tab === 'memory' ? <MemoryPage /> : <SkillsPage go={go} />}
    </div>
  );
}

export function GrowthAllPage({ query }: { query?: Q }) {
  const { t } = useT();
  const [tab, setTab] = useState(pick(query?.tab, ['growth', 'revenue'] as const, 'growth'));
  return (
    <div className="flex flex-col" data-testid="growth-all">
      <div className="page page-narrow !pb-0"><SegTabs value={tab} onChange={setTab} label={t('ui.growth')} options={[['growth', '成长'], ['revenue', '收益']]} /></div>
      {tab === 'growth' ? <GrowthPage /> : <RevenuePage />}
    </div>
  );
}

export function SpendPage() { return <SettingsV9Page part="spend" />; }

const RECORD_FILTERS = ['recent', 'failed', 'approval', 'cost', 'settings'] as const;
export function RecordsPage({ go, query, logs }: { go: (to: string) => void; query?: Q; logs: React.ReactNode }) {
  const { t } = useT();
  const [tab, setTab] = useState(pick(query?.tab, ['records', 'status'] as const, 'records'));
  const [filter, setFilter] = useState(pick(query?.filter, RECORD_FILTERS, 'recent'));
  return (
    <div className="flex flex-col" data-testid="records-page">
      <div className="page page-narrow !pb-0 flex flex-col gap-2">
        <SegTabs value={tab} onChange={setTab} label={t('ui.records')} options={[['records', '记录'], ['status', '运行健康']]} />
        {tab === 'records' && <SegTabs value={filter} onChange={setFilter} label={t('ui.filter')} options={[['recent', '最近任务'], ['failed', '失败'], ['approval', '审批'], ['cost', '花费'], ['settings', '设定改动']]} />}
      </div>
      {tab === 'status' ? <StatusMain go={go} /> : filter === 'recent' ? <><AuditPage key="all" />{logs}</>
        : filter === 'failed' ? <AuditPage key="f" outcome="failed" />
          : filter === 'approval' ? <AuditPage key="a" initialKind="approval" />
            : filter === 'cost' ? <AuditPage key="c" initialKind="spend" />
              : <AuditPage key="s" kinds={['setting_change', 'system_file_change', 'flag_change', 'migration', 'key_change']} />}
    </div>
  );
}

export function DataPage({ query }: { query?: Q }) {
  const { t } = useT();
  const [tab, setTab] = useState(pick(query?.tab, ['backup', 'storage'] as const, 'backup'));
  return (
    <div className="flex flex-col" data-testid="data-page">
      <div className="page page-narrow !pb-0"><SegTabs value={tab} onChange={setTab} label={t('ui.data')} options={[['backup', '备份与恢复'], ['storage', '存储']]} /></div>
      {tab === 'backup' ? <BackupV9Page /> : <StoragePage />}
    </div>
  );
}
