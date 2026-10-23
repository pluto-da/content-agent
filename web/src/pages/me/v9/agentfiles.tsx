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
      <Note>{t('这些是 Agent 的设定文件：每次对话按 SYSTEM.md 里的顺序加载。改完保存后，下一次运行立即生效；每次保存都留版本，可随时回滚。')}</Note>
      <SegTabs value={tab} onChange={setTab} label={t('Agent 设定')} options={[['files', '文件'], ['preview', '加载预览']]} />
      {error && <Problem title={t('读取设定文件失败')} advice={error} action={t('重试')} onAction={reload} />}
      {tab === 'files' && <>
        <input placeholder={t('搜索文件')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('搜索文件')} />
        {hit ? (
          <GroupList title={`${t('搜索结果')}（${hit.length}）`}>{hit.slice(0, 60).map((f) => <ListRow key={f.path} label={f.path} hint={`v${f.version} · ${fmtTime(f.updated)}`} onClick={() => setOpen(f.path)} />)}</GroupList>
        ) : <>
          <GroupList title={t('根目录（系统文件）')}>{root.map((f) => <ListRow key={f.path} icon={editableOf(f.content, f.path) === 'system_only' ? 'lock' : 'agent'} label={f.path} hint={`v${f.version} · ${editableOf(f.content, f.path) === 'system_only' ? t('只读') : t('可编辑')}`} onClick={() => setOpen(f.path)} testId={`file-${f.path}`} />)}</GroupList>
          {dirs.map((d) => <DirGroup key={d} dir={d} files={(files ?? []).filter((f) => f.path.startsWith(`${d}/`))} onOpen={setOpen} />)}
        </>}
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => go('me/memory')}>{t('记忆')}</button><button type="button" onClick={() => go('me/skills')}>{t('技能')}</button><button type="button" onClick={() => go('me/growth')}>{t('成长记录')}</button></div>
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
  if (f === null) return <div className="page page-narrow"><BackBar label={path} onBack={onBack} /><Problem title={t('文件不存在或已删除')} /></div>;
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
      setText(null); setConfirm(null); reload(); show(`${t('已保存')} v${r.version}${t('，下一次运行生效')}`);
    } catch (e) { setErr((e as Error).message); setConfirm(null); }
  };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="file-editor">
      {toast}
      <BackBar label={path} onBack={onBack} />
      <Note>v{f.version} · {fmtTime(f.updated)} · {ro ? t('只读：由代码强制，任何文件和对话都不能放宽') : t('可编辑')}</Note>
      {confirm ? (
        <Section title={t('确认改动')} testId="confirm-diff">
          <DiffInline a={f.content} b={confirm.next} />
          <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void save(confirm.next, confirm.why)} data-testid="confirm-save">{t('确认保存')}</button><button type="button" onClick={() => setConfirm(null)}>{t('再改改')}</button></div>
        </Section>
      ) : view ? (
        <Section title={`${t('版本')} v${view.version} · ${fmtTime(view.updated)} · ${view.author}`}>
          <DiffInline a={view.content} b={f.content} />
          <div className="flex flex-wrap gap-2">{!ro && <button type="button" className="primary" onClick={() => setConfirm({ next: view.content, why: `回滚到 v${view.version}` })}>{t('回滚到这个版本')}</button>}<button type="button" onClick={() => setView(null)}>{t('关闭')}</button></div>
        </Section>
      ) : (
        <Section>
          <textarea className="v9-editor" rows={18} value={body} readOnly={ro} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label={path} data-testid="file-text" />
          {err && <Problem title={err} advice={t('改好后再保存；密钥只能存“账号与 Key”')} />}
          {!ro && <div className="flex flex-wrap gap-2">
            <button type="button" className="primary" disabled={text === null || text === f.content} onClick={() => setConfirm({ next: body, why: '手动编辑' })} data-testid="file-save">{t('保存（先看改动）')}</button>
            {def !== undefined && def !== f.content && <button type="button" onClick={() => setConfirm({ next: patchFM(def, {}), why: '恢复默认' })} data-testid="file-reset">{t('恢复默认')}</button>}
          </div>}
        </Section>
      )}
      <GroupList title={t('版本历史')}>
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
      <label className="field !m-0"><span>{t('试一句话，看会额外加载什么')}</span><input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <Section title={`${t('稳定前缀')}：${pre.total} ${t('字符')}`}>
        <ol className="m-0 flex flex-col gap-1 pl-5 text-[14px]">{pre.parts.map((p) => <li key={p.path}><span className="break-all">{p.path}</span> <span className="text-muted">{p.chars}/{p.budget}{p.truncated ? ` · ${t('已截断')}` : ''}</span></li>)}</ol>
        {pre.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      </Section>
      <Section title={t('按需加载')}>
        <Note tone={sem.loaded ? 'ok' : 'muted'}>{sem.loaded ? `semiotics：${sem.parts.map((p) => `${p.path}（${p.chars}）`).join(' → ')}` : t('这句话不需要符号—结构底座（简单任务不加载）')}</Note>
        <Note>{sk ? `${t('技能')}：${sk.name}${sk.source === 'user' ? `（${t('自定义优先')}）` : ''}` : t('没有命中技能，只带技能目录')}</Note>
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
    if (!window.confirm(`${t('将删除')} ${hits.length} ${t('条，并写入“不要记住”规则。确定？')}`)) return;
    const f = forget(rows, q, hits.map((h) => h.id));
    for (const h of hits) { const id = rid(h); if (id !== undefined) await db.del('memories', id); }
    await db.setKV('memory.dontRemember', [...(dont ?? []), q.trim()]);
    const v = await getVfs(); const mem = (await v.text('MEMORY.md')) ?? '';
    await v.write('MEMORY.md', `${mem.replace(/\s*$/, '')}\n${f.rule}\n`, { author: 'user', note: 'forget' }).catch(() => {});
    await audit({ kind: 'memory_change', actor: 'user', summary: `忘掉：${q}（删除 ${f.removed.length} 条，复查命中 ${f.verifyHits}）`, outcome: 'ok' });
    show(`${t('已删除')} ${f.removed.length} ${t('条，复查命中')} ${f.verifyHits}`); reload();
  };
  const saveEdit = async () => { if (!edit) return; await db.update('memories', edit.row, { text: edit.text, condition: edit.condition || undefined, source: 'user_edited', updatedAt: new Date().toISOString() }); await audit({ kind: 'memory_change', actor: 'user', summary: `编辑记忆：${edit.text.slice(0, 40)}`, outcome: 'ok' }); setEdit(null); reload(); };
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="memory-page">
      {toast}
      <Note>{t('Agent 只在你确认后才记住；推断出来的会标“推断”。可以随时编辑或删除。')}</Note>
      <div className="flex flex-wrap gap-2"><input className="grow" placeholder={t('搜索或输入要忘掉的内容')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('搜索记忆')} /><button type="button" className="danger" disabled={!q.trim()} onClick={() => void doForget()} data-testid="forget">{t('忘掉这些')}</button></div>
      {!list.length ? <div className="card !p-0"><EmptyState icon="inbox" title={t('还没有长期记忆')} why={t('在对话里说“记住……”，确认后会出现在这里。')} /></div> : (
        <ul className="item-list">
          {list.map((m) => { const id = rid(m); return (
            <li key={m.id} className="flex-col !items-stretch">
              {edit && edit.row === id ? (
                <div className="flex flex-col gap-2"><textarea rows={2} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /><input placeholder={t('条件（可不填）')} value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })} /><div className="flex gap-2"><button type="button" className="primary" onClick={() => void saveEdit()}>{t('保存')}</button><button type="button" onClick={() => setEdit(null)}>{t('取消')}</button></div></div>
              ) : <>
                <span className="item-title !text-[15px]">{m.text}</span>
                <span className="item-meta">{m.condition ? `${t('条件')}：${m.condition} · ` : ''}{m.source === 'inferred' || m.confidence === 'inferred' ? t('推断') : m.source === 'user_edited' ? t('你改过') : t('你说的')} · {String(m.createdAt ?? '').slice(0, 10)}</span>
                <span className="flex gap-2">{id !== undefined && <><button type="button" className="ghost" onClick={() => setEdit({ row: id, text: m.text, condition: m.condition ?? '' })}>{t('编辑')}</button><button type="button" className="ghost danger" onClick={async () => { await db.del('memories', id); await audit({ kind: 'memory_change', actor: 'user', summary: `删除记忆：${m.text.slice(0, 40)}`, outcome: 'ok' }); reload(); }}>{t('删除')}</button></>}</span>
              </>}
            </li>
          ); })}
        </ul>
      )}
      {!!dont?.length && <GroupList title={t('不要记住（规则）')}>{dont.map((d) => <li key={d}><div className="list-row static"><span className="row-text"><span className="row-label">{d}</span></span></div></li>)}</GroupList>}
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
    try { await v.write(path, patchFM(cur.content, { enabled: on }), { author: 'user', expectedVersion: cur.version, note: on ? '启用' : '停用' }); await audit({ kind: 'system_file_change', actor: 'user', summary: `${on ? '启用' : '停用'}技能 ${path}`, target: path, outcome: 'ok' }); show(on ? t('已启用') : t('已停用')); reload(); }
    catch (e) { show((e as Error).message); }
  };
  const docOf = (p: string) => parseDoc(files[p] ?? '').fm;
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="skills-page">
      {toast}
      <Note>{t('每轮只带技能目录（名称 + 描述），命中后才载入正文；你写的技能优先。Agent 只能提修订建议，你看过改动对比确认后才生效。')}</Note>
      <GroupList title={`${t('技能')}（${skills.length}）`}>
        {skills.map((s) => (
          <li key={s.path}>
            <div className="list-row static flex-wrap">
              <span className="row-text"><span className="row-label">{s.name}{s.source === 'user' ? ` · ${t('自定义')}` : ''}{s.version ? ` · v${s.version}` : ''}{docOf(s.path).status ? ` · ${String(docOf(s.path).status)}` : ''}</span><span className="row-hint">{s.description}</span></span>
              <button type="button" className="ghost" onClick={() => setOpen(s.path)}>{t('查看')}</button>
              <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={s.enabled} onChange={() => void toggle(s.path, !s.enabled)} aria-label={`${t('启用')} ${s.name}`} />{t('启用')}</label>
            </div>
          </li>
        ))}
      </GroupList>
      <button type="button" className="self-start" onClick={() => go('me/growth')}>{t('技能版本与修订建议在“成长记录”')} ›</button>
    </div>
  );
}
