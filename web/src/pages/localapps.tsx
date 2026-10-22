import { useState } from 'react';
import { del, get, post, put } from '../api';
import { useT } from '../i18n';
import { canListInstalled, launchLocalApp, listInstalledApps, pickDesktopApp, type KnownApp, type LocalAppEntry } from '../native';
import { MoreMenu } from '../components/MoreMenu';
import { useAddApp } from '../components/addAppContext';
import { appOs, runtime, type AppOs } from '../runtime';
import { Card, Empty, ErrorBox, Field, Loading, useToast } from '../ui';


export { OS_LABEL, presetFor, useLocalApps, type LocalAppsData } from '../format';
import { OS_LABEL, presetFor, useLocalApps, type LocalAppsData } from '../format';

/** 登记信息的简短描述。 */
export function describeEntry(e: LocalAppEntry): string {
  if (e.os === 'android') return `${e.package_name ?? ''}${e.deep_link ? ` · ${e.deep_link}` : ''}`;
  if (e.os === 'ios') return e.url_scheme ?? '';
  return [e.exec_path, e.protocol].filter(Boolean).join(' · ');
}

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 编辑表单：按系统显示对应字段。 */
export function LocalAppForm({ value, known, onSaved, onCancel }: { value: LocalAppEntry; known: KnownApp[]; onSaved: () => void; onCancel?: () => void }) {
  const { t } = useT();
  const [v, setV] = useState<LocalAppEntry>(value);
  const [err, setErr] = useState<any>(null);
  const [installed, setInstalled] = useState<{ packageName: string; label: string }[] | null>(null);
  const set = (k: keyof LocalAppEntry, x: string) => setV({ ...v, [k]: x });
  const desktop = v.os === 'windows' || v.os === 'mac';
  return (
    <form aria-label="本地应用条目" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await put('/api/local-apps', v); onSaved(); } catch (x) { setErr(x); } }}>
      <div className="form-row">
        <Field label="平台"><select value={v.platform} onChange={(e) => setV(presetFor(known, e.target.value, v.os))}>{known.map((k) => <option key={k.platform} value={k.platform}>{k.label}</option>)}</select></Field>
        <Field label="系统"><select value={v.os} onChange={(e) => setV(presetFor(known, v.platform, e.target.value as AppOs))}>{(Object.keys(OS_LABEL) as AppOs[]).map((o) => <option key={o} value={o}>{OS_LABEL[o]}</option>)}</select></Field>
        <Field label="名称"><input value={v.label} onChange={(e) => set('label', e.target.value)} /></Field>
      </div>
      {v.os === 'android' && (
        <div className="form-row">
          <Field label="包名" hint="例如 com.zhihu.android"><input value={v.package_name ?? ''} onChange={(e) => set('package_name', e.target.value)} required /></Field>
          <Field label="深链接（可选）" hint="例如 zhihu://"><input value={v.deep_link ?? ''} onChange={(e) => set('deep_link', e.target.value)} /></Field>
        </div>
      )}
      {v.os === 'ios' && <Field label="URL Scheme" hint="例如 zhihu://（需在 Info.plist 的 LSApplicationQueriesSchemes 中声明才能检测是否安装）"><input value={v.url_scheme ?? ''} onChange={(e) => set('url_scheme', e.target.value)} required /></Field>}
      {desktop && (
        <div className="form-row">
          <Field label={v.os === 'windows' ? '程序路径（.exe/.lnk）' : '应用路径（.app）'}><input value={v.exec_path ?? ''} onChange={(e) => set('exec_path', e.target.value)} placeholder={v.os === 'windows' ? 'C:\\Program Files\\…\\app.exe' : '/Applications/…app'} /></Field>
          <Field label="协议（可选）" hint="已注册的协议，如 zhihu://"><input value={v.protocol ?? ''} onChange={(e) => set('protocol', e.target.value)} /></Field>
          {runtime() === 'electron' && <button type="button" onClick={async () => { const p = await pickDesktopApp(); if (p) set('exec_path', p); }}>{t('选择应用')}</button>}
        </div>
      )}
      {v.os === 'android' && canListInstalled() && (
        <div>
          <button type="button" onClick={async () => { setErr(null); try { setInstalled(await listInstalledApps()); } catch (x) { setErr(x); } }}>{t('导入已安装应用')}</button>
          {installed && (installed.length
            ? <ul className="list compact">{installed.map((a) => <li key={a.packageName}><button type="button" className="linklike" onClick={() => setV({ ...v, package_name: a.packageName, label: v.label || a.label })}>{a.label} <span className="muted small">{a.packageName}</span></button></li>)}</ul>
            : <p className="muted small">没有找到可导入的应用。出于隐私与应用商店政策，本 App 只能看到清单中声明的官方 App（抖音、小红书、微信、知乎、闲鱼、X）。</p>)}
        </div>
      )}
      <ErrorBox error={err} />
      <div className="row wrap">
        <button className="primary" type="submit">{t('保存')}</button>
        {onCancel && <button type="button" onClick={onCancel}>{t('取消')}</button>}
      </div>
    </form>
  );
}

