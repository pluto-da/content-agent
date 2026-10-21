import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { useT } from '../i18n';
import type { Device } from '../runtime';
import { Badge, Card, ErrorBox, Field, Loading, StatusBadge, useLoad, useToast } from '../ui';

export function AgentFiles() {
  const { t } = useT();
  const files = useLoad(() => get('/api/agent/files'));
  const [path, setPath] = useState('soul.md');
  const file = useLoad(() => (path.startsWith('memory/') ? get(`/api/agent/memory?path=${encodeURIComponent(path)}`) : get(`/api/agent/file?path=${encodeURIComponent(path)}`)), [path]);
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  useEffect(() => { if (file.data) setContent(file.data.content); }, [file.data]);
  const readOnly = path.startsWith('memory/');
  return (
    <div className="split">
      <Card title={t('系统文件')}>
        <p className="muted small">soul、工作方式、用户画像、确认规则与 skills 均可编辑；每次保存生成新版本，可回滚。硬边界写在代码中，修改这些文件不能放宽。</p>
        <ul className="list compact">
          {files.data?.files?.map((f: string) => <li key={f}><button className={`linklike ${path === f ? 'active' : ''}`} onClick={() => setPath(f)}>{f}</button></li>)}
        </ul>
        <h3>{t('记忆')}</h3>
        <ul className="list compact">
          {files.data?.memory?.map((m: any) => <li key={m.path}><button className={`linklike ${path === m.path ? 'active' : ''}`} onClick={() => setPath(m.path)}>{m.path}</button></li>)}
        </ul>
        <p className="small">必须确认的操作：{files.data?.approval?.map((a: string) => <Badge key={a}>{a}</Badge>)}</p>
      </Card>
      <Card title={path}>
        {toast}
        <ErrorBox error={err ?? file.error} />
        <Loading show={file.loading} />
        <Field label={t('内容')}><textarea className="mono" rows={20} value={content} readOnly={readOnly} onChange={(e) => setContent(e.target.value)} /></Field>
        {!readOnly && (
          <div className="form-row">
            <Field label={t('理由')}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="为什么修改（写入改进日志）" /></Field>
            <button className="primary" onClick={async () => { setErr(null); try { const r = await put('/api/agent/file', { path, content, reason }); say(`已保存为版本 #${r.version.id}`); setReason(''); file.reload(); } catch (e) { setErr(e); } }}>{t('保存')}</button>
          </div>
        )}
        {file.data?.history && (
          <details>
            <summary>{t('历史版本')}（{file.data.history.length}）</summary>
            <ul className="list compact">
              {file.data.history.map((v: any) => (
                <li key={v.id} className="row between">
                  <span>#{v.id} {v.kind} {v.active ? <Badge tone="ok">生效</Badge> : null} <span className="muted small">{v.created_at} {v.reason}</span></span>
                  {!v.active && <button onClick={async () => { setErr(null); try { await post(`/api/versions/${v.id}/rollback`, { reason: '手动回滚' }); say('已回滚'); file.reload(); } catch (e) { setErr(e); } }}>{t('回滚')}</button>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}

export function Improve() {
  const { t } = useT();
  const log = useLoad(() => get('/api/improvement-log'));
  const versions = useLoad(() => get('/api/versions'));
  const skills = useLoad(() => get('/api/skills'));
  const bench = useLoad(() => get('/api/evals/benchmark'));
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const skillVersions = (versions.data?.versions ?? []).filter((v: any) => v.target.startsWith('skills/'));
  return (
    <div className="grid">
      <Card title="Skills">
        <ErrorBox error={skills.error} />
        <table className="table">
          <thead><tr><th>名称</th><th>需要的模型能力</th><th>{t('状态')}</th></tr></thead>
          <tbody>{skills.data?.skills?.map((s: any) => (
            <tr key={s.name}><td><b>{s.name}</b><div className="muted small">{s.description}</div></td><td>{s.models.map((m: string) => <Badge key={m}>{m}</Badge>)}</td>
              <td>{s.missing.length ? <Badge tone="warn">缺 {s.missing.join('/')}</Badge> : <Badge tone="ok">可用</Badge>}</td></tr>
          ))}</tbody>
        </table>
        {skills.data?.errors?.map((e: any) => <div key={e.file} className="alert error">{e.file}：{e.error}</div>)}
      </Card>
      <Card title={t('A/B 评测')}>
        <p className="muted small">对同一个 skill 的两个版本运行基准集（{bench.data?.cases?.length ?? 0} 个用例），比较通过率。评测只证明格式与规则层面的改进，真实效果以平台数据为准。</p>
        <div className="form-row">
          <Field label="版本 A"><select value={a} onChange={(e) => setA(e.target.value)}><option value="">选择</option>{skillVersions.map((v: any) => <option key={v.id} value={v.id}>#{v.id} {v.target}</option>)}</select></Field>
          <Field label="版本 B"><select value={b} onChange={(e) => setB(e.target.value)}><option value="">选择</option>{skillVersions.map((v: any) => <option key={v.id} value={v.id}>#{v.id} {v.target}</option>)}</select></Field>
          <button className="primary" disabled={!a || !b} onClick={async () => { setErr(null); try { setRes(await post('/api/evals/ab', { a: Number(a), b: Number(b) })); versions.reload(); log.reload(); } catch (e) { setErr(e); } }}>{t('运行')}</button>
        </div>
        <ErrorBox error={err} />
        {res && <p>A #{res.A.version}：{(res.A.passRate * 100).toFixed(0)}%  B #{res.B.version}：{(res.B.passRate * 100).toFixed(0)}%  （{res.cases} 个用例）{res.note && <Badge tone="warn">{res.note}</Badge>}</p>}
      </Card>
      <Card title={t('改进日志')} actions={<button onClick={log.reload}>{t('刷新')}</button>}>
        <pre className="pre">{log.data?.content}</pre>
      </Card>
    </div>
  );
}

export function Plugins({ device }: { device: Device }) {
  const { t } = useT();
  const p = useLoad(() => get(`/api/plugins?device=${device}`), [device]);
  const [sel, setSel] = useState<string[]>([]);
  const [toast, say] = useToast();
  useEffect(() => { if (p.data) setSel(p.data.enabled); }, [p.data]);
  const label: Record<string, string> = { phone: '手机', tablet: '平板', desktop: '电脑（App）', web: '网页' };
  return (
    <Card title={`${t('插件管理')} · ${t('本终端')}：${label[device]}`} actions={<button className="primary" onClick={async () => { await put('/api/plugins', { device, enabled: sel }); say('已保存，本终端导航与改写目标已更新'); p.reload(); }}>{t('保存')}</button>}>
      {toast}
      <p className="muted small">每个终端单独勾选要启用的平台模块；未启用的插件不出现在导航、改写目标与热榜采集中。插件只能声明白名单内的能力。</p>
      <ErrorBox error={p.error} />
      <ul className="plugins">
        {p.data?.plugins?.map((pl: any) => (
          <li key={pl.id}>
            <label className="row top">
              <input type="checkbox" checked={sel.includes(pl.id)} onChange={(e) => setSel(e.target.checked ? [...sel, pl.id] : sel.filter((x) => x !== pl.id))} />
              <span className="grow"><b>{pl.label}</b> {pl.provides.map((x: string) => <Badge key={x}>{x}</Badge>)}<div className="muted small">{pl.description}</div></span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Tasks() {
  const { t } = useT();
  const tasks = useLoad(() => get('/api/tasks?limit=100'));
  const reloadTasks = tasks.reload;
  const [level, setLevel] = useState('');
  const logs = useLoad(() => get(`/api/logs?limit=200${level ? '&level=' + level : ''}`), [level]);
  useEffect(() => {
    const iv = setInterval(reloadTasks, 5000);
    return () => clearInterval(iv);
  }, [reloadTasks]);
  return (
    <div className="grid">
      <Card title={t('任务')} actions={<button onClick={tasks.reload}>{t('刷新')}</button>}>
        <div className="stats">{Object.entries(tasks.data?.stats ?? {}).map(([k, v]) => <div key={k} className="stat"><b>{String(v)}</b><span><StatusBadge status={k} /></span></div>)}</div>
        <ErrorBox error={tasks.error} />
        <table className="table">
          <thead><tr><th>#</th><th>任务</th><th>{t('状态')}</th><th>次数</th><th>耗时</th><th>错误</th></tr></thead>
          <tbody>{tasks.data?.tasks?.map((x: any) => (
            <tr key={x.id}><td>{x.id}</td><td>{x.label}</td><td><StatusBadge status={x.status} /></td><td>{x.attempts}</td><td>{x.ms ?? '–'}ms</td><td className="small">{x.error}</td></tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="结构化日志" actions={<select aria-label="日志级别" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">全部</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>}>
        <pre className="pre small">{logs.data?.logs?.map((l: any) => JSON.stringify(l)).join('\n')}</pre>
      </Card>
    </div>
  );
}
