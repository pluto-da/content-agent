/** 1.1.0：对话里的“深度思考”开关（思考是同一模型的档位，不是另一个模型）。唯一真相源：模型配置 advanced.thinking。 */
import { getModelsV3, saveModelsV3 } from '../local/store';
import { useModelsV3 } from '../pages/me/v9/common';
import { tr } from '../i18n';
import { Icon } from '../icons';

export function ThinkingToggle() {
  const { data: s } = useModelsV3();
  if (!s) return null;
  const on = s.advanced?.thinking === 'on';
  const flip = async () => { const cur = await getModelsV3(); await saveModelsV3({ ...cur, advanced: { ...cur.advanced, thinking: on ? 'off' : 'on' } }); };
  return (
    <button type="button" aria-pressed={on} aria-label={tr('ui.deep_thinking')} title={tr('ui.deep_thinking')} data-testid="thinking-toggle" className={`!min-h-11 !min-w-11 !rounded-full !px-3 max-sm:!px-0 !text-[13px] ${on ? 'primary' : ''}`} onClick={() => void flip()}>
      <Icon name="compass" size={16} /><span className="ml-1 max-sm:sr-only">{tr('ui.deep_thinking')}</span>
    </button>
  );
}