/** “平台”页里的本地软件管理列表：所有系统的登记、打开、编辑、删除，导入导出放在页面“⋯”菜单。 */
export function LocalAppsList({ d, onChanged }: { d: ReturnType<typeof useLocalApps>; onChanged: () => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState<LocalAppEntry | null>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const known = d.data?.known ?? [];
  const os = appOs() ?? 'android';
  const apps = d.data?.apps ?? [];
  return (
    <Card title={t('已登记的本地软件')} subtitle={t('只保存启动信息（包名、URL Scheme、程序路径），不保存账号；会随备份一起导出。')}>
      {toast}
      <ErrorBox error={err ?? d.error} />
      <Loading show={d.loading} />
      {editing && <LocalAppForm key={`${editing.platform}-${editing.os}-${editing.id ?? 'new'}`} value={editing} known={known} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); say('已保存'); onChanged(); }} />}
      {apps.length > 0 && (
        <ul className="m-0 list-none p-0">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{a.label} <span className="text-muted">· {OS_LABEL[a.os]}{a.os === os ? ` · ${t('本终端')}` : ''}</span></div>
                <div className="truncate font-mono text-[12px] text-muted">{describeEntry(a)}</div>
              </div>
              {a.os === os && <button onClick={async () => say((await launchLocalApp(a)).message)}>{t('打开')}</button>}
              <MoreMenu label={`${a.label} ${t('更多操作')}`} items={[
                { label: t('编辑'), onSelect: () => setEditing(a) },
                { label: t('删除登记'), danger: true, onSelect: async () => { setErr(null); try { await del(`/api/local-apps/${a.id}`); onChanged(); } catch (x) { setErr(x); } } },
              ]} />
            </li>
          ))}
        </ul>
      )}
      {!d.loading && !apps.length && <Empty icon="creator">{t('还没有登记软件。点侧栏底部“添加软件”，3 步完成。')}</Empty>}
    </Card>
  );
}

/** 本地软件的导入 / 导出（平台页“⋯”菜单调用）。 */
export async function exportLocalApps() { downloadJson('content-agent-local-apps.json', await get('/api/local-apps/export')); }
export async function importLocalAppsFile(f: File): Promise<string> {
  const r = await post('/api/local-apps/import', JSON.parse(await f.text()));
  return `导入 ${r.imported} 条${r.errors?.length ? `，${r.errors.length} 条无效` : ''}`;
}

/** 发布台里某个平台的“本地软件”：只保留执行动作“打开”（分享在草稿的发布交接里）；没登记时给一句说明和“添加软件”。 */
export function LocalAppLauncher({ platform, data }: { platform: string; data: LocalAppsData | null }) {
  const { t } = useT();
  const os = appOs();
  const { open } = useAddApp();
  const [toast, say] = useToast();
  const entry = os ? data?.apps?.find((a) => a.platform === platform && a.os === os) : undefined;
  return (
    <Card title={t('本地软件')}>
      {toast}
      {!os && <p className="muted">{t('无法识别本机系统，请在手机或电脑 App 中使用本地软件。')}</p>}
      {os && entry && (
        <>
          <p><b>{entry.label}</b>（{OS_LABEL[entry.os]}）<span className="muted small mono"> {describeEntry(entry)}</span></p>
          <div className="row wrap"><button className="primary" onClick={async () => say((await launchLocalApp(entry)).message)}>{t('打开应用')}</button></div>
          <p className="muted small">{t('在 App 中由你本人登录、编辑和发布；分享草稿请在草稿的“发布交接”里点“分享草稿到应用”。本应用不会操控 App 内的任何界面。')}</p>
        </>
      )}
      {os && !entry && (
        <div className="empty"><span>{t('还没有登记')} {OS_LABEL[os]} {t('上的这个软件。')}</span><button onClick={() => open(platform)}>{t('添加软件')}</button></div>
      )}
    </Card>
  );
}
