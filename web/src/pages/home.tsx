import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { writePlatform } from '../data/platforms';
import { getModels } from '../local/store';
import { apiMode } from '../api';
import { listDrafts, loadHot, STATUS_LABEL, type Draft } from '../services';
import { nextStep, type Snapshot } from '../state';
import { ago } from '../format';
import { ErrorNext, Skeleton, StatusDot } from '../ui';
import { Composer } from '../components/Composer';
import { useAddApp } from '../components/addAppContext';

/**
 * 首页（原则 1 + 2）：一句话说明 → 唯一的“下一步”卡片 → 一句话指令框（结果以卡片出现）→ 最近内容。
 */
export function Home({ go }: { go: (to: string) => void }) {
  const { t, lang } = useT();
  const { open: openAdd } = useAddApp();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [recent, setRecent] = useState<Draft[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    try {
      const [drafts, hot, models] = await Promise.all([listDrafts(), loadHot().catch(() => ({ items: [] })), getModels()]);
      const hasModel = apiMode() === 'server' || models.providers.some((p) => p.check?.ok);
      setSnap({
        hasModel, hotCount: hot.items.length, drafts: drafts.length,
        pending: drafts.filter((d) => d.status === 'pending').length, approved: drafts.filter((d) => d.status === 'approved').length, published: drafts.filter((d) => d.status === 'handed_off').length,
      });
      setRecent(drafts.slice(0, 5));
      setErr(null);
    } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e), '刷新一下页面')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const step = snap ? nextStep(snap) : null;

  return (
    <div className="page page-narrow flex flex-col gap-6">
      <section className="flex flex-col gap-2 pt-2">
        <h2 className="!text-[22px] !leading-snug" data-testid="intro">{t('这个助手帮你找选题、写内容、准备发布，发布由你自己点。')}</h2>
        <p className="sub">{t('全部在这台设备上完成，不需要服务器。')}</p>
      </section>

      <ErrorNext error={err} action={t('重新加载')} onAction={() => void load()} />
      {step ? (
        <section className="next-card" data-testid="next-step" data-step={step.id} aria-label={t('下一步')}>
          <span className="next-ico"><Icon name={step.icon} size={20} /></span>
          <div className="grow"><strong>{t(step.title)}</strong><p>{t(step.hint)}</p></div>
          <button type="button" className="primary" onClick={() => go(step.to)}>{t(step.action)}</button>
        </section>
      ) : !err && <Skeleton h={84} r={20} />}

      <section aria-label={t('一句话开始')} className="flex flex-col gap-2">
        <h2 className="section-t !m-0 !mx-1">{t('一句话开始')}</h2>
        <Composer
          go={go} onPlus={() => openAdd()} onDone={() => void load()}
          suggestions={[
            ...(snap && !snap.hasModel ? [{ label: t('连接一个模型'), to: 'me/models' }] : []),
            { label: t('帮我找今天的选题'), to: 'topics' },
            { label: t('写一篇小红书：通勤时间怎么利用'), text: '写一篇小红书：通勤时间怎么利用' },
            { label: t('添加手机上的 App'), to: 'me/platforms' },
          ]}
        />
      </section>

      {recent.length > 0 && (
        <section aria-label={t('最近内容')}>
          <div className="mb-2 flex items-center justify-between px-1"><h2 className="section-t !m-0">{t('最近内容')}</h2><button type="button" className="ghost" onClick={() => go('write')}>{t('查看全部')}</button></div>
          <ul className="item-list">
            {recent.map((d) => (
              <li key={d.id}>
                <button type="button" className="linklike !min-h-11 !p-0" onClick={() => go(`write/${d.id}`)}>
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="item-title ellipsis">{d.title || d.body.slice(0, 30)}</span>
                    <span className="item-meta">{writePlatform(d.platform).short} · <StatusDot tone={d.status === 'pending' ? 'neutral' : d.status === 'approved' ? 'info' : 'ok'}>{t(STATUS_LABEL[d.status] ?? d.status)}</StatusDot> · {ago(d.updated_at ?? d.created_at, lang)}</span>
                  </span>
                  <Icon name="chevronRight" size={16} className="text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
