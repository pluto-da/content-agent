/**
 * 我的 → 数据源（0.8.0，修订 R1-a / R1-b）：第三方数据服务连接器 + 平台官方接口 + 公开来源 + 热点巡视 + 来源说明。
 * 凭证本机加密保存（AES-GCM），只显示末四位；可测试连接；未连接显示申请指引；没有公开 API 的标“暂不支持”。
 */
import { useCallback, useEffect, useState } from 'react';
import { useStoreChange } from '../../local/useStore';
import { CONNECTORS, DOUYIN_OPEN, PATROL_STOPS, PLATFORM_SOURCES, PUBLIC_SOURCES, ROUTE_LABEL, type ConnectorMeta } from '../../data/hotSources';
import { isConnected, listCreds, removeCred, saveCred, tail4, unseal, type SourceCred } from '../../local/secure';
import { getPrefs, setPrefs, type Prefs } from '../../local/store';
import { testConnector } from '../../hot/connectors';
import { openExternal } from '../../runtime';
import { GroupList } from '../../ui';

type Meta = Pick<ConnectorMeta, 'id' | 'label' | 'note' | 'apply' | 'fields'> & { docs?: string; status: ConnectorMeta['status']; covers?: string; route: 'a' | 'b' };
const ALL: Meta[] = [
  ...CONNECTORS.map((c) => ({ ...c, route: 'a' as const })),
  { id: DOUYIN_OPEN.id, label: DOUYIN_OPEN.label, note: DOUYIN_OPEN.note, apply: DOUYIN_OPEN.apply, docs: DOUYIN_OPEN.docs, fields: DOUYIN_OPEN.fields, status: 'supported', covers: '抖音实时热点词与热度', route: 'b' },
];

