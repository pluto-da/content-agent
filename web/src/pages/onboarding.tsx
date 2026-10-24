import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { CENTERS } from '../data/platforms';
import { getModelsV3, getPrefs, setPrefs } from '../local/store';
import { useLocalApps } from '../format';
import { ConnectWizard } from '../v11/ModelsHub';
import { Note } from './me/v9/common';
import { useAddApp } from '../components/addAppContext';

/**
 * 首次打开引导（借鉴 open-webui“先连模型、连不上明确说”）：三步，每步可跳过。
 * 1 连接一个模型（测试成功才亮“下一步”）→ 2 选要发的平台（勾选后问“要不要把手机上的 App 也加进来”）→ 3 写第一篇（当场看到结果）。
 */
export function Onboarding({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { open: openAdd, version } = useAddApp();
  const apps = useLocalApps(version);
  const [step, setStep] = useState(1);
  const [first, setFirst] = useState('看看今天各平台热点，给我 3 个选题');
  const [connected, setConnected] = useState(false);
  const [plats, setPlats] = useState<string[]>([]);
  const [askFor, setAskFor] = useState<string | null>(null);
  useEffect(() => {
    void getModelsV3().then((m) => { if (m.main) setConnected(true); });
    void getPrefs().then((p) => setPlats(p.platforms));
  }, []);
  const finish = async () => { await setPrefs({ onboarded: true, platforms: plats }); go('agent'); };
  const registered = (id: string) => !!apps.data?.apps.some((a) => a.platform === id);
  const toggle = (id: string) => {
    const on = plats.includes(id);
    setPlats(on ? plats.filter((x) => x !== id) : [...plats, id]);
    if (!on && !registered(id)) setAskFor(id);
  };

  return (
    <div className="onb" data-testid="onboarding">
      <div className="onb-inner">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-[10px] bg-ink text-ink-fg"><Icon name="topics" size={18} /></span>
          <span className="grow text-[15px] font-semibold text-fg">{t('ui.super_workbench')}</span>
          <button type="button" className="ghost" onClick={() => void finish()} data-testid="onb-skip-all">{t('ui.skip_setup')}</button>
        </div>
        <div className="steps" aria-label={`${t('ui.x')} ${step} / 3 ${t('ui.steps_2')}`}>{[1, 2, 3].map((i) => <span key={i} data-on={i <= step} />)}</div>

        {step === 1 && (
          <section className="flex grow flex-col gap-4" aria-label={t('ui.connect_a_model_2')}>
            <div>
              <h1>{t('ui.super_workbench_one_agent_to')}</h1>
              <p className="sub !text-[15px]">{t('ui.step_1_connect_a_writing')}</p>
            </div>
            {/* 1.1.0：与“我的 → 模型 → 接入第一个模型”同一个三步向导（选服务商 → 填 Key → 选模型），不再有第二套接入表单 */}
            {connected ? <Note>{t('ui.model_connected_next')}</Note> : <ConnectWizard go={go} cap={null} embedded onDone={() => { setConnected(true); setStep(2); }} />}
            <p className="m-0 text-[13px] text-muted">{t('ui.keys_stay_on_this_device')}</p>
            <div className="onb-actions flex gap-2">
              <button type="button" className="primary !min-h-12 flex-1" disabled={!connected} onClick={() => setStep(2)} data-testid="onb-next-1">{t('ui.next_step')}</button>
              <button type="button" className="!min-h-12" onClick={() => setStep(2)}>{t('ui.skip_for_now')}</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="flex grow flex-col gap-4" aria-label={t('ui.pick_the_platforms_you_publish')}>
            <div><h1>{t('ui.pick_platforms_for_your_workspace')}</h1><p className="sub !text-[15px]">{t('ui.ticked_platforms_appear_in_the')}</p></div>
            <ul className="group-list">
              {CENTERS.map((c) => (
                <li key={c.id}><label className="list-row cursor-pointer"><input type="checkbox" checked={plats.includes(c.id)} onChange={() => toggle(c.id)} aria-label={c.label} /><span className="row-text"><span className="row-label">{c.label}</span>{registered(c.id) && <span className="row-hint">{t('ui.phone_app_added')}</span>}</span></label></li>
              ))}
            </ul>
            {askFor && !registered(askFor) && (
              <div className="next-card" role="dialog" aria-label={t('ui.add_app_2')} data-testid="onb-ask-app">
                <span className="next-ico"><Icon name="phone" size={20} /></span>
                <div className="grow"><strong>{t('ui.add_the_phone_app_for')}{CENTERS.find((c) => c.id === askFor)?.app}{t('ui.add_it_too')}</strong><p>{t('ui.only_launch_info_is_stored_3')}</p></div>
                <button type="button" className="primary" onClick={() => { openAdd(askFor); setAskFor(null); }} data-testid="onb-add-app">{t('ui.add_2')}</button>
                <button type="button" className="ghost" onClick={() => setAskFor(null)}>{t('ui.no_thanks')}</button>
              </div>
            )}
            <div className="onb-actions flex gap-2">
              <button type="button" className="!min-h-12" onClick={() => setStep(1)}>{t('ui.previous')}</button>
              <button type="button" className="primary !min-h-12 flex-1" onClick={() => { void setPrefs({ platforms: plats }); setStep(3); }} data-testid="onb-next-2">{t('ui.next_step')}</button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex grow flex-col gap-4" aria-label={t('ui.say_your_first_words_to')}>
            <div><h1>{t('ui.say_your_first_words_to')}</h1><p className="sub !text-[15px]">{t('ui.after_send_you_go_to')}</p></div>
            <textarea rows={3} value={first} onChange={(e) => setFirst(e.target.value)} aria-label={t('ui.first_message')} data-testid="onb-first" className="!text-[15px]" />
            <div className="onb-actions flex gap-2">
              <button type="button" className="!min-h-12" onClick={() => setStep(2)}>{t('ui.previous')}</button>
              <button type="button" className="primary !min-h-12 flex-1" disabled={!first.trim()} onClick={() => { sessionStorage.setItem('ca.firstAsk', first.trim()); void finish(); }} data-testid="onb-send">{t('ui.send')}</button>
              <button type="button" className="!min-h-12" onClick={() => void finish()} data-testid="onb-finish">{t('ui.skip')}</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
