import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStoreChange } from '../local/useStore';
import { ApiError, del, get, put } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import { WRITE_FILTERS } from '../route';
import { writePlatform, WRITE_PLATFORMS, WRITE_TARGETS } from '../data/platforms';
import { adaptDraft } from '../local/generate';
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
        <div className="seg" role="group" aria-label={t('ui.filter_by_status_2')}>
          {WRITE_FILTERS.map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => go(f === 'all' ? 'write' : `write/${f}`)}>{t(FILTER_LABEL[f]!)} <span className="tabular-nums text-muted">{count(f)}</span></button>)}
        </div>
        <span className="grow" />
        <button type="button" className="primary" onClick={() => go('write/new')} data-testid="new-draft"><Icon name="plus" size={16} />{t('ui.write_new')}</button>
      </div>
      <ErrorNext error={err} action={t('ui.reload_2')} onAction={load} />
      {drafts && !shown.length && (
        <div className="card !p-0">
          {filter === 'all' ? <EmptyState icon="create" title={t('ui.nothing_yet')} why={t('ui.type_an_idea_and_the')} action={t('ui.write_new')} onAction={() => go('write/new')} />
            : filter === 'pending' ? <EmptyState icon="review" title={t('ui.nothing_waiting_for_review')} why={t('ui.new_drafts_wait_here_for')} action={t('ui.write_new')} onAction={() => go('write/new')} />
              : filter === 'approved' ? <EmptyState icon="send" title={t('ui.nothing_waiting_to_publish')} why={t('ui.approved_drafts_appear_here')} action={t('ui.go_review')} onAction={() => go('write/pending')} />
                : <EmptyState icon="check" title={t('ui.nothing_published_yet')} why={t('ui.appears_here_after_you_copy')} action={t('ui.go_publish')} onAction={() => go('publish')} />}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="item-list" data-testid="draft-list">
          {shown.map((d) => (
            <li key={d.id} aria-current={String(d.id) === id ? 'true' : undefined} className={String(d.id) === id ? 'bg-surface-2' : ''}>
              <button type="button" className="linklike !min-h-11 !p-0" onClick={() => go(`write/${d.id}`)}>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="item-title ellipsis">{d.title || d.body.slice(0, 30) || t('ui.untitled')}</span>
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
      <div className="min-w-0">{editor ?? <div className="card !p-0"><EmptyState icon="edit" title={t('ui.pick_a_draft_to_edit')} why={t('ui.pick_a_draft_on_the_2')} action={t('ui.write_new')} onAction={() => go('write/new')} /></div>}</div>
    </div>
  );
}

function NewDraft({ go, onDone }: { go: (to: string) => void; onDone: () => void }) {
  const { t } = useT();
  return (
    <section className="card flex flex-col gap-3" aria-label={t('ui.write_new')}>
      <h2>{t('ui.write_new')}</h2>
      <Composer go={go} autoFocus onDone={(d) => { onDone(); go(`write/${d.id}`); }} />
    </section>
  );
}

function Editor({ id, go, onChanged }: { id: number; go: (to: string) => void; onChanged: () => void }) {
  const { t } = useT();
  const [d, setD] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [platform, setPlatform] = useState('free');
  const [targets, setTargets] = useState<string[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [pick, setPick] = useState<Pick>({ providerId: null, model: null });
  const [toast, show] = useToast();
  const apply = (x: Draft) => { setD(x); setTitle(x.title ?? ''); setBody(x.body ?? ''); setPlatform(x.platform); };
  useEffect(() => { get<{ draft: Draft }>(`/api/drafts/${id}`).then((r) => apply(r.draft)).catch((e) => setErr(e instanceof ApiError ? e : new ApiError('error', String(e)))); }, [id]);
  if (err && !d) return <Problem title={err.message} advice={err.advice} action={t('ui.back_to_list')} onAction={() => go('write')} />;
  if (!d) return <Busy label={t('ui.opening')} />;
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
    <section className="card flex flex-col gap-4" aria-label={t('ui.edit_draft')}>
      {toast}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ghost !px-1" onClick={() => go('write')} aria-label={t('ui.back_to_list_2')}><Icon name="arrowLeft" size={18} /></button>
        <StatusDot tone={tone(d.status)}>{t(STATUS_LABEL[d.status] ?? d.status)}</StatusDot>
        <span className="grow" />
        <select aria-label={t('ui.platforms')} className="!w-auto" value={platform} onChange={(e) => setPlatform(e.target.value)}>{WRITE_TARGETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </div>
      <label className="field !m-0"><span>{t('ui.title')}</span><input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="edit-title" /></label>
      <label className="field !m-0"><span>{t('ui.body')} <span className="font-normal text-muted">· {[...body].length} {t('ui.chars')}</span></span><textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} data-testid="edit-body" /></label>
      {warns.length > 0 && <p className="m-0 text-[14px] text-warn" role="status">{warns.join('；')}</p>}
      {hits.length > 0 && <p className="m-0 text-[14px] text-fg-2"><Icon name="alert" size={14} className="mr-1 inline" />{t('ui.possibly_prohibited_words')}：{hits.map((h) => `「${h.match}」${h.rule}`).join('、')}</p>}
      {d.model && <p className="m-0 text-[13px] text-muted">{t('ui.by')} {d.model} {t('ui.generate')}</p>}

      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) void act(t('ui.rewriting'), async () => { if (dirty) await save(); apply(await revise({ ...d, title, body }, ask, pick)); setAsk(''); }, t('ui.rewritten_as_requested')); }}>
        <span className="text-[14px] font-medium text-fg">{t('ui.edit_in_one_sentence')}</span>
        <div className="flex flex-wrap gap-2">
          <input className="!min-w-0 flex-1" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t('ui.e_g_make_it_more')} aria-label={t('ui.edit_in_one_sentence')} />
          <button type="submit" disabled={!ask.trim() || !!busy}>{t('ui.change_it_like_this')}</button>
        </div>
        <ModelPicker value={pick} onChange={setPick} go={go} />
      </form>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="adapt">
        <legend className="mb-1 text-[14px] font-medium text-fg">{t('ui.adapt_to_platforms')}</legend>
        <span className="text-[13px] text-muted">{t('ui.this_draft_stays_as_the')}</span>
        <div className="flex flex-wrap gap-1">{WRITE_PLATFORMS.map((p) => <label key={p.id} className={`v9-chip ${targets.includes(p.id) ? 'on' : ''}`}><input type="checkbox" checked={targets.includes(p.id)} onChange={() => setTargets((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} data-testid={`adapt-${p.id}`} />{p.short}</label>)}</div>
        <button type="button" className="self-start" disabled={!targets.length || !!busy} data-testid="adapt-run" onClick={() => void act(t('ui.adapting'), async () => { if (dirty) await save(); await adaptDraft(id, targets, pick); setTargets([]); }, t('ui.adapted_the_original_is_kept'))}>{t('ui.adapt')}（{targets.length}）</button>
      </fieldset>

      {err && <Problem title={err.message} advice={err.advice} action={err.code.startsWith('model_') ? t('ui.check_models') : undefined} onAction={() => go('me/models')} />}
      {busy && <Busy label={busy} />}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {d.status === 'pending' && <button type="button" className="primary" disabled={!!busy} data-testid="approve" onClick={() => void act(t('ui.working'), async () => { if (dirty) await save(); await setStatus(id, 'approved'); await reload(); }, t('ui.approved_publish_it_from_go'))}>{t('ui.approve')}</button>}
        {d.status === 'approved' && <button type="button" className="primary" onClick={() => go('publish')}>{t('ui.go_publish')}</button>}
        {d.status === 'rejected' && <button type="button" className="primary" onClick={() => void act(t('ui.working'), async () => { await setStatus(id, 'pending'); await reload(); }, t('ui.moved_back_to_pending_review'))}>{t('ui.move_back_to_pending')}</button>}
        <button type="button" disabled={!dirty || !!busy} onClick={() => void act(t('ui.saving'), async () => { await save(); await reload(); }, t('ui.saved'))}>{t('ui.save_changes')}</button>
        {d.status === 'approved' && <button type="button" className="ghost" onClick={() => void act(t('ui.working'), async () => { await setStatus(id, 'pending'); await reload(); }, t('ui.moved_back_to_pending_review'))}>{t('ui.move_back_to_pending')}</button>}
        {d.status === 'pending' && <button type="button" className="ghost" onClick={() => void act(t('ui.working'), async () => { await setStatus(id, 'rejected'); await reload(); }, t('ui.returned'))}>{t('ui.discard_this_draft')}</button>}
        <span className="grow" />
        <button type="button" className="ghost danger" onClick={() => { if (confirm(t('ui.delete_this_draft_this_cant'))) void del(`/api/drafts/${id}`).then(() => { onChanged(); go('write'); }).catch((e) => setErr(e)); }}>{t('ui.delete')}</button>
      </div>
    </section>
  );
}
