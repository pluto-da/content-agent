import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { CENTERS } from '../data/platforms';
import { PROVIDERS } from '../data/providers';
import { SAMPLE_IDEAS } from '../local/hot';
import type { ProviderConfig } from '../local/llm';
import { getModels, getPrefs, newProviderConfig, setPrefs } from '../local/store';
import { useLocalApps } from '../format';
import { ProviderForm } from '../components/ProviderForm';
import { Composer } from '../components/Composer';
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
  const [prov, setProv] = useState('mimo');
  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [plats, setPlats] = useState<string[]>([]);
  const [askFor, setAskFor] = useState<string | null>(null);
  useEffect(() => {
    void getModels().then((m) => {
      const c = m.providers.find((p) => p.id === 'mimo') ?? newProviderConfig('mimo');
      setCfg(c); if (m.providers.some((p) => p.check?.ok)) setConnected(true);
    });
    void getPrefs().then((p) => setPlats(p.platforms));
  }, []);
  const pickProvider = async (id: string) => {
    setProv(id); setConnected(false);
    const m = await getModels();
    setCfg(m.providers.find((p) => p.id === id) ?? newProviderConfig(id));
  };
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
          <span className="grow text-[15px] font-semibold text-fg">{t('内容运营助手')}</span>
          <button type="button" className="ghost" onClick={() => void finish()} data-testid="onb-skip-all">{t('跳过引导')}</button>
        </div>
        <div className="steps" aria-label={`${t('第')} ${step} / 3 ${t('步')}`}>{[1, 2, 3].map((i) => <span key={i} data-on={i <= step} />)}</div>

        {step === 1 && (
          <section className="flex grow flex-col gap-4" aria-label={t('连接一个模型')}>
            <div>
              <h1>{t('超级工作台——一个 Agent 帮你管理各大平台：找热点、写内容、准备发布、记录效果；发布由你本人点击。')}</h1>
              <p className="sub !text-[15px]">{t('第 1 步：连接一个写作模型。选一家，粘贴 Key，点“测试连接”。')}</p>
            </div>
            <div className="provider-grid" role="group" aria-label={t('选服务商')}>
              {PROVIDERS.filter((p) => p.common).map((p) => <button key={p.id} type="button" aria-pressed={prov === p.id} onClick={() => void pickProvider(p.id)}>{p.label}</button>)}
            </div>
            {cfg && <div className="card"><ProviderForm key={cfg.id} initial={cfg} compact onConnected={() => setConnected(true)} /></div>}
            <p className="m-0 text-[13px] text-muted">{t('Key 只保存在这台设备上，界面只显示末四位。其他服务商与自定义服务可在“我的 → 模型”里添加。')}</p>
            <div className="onb-actions flex gap-2">
              <button type="button" className="primary !min-h-12 flex-1" disabled={!connected} onClick={() => setStep(2)} data-testid="onb-next-1">{t('下一步')}</button>
              <button type="button" className="!min-h-12" onClick={() => setStep(2)}>{t('先跳过')}</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="flex grow flex-col gap-4" aria-label={t('选你要发的平台')}>
            <div><h1>{t('选你要放进工作台的平台')}</h1><p className="sub !text-[15px]">{t('勾选的平台会出现在侧栏，点一下就在工作台里打开它的官方网页；也可以顺手登记手机上的官方 App。')}</p></div>
            <ul className="group-list">
              {CENTERS.map((c) => (
                <li key={c.id}><label className="list-row cursor-pointer"><input type="checkbox" checked={plats.includes(c.id)} onChange={() => toggle(c.id)} aria-label={c.label} /><span className="row-text"><span className="row-label">{c.label}</span>{registered(c.id) && <span className="row-hint">{t('手机上的 App 已加入')}</span>}</span></label></li>
              ))}
            </ul>
            {askFor && !registered(askFor) && (
              <div className="next-card" role="dialog" aria-label={t('加入 App')} data-testid="onb-ask-app">
                <span className="next-ico"><Icon name="phone" size={20} /></span>
                <div className="grow"><strong>{t('要不要把手机上的')}{CENTERS.find((c) => c.id === askFor)?.app}{t('也加进来？')}</strong><p>{t('只保存打开 App 用的信息，不保存账号。')}</p></div>
                <button type="button" className="primary" onClick={() => { openAdd(askFor); setAskFor(null); }} data-testid="onb-add-app">{t('加入')}</button>
                <button type="button" className="ghost" onClick={() => setAskFor(null)}>{t('不用')}</button>
              </div>
            )}
            <div className="onb-actions flex gap-2">
              <button type="button" className="!min-h-12" onClick={() => setStep(1)}>{t('上一步')}</button>
              <button type="button" className="primary !min-h-12 flex-1" onClick={() => { void setPrefs({ platforms: plats }); setStep(3); }} data-testid="onb-next-2">{t('下一步')}</button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex grow flex-col gap-4" aria-label={t('和 Agent 说第一句话')}>
            <div><h1>{t('和 Agent 说第一句话')}</h1><p className="sub !text-[15px]">{t('点“发送”后进入首页对话，Agent 会真实执行：拉取合法来源的热点、分析并给出选题。')}</p></div>
            <textarea rows={3} value={first} onChange={(e) => setFirst(e.target.value)} aria-label={t('第一句话')} data-testid="onb-first" className="!text-[15px]" />
            <div className="onb-actions flex gap-2">
              <button type="button" className="!min-h-12" onClick={() => setStep(2)}>{t('上一步')}</button>
              <button type="button" className="primary !min-h-12 flex-1" disabled={!first.trim()} onClick={() => { sessionStorage.setItem('ca.firstAsk', first.trim()); void finish(); }} data-testid="onb-send">{t('发送')}</button>
              <button type="button" className="!min-h-12" onClick={() => void finish()} data-testid="onb-finish">{t('跳过')}</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
