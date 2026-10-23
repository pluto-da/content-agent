/**
 * 我的 → Agent 设定（8.11）：VFS 文件树 + 编辑（保存前看 diff 确认）+ 版本历史与回滚 + 恢复默认 + “本轮会加载什么”预览。
 * 我的 → 记忆：长期记忆条目（来源、条件、推断标记）查看 / 编辑 / 删除 / “忘掉”（删除后复查命中数）。
 * 我的 → 技能：技能目录（名称、描述、来源、版本、启用），用户技能优先；查看正文、启用 / 停用。
 * 写入一律以 author=user 经 Vfs（权限、密钥拦截、大小上限、乐观并发由 shared 强制）；BOUNDARIES.md 只读。
 */
import { useState } from 'react';
import {
  DEFAULT_FILES, diffLines, applyChanged, editableOf, assemblePrefix, loadSemiotics, skillMeta, skillsDirectory, routeSkill, parseDoc, patchFM, searchMemory, forget,
  type VfsFile, type VfsVersion, type MemoryEntry,
} from '@content-agent/shared';
import { useT } from '../../../i18n';
import { getVfs, vfsFiles } from '../../../v9/vfsBackend';
import { audit } from '../../../v9/ops';
import { db } from '../../../local/db';
import { GroupList, ListRow, Problem, useToast, EmptyState } from '../../../ui';
import { useAsync, BackBar, Section, Note, SegTabs, fmtTime } from './common';
import { DiffInline } from './diffInline';

const listAll = async (): Promise<VfsFile[]> => (await getVfs()).list();

/* ---------------- Agent 设定 ---------------- */
export function AgentSettingsPage({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<'files' | 'preview'>('files');
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const { data: files, error, reload } = useAsync(listAll, ['kv:vfs_files']);
  if (open) return <FileEditor path={open} onBack={() => { setOpen(null); reload(); }} />;
  const root = (files ?? []).filter((f) => !f.path.includes('/'));
  const dirs = [...new Set((files ?? []).filter((f) => f.path.includes('/')).map((f) => f.path.split('/')[0]!))].sort();
  const hit = q.trim() ? (files ?? []).filter((f) => f.path.toLowerCase().includes(q.toLowerCase())) : null;
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="agent-settings">
      <Note>{t('ui.these_are_the_agents_settings')}</Note>
      <SegTabs value={tab} onChange={setTab} label={t('ui.agent_settings')} options={[['files', '文件'], ['preview', '加载预览']]} />
      {error && <Problem title={t('ui.failed_to_read_settings_files')} advice={error} action={t('ui.retry')} onAction={reload} />}
      {tab === 'files' && <>
        <input placeholder={t('ui.search_files')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('ui.search_files')} />
        {hit ? (
          <GroupList title={`${t('ui.search_results')}（${hit.length}）`}>{hit.slice(0, 60).map((f) => <ListRow key={f.path} label={f.path} hint={`v${f.version} · ${fmtTime(f.updated)}`} onClick={() => setOpen(f.path)} />)}</GroupList>
        ) : <>
          <GroupList title={t('ui.root_system_files')}>{root.map((f) => <ListRow key={f.path} icon={editableOf(f.content, f.path) === 'system_only' ? 'lock' : 'agent'} label={f.path} hint={`v${f.version} · ${editableOf(f.content, f.path) === 'system_only' ? t('ui.read_only') : t('ui.editable')}`} onClick={() => setOpen(f.path)} testId={`file-${f.path}`} />)}</GroupList>
          {dirs.map((d) => <DirGroup key={d} dir={d} files={(files ?? []).filter((f) => f.path.startsWith(`${d}/`))} onOpen={setOpen} />)}
        </>}
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => go('me/memory')}>{t('ui.memory')}</button><button type="button" onClick={() => go('me/skills')}>{t('ui.skills')}</button><button type="button" onClick={() => go('me/growth')}>{t('ui.growth_log')}</button></div>
      </>}
      {tab === 'preview' && <LoadPreview />}
    </div>
  );
}
function DirGroup({ dir, files, onOpen }: { dir: string; files: VfsFile[]; onOpen: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <GroupList title={`${dir}/（${files.length}）`}>
      {!open ? <ListRow label={files.find((f) => f.path.split('/').length === 2 && /[A-Z]+\.md$/.test(f.path))?.path ?? `${dir}/`} hint={files.slice(0, 4).map((f) => f.path.slice(dir.length + 1)).join('、')} onClick={() => setOpen(true)} testId={`dir-${dir}`} />
        : files.map((f) => <ListRow key={f.path} label={f.path.slice(dir.length + 1)} hint={`v${f.version}`} onClick={() => onOpen(f.path)} />)}
    </GroupList>
  );
}

