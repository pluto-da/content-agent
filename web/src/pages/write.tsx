import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStoreChange } from '../local/useStore';
import { ApiError, del, get, put } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import { WRITE_FILTERS } from '../route';
import { writePlatform, WRITE_PLATFORMS } from '../data/platforms';
import { limitWarnings } from '../local/generate';
import { listDrafts, revise, setStatus, STATUS_LABEL, type Draft } from '../services';
import { ago } from '../format';
import { Busy, EmptyState, ErrorNext, Problem, StatusDot, useToast } from '../ui';
import { Composer } from '../components/Composer';
import { ModelPicker, type Pick } from '../components/ModelPicker';

const FILTER_LABEL: Record<string, string> = { all: '全部', pending: '待审核', approved: '待发布', handed_off: '已发布' };
const tone = (s: string) => (s === 'pending' ? 'neutral' : s === 'approved' ? 'info' : s === 'rejected' ? 'bad' : 'ok') as 'neutral' | 'info' | 'ok' | 'bad';

/** 写内容：草稿列表（全部 / 待审核 / 待发布 / 已发布）+ 编辑器（选平台、选模型、生成、修改、标记通过）。 */
export function Write({ filter, id, go, lay }: { filter: string; id: string | null; go: (to: string) => void; lay: Layout }) {
  const { t, lang } = useT();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = useCallback(() => { listDrafts().then((d) => { setDrafts(d); setErr(null); }).catch((e) => setErr(e instanceof ApiError ? e : new ApiError('error', String(e)))); }, []);
  useEffect(load, [load]);
  // 0.8.1：Agent 写的草稿、别处审核的状态立即出现在列表里
  useStoreChange(['drafts'], load);
  const shown = useMemo(() => (drafts ?? []).filter((d) => filter === 'all' || d.status === filter), [drafts, filter]);
  const count = (f: string) => (drafts ?? []).filter((d) => f === 'all' || d.status === f).length;
  const phone = lay === 'phone';

  const list = (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label={t('按状态筛选')}>
          {WRITE_FILTERS.map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => go(f === 'all' ? 'write' : `write/${f}`)}>{t(FILTER_LABEL[f]!)} <span className="tabular-nums text-muted">{count(f)}</span></button>)}
        </div>
        <span className="grow" />
        <button type="button" className="primary" onClick={() => go('write/new')} data-testid="new-draft"><Icon name="plus" size={16} />{t('新写一篇')}</button>
      </div>
      <ErrorNext error={err} action={t('重新加载')} onAction={load} />
      {drafts && !shown.length && (
        <div className="card !p-0">
          {filter === 'all' ? <EmptyState icon="create" title={t('还没有内容')} why={t('输入一个想法，助手帮你写第一篇。')} action={t('新写一篇')} onAction={() => go('write/new')} />
            : filter === 'pending' ? <EmptyState icon="review" title={t('没有待审核的内容')} why={t('新生成的草稿会先放在这里等你看。')} action={t('新写一篇')} onAction={() => go('write/new')} />
              : filter === 'approved' ? <EmptyState icon="send" title={t('没有待发布的内容')} why={t('审核通过的草稿会出现在这里。')} action={t('去审核')} onAction={() => go('write/pending')} />
                : <EmptyState icon="check" title={t('还没有已发布的内容')} why={t('在“去发布”里复制并打开 App、你本人发布后，会出现在这里。')} action={t('去发布')} onAction={() => go('publish')} />}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="item-list" data-testid="draft-list">
          {shown.map((d) => (
            <li key={d.id} aria-current={String(d.id) === id ? 'true' : undefined} className={String(d.id) === id ? 'bg-surface-2' : ''}>
              <button type="button" className="linklike !min-h-11 !p-0" onClick={() => go(`write/${d.id}`)}>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="item-title ellipsis">{d.title || d.body.slice(0, 30) || t('（无标题）')}</span>
                  <span className="item-meta">{writePlatform(d.platform).short} · <StatusDot tone={tone(d.status)}>{t(STATUS_LABEL[d.status] ?? d.status)}</StatusDot> · {ago(d.updated_at ?? d.created_at, lang)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const editor = id === 'new'
    ? <NewDraft go={go} onDone={load} />
    : id ? <Editor key={id} id={Number(id)} go={go} onChanged={load} /> : null;

  if (phone) return <div className="page">{editor ?? list}</div>;
  return (
    <div className="page grid gap-6" style={{ gridTemplateColumns: 'minmax(280px, 380px) minmax(0, 1fr)' }}>
      {list}
      <div className="min-w-0">{editor ?? <div className="card !p-0"><EmptyState icon="edit" title={t('选一篇开始修改')} why={t('左边点一篇草稿，或新写一篇。')} action={t('新写一篇')} onAction={() => go('write/new')} /></div>}</div>
    </div>
  );
}

function NewDraft({ go, onDone }: { go: (to: string) => void; onDone: () => void }) {
  const { t } = useT();
  return (
    <section className="card flex flex-col gap-3" aria-label={t('新写一篇')}>
      <h2>{t('新写一篇')}</h2>
      <Composer go={go} autoFocus onDone={(d) => { onDone(); go(`write/${d.id}`); }} />
    </section>
  );
}

function Editor({ id, go, onChanged }: { id: number; go: (to: string) => void; onChanged: () => void }) {
  const { t } = useT();
  const [d, setD] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [platform, setPlatform] = useState('xiaohongshu');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [pick, setPick] = useState<Pick>({ providerId: null, model: null });
  const [toast, show] = useToast();
  const apply = (x: Draft) => { setD(x); setTitle(x.title ?? ''); setBody(x.body ?? ''); setPlatform(x.platform); };
  useEffect(() => { get<{ draft: Draft }>(`/api/drafts/${id}`).then((r) => apply(r.draft)).catch((e) => setErr(e instanceof ApiError ? e : new ApiError('error', String(e)))); }, [id]);
  if (err && !d) return <Problem title={err.message} advice={err.advice} action={t('回到列表')} onAction={() => go('write')} />;
  if (!d) return <Busy label={t('正在打开…')} />;
  const dirty = title !== (d.title ?? '') || body !== d.body || platform !== d.platform;
  const warns = limitWarnings(platform, title, body);
  const hits = (d.compliance ?? []).filter((c) => c.level === 'warn');

  const act = async (label: string, fn: () => Promise<void>, done: string) => {
    setBusy(label); setErr(null);
    try { await fn(); show(done); onChanged(); } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e))); } finally { setBusy(null); }
  };
  const save = () => put(`/api/drafts/${id}`, { title, body, platform });
  const reload = async () => apply((await get<{ draft: Draft }>(`/api/drafts/${id}`)).draft);

  return (
    <section className="card flex flex-col gap-4" aria-label={t('编辑草稿')}>
      {toast}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ghost !px-1" onClick={() => go('write')} aria-label={t('返回列表')}><Icon name="arrowLeft" size={18} /></button>
        <StatusDot tone={tone(d.status)}>{t(STATUS_LABEL[d.status] ?? d.status)}</StatusDot>
        <span className="grow" />
        <select aria-label={t('平台')} className="!w-auto" value={platform} onChange={(e) => setPlatform(e.target.value)}>{WRITE_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </div>
      <label className="field !m-0"><span>{t('标题')}</span><input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="edit-title" /></label>
      <label className="field !m-0"><span>{t('正文')} <span className="font-normal text-muted">· {[...body].length} {t('字')}</span></span><textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} data-testid="edit-body" /></label>
      {warns.length > 0 && <p className="m-0 text-[14px] text-warn" role="status">{warns.join('；')}</p>}
      {hits.length > 0 && <p className="m-0 text-[14px] text-fg-2"><Icon name="alert" size={14} className="mr-1 inline" />{t('可能违规的词')}：{hits.map((h) => `「${h.match}」${h.rule}`).join('、')}</p>}
      {d.model && <p className="m-0 text-[13px] text-muted">{t('由')} {d.model} {t('生成')}</p>}

      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) void act(t('正在改写…'), async () => { if (dirty) await save(); apply(await revise({ ...d, title, body }, ask, pick)); setAsk(''); }, t('已按要求改写')); }}>
        <span className="text-[14px] font-medium text-fg">{t('一句话修改')}</span>
        <div className="flex flex-wrap gap-2">
          <input className="!min-w-0 flex-1" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t('例如：改得更口语一点，开头加一个问题')} aria-label={t('一句话修改')} />
          <button type="submit" disabled={!ask.trim() || !!busy}>{t('按这个改')}</button>
        </div>
        <ModelPicker value={pick} onChange={setPick} go={go} />
      </form>

      {err && <Problem title={err.message} advice={err.advice} action={err.code.startsWith('model_') ? t('去检查模型') : undefined} onAction={() => go('me/models')} />}
      {busy && <Busy label={busy} />}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {d.status === 'pending' && <button type="button" className="primary" disabled={!!busy} data-testid="approve" onClick={() => void act(t('处理中…'), async () => { if (dirty) await save(); await setStatus(id, 'approved'); await reload(); }, t('已通过，去“去发布”里发出去'))}>{t('通过')}</button>}
        {d.status === 'approved' && <button type="button" className="primary" onClick={() => go('publish')}>{t('去发布')}</button>}
        {d.status === 'rejected' && <button type="button" className="primary" onClick={() => void act(t('处理中…'), async () => { await setStatus(id, 'pending'); await reload(); }, t('已改回待审核'))}>{t('改回待审核')}</button>}
        <button type="button" disabled={!dirty || !!busy} onClick={() => void act(t('保存中…'), async () => { await save(); await reload(); }, t('已保存'))}>{t('保存修改')}</button>
        {d.status === 'approved' && <button type="button" className="ghost" onClick={() => void act(t('处理中…'), async () => { await setStatus(id, 'pending'); await reload(); }, t('已改回待审核'))}>{t('改回待审核')}</button>}
        {d.status === 'pending' && <button type="button" className="ghost" onClick={() => void act(t('处理中…'), async () => { await setStatus(id, 'rejected'); await reload(); }, t('已退回'))}>{t('不要这篇')}</button>}
        <span className="grow" />
        <button type="button" className="ghost danger" onClick={() => { if (confirm(t('删除这篇草稿？删除后无法恢复。'))) void del(`/api/drafts/${id}`).then(() => { onChanged(); go('write'); }).catch((e) => setErr(e)); }}>{t('删除')}</button>
      </div>
    </section>
  );
}
