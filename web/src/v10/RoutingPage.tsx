/**
 * 0.10.0「高级：按任务路由」（补 0.9.0 D-ROUTING；v9 规格 5.6）：给某个能力里的特定任务单独指定模型，例如“封面用更好的生图模型”“上下文压缩用便宜的快速模型”。
 * 只列出运行时真的会读取的任务（见 TASKS 的 where），没指定就跟随该能力的默认模型；指定的模型被删除时这里显示“未配置”，不悄悄换别家。
 * 数据写在模型配置（ModelsStateV3.roles[role].tasks），与 runner 的 resolveTarget 同一份。
 */
import { useState } from 'react';
import { candidatesFor, displayModel, findEntry, roleLabel, type ModelsStateV3, type RoleId } from '@content-agent/shared';
import { useT } from '../i18n';
import { saveModelsV3, getModelsV3 } from '../local/store';
import { audit } from '../v9/ops';
import { BackBar, Note, Section, useModelsV3 } from '../pages/me/v9/common';
import { Problem, useToast } from '../ui';

export interface RoutingTask { role: RoleId; task: string; label: string; hint: string; where: string }
export const ROUTING_TASKS: RoutingTask[] = [
  { role: 'chat', task: 'compress', label: '上下文压缩', hint: '长对话自动压缩历史；适合便宜的快速模型', where: 'Agent 运行时 compress' },
  { role: 'chat', task: 'plan', label: '任务规划', hint: '多步任务先列计划；可用推理更强的模型', where: 'Agent 运行时 plan' },
  { role: 'chat', task: 'repair', label: '工具参数修复', hint: '模型给的参数不合格时修一次；适合快速模型', where: 'Agent 运行时 repair' },
  { role: 'chat', task: 'judge', label: '自检判官', hint: '“自检判官”实验开关打开时使用', where: 'Agent 运行时 judge' },
  { role: 'vision', task: 'ocr', label: '识别图中文字', hint: '看图工具只识字时（purpose=ocr）', where: 'image_understand purpose=ocr' },
  { role: 'image', task: 'cover', label: '封面', hint: '生图工具出封面时（purpose=cover）', where: 'image_generate purpose=cover' },
];

export function setTaskRoute(s: ModelsStateV3, role: RoleId, task: string, entryId: string | null): ModelsStateV3 {
  const n = structuredClone(s);
  const b = n.roles[role];
  const tasks = { ...(b.tasks ?? {}) };
  if (!entryId) delete tasks[task];
  else { const f = findEntry(n, entryId); if (!f) return s; tasks[task] = { accountId: f.account.id, modelEntryId: f.entry.id, model: f.entry.model }; }
  n.roles[role] = { ...b, tasks: Object.keys(tasks).length ? tasks : undefined };
  return n;
}

export function RoutingPage({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { data: s, error } = useModelsV3();
  const [toast, show] = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <div className="page page-narrow"><Problem title={t('ui.failed_to_read_model_settings')} advice={error} /></div>;
  if (!s) return null;
  const change = async (r: RoutingTask, entryId: string) => {
    setBusy(`${r.role}.${r.task}`);
    try {
      const next = setTaskRoute(await getModelsV3(), r.role, r.task, entryId || null);
      await saveModelsV3(next);
      const f = entryId ? findEntry(next, entryId) : null;
      await audit({ kind: 'setting_change', actor: 'user', summary: `按任务路由：${roleLabel(r.role)}·${r.label} → ${f ? displayModel(f.entry) : '跟随默认'}`, outcome: 'ok' });
      show(t('ui.saved_applies_to_the_next'));
    } finally { setBusy(null); }
  };
  const roles = [...new Set(ROUTING_TASKS.map((x) => x.role))];
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="routing-page">
      {toast}
      <BackBar label={t('ui.advanced_per_task_routing')} onBack={() => go('me/models')} />
      <Note>{t('ui.assign_a_model_to_specific')}</Note>
      {roles.map((role) => {
        const b = s.roles[role];
        const def = b?.primary ? findEntry(s, b.primary.modelEntryId) : null;
        const cands = candidatesFor(s, role);
        return (
          <Section key={role} title={t(roleLabel(role))} testId={`routing-${role}`}>
            <Note>{t('ui.default')}：{def ? `${displayModel(def.entry)} · ${def.account.label}` : t('ui.not_set')}</Note>
            {ROUTING_TASKS.filter((x) => x.role === role).map((r) => {
              const cur = b?.tasks?.[r.task];
              const missing = !!cur && !findEntry(s, cur.modelEntryId);
              return (
                <label key={r.task} className="field !m-0" data-testid={`route-${role}-${r.task}`}>
                  <span>{t(r.label)}<span className="ml-2 text-[12px] font-normal text-muted">{t(r.hint)}</span></span>
                  <select value={missing ? '__missing' : cur?.modelEntryId ?? ''} disabled={busy === `${r.role}.${r.task}`} onChange={(e) => void change(r, e.target.value === '__missing' ? '' : e.target.value)} aria-label={`${t(roleLabel(role))} · ${t(r.label)}`}>
                    <option value="">{t('ui.follow_default')}{def ? `（${displayModel(def.entry)}）` : ''}</option>
                    {missing && <option value="__missing">{t('ui.not_set_the_chosen_model')}</option>}
                    {cands.map((c) => <option key={c.entry.id} value={c.entry.id}>{c.text}</option>)}
                  </select>
                  {!cands.length && <span className="text-[12px] text-muted">{t('ui.no_model_name_has_this')}</span>}
                </label>
              );
            })}
          </Section>
        );
      })}
      <Note>{t('ui.models_chosen_with_win_over')}</Note>
    </div>
  );
}