function FileEditor({ path, onBack }: { path: string; onBack: () => void }) {
  const { t } = useT();
  const { data: f, reload } = useAsync(async () => (await getVfs()).read(path) ?? null, ['kv:vfs_files'], [path]);
  const { data: hist } = useAsync(async () => (await getVfs()).history(path), ['kv:vfs_versions'], [path]);
  const [text, setText] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ next: string; why: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<VfsVersion | null>(null);
  const [toast, show] = useToast();
  if (f === null) return <div className="page page-narrow"><BackBar label={path} onBack={onBack} /><Problem title={t('ui.file_doesnt_exist_or_was')} /></div>;
  if (!f) return null;
  const ro = editableOf(f.content, path) === 'system_only';
  const body = text ?? f.content;
  const def = DEFAULT_FILES[path];
  const save = async (next: string, why: string) => {
    setErr(null);
    try {
      const v = await getVfs();
      const r = await v.write(path, next, { author: 'user', expectedVersion: f.version, note: why });
      const d = applyChanged(diffLines(f.content, next));
      await audit({ kind: 'system_file_change', actor: 'user', summary: `${why}：${path} v${f.version}→v${r.version}（+${d.added}/-${d.removed}）`, target: path, outcome: 'ok' });
      setText(null); setConfirm(null); setView(null); reload(); show(`${t('ui.saved')} v${r.version}${t('ui.applies_to_the_next_run')}`);
    } catch (e) { setErr((e as Error).message); setConfirm(null); }
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="file-editor">
      {toast}
      <BackBar label={path} onBack={onBack} />
      <Note>v{f.version} · {fmtTime(f.updated)} · {ro ? t('ui.read_only_enforced_in_code') : t('ui.editable')}</Note>
      {confirm ? (
        <Section title={t('ui.review_changes')} testId="confirm-diff">
          <DiffInline a={f.content} b={confirm.next} />
          <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void save(confirm.next, confirm.why)} data-testid="confirm-save">{t('ui.confirm_save')}</button><button type="button" onClick={() => setConfirm(null)}>{t('ui.revise')}</button></div>
        </Section>
      ) : view ? (
        <Section title={`${t('ui.version')} v${view.version} · ${fmtTime(view.updated)} · ${view.author}`}>
          <DiffInline a={view.content} b={f.content} />
          <div className="flex flex-wrap gap-2">{!ro && <button type="button" className="primary" onClick={() => setConfirm({ next: view.content, why: `回滚到 v${view.version}` })}>{t('ui.roll_back_to_this_version')}</button>}<button type="button" onClick={() => setView(null)}>{t('ui.close')}</button></div>
        </Section>
      ) : (
        <Section>
          <textarea className="v9-editor" rows={18} value={body} readOnly={ro} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label={path} data-testid="file-text" />
          {err && <Problem title={err} advice={t('ui.fix_it_then_save_keys')} />}
          {!ro && <div className="flex flex-wrap gap-2">
            <button type="button" className="primary" disabled={text === null || text === f.content} onClick={() => setConfirm({ next: body, why: '手动编辑' })} data-testid="file-save">{t('ui.save_review_diff')}</button>
            {def !== undefined && def !== f.content && <button type="button" onClick={() => setConfirm({ next: patchFM(def, {}), why: '恢复默认' })} data-testid="file-reset">{t('ui.restore_default')}</button>}
          </div>}
        </Section>
      )}
      <GroupList title={t('ui.version_history')}>
        {(hist ?? []).slice().reverse().slice(0, 30).map((v) => <ListRow key={v.version} label={`v${v.version} · ${v.author}${v.note ? ` · ${v.note}` : ''}`} hint={fmtTime(v.updated)} onClick={() => setView(v)} />)}
      </GroupList>
    </div>
  );
}

