import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { useT } from '../i18n';
import type { Device } from '../runtime';
import { Badge, Card, ErrorBox, Field, Loading, StatusBadge, StatusDot, useLoad, useToast } from '../ui';

const STATUS_LABEL: Record<string, string> = { succeeded: '成功', failed: '失败', running: '运行中', queued: '排队' };

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
      <Card icon="agent" title={t('系统文件')}>
        <p className="muted small">soul、工作方式、用户画像、确认规则与 skills 均可编辑；每次保存生成新版本，可回滚。硬边界写在代码中，修改这些文件不能放宽。</p>
        <Field label={t('文件')}>
          <select value={path} onChange={(e) => setPath(e.target.value)} aria-label={t('选择文件')}>
            <optgroup label={t('系统文件')}>{files.data?.files?.map((f: string) => <option key={f} value={f}>{f}</option>)}</optgroup>
            {files.data?.memory?.length ? <optgroup label={t('记忆（只读）')}>{files.data.memory.map((m: any) => <option key={m.path} value={m.path}>{m.path}</option>)}</optgroup> : null}
          </select>
        </Field>
        <p className="small">必须确认的操作：<span className="muted">{(files.data?.approval ?? []).join('、')}</span></p>
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
      <Card icon="topics" title="Skills">
        <ErrorBox error={skills.error} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>名称</th><th>需要的模型能力</th><th>{t('状态')}</th></tr></thead>
          <tbody>{skills.data?.skills?.map((s: any) => (
            <tr key={s.name}><td><b>{s.name}</b><div className="muted small">{s.description}</div></td><td className="small muted">{s.models.join(' · ')}</td>
              <td>{s.missing.length ? <StatusDot tone="warn">缺 {s.missing.join('/')}</StatusDot> : <StatusDot tone="ok">可用</StatusDot>}</td></tr>
          ))}</tbody>
        </table></div>
        {skills.data?.errors?.map((e: any) => <div key={e.file} className="alert error">{e.file}：{e.error}</div>)}
      </Card>
      <Card icon="analytics" title={t('A/B 评测')}>
        <p className="muted small">对同一个 skill 的两个版本运行基准集（{bench.data?.cases?.length ?? 0} 个用例），比较通过率。评测只证明格式与规则层面的改进，真实效果以平台数据为准。</p>
        <div className="form-row">
          <Field label="版本 A"><select value={a} onChange={(e) => setA(e.target.value)}><option value="">选择</option>{skillVersions.map((v: any) => <option key={v.id} value={v.id}>#{v.id} {v.target}</option>)}</select></Field>
          <Field label="版本 B"><select value={b} onChange={(e) => setB(e.target.value)}><option value="">选择</option>{skillVersions.map((v: any) => <option key={v.id} value={v.id}>#{v.id} {v.target}</option>)}</select></Field>
          <button className="primary" disabled={!a || !b} onClick={async () => { setErr(null); try { setRes(await post('/api/evals/ab', { a: Number(a), b: Number(b) })); versions.reload(); log.reload(); } catch (e) { setErr(e); } }}>{t('运行')}</button>
        </div>
        <ErrorBox error={err} />
        {res && <p>A #{res.A.version}：{(res.A.passRate * 100).toFixed(0)}%  B #{res.B.version}：{(res.B.passRate * 100).toFixed(0)}%  （{res.cases} 个用例）{res.note && <Badge tone="warn">{res.note}</Badge>}</p>}
      </Card>
      <Card icon="improve" title={t('改进日志')} actions={<button onClick={log.reload}>{t('刷新')}</button>}>
        <pre className="pre">{log.data?.content}</pre>
      </Card>
    </div>
  );
}

const PROVIDES: Record<string, string> = { source: '采集', rewrite: '改写', handoff: '发布交接', creator_center: '创作后台', hot_board: '热榜' };

/** 平台模块开关（原“插件”页，0.5.0 并入“平台”页）。每个终端单独勾选。 */
export function Plugins({ device }: { device: Device }) {
  const { t } = useT();
  const p = useLoad(() => get(`/api/plugins?device=${device}`), [device]);
  const [sel, setSel] = useState<string[]>([]);
  const [toast, say] = useToast();
  useEffect(() => { if (p.data) setSel(p.data.enabled); }, [p.data]);
  const label: Record<string, string> = { phone: '手机', tablet: '平板', desktop: '电脑（App）', web: '网页' };
  return (
    <Card title={`${t('平台模块')} · ${t('本终端')}：${label[device]}`} subtitle={t('未启用的模块不出现在改写目标与热榜采集中；模块只能声明白名单内的能力。')}
      actions={<button className="primary" onClick={async () => { await put('/api/plugins', { device, enabled: sel }); say('已保存，本终端的改写目标已更新'); p.reload(); }}>{t('保存')}</button>}>
      {toast}
      <ErrorBox error={p.error} />
      <ul className="plugins">
        {p.data?.plugins?.map((pl: any) => (
          <li key={pl.id}>
            <label className="row top">
              <input type="checkbox" checked={sel.includes(pl.id)} onChange={(e) => setSel(e.target.checked ? [...sel, pl.id] : sel.filter((x) => x !== pl.id))} />
              <span className="grow"><b>{pl.label}</b><div className="muted small">{pl.provides.map((x: string) => t(PROVIDES[x] ?? x)).join(' · ')} — {pl.description}</div></span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 任务与日志。focus=任务 id 时只看该任务及其日志（从“今天”的失败任务跳来）。 */
export function Tasks({ focus, onClear }: { focus?: number | null; onClear?: () => void }) {
  const { t } = useT();
  const tasks = useLoad(() => get('/api/tasks?limit=100'));
  const reloadTasks = tasks.reload;
  const [level, setLevel] = useState('');
  const logs = useLoad(() => get(`/api/logs?limit=200${level ? '&level=' + level : ''}`), [level]);
  useEffect(() => {
    const iv = setInterval(reloadTasks, 5000);
    return () => clearInterval(iv);
  }, [reloadTasks]);
  const rows: any[] = (tasks.data?.tasks ?? []).filter((x: any) => !focus || x.id === focus);
  const logRows: any[] = (logs.data?.logs ?? []).filter((l: any) => !focus || JSON.stringify(l).includes(`"taskId":${focus}`));
  return (
    <div className="grid">
      {focus ? <div className="alert info" role="status"><span>{t('只显示任务')} #{focus} {t('及其日志')}</span>{onClear && <button className="ghost" onClick={onClear}>{t('显示全部')}</button>}</div> : null}
      <Card title={t('任务')} actions={<button onClick={tasks.reload}>{t('刷新')}</button>}>
        {!focus && <p className="muted small">{Object.entries(tasks.data?.stats ?? {}).map(([k, v]) => `${STATUS_LABEL[k] ?? k} ${String(v)}`).join(' · ')}</p>}
        <ErrorBox error={tasks.error} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>任务</th><th>{t('状态')}</th><th>次数</th><th>耗时</th><th>原因</th></tr></thead>
          <tbody>{rows.map((x: any) => (
            <tr key={x.id}><td>{x.id}</td><td>{x.label}</td><td><StatusBadge status={x.status} /></td><td>{x.attempts}</td><td>{x.ms ?? '–'}ms</td><td className="small">{x.error}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card title={t('运行日志')} actions={<select aria-label="日志级别" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">全部</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>}>
        <pre className="pre small">{logRows.map((l: any) => JSON.stringify(l)).join('\n') || t('暂无日志')}</pre>
      </Card>
    </div>
  );
}
