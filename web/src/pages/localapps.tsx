import { useState } from 'react';
import { del, get, post, put } from '../api';
import { useT } from '../i18n';
import { canListInstalled, launchLocalApp, listInstalledApps, pickDesktopApp, type KnownApp, type LocalAppEntry } from '../native';
import { appOs, runtime, type AppOs } from '../runtime';
import { Badge, Card, ErrorBox, Field, Loading, useLoad, useToast } from '../ui';

export const OS_LABEL: Record<AppOs, string> = { android: 'Android', ios: 'iOS', windows: 'Windows', mac: 'macOS' };

export interface LocalAppsData { apps: (LocalAppEntry & { id: number })[]; known: KnownApp[] }

export function useLocalApps() {
  return useLoad<LocalAppsData>(() => get('/api/local-apps'));
}

/** 登记信息的简短描述。 */
export function describeEntry(e: LocalAppEntry): string {
  if (e.os === 'android') return `${e.package_name ?? ''}${e.deep_link ? ` · ${e.deep_link}` : ''}`;
  if (e.os === 'ios') return e.url_scheme ?? '';
  return [e.exec_path, e.protocol].filter(Boolean).join(' · ');
}

/** 某平台在本机系统上的预设条目（官方包名 / Scheme）。 */
export function presetFor(known: KnownApp[], platform: string, os: AppOs): LocalAppEntry {
  const k = known.find((x) => x.platform === platform);
  const base: LocalAppEntry = { platform, os, label: k?.label ?? platform };
  if (os === 'android') return { ...base, package_name: k?.android ?? '' };
  if (os === 'ios') return { ...base, url_scheme: k?.ios ?? '' };
  return { ...base, protocol: '', exec_path: '' };
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

/** 插件管理中的“本地应用”：登记、导入导出。 */
export function LocalAppsManager() {
  const { t } = useT();
  const d = useLocalApps();
  const [editing, setEditing] = useState<LocalAppEntry | null>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const known = d.data?.known ?? [];
  const os = appOs() ?? 'android';
  return (
    <Card title={t('本地应用')} actions={<>
      <button onClick={() => setEditing(presetFor(known, known[0]?.platform ?? 'douyin', os))} disabled={!known.length}>{t('添加')}</button>
      <button onClick={async () => { setErr(null); try { downloadJson('content-agent-local-apps.json', await get('/api/local-apps/export')); } catch (x) { setErr(x); } }}>{t('导出')}</button>
      <label className="button-like">{t('导入')}<input type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setErr(null);
        try { const r = await post('/api/local-apps/import', JSON.parse(await f.text())); say(`导入 ${r.imported} 条${r.errors?.length ? `，${r.errors.length} 条无效` : ''}`); d.reload(); } catch (x) { setErr(x); }
        e.target.value = '';
      }} /></label>
    </>}>
      {toast}
      <p className="muted small">为每个平台登记手机或电脑上的官方 App，创作中心与发布交接会同时提供「网页端（创作中心）」和「本地应用」两种方式。这里只保存启动信息（包名、URL Scheme、程序路径），不保存账号；登记会随备份一起导出。</p>
      <ErrorBox error={err ?? d.error} />
      <Loading show={d.loading} />
      {editing && <LocalAppForm key={`${editing.platform}-${editing.os}-${editing.id ?? 'new'}`} value={editing} known={known} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); say('已保存'); d.reload(); }} />}
      <table className="table">
        <thead><tr><th>平台</th><th>系统</th><th>启动信息</th><th></th></tr></thead>
        <tbody>
          {d.data?.apps?.map((a) => (
            <tr key={a.id}>
              <td><b>{a.label}</b></td>
              <td>{OS_LABEL[a.os]} {a.os === os && <Badge tone="info">{t('本终端')}</Badge>}</td>
              <td className="small mono">{describeEntry(a)}</td>
              <td className="row wrap">
                {a.os === os && <button onClick={async () => say((await launchLocalApp(a)).message)}>{t('打开应用')}</button>}
                <button onClick={() => setEditing(a)}>编辑</button>
                <button className="danger" onClick={async () => { setErr(null); try { await del(`/api/local-apps/${a.id}`); d.reload(); } catch (x) { setErr(x); } }}>{t('删除')}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!d.loading && !d.data?.apps?.length && <p className="muted">{t('暂无数据')}</p>}
    </Card>
  );
}

/** 创作中心里某个平台的“本地应用”面板。 */
export function LocalAppPanel({ platform, data, reload }: { platform: string; data: LocalAppsData | null; reload: () => void }) {
  const { t } = useT();
  const os = appOs();
  const [toast, say] = useToast();
  const [editing, setEditing] = useState(false);
  const known = data?.known ?? [];
  const entry = os ? data?.apps?.find((a) => a.platform === platform && a.os === os) : undefined;
  const others = data?.apps?.filter((a) => a.platform === platform && a.os !== os) ?? [];
  return (
    <Card title={t('本地应用')}>
      {toast}
      {!os && <p className="muted">无法识别本机系统，请在其他终端使用本地应用。</p>}
      {os && entry && !editing && (
        <>
          <p><b>{entry.label}</b>（{OS_LABEL[entry.os]}）<span className="muted small mono"> {describeEntry(entry)}</span></p>
          <div className="row wrap">
            <button className="primary" onClick={async () => say((await launchLocalApp(entry)).message)}>{t('打开应用')}</button>
            <button onClick={() => setEditing(true)}>编辑</button>
          </div>
          <p className="muted small">在 App 中由你本人登录、编辑和发布；本应用不会操控 App 内的任何界面。</p>
        </>
      )}
      {os && (!entry || editing) && (
        <>
          {!entry && <p className="muted small">还没有登记 {OS_LABEL[os]} 上的应用。可以用官方预设一键填写，按需修改后保存。</p>}
          <LocalAppForm key={`${platform}-${os}`} value={entry ?? presetFor(known, platform, os)} known={known} onCancel={entry ? () => setEditing(false) : undefined} onSaved={() => { setEditing(false); say('已保存'); reload(); }} />
        </>
      )}
      {others.length > 0 && <p className="muted small">其他系统已登记：{others.map((o) => OS_LABEL[o.os]).join('、')}</p>}
    </Card>
  );
}