/** “本轮会加载什么”：按 SYSTEM.md 的表组装，显示每段的字符数、预算与截断；输入一句话可预览 semiotics 与技能是否按需加载。 */
function LoadPreview() {
  const { t } = useT();
  const [q, setQ] = useState('帮我想 3 个小红书选题');
  const { data: files } = useAsync(vfsFiles, ['kv:vfs_files']);
  if (!files) return null;
  const skills = Object.entries(files).filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map(([p, c]) => skillMeta(p, c)).filter((x): x is NonNullable<typeof x> => !!x);
  const pre = assemblePrefix({ ...files, 'skills/SKILLS.md': skillsDirectory(skills) });
  const sem = loadSemiotics(files, q);
  const sk = routeSkill(q, skills);
  return (
    <div className="flex flex-col gap-3" data-testid="load-preview">
      <label className="field !m-0"><span>{t('ui.try_a_sentence_to_see')}</span><input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <Section title={`${t('ui.stable_prefix')}：${pre.total} ${t('ui.characters')}`}>
        <ol className="m-0 flex flex-col gap-1 pl-5 text-[14px]">{pre.parts.map((p) => <li key={p.path}><span className="break-all">{p.path}</span> <span className="text-muted">{p.chars}/{p.budget}{p.truncated ? ` · ${t('ui.truncated')}` : ''}</span></li>)}</ol>
        {pre.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      </Section>
      <Section title={t('ui.load_on_demand')}>
        <Note tone={sem.loaded ? 'ok' : 'muted'}>{sem.loaded ? `semiotics：${sem.parts.map((p) => `${p.path}（${p.chars}）`).join(' → ')}` : t('ui.this_sentence_doesnt_need_the')}</Note>
        <Note>{sk ? `${t('ui.skills')}：${sk.name}${sk.source === 'user' ? `（${t('ui.custom_first')}）` : ''}` : t('ui.no_skill_matched_only_the')}</Note>
      </Section>
    </div>
  );
}

/* ---------------- 记忆 ---------------- */
export function MemoryPage() {
  const { t } = useT();
  const { data, reload } = useAsync(async () => (await db.all('memories')) as unknown as (MemoryEntry & { id: string })[], ['memories']);
  const { data: dont } = useAsync(async () => (await db.getKV<string[]>('memory.dontRemember')) ?? [], ['kv:memory.dontRemember']);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ row: number; text: string; condition: string } | null>(null);
  const [toast, show] = useToast();
  const rows = (data ?? []) as unknown as (MemoryEntry & { id: string; _rid?: number })[];
  const all = useAsync(async () => db.all('memories'), ['memories']).data ?? [];
  const rid = (m: MemoryEntry) => (all.find((r) => (r as unknown as MemoryEntry).id === m.id)?.id as number | undefined);
  const list = q.trim() ? searchMemory(rows, q) : rows;
  const doForget = async () => {
    if (!q.trim()) return;
    const hits = searchMemory(rows, q);
    if (!window.confirm(`${t('ui.will_delete')} ${hits.length} ${t('ui.items_and_add_a_dont')}`)) return;
    const f = forget(rows, q, hits.map((h) => h.id));
    for (const h of hits) { const id = rid(h); if (id !== undefined) await db.del('memories', id); }
    await db.setKV('memory.dontRemember', [...(dont ?? []), q.trim()]);
    const v = await getVfs(); const mem = (await v.text('MEMORY.md')) ?? '';
    await v.write('MEMORY.md', `${mem.replace(/\s*$/, '')}\n${f.rule}\n`, { author: 'user', note: 'forget' }).catch(() => {});
    await audit({ kind: 'memory_change', actor: 'user', summary: `忘掉：${q}（删除 ${f.removed.length} 条，复查命中 ${f.verifyHits}）`, outcome: 'ok' });
    show(`${t('ui.deleted')} ${f.removed.length} ${t('ui.items_re_check_hits')} ${f.verifyHits}`); reload();
  };
  const saveEdit = async () => { if (!edit) return; await db.update('memories', edit.row, { text: edit.text, condition: edit.condition || undefined, source: 'user_edited', updatedAt: new Date().toISOString() }); await audit({ kind: 'memory_change', actor: 'user', summary: `编辑记忆：${edit.text}`, outcome: 'ok' }); setEdit(null); reload(); };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="memory-page">
      {toast}
      <Note>{t('ui.the_agent_only_remembers_after')}</Note>
      <div className="flex flex-wrap gap-2"><input className="grow" placeholder={t('ui.search_or_type_what_to')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('ui.search_memory')} /><button type="button" className="danger" disabled={!q.trim()} onClick={() => void doForget()} data-testid="forget">{t('ui.forget_these')}</button></div>
      {!list.length ? <div className="card !p-0"><EmptyState icon="inbox" title={t('ui.no_long_term_memory_yet')} why={t('ui.say_remember_in_chat_it')} /></div> : (
        <ul className="item-list">
          {list.map((m) => { const id = rid(m); return (
            <li key={m.id} className="flex-col !items-stretch">
              {edit && edit.row === id ? (
                <div className="flex flex-col gap-2"><textarea rows={2} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /><input placeholder={t('ui.condition_optional')} value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })} /><div className="flex gap-2"><button type="button" className="primary" onClick={() => void saveEdit()}>{t('ui.save')}</button><button type="button" onClick={() => setEdit(null)}>{t('ui.cancel')}</button></div></div>
              ) : <>
                <span className="item-title !text-[15px]">{m.text}</span>
                <span className="item-meta">{m.condition ? `${t('ui.condition')}：${m.condition} · ` : ''}{m.source === 'inferred' || m.confidence === 'inferred' ? t('ui.inferred') : m.source === 'user_edited' ? t('ui.edited_by_you') : t('ui.you_said')} · {String(m.createdAt ?? '').slice(0, 10)}</span>
                <span className="flex gap-2">{id !== undefined && <><button type="button" className="ghost" onClick={() => setEdit({ row: id, text: m.text, condition: m.condition ?? '' })}>{t('ui.edit')}</button><button type="button" className="ghost danger" onClick={async () => { await db.del('memories', id); await audit({ kind: 'memory_change', actor: 'user', summary: `删除记忆：${m.text}`, outcome: 'ok' }); reload(); }}>{t('ui.delete')}</button></>}</span>
              </>}
            </li>
          ); })}
        </ul>
      )}
      {!!dont?.length && <GroupList title={t('ui.dont_remember_rule')}>{dont.map((d) => <li key={d}><div className="list-row static"><span className="row-text"><span className="row-label">{d}</span></span></div></li>)}</GroupList>}
    </div>
  );
}

