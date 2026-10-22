import { useEffect, useRef, useState } from 'react';
import { get, put } from '../api';
import { useT } from '../i18n';
import type { Layout } from '../nav';
import { launchLocalApp } from '../native';
import { appOs, electronBridge, runtime, type Device } from '../runtime';
import { MoreMenu } from '../components/MoreMenu';
import { useAddApp } from '../components/addAppContext';
import { Card, ErrorBox, SkeletonLines, StatusDot, useLoad, useToast } from '../ui';
import { LOGIN_LABEL, useLoginStatus } from './publish';
import { LocalAppsList, OS_LABEL, exportLocalApps, importLocalAppsFile, useLocalApps } from './localapps';

const DEVICE_LABEL: Record<string, string> = { phone: '手机', tablet: '平板', desktop: '电脑（App）', web: '网页' };

/**
 * 平台（原“插件”+“本地应用”+发布台登录状态合并）：每个平台一行——网页登录状态、本地软件是否登记、发布入口、模块开关。
 * 下方是本地软件管理列表与采集模块开关。导入/导出收进页面“⋯”。
 */
export function PlatformsPage({ go, device }: { go: (p: string) => void; lay: Layout; device: Device }) {
  const { t } = useT();
  const { open, version } = useAddApp();
  const centers = useLoad(() => get('/api/creator-centers'));
  const plugins = useLoad(() => get(`/api/plugins?device=${device}`), [device]);
  const apps = useLocalApps(version);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rt = runtime();
  const os = appOs() ?? 'android'; // 无法识别时按 Android（与“添加软件”的默认一致）
  const list: any[] = centers.data?.centers ?? [];
  const { status } = useLoginStatus(rt === 'electron' ? list.map((c) => c.id) : []);
  useEffect(() => { if (plugins.data?.enabled) setEnabled(plugins.data.enabled); }, [plugins.data]);
  const pl: any[] = plugins.data?.plugins ?? [];
  const pluginFor = (center: string) => pl.find((p) => p.creatorCenter === center);
  const others = pl.filter((p) => !p.creatorCenter);
  const toggle = async (id: string, on: boolean) => {
    const next = on ? [...enabled, id] : enabled.filter((x) => x !== id);
    setEnabled(next); setErr(null);
    try { await put('/api/plugins', { device, enabled: next }); say(on ? '已启用' : '已停用'); } catch (e) { setErr(e); setEnabled(enabled); }
  };
  const reloadApps = apps.reload;
  const registered = (id: string) => apps.data?.apps?.find((a) => a.platform === id && a.os === os);

  const pageMore = (
    <MoreMenu label={t('平台页更多操作')} items={[
      { label: t('导出软件登记'), icon: 'upload', onSelect: async () => { setErr(null); try { await exportLocalApps(); } catch (x) { setErr(x); } } },
      { label: t('导入软件登记'), icon: 'backup', onSelect: () => fileRef.current?.click() },
    ]} />
  );

  return (
    <div className="page mx-auto w-full max-w-[960px]">
      {toast}
      <div className="flex items-start gap-3 pb-3">
        <p className="m-0 min-w-0 flex-1 text-[13px] text-muted">{t('每个平台：网页登录、手机或电脑上的官方软件、发布入口，以及本终端是否启用。')}（{t('本终端')}：{t(DEVICE_LABEL[device] ?? device)}）{rt !== 'electron' && <> {t('网页端的登录状态由浏览器保存，本应用无法也不会检测。')}</>}</p>
        {pageMore}
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setErr(null);
          try { say(await importLocalAppsFile(f)); reloadApps(); } catch (x) { setErr(x); }
          e.target.value = '';
        }} />
      </div>
      <ErrorBox error={err ?? centers.error ?? plugins.error} />
      <section aria-label={t('平台')} className="overflow-hidden rounded-card border border-line bg-surface">
        {centers.loading ? <div className="p-5"><SkeletonLines lines={5} /></div> : (
          <ul className="m-0 list-none p-0">
            {list.map((c) => {
              const p = pluginFor(c.id);
              const on = p ? enabled.includes(p.id) : true;
              const app = registered(c.id);
              const st = status[c.id];
              const login = st ? t(LOGIN_LABEL[st][0]) : t('未登录');
              return (
                <li key={c.id} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold text-fg">{(p?.label ?? c.label).slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{p?.label ?? c.label}</div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                      {rt === 'electron' && <StatusDot tone={st === 'saved' ? 'ok' : st === 'expired' ? 'warn' : 'neutral'}>{login}</StatusDot>}
                      <span className="text-[12px] text-muted">{app ? `${t('已登记软件')}（${OS_LABEL[app.os]}）` : t('未登记软件')}</span>
                    </div>
                  </div>
                  {p && (
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-muted" title={t('本终端启用该平台模块')}>
                      <input type="checkbox" role="switch" aria-checked={on} checked={on} aria-label={`${t('启用')} ${p.label}`} onChange={(e) => void toggle(p.id, e.target.checked)} />
                      <span className="hidden sm:inline">{t('启用')}</span>
                    </label>
                  )}
                  <button className="shrink-0" onClick={() => go(`create/publish/${c.id}`)}>{t('发布')}</button>
                  <MoreMenu label={`${p?.label ?? c.label} ${t('更多操作')}`} items={[
                    ...(app ? [{ label: t('打开本地软件'), onSelect: async () => say((await launchLocalApp(app)).message) }] : []),
                    { label: app ? t('重新登记软件') : t('登记本地软件'), onSelect: () => open(c.id) },
                    ...(rt === 'electron' && st === 'saved' ? [{ label: t('退出登录/清除登录'), danger: true, onSelect: async () => {
                      if (!window.confirm(`确定退出「${c.label}」吗？将清除本机保存的该平台登录信息，下次需要重新登录。`)) return;
                      await electronBridge()?.creator?.logout(c.id); say('已清除该平台登录信息');
                    } }] : []),
                  ]} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-4 grid gap-4">
        <LocalAppsList d={apps} onChanged={reloadApps} />
        {others.length > 0 && (
          <Card title={t('采集模块')} subtitle={t('不属于某个发布平台的信息源与热榜；未启用的不参与采集。')}>
            <ul className="m-0 list-none p-0">
              {others.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{p.label}</div>
                    <div className="truncate text-[12px] text-muted">{p.description}</div>
                  </div>
                  <input type="checkbox" role="switch" aria-checked={enabled.includes(p.id)} checked={enabled.includes(p.id)} aria-label={`${t('启用')} ${p.label}`} onChange={(e) => void toggle(p.id, e.target.checked)} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="m-0 text-[12px] text-muted">{t('“添加软件”只能打开 App 或调用系统分享，不会自动操作其他 App；发布始终由你本人点击。')}</p>
      </div>
    </div>
  );
}
