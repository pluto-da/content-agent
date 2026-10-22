import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { centerOfWrite, writePlatform } from '../data/platforms';
import { launchLocalApp, type LocalAppEntry } from '../native';
import { appOs, copyText, openExternal } from '../runtime';
import { listDrafts, markPublished, type Draft } from '../services';
import { presetFor, useLocalApps } from '../format';
import { KNOWN_APPS } from '../data/platforms';
import { EmptyState, ErrorNext, HelpTip, Problem, useToast } from '../ui';
import { useAddApp } from '../components/addAppContext';

/** 去发布：待发布内容逐条显示，按钮是具体动作“复制文案并打开小红书”。发布永远由用户在平台 App 里点击。 */
export function Publish({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { open: openAdd, version } = useAddApp();
  const apps = useLocalApps(version);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState<Record<number, string>>({});
  const [toast, show] = useToast();
  const load = useCallback(() => { listDrafts('approved').then((d) => { setDrafts(d); setErr(null); }).catch((e) => setErr(e instanceof ApiError ? e : new ApiError('error', String(e)))); }, []);
  useEffect(load, [load]);
  const os = appOs() ?? 'android';
  const registered = apps.data?.apps ?? [];

  const entryFor = (centerId: string): LocalAppEntry => registered.find((a) => a.platform === centerId && a.os === os) ?? presetFor(KNOWN_APPS, centerId, os);

  const handoff = async (d: Draft) => {
    const c = centerOfWrite(d.platform);
    const text = [d.title, d.body, (d.tags ?? []).map((x) => `#${x.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n');
    const ok = await copyText(text);
    const r = await launchLocalApp(entryFor(c.id));
    if (!r.ok) await openExternal(c.url);
    setCopied((m) => ({ ...m, [d.id]: ok ? `${t('文案已复制')}。${r.ok ? t('已打开') + c.app : t('已打开') + c.label + t('网页版')}，${t('请粘贴后由你本人点击发布。')}` : t('复制失败，请长按正文手动复制') }));
  };

  return (
    <div className="page page-narrow flex flex-col gap-5">
      {toast}
      <p className="m-0 flex items-center gap-2 text-[15px] text-fg-2">{t('每篇内容都由你本人在平台 App 里点击发布。')}<HelpTip label={t('为什么不自动发布')}>{t('为了账号安全与平台规则，本应用只复制文案、打开官方 App 或系统分享，不会替你点击发布、点赞、评论或私信。')}</HelpTip></p>
      <ErrorNext error={err} action={t('重新加载')} onAction={load} />
      {drafts && !drafts.length && (
        <div className="card !p-0"><EmptyState icon="send" title={t('没有待发布的内容')} why={t('在“写内容”里把草稿点“通过”，它就会出现在这里。')} action={t('去审核')} onAction={() => go('write/pending')} /></div>
      )}
      {drafts?.map((d) => {
        const c = centerOfWrite(d.platform);
        return (
          <article key={d.id} className="draft-card" data-testid="publish-item">
            <div className="mb-1 flex items-center gap-2 text-[13px] text-muted"><span className="chip">{writePlatform(d.platform).label}</span></div>
            <h3>{d.title || d.body.slice(0, 24)}</h3>
            <div className="body !max-h-24">{d.body}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="primary" onClick={() => void handoff(d)} data-testid="handoff">{t('复制文案并打开')}{c.label}</button>
              <button type="button" onClick={() => go(`write/${d.id}`)}>{t('再改改')}</button>
            </div>
            {copied[d.id] && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] bg-surface-2 px-4 py-3" role="status">
                <span className="grow text-[14px] text-fg-2">{copied[d.id]}</span>
                <button type="button" className="primary" onClick={() => void markPublished(d.id).then(() => { show(t('已记为已发布，可在“看效果”录入数据')); load(); }).catch((e) => setErr(e))}>{t('我已发布')}</button>
              </div>
            )}
          </article>
        );
      })}

      <section aria-label={t('已登记的软件')}>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="section-t !m-0">{t('已登记的软件')}</h2>
          <button type="button" className="ghost" onClick={() => go('results')}>{t('看效果')} ›</button>
        </div>
        {apps.error ? <Problem title={apps.error.message} advice={apps.error.advice} action={t('重试')} onAction={apps.reload} />
          : registered.length ? (
            <ul className="item-list">
              {registered.map((a) => (
                <li key={a.id}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold text-fg" aria-hidden="true">{a.label.slice(0, 1)}</span>
                  <span className="flex min-w-0 flex-1 flex-col"><span className="item-title">{a.label}</span><span className="item-meta">{a.os}</span></span>
                  <button type="button" onClick={async () => show((await launchLocalApp(a)).message)}><Icon name="external" size={16} />{t('打开')}</button>
                </li>
              ))}
            </ul>
          ) : <div className="card !p-0"><EmptyState icon="phone" title={t('还没有登记软件')} why={t('把手机上的小红书、抖音等官方 App 加进来，发布时一键打开。')} action={t('添加软件')} onAction={() => openAdd()} /></div>}
      </section>
    </div>
  );
}