/* ---------------- 技能 ---------------- */
export function SkillsPage({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { data: files, reload } = useAsync(vfsFiles, ['kv:vfs_files']);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, show] = useToast();
  if (!files) return null;
  if (open) return <FileEditor path={open} onBack={() => { setOpen(null); reload(); }} />;
  const skills = Object.entries(files).filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map(([p, c]) => skillMeta(p, c)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'user' ? -1 : 1));
  const toggle = async (path: string, on: boolean) => {
    const v = await getVfs(); const cur = await v.read(path); if (!cur) return;
    try { await v.write(path, patchFM(cur.content, { enabled: on }), { author: 'user', expectedVersion: cur.version, note: on ? '启用' : '停用' }); await audit({ kind: 'system_file_change', actor: 'user', summary: `${on ? '启用' : '停用'}技能 ${path}`, target: path, outcome: 'ok' }); show(on ? t('ui.enabled') : t('ui.disabled')); reload(); }
    catch (e) { show((e as Error).message); }
  };
  const docOf = (p: string) => parseDoc(files[p] ?? '').fm;
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="skills-page">
      {toast}
      <Note>{t('ui.each_turn_carries_only_the')}</Note>
      <GroupList title={`${t('ui.skills')}（${skills.length}）`}>
        {skills.map((s) => (
          <li key={s.path}>
            <div className="list-row static flex-wrap">
              <span className="row-text"><span className="row-label">{s.name}{s.source === 'user' ? ` · ${t('ui.custom')}` : ''}{s.version ? ` · v${s.version}` : ''}{docOf(s.path).status ? ` · ${String(docOf(s.path).status)}` : ''}</span><span className="row-hint">{s.description}</span></span>
              <button type="button" className="ghost" onClick={() => setOpen(s.path)}>{t('ui.view')}</button>
              <label className="flex min-h-11 items-center gap-1 px-1 text-[13px]"><input type="checkbox" checked={s.enabled} onChange={() => void toggle(s.path, !s.enabled)} aria-label={`${t('ui.enable')} ${s.name}`} />{t('ui.enable')}</label>
            </div>
          </li>
        ))}
      </GroupList>
      <button type="button" className="self-start" onClick={() => go('me/growth')}>{t('ui.skill_versions_and_proposals_are')} ›</button>
    </div>
  );
}