export function SourcesPage() {
  const [creds, setCreds] = useState<Record<string, SourceCred>>({});
  const [prefs, setP] = useState<Prefs | null>(null);
  const load = useCallback(async () => { setCreds(await listCreds()); setP(await getPrefs()); }, []);
  useEffect(() => { void load(); }, [load]);
  useStoreChange(['kv:sources.creds', 'kv:prefs'], () => void load());
  return (
    <div className="page page-narrow" data-testid="sources-page">
      <p className="m-0 mb-4 text-[14px] text-muted">Agent 会按你连接 / 启用的来源自动规划“五路并行”收集热点；它不会在平台页面里点击、滚动或读取内容。凭证只存在这台设备上（加密），界面只显示末四位。</p>
      <GroupList title={`a · ${ROUTE_LABEL.a}（第三方数据服务，你自己的 API Key）`}>
        {ALL.filter((m) => m.route === 'a').map((m) => <ConnectorRow key={m.id} m={m} cred={creds[m.id]} onChange={load} />)}
      </GroupList>
      <GroupList title={`b · ${ROUTE_LABEL.b}（平台官方数据）`}>
        {ALL.filter((m) => m.route === 'b').map((m) => <ConnectorRow key={m.id} m={m} cred={creds[m.id]} onChange={load} />)}
        <div className="px-4 py-3 text-[14px] text-fg-2">巨量算数等官方页面没有公开接口，只能在内置浏览器里打开给你本人看（热点巡视里也有）。</div>
      </GroupList>
      <GroupList title={`c · ${ROUTE_LABEL.c}`}>
        <div className="px-4 py-3 text-[14px] text-fg-2">在抖音、小红书等官方 App 里点“分享 → 超级工作台”，或在任何地方选中文字后点“发给 Agent”。内容先出预览，确认后进入素材箱与当前会话。</div>
      </GroupList>
      <GroupList title={`d · ${ROUTE_LABEL.d}（公开 RSS 与榜单，先查 robots）`}>
        {PUBLIC_SOURCES.map((s) => {
          const on = !!prefs?.hotSources.includes(s.id);
          return (
            <label key={s.id} className="flex min-h-12 items-center gap-3 px-4 text-[15px]">
              <input type="checkbox" checked={on} onChange={async () => { const cur = prefs?.hotSources ?? []; await setPrefs({ hotSources: on ? cur.filter((x) => x !== s.id) : [...cur, s.id] }); void load(); }} />
              <span className="min-w-0 flex-1">{s.label}<small className="block text-[12px] text-muted">{s.platform}{s.note ? ` · ${s.note}` : ''}</small></span>
            </label>
          );
        })}
      </GroupList>
      <GroupList title={`e · ${ROUTE_LABEL.e}（你本人翻看，Agent 不读页面）`}>
        <div className="px-4 py-3 text-[14px] text-fg-2">对 Agent 说“开始热点巡视”，它会在内置浏览器依次打开：{PATROL_STOPS.map((s) => s.label).join('、')}。底部浮条有“下一个 / 发给 Agent / 结束”。</div>
      </GroupList>
      <GroupList title="来源说明（逐平台）">
        <table className="w-full text-left text-[13px]" data-testid="source-table">
          <thead><tr className="text-muted"><th className="px-3 py-2 font-normal">平台</th><th className="px-3 py-2 font-normal">路数</th><th className="px-3 py-2 font-normal">方式与状态</th></tr></thead>
          <tbody>
            {PLATFORM_SOURCES.map((r) => (
              <tr key={r.platform} className="border-t border-line align-top">
                <td className="px-3 py-2 whitespace-nowrap text-fg">{r.label}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.routes.join(' ')}</td>
                <td className="px-3 py-2">{r.how}<span className="block text-muted">{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </GroupList>
    </div>
  );
}

function ConnectorRow({ m, cred, onChange }: { m: Meta; cred?: SourceCred; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const secretKeys = m.fields.filter((f) => f.secret).map((f) => f.key);
  const connected = isConnected(cred, secretKeys);
  const [tails, setTails] = useState<Record<string, string>>({});
  useEffect(() => { void (async () => { const t: Record<string, string> = {}; for (const f of m.fields) if (f.secret && cred?.fields[f.key]) t[f.key] = tail4(await unseal(cred.fields[f.key])) || `••••${cred.fields[f.key]!.tail}`; setTails(t); })(); }, [cred, m.fields]);
  const state = m.status === 'unsupported' ? '暂不支持' : connected ? (cred?.check ? (cred.check.ok ? '已连接' : '连接失败') : '已填写') : '未连接';
  return (
    <div className="border-b border-line px-4 py-3 last:border-0" data-testid={`source-${m.id}`} data-state={state}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] text-fg">{m.label}</p>
          <p className="m-0 text-[12px] text-muted">{m.covers}</p>
        </div>
        <span className={state === '已连接' ? 'text-[13px] text-ok' : state === '连接失败' ? 'text-[13px] text-bad' : 'text-[13px] text-muted'}>{state}</span>
        {m.status !== 'unsupported' && <button type="button" className="!min-h-9 !px-3 !text-[13px]" onClick={() => setOpen((x) => !x)}>{open ? '收起' : connected ? '管理' : '连接'}</button>}
      </div>
      <p className="m-0 mt-1 text-[13px] text-fg-2">{m.note}</p>
      {connected && Object.keys(tails).length > 0 && <p className="m-0 mt-1 text-[12px] text-muted" data-testid="masked">{m.fields.filter((f) => f.secret).map((f) => `${f.label} ${tails[f.key] ?? ''}`).join(' · ')}{cred?.check?.reason ? ` · ${cred.check.reason}` : ''}</p>}
      <div className="mt-1 flex flex-wrap gap-3 text-[13px]">
        <button type="button" className="!min-h-0 !border-0 !bg-transparent !p-0 !text-[13px] !text-accent" onClick={() => void openExternal(m.apply)}>{m.status === 'unsupported' ? '打开官网' : '申请 / 购买指引'}</button>
        {m.docs && <button type="button" className="!min-h-0 !border-0 !bg-transparent !p-0 !text-[13px] !text-accent" onClick={() => void openExternal(m.docs!)}>接口文档</button>}
      </div>
      {open && (
        <form className="mt-2 flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await saveCred(m.id, vals, secretKeys); setVals({}); setMsg('已加密保存'); setBusy(false); onChange(); }}>
          {m.fields.map((f) => (
            <label key={f.key} className="text-[13px] text-muted">{f.label}{f.optional ? '（可选）' : ''}
              <input type={f.secret ? 'password' : 'text'} autoComplete="off" value={vals[f.key] ?? ''} placeholder={f.secret && tails[f.key] ? `已保存 ${tails[f.key]}（留空不改）` : f.placeholder ?? (cred?.plainFields?.[f.key] || '')} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} className="!min-h-10 w-full !text-[14px]" />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="primary !min-h-10" disabled={busy}>保存</button>
            <button type="button" className="!min-h-10" disabled={busy || !connected} onClick={async () => { setBusy(true); setMsg('正在测试…'); const r = await testConnector(m.id); setMsg(r.ok ? `连接成功${r.ms ? `，用时 ${(r.ms / 1000).toFixed(1)} 秒` : ''}` : `连接失败：${r.reason}`); setBusy(false); onChange(); }}>测试连接</button>
            {cred && <button type="button" className="!min-h-10" onClick={async () => { await removeCred(m.id); setMsg('已删除'); onChange(); }}>删除凭证</button>}
          </div>
          {msg && <p className="m-0 text-[13px] text-muted" role="status">{msg}</p>}
        </form>
      )}
    </div>
  );
}
