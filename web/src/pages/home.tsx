import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { center, writePlatform } from '../data/platforms';
import { builtinMode, builtinOpenLabel, canSplitScreen, currentEnv, openBuiltin, openSplit, splitLabel } from '../builtin';
import { useLocalApps } from '../format';
import { appOs } from '../runtime';
import { getModels, hasConfiguredModel } from '../local/store';
import { useStoreChange } from '../local/useStore';
import { apiMode } from '../api';
import { listDrafts, loadHot, STATUS_LABEL, type Draft } from '../services';
import { nextStep, type Snapshot } from '../state';
import { ago } from '../format';
import { ErrorNext, Skeleton, StatusDot, useToast } from '../ui';
import { Composer } from '../components/Composer';
import { useAddApp } from '../components/addAppContext';

/**
 * 首页（原则 1 + 2）：一句话说明 → 唯一的“下一步”卡片 → 一句话指令框（结果以卡片出现）→ 最近内容。
 */
export function Home({ go }: { go: (to: string) => void }) {
  const { t, lang } = useT();
  const { open: openAdd, version } = useAddApp();
  const apps = useLocalApps(version);
  const [toast, show] = useToast();
  const env = currentEnv();
  const mode = builtinMode(env.rt, env.os);
  const os = appOs() ?? 'android';
  // 已登记的平台（每个平台一张入口卡片；优先本机系统的条目，用于分屏）
  const entries = Object.values((apps.data?.apps ?? []).reduce<Record<string, NonNullable<typeof apps.data>['apps'][number]>>((m, a) => {
    if (center(a.platform) && (!m[a.platform] || a.os === os)) m[a.platform] = a;
    return m;
  }, {}));
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [recent, setRecent] = useState<Draft[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    try {
      const [drafts, hot, models] = await Promise.all([listDrafts(), loadHot().catch(() => ({ items: [] })), getModels()]);
      const hasModel = apiMode() === 'server' || hasConfiguredModel(models);
      setSnap({
        hasModel, hotCount: hot.items.length, drafts: drafts.length,
        pending: drafts.filter((d) => d.status === 'pending').length, approved: drafts.filter((d) => d.status === 'approved').length, published: drafts.filter((d) => d.status === 'handed_off').length,
      });
      setRecent(drafts.slice(0, 5));
      setErr(null);
    } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e), '刷新一下页面')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useStoreChange(['drafts', 'kv:models', 'kv:hot.cache'], () => void load(), { onNavigate: true });
  const step = snap ? nextStep(snap) : null;

  return (
    <div className="page page-narrow flex flex-col gap-6">
      {toast}
      <section className="flex flex-col gap-2 pt-2">
        <h2 className="!text-[22px] !leading-snug" data-testid="intro">{t('ui.this_assistant_finds_topics_writes')}</h2>
        <p className="sub">{t('ui.everything_happens_on_this_device')}</p>
      </section>

      <ErrorNext error={err} action={t('ui.reload_2')} onAction={() => void load()} />
      {step ? (
        <section className="next-card" data-testid="next-step" data-step={step.id} aria-label={t('ui.next_step')}>
          <span className="next-ico"><Icon name={step.icon} size={20} /></span>
          <div className="grow"><strong>{t(step.title)}</strong><p>{t(step.hint)}</p></div>
          <button type="button" className="primary" onClick={() => go(step.to)}>{t(step.action)}</button>
        </section>
      ) : !err && <Skeleton h={84} r={20} />}

      <section aria-label={t('ui.start_with_one_sentence')} className="flex flex-col gap-2">
        <h2 className="section-t !m-0 !mx-1">{t('ui.start_with_one_sentence')}</h2>
        <Composer
          go={go} onPlus={() => openAdd()} onDone={() => void load()}
          suggestions={[
            ...(snap && !snap.hasModel ? [{ label: t('ui.connect_a_model_2'), to: 'me/models' }] : []),
            { label: t('ui.find_todays_topics_for_me'), to: 'topics' },
            { label: t('ui.write_a_xiaohongshu_post_making'), text: '写一篇小红书：通勤时间怎么利用' },
            { label: t('ui.add_a_phone_app'), to: 'me/platforms' },
          ]}
        />
      </section>

      {entries.length > 0 && (
        <section aria-label={t('ui.open_platform')} data-testid="builtin-entries">
          <div className="mb-2 flex items-center justify-between px-1"><h2 className="section-t !m-0">{t('ui.open_platform')}</h2><button type="button" className="ghost" onClick={() => go('publish')}>{t('ui.go_publish')} ›</button></div>
          <ul className="entry-grid">
            {entries.map((a) => {
              const c = center(a.platform)!;
              return (
                <li key={a.platform} className="entry-card">
                  <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold text-fg">{c.label.slice(0, 1)}</span>
                  <button type="button" className="primary" onClick={async () => show((await openBuiltin(c, { packageName: a.package_name ?? undefined })).message)} data-testid="home-builtin">{t(builtinOpenLabel(c, mode))}</button>
                  {canSplitScreen(env, a) && <button type="button" onClick={async () => show((await openSplit(a, c.app)).message)} data-testid="home-split">{t(splitLabel(c))}</button>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-label={t('ui.recent_content')}>
          <div className="mb-2 flex items-center justify-between px-1"><h2 className="section-t !m-0">{t('ui.recent_content')}</h2><button type="button" className="ghost" onClick={() => go('write')}>{t('ui.view_all')}</button></div>
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
