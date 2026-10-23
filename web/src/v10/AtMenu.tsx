/**
 * 0.10.0 输入框 @ 菜单（补 0.9.0 D-AT；v9 规格 9.2 / 6.x）：键入 @ 弹出“能力 → 已配置模型”，每项“显示名（模型名）· 服务商”（没有显示名只显示模型名）；
 * 选中后以同样文字的胶囊显示在输入框上方，只影响这一轮（发送后清空），消息气泡上方标注“本轮指定：…”。指定的模型没接好按“未配置”处理，不悄悄换别家。
 */
import { useMemo } from 'react';
import { CAPS, candidatesFor, displayModel, type ModelsStateV3, type RoleId, type RoleTarget } from '@content-agent/shared';

/** 1.1.0：@ 菜单按用户能力（对话 / 思考 / 看图……）分组，不再出现“深度推理 / 快速小模型”等角色名。 */
const capLabelOf = (r: RoleId): string => CAPS.find((c) => c.role === r)?.label ?? r;
import { useT } from '../i18n';
import { Icon } from '../icons';

export interface AtPick { role: RoleId; target: RoleTarget; text: string }
/** 光标前是否正在输入 @ 词：返回查询词（可为空串）与起点。 */
export function atQuery(text: string, caret = text.length): { q: string; start: number } | null {
  const m = /(^|\s)@([^\s@]{0,24})$/.exec(text.slice(0, caret));
  return m ? { q: m[2]!, start: caret - m[2]!.length - 1 } : null;
}
export interface AtOption { role: RoleId; group: string; target: RoleTarget; text: string; hasKey: boolean }
export function atOptions(s: ModelsStateV3 | null, q: string): AtOption[] {
  if (!s) return [];
  const k = q.trim().toLowerCase();
  const out: AtOption[] = [];
  for (const cap of CAPS) for (const c of candidatesFor(s, cap.role)) {
    const role = cap.role;
    const text = `${displayModel(c.entry)} · ${c.account.label}`;
    const hay = `${cap.label} ${text} ${c.entry.model}`.toLowerCase();
    if (k && !hay.includes(k)) continue;
    out.push({ role, group: cap.label, target: { accountId: c.account.id, modelEntryId: c.entry.id, model: c.entry.model }, text, hasKey: !!c.account.hasKey || ['mock', 'ollama', 'comfyui'].includes(c.account.vendor) });
  }
  return out;
}
export const pickLabel = (p: AtPick): string => `${capLabelOf(p.role)}：${p.text}`;

export function AtMenu({ state, q, onPick, onClose }: { state: ModelsStateV3 | null; q: string; onPick: (p: AtPick) => void; onClose: () => void }) {
  const { t } = useT();
  const opts = useMemo(() => atOptions(state, q), [state, q]);
  const roles = [...new Set(opts.map((o) => o.role))];
  return (
    <div className="at-menu absolute inset-x-0 bottom-full z-30 mb-2 max-h-[min(50vh,360px)] overflow-y-auto rounded-[18px] border border-line bg-surface p-1 shadow-lg" role="listbox" aria-label={t('ui.pick_a_model_for_this')} data-testid="at-menu" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="flex min-h-11 items-center justify-between px-3 text-[13px] text-muted"><span>{t('ui.pick_a_model_for_this')}{q ? ` · “${q}”` : ''}</span><button type="button" className="ghost !min-h-11 !min-w-11 !p-0" aria-label={t('ui.close')} onClick={onClose}><Icon name="close" size={16} /></button></div>
      {!opts.length && <p className="m-0 px-3 pb-3 text-[14px] text-muted" data-testid="at-empty">{state && candidatesFor(state, 'chat').length + roles.length === 0 ? t('ui.no_models_configured_add_one') : t('ui.no_matching_model')}</p>}
      {roles.map((role) => (
        <div key={role} role="group" aria-label={t(capLabelOf(role))}>
          <div className="px-3 pt-2 pb-1 text-[12px] font-semibold text-muted">{t(capLabelOf(role))}</div>
          {opts.filter((o) => o.role === role).map((o) => (
            <button key={`${role}:${o.target.modelEntryId}`} type="button" role="option" aria-selected={false} className="!flex !min-h-11 w-full !justify-start !rounded-[12px] !border-0 !bg-transparent !px-3 !text-left !text-[14px] !font-normal hover:!bg-surface-2" onClick={() => onPick({ role, target: o.target, text: o.text })} data-testid={`at-opt-${role}`}>
              <span className="min-w-0 flex-1 truncate">{o.text}</span>{!o.hasKey && <span className="shrink-0 text-[12px] text-warn">{t('ui.no_key')}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AtChips({ picks, onRemove }: { picks: AtPick[]; onRemove: (role: RoleId) => void }) {
  const { t } = useT();
  if (!picks.length) return null;
  return (
    <div className="mb-1 flex flex-wrap gap-1" data-testid="at-chips" aria-label={t('ui.models_for_this_turn')}>
      {picks.map((p) => (
        <span key={p.role} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 pl-3 text-[13px]" data-testid={`at-chip-${p.role}`}>
          <span className="min-w-0 truncate">@{pickLabel(p)}</span>
          <button type="button" className="ghost !min-h-11 !min-w-11 !rounded-full !p-0" aria-label={`${t('ui.remove_2')} ${pickLabel(p)}`} onClick={() => onRemove(p.role)}><Icon name="close" size={14} /></button>
        </span>
      ))}
    </div>
  );
}
