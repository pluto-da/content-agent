/**
 * 我的 → 模型（0.9.0，9.1）：11 个能力角色按 5 组显示；角色二级页（设置 | 试一试 | 用量）；账号与 Key；账号详情（模型名手填、获取列表、按能力测试）。
 * 规则：模型名原样保存、原样发送；Key 只进安全存储（只显示末 4 位）；同一服务商一个 Key 默认各能力通用，可按角色覆盖地址与 Key。
 */
import { useMemo, useState } from 'react';
import {
  ROLE_GROUPS, ROLE_IDS, ADAPTERS, adapterOf, roleDef, roleLabel, isRoleId, configuredRoles, candidatesFor, displayModel, findEntry, bindRole, addModelEntry, referencesOf,
  removeModelEntry, markAgainstList, MODEL_NAME_MESSAGES, PROBES, VERIFIED_LABEL, mergeDecl,
  type RoleId, type ModelsStateV3, type ModelEntry, type ProviderAccount, type ProbeResult, type CallResult,
} from '@content-agent/shared';
import { useT } from '../../../i18n';
import type { Layout } from '../../../nav';
import { saveModelsV3, getModelsV3 } from '../../../local/store';
import { setSecret, deleteSecret, secretTails, secretStorageInfo, secretStorageInfoAsync, undecryptableSecrets } from '../../../local/secrets';
import { call, probe, fetchList, saveMedia } from '../../../v9/models';
import { modelStats } from '../../../v9/ops';
import { addInbox } from '../../../agent/store';
import { db } from '../../../local/db';
import { GroupList, ListRow, Problem, StatusDot, Busy, useToast } from '../../../ui';
import { ModelsPage } from '../models';
import { useAsync, useModelsV3, SegTabs, BackBar, Section, Note, pct } from './common';

const ROLE_ICON: Record<RoleId, string> = { chat: 'bot', reason: 'compass', fast: 'activity', vision: 'eye', image: 'wand', imageEdit: 'edit', tts: 'mic', asr: 'list', video: 'creator', embed: 'search', rerank: 'kanban' };
type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
export function entryTone(e: ModelEntry | undefined, role?: RoleId): Tone {
  if (!e) return 'neutral';
  const p = role ? e.probes?.[role] : undefined;
  if (p) return p.ok ? 'ok' : p.kind === 'needs_confirm' ? 'warn' : 'bad';
  return e.status === 'ok' ? 'ok' : ['failed', 'not_found', 'not_enabled'].includes(e.status) ? 'bad' : 'warn';
}
const TONE_TEXT: Record<Tone, string> = { ok: '已实测', warn: '未实测', bad: '最近测试失败', neutral: '未接' };

export function RolesPage({ id, go, lay }: { id: string | null; go: (to: string) => void; lay: Layout }) {
  if (!id) return <RolesIndex go={go} />;
  if (id === 'accounts') return <Accounts go={go} />;
  if (id === 'legacy') return <ModelsPage id={null} go={go} lay={lay} />;
  if (id.startsWith('acc-')) return <AccountDetail accountId={id.slice(4)} go={go} />;
  if (isRoleId(id)) return <RoleDetail role={id} go={go} />;
  return <ModelsPage id={id} go={go} lay={lay} />;   // 0.6–0.8 服务商快速连接（#me/models/mimo 等旧链接）
}

/* ---------------- 一级页：5 组 11 个角色 ---------------- */
function RolesIndex({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { data: s, error } = useModelsV3();
  if (error) return <div className="page page-narrow"><Problem title={t('读取模型配置失败')} advice={error} /></div>;
  if (!s) return null;
  const done = configuredRoles(s);
  return (
    <div className="page page-narrow" data-testid="roles-index">
      <p className="m-0 mb-2 text-[15px] text-fg-2" data-testid="roles-count">{t('已接')} {done.length} / {ROLE_IDS.length} {t('类')}</p>
      {ROLE_GROUPS.map((g) => (
        <GroupList key={g.id} title={t(g.label)}>
          {g.roles.map((r) => {
            const b = s.roles[r]; const f = b.primary ? findEntry(s, b.primary.modelEntryId) : null;
            const tone: Tone = done.includes(r) ? entryTone(f?.entry, r) : 'neutral';
            return <ListRow key={r} icon={ROLE_ICON[r]} label={t(roleLabel(r))} hint={f ? `${displayModel(f.entry)} · ${f.account.label}` : t('未接')} value={<StatusDot tone={tone}>{t(TONE_TEXT[tone])}</StatusDot>} onClick={() => go(`me/models/${r}`)} href={`#me/models/${r}`} testId={`role-${r}`} />;
          })}
        </GroupList>
      ))}
      <GroupList title={t('更多')}>
        <ListRow icon="key" label={t('账号与 Key')} hint={t('同一服务商一个 Key，默认各能力通用')} onClick={() => go('me/models/accounts')} testId="accounts-link" />
        <ListRow icon="activity" label={t('用量与费用')} hint={t('延迟、成本、缓存命中、错误率')} onClick={() => go('me/status')} />
        <ListRow icon="cpu" label={t('常用服务快速连接')} hint={t('6 家常用服务：填 Key → 测试连接（只接文本对话）')} onClick={() => go('me/models/legacy')} testId="legacy-link" />
      </GroupList>
    </div>
  );
}

/* ---------------- 角色二级页 ---------------- */
function RoleDetail({ role, go }: { role: RoleId; go: (to: string) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<'settings' | 'try' | 'usage'>('settings');
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid={`role-detail-${role}`}>
      <BackBar label={t(roleLabel(role))} onBack={() => go('me/models')} />
      <a className="v9-return" href="#agent" data-testid="return-chat">{t('配置好后回到对话')} ›</a>
      <Note>{t(roleDef(role).io)}</Note>
      <SegTabs value={tab} onChange={setTab} label={t('角色页标签')} options={[['settings', '设置'], ['try', '试一试'], ['usage', '用量']]} />
      {tab === 'settings' && <RoleSettings role={role} go={go} />}
      {tab === 'try' && <Playground role={role} go={go} />}
      {tab === 'usage' && <RoleUsage role={role} />}
    </div>
  );
}

function probeLine(p: ProbeResult | undefined, t: (k: string) => string): string {
  if (!p) return t('还没测试');
  if (p.ok) return `${t('测试通过')}${p.ms ? ` · ${(p.ms / 1000).toFixed(1)}s` : ''}${p.respondedModel ? ` · ${t('请求')} ${p.requestedModel} → ${t('实际')} ${p.respondedModel}` : ''}`;
  return `${p.reason ?? t('测试未通过')}`;
}

function RoleSettings({ role, go }: { role: RoleId; go: (to: string) => void }) {
  const { t } = useT();
  const { data: s } = useModelsV3();
  const tails = useAsync(secretTails, ['kv:secrets']).data ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  const [ovURL, setOvURL] = useState<string | null>(null);
  const [ovKey, setOvKey] = useState('');
  if (!s) return null;
  const cands = candidatesFor(s, role);
  const b = s.roles[role];
  const save = async (n: ModelsStateV3) => { await saveModelsV3(n); };
  const setSlot = async (slot: 'primary' | 'fallback', entryId: string) => {
    const cur = await getModelsV3();
    if (!entryId) { const n = structuredClone(cur); delete n.roles[role][slot]; await save(n); return; }
    const f = findEntry(cur, entryId); if (!f) return;
    const keep = cur.roles[role][slot];
    const n = bindRole(cur, role, slot, f.entry);
    if (keep?.overrideSecretRef || keep?.overrideBaseURL) Object.assign(n.roles[role][slot]!, { overrideSecretRef: keep.overrideSecretRef, overrideBaseURL: keep.overrideBaseURL });
    await save(n); show(t('已保存'));
  };
  const test = async (slot: 'primary' | 'fallback', allowPaid = false) => {
    const tg = s.roles[role][slot]; if (!tg) return;
    setBusy(slot);
    try { const r = await probe(tg.accountId, tg.modelEntryId, { roles: [role], allowPaid }); show(r[0]?.result.ok ? t('测试通过') : (r[0]?.result.reason ?? t('测试未通过'))); } finally { setBusy(null); }
  };
  const saveOverride = async () => {
    const cur = await getModelsV3(); const p = cur.roles[role].primary; if (!p) return;
    const ref = `secret:role:${role}`;
    if (ovKey.trim()) { await setSecret(ref, ovKey); p.overrideSecretRef = ref; }
    if (ovURL !== null) p.overrideBaseURL = ovURL.trim() || undefined;
    await save(cur); setOvKey(''); show(t('已保存这一类单独的地址与 Key'));
  };
  const clearOverride = async () => { const cur = await getModelsV3(); const p = cur.roles[role].primary; if (!p) return; await deleteSecret(`secret:role:${role}`); delete p.overrideSecretRef; delete p.overrideBaseURL; await save(cur); setOvURL(null); show(t('已改回共用账号的 Key')); };
  const slotCard = (slot: 'primary' | 'fallback', title: string) => {
    const tg = b[slot]; const f = tg ? findEntry(s, tg.modelEntryId) : null;
    const p = f ? (f.entry.probes?.[role] ?? f.entry.lastProbe) : undefined;
    return (
      <Section title={t(title)} testId={`slot-${slot}`}>
        <select aria-label={`${t(title)}${t('模型')}`} value={tg?.modelEntryId ?? ''} onChange={(e) => void setSlot(slot, e.target.value)} data-testid={`slot-${slot}-select`}>
          <option value="">{t('未设置')}</option>
          {cands.map((c) => <option key={c.entry.id} value={c.entry.id}>{c.text}</option>)}
        </select>
        {f && <>
          <Note tone={p?.ok ? 'ok' : p ? 'warn' : 'muted'}>{probeLine(p, t)}</Note>
          {f.entry.status === 'not_in_list' && <Note tone="warn">{t('可能已下线或改名：获取到的模型列表里没有这个名字')}</Note>}
          {p && !p.ok && p.kind === 'model_not_found' && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => go(`me/models/acc-${f.account.id}`)}>{t('获取列表')}</button><button type="button" onClick={() => go(`me/models/acc-${f.account.id}`)}>{t('改模型名')}</button></div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void test(slot)} disabled={!!busy} data-testid={`slot-${slot}-test`}>{busy === slot ? <Busy label={t('测试中…')} /> : t('测试')}</button>
            {p?.kind === 'needs_confirm' && <button type="button" className="primary" onClick={() => void test(slot, true)}>{t('确认花费并测试')}</button>}
          </div>
          <Note>{t('测试方式')}：{t(PROBES[role].describe)}{PROBES[role].paid ? `（${t('会花钱')}）` : ''}</Note>
        </>}
      </Section>
    );
  };
  const supported = s.accounts.map((a) => ({ a, ok: !!adapterOf(a.vendor)?.roles.includes(role) })).sort((x, y) => Number(y.ok) - Number(x.ok));
  const pri = b.primary;
  return (
    <>
      {toast}
      {!cands.length && <Problem title={t('还没有能做这件事的模型名')} advice={t('先在“账号与 Key”里添加服务商，再给模型名勾上这项能力')} action={t('去添加')} onAction={() => go('me/models/accounts')} />}
      {slotCard('primary', '默认')}
      {slotCard('fallback', '备用')}
      <Note>{t('备用只在超时、限流、服务商 5xx、断网时自动切换；Key 不对、余额不足、模型名不存在不会悄悄换别家。')}</Note>
      {pri && (
        <Section title={t('这一类单独填写地址与 Key')} testId="role-override">
          <Note>{s.keyPolicy.scope === 'account' ? t('默认与账号共用 Key。只有这一类要用另一个 Key / 地址时才填。') : t('当前设置为“每类单独填写”。')}</Note>
          {pri.overrideSecretRef && <Note tone="ok">{t('正在使用单独的 Key')} ••••{tails[pri.overrideSecretRef]?.tail ?? ''}</Note>}
          <label className="field !m-0"><span>{t('地址（留空用账号地址）')}</span><input value={ovURL ?? pri.overrideBaseURL ?? ''} onChange={(e) => setOvURL(e.target.value)} spellCheck={false} placeholder="https://…" /></label>
          <label className="field !m-0"><span>{t('Key（只存本机加密存储）')}</span><input type="password" autoComplete="off" value={ovKey} onChange={(e) => setOvKey(e.target.value)} data-testid="override-key" /></label>
          <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void saveOverride()}>{t('保存')}</button>{(pri.overrideSecretRef || pri.overrideBaseURL) && <button type="button" onClick={() => void clearOverride()}>{t('改回共用')}</button>}</div>
        </Section>
      )}
      <GroupList title={t('可用服务商')}>
        {supported.map(({ a, ok }) => <ListRow key={a.id} label={a.label} hint={`${ok ? t('支持这项能力') : t('能力声明里没有这项（可自定义）')} · ${a.models.length} ${t('个模型名')}`} onClick={() => go(`me/models/acc-${a.id}`)} />)}
        <ListRow icon="plus" label={t('＋ 自定义（OpenAI 兼容）')} hint={t('任何兼容地址；模型名手填，原样发送')} onClick={() => go('me/models/accounts')} testId="add-custom-role" />
      </GroupList>
    </>
  );
}

/* ---------------- 试一试（不经 Agent，直接调用统一能力层；与 Agent 共用记账与标识） ---------------- */
const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
function Playground({ role, go }: { role: RoleId; go: (to: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CallResult | null>(null);
  const [media, setMedia] = useState<{ id: number; dataUrl: string; kind: string }[]>([]);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [toast, show] = useToast();
  const paid = roleDef(role).paid !== 'cheap';
  const needFile = role === 'vision' || role === 'imageEdit' || role === 'asr';
  const run = async () => {
    if (paid && !confirmPaid) { setConfirmPaid(true); return; }
    setBusy(true); setRes(null); setMedia([]); setConfirmPaid(false);
    const lines = extra.split('\n').map((x) => x.trim()).filter(Boolean);
    const req = role === 'chat' || role === 'reason' || role === 'fast' ? { role, messages: [{ role: 'user' as const, content: text }], thinking: role === 'reason' }
      : role === 'vision' ? { role, image: file ?? '', question: text || '这张图里有什么？' }
      : role === 'image' ? { role, prompt: text, n: 1 }
      : role === 'imageEdit' ? { role, images: file ? [file] : [], instruction: text }
      : role === 'tts' ? { role, text }
      : role === 'asr' ? { role, audio: { base64: (file ?? '').split(',')[1] ?? '', format: /wav/.test(file ?? '') ? 'wav' : 'mp3', mime: (/^data:([^;]+)/.exec(file ?? '')?.[1]) ?? 'audio/wav' } }
      : role === 'video' ? { role, prompt: text, duration: 5 }
      : role === 'embed' ? { role, input: [text, ...lines].filter(Boolean) }
      : { role, query: text, documents: lines };
    try {
      const r = await call(role, req as never);
      setRes(r);
      if (r.ok && r.value.type === 'media') {
        const rows = await saveMedia(r.value.items, { role, model: r.target.model, prompt: text, vendor: r.account.vendor });
        setMedia(rows.map((x) => ({ id: x.id, dataUrl: x.dataUrl, kind: x.kind })));
      }
    } finally { setBusy(false); }
  };
  const resultText = res?.ok ? (res.value.type === 'text' ? res.value.text : res.value.type === 'transcript' ? res.value.text : res.value.type === 'vectors' ? `${t('向量维度')} ${res.value.dims} × ${res.value.vectors.length}` : res.value.type === 'ranking' ? res.value.results.map((x) => `#${x.index} ${x.score.toFixed(3)}`).join('  ') : res.value.type === 'job' ? `${t('任务已提交')}：${res.value.jobId}（${res.value.status}）` : '') : '';
  const toInbox = async () => { await addInbox({ kind: media[0] ? 'image' : 'text', text: resultText || text, image: media[0]?.dataUrl, title: `${t('试一试')} · ${t(roleLabel(role))}`, channel: 'paste' }); show(t('已发给 Agent（素材箱）')); };
  const toDraft = async () => { const d = await db.insert('drafts', { platform: 'xiaohongshu', title: text.slice(0, 20) || t(roleLabel(role)), body: resultText, status: 'pending', images: media.map((m) => m.dataUrl) }); show(t('已插入草稿')); go(`agent/drafts/${d.id}`); };
  return (
    <Section testId="playground">
      {toast}
      <label className="field !m-0"><span>{role === 'rerank' ? t('查询') : role === 'tts' ? t('要配音的文字') : role === 'asr' ? t('说明（可不填）') : t('提示词 / 问题')}</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid="try-input" /></label>
      {(role === 'embed' || role === 'rerank') && <label className="field !m-0"><span>{role === 'rerank' ? t('候选（每行一条）') : t('更多文本（每行一条）')}</span><textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} /></label>}
      {needFile && <label className="field !m-0"><span>{role === 'asr' ? t('选择音频') : t('选择图片（你自己的或已授权的）')}</span><input type="file" accept={role === 'asr' ? 'audio/*' : 'image/*'} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setFile(await readFile(f)); }} /></label>}
      {confirmPaid && <Problem title={t('这次调用会花钱')} advice={role === 'video' ? t('视频每次都先问你；费用以服务商账单为准') : t('按服务商公开单价估算，以账单为准')} action={t('确认并调用')} onAction={() => void run()} secondary={<button type="button" onClick={() => setConfirmPaid(false)}>{t('取消')}</button>} testId="try-confirm" />}
      <button type="button" className="primary" disabled={busy || (!text.trim() && !file)} onClick={() => void run()} data-testid="try-run">{busy ? <Busy label={t('调用中…')} /> : t('试一试')}</button>
      {res && !res.ok && <Problem title={res.error.reason} advice={res.error.advice} action={res.error.actions.includes('fetch_list') || res.error.actions.includes('fix_key') ? t('去检查账号') : res.error.actions.includes('configure') ? t('去配置') : undefined} onAction={() => go(res.target ? `me/models/acc-${res.target.accountId}` : `me/models/${role}`)} testId="try-error" />}
      {res?.ok && (
        <div className="flex flex-col gap-2" data-testid="try-result">
          {resultText && <p className="m-0 whitespace-pre-wrap text-[15px]">{resultText}</p>}
          {res.value.type === 'text' && res.value.reasoning && <details><summary className="text-[13px] text-muted">{t('推理过程')}</summary><p className="m-0 whitespace-pre-wrap text-[13px] text-muted">{res.value.reasoning}</p></details>}
          <div className="flex flex-wrap gap-2">{media.map((m) => m.kind === 'audio' ? <audio key={m.id} controls src={m.dataUrl} /> : m.kind === 'video' ? <video key={m.id} controls src={m.dataUrl} className="max-h-60" /> : <figure key={m.id} className="m-0"><img src={m.dataUrl} alt="" className="h-32 w-32 rounded-[10px] object-cover" /><figcaption className="text-[11px] text-muted">{t('AI 生成')}</figcaption></figure>)}</div>
          <Note>{t('模型')}：{res.target.model}{res.respondedModel && res.respondedModel !== res.target.model ? `（${t('请求')} ${res.target.model} → ${t('实际')} ${res.respondedModel}）` : ''} · {(res.ms / 1000).toFixed(1)}s{res.cost !== null ? ` · ¥${res.cost.toFixed(4)}` : ` · ${t('单价未知')}`}{res.fromCache ? ` · ${t('缓存命中')}` : ''}</Note>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void toInbox()}>{t('存素材 / 发给 Agent')}</button><button type="button" onClick={() => void toDraft()}>{t('插入草稿')}</button></div>
        </div>
      )}
    </Section>
  );
}

function RoleUsage({ role }: { role: RoleId }) {
  const { t } = useT();
  const { data } = useAsync(() => modelStats(30), ['usage_log']);
  const rows = (data?.stats ?? []).filter((x) => x.role === role);
  if (!rows.length) return <Note>{t('近 30 天还没有这一类的调用记录')}</Note>;
  return (
    <ul className="item-list" data-testid="role-usage">
      {rows.map((r) => <li key={r.key}><span className="flex min-w-0 flex-1 flex-col"><span className="item-title !text-[14px]">{r.model} · {r.vendor}</span><span className="item-meta">{r.calls} {t('次')} · p50 {(r.p50 / 1000).toFixed(1)}s · ¥{r.cost.toFixed(3)} · {t('错误率')} {pct(r.errorRate)} · {t('缓存命中')} {pct(r.cacheRate)}</span></span></li>)}
    </ul>
  );
}

/* ---------------- 账号与 Key ---------------- */
function Accounts({ go }: { go: (to: string) => void }) {
  const { t } = useT();
  const { data: s } = useModelsV3();
  const tails = useAsync(secretTails, ['kv:secrets']).data ?? {};
  const vendors = useMemo(() => ADAPTERS.list(), []);
  const [vendor, setVendor] = useState('openai-compatible');
  const ad = adapterOf(vendor);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const info: { where: string; risk?: string; warn?: string } = useAsync(secretStorageInfoAsync, ['kv:secrets']).data ?? secretStorageInfo();
  const broken = useAsync(undecryptableSecrets, ['kv:secrets']).data ?? [];
  const add = async () => {
    setErr(null);
    const baseURL = (url || ad?.defaultBaseURL || '').trim();
    if (!/^https?:\/\//.test(baseURL) && vendor !== 'mock') { setErr(t('地址要以 http:// 或 https:// 开头')); return; }
    if (/154\.8\.183\.93/.test(baseURL)) { setErr(t('该服务器不在允许范围内')); return; }
    if (ad?.keyRequired && !key.trim()) { setErr(t('这家服务需要 Key')); return; }
    const cur = await getModelsV3();
    const id = `a${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;   // 短 id：避免 “secret:<id>” 被密钥扫描误判
    const acc: ProviderAccount = { id, vendor, label: label.trim() || ad?.label || vendor, baseURL, region: ad?.region ?? 'cn', models: [], secretRef: `secret:${id}`, hasKey: false };
    try {
      if (key.trim()) { const r = await setSecret(acc.secretRef!, key); acc.hasKey = true; acc.keyTail = r.tail; }
      cur.accounts.push(acc);
      await saveModelsV3(cur);
    } catch (e) { setErr(`${t('没有保存')}：${(e as Error).message}`); return; }
    setKey(''); setLabel(''); setUrl('');
    go(`me/models/acc-${id}`);
  };
  if (!s) return null;
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="accounts">
      <BackBar label={t('账号与 Key')} onBack={() => go('me/models')} />
      <Note>{t('同一服务商一个 Key，默认各能力通用（例如百炼填一次，文本、生图、配音、转写都能用）；某一类要单独的 Key，在那一类的页面里填。')}</Note>
      <Note>{t('存放位置')}：{t(info.where)}{info.risk ? ` · ${t(info.risk)}` : ''}</Note>
      {info.warn && <Note tone="warn">{t(info.warn)}</Note>}
      {!!broken.length && <Problem testId="keys-undecryptable" title={`${broken.length} ${t('个 Key 在这台设备上解不开')}`} advice={t('卸载重装、换手机或恢复了别的设备的数据后属于正常情况（硬件密钥不会跟着走）。请在对应服务商里重新填写 Key。')} />}
      <GroupList title={t('已添加的服务商')}>
        {!s.accounts.length && <li className="p-4 text-[14px] text-muted">{t('还没有。下面添加一家，或用“常用服务快速连接”。')}</li>}
        {s.accounts.map((a) => <ListRow key={a.id} label={a.label} hint={`${adapterOf(a.vendor)?.label ?? a.vendor} · ${a.models.length} ${t('个模型名')} · ${a.hasKey ? `Key ••••${tails[a.secretRef ?? '']?.tail ?? a.keyTail ?? ''}` : t('没有 Key')}`} onClick={() => go(`me/models/acc-${a.id}`)} testId={`acc-${a.vendor}`} />)}
      </GroupList>
      <Section title={t('＋ 添加服务商')} testId="add-account">
        <label className="field !m-0"><span>{t('类型')}</span>
          <select value={vendor} onChange={(e) => { setVendor(e.target.value); setUrl(''); }} data-testid="vendor-select">
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.id === 'mock' ? t('本地模拟（演示 / 测试用，不花钱）') : v.label}</option>)}
          </select>
        </label>
        <label className="field !m-0"><span>{t('名称（可不填）')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={ad?.label} /></label>
        <label className="field !m-0"><span>{t('地址')}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={ad?.defaultBaseURL || 'https://…/v1'} spellCheck={false} data-testid="acc-url" /></label>
        {!!ad?.baseURLPresets?.length && <div className="flex flex-wrap gap-2">{ad.baseURLPresets.map((p) => <button key={p.url} type="button" className="ghost" onClick={() => setUrl(p.url)}>{p.label}</button>)}</div>}
        {ad?.keyRequired !== false && <label className="field !m-0"><span>{t('API Key（只存本机加密存储，只显示末 4 位）')}</span><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} data-testid="acc-key" /></label>}
        {err && <Problem title={err} advice={t('改好后再点添加')} />}
        <button type="button" className="primary" onClick={() => void add()} data-testid="acc-add">{t('添加')}</button>
      </Section>
    </div>
  );
}

/* ---------------- 账号详情：模型名（手填 / 获取列表）、能力勾选、测试 ---------------- */
const EXAMPLES: Record<string, string> = { mimo: 'mimo-v2.6-flash', dashscope: 'qwen3.7-plus', deepseek: 'deepseek-v4-pro', zhipu: 'glm-4.7-flash', ark: 'ep-2026…', kimi: '点“获取列表”选择', mock: 'Mock/Model:v1.0' };
function AccountDetail({ accountId, go }: { accountId: string; go: (to: string) => void }) {
  const { t } = useT();
  const { data: s } = useModelsV3();
  const tails = useAsync(secretTails, ['kv:secrets']).data ?? {};
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [roles, setRoles] = useState<RoleId[]>(['chat']);
  const [err, setErr] = useState<string | null>(null);
  const [listed, setListed] = useState<{ id: string }[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [toast, show] = useToast();
  const a = s?.accounts.find((x) => x.id === accountId);
  if (!s) return null;
  if (!a) return <div className="page page-narrow"><Problem title={t('这个服务商已被删除')} action={t('返回')} onAction={() => go('me/models/accounts')} /></div>;
  const ad = adapterOf(a.vendor);
  const mutate = async (fn: (acc: ProviderAccount, st: ModelsStateV3) => void | ModelsStateV3) => { const cur = await getModelsV3(); const acc = cur.accounts.find((x) => x.id === accountId)!; const r = fn(acc, cur); await saveModelsV3(r ?? cur); };
  const runProbe = async (e: ModelEntry, allowPaid = false) => { setBusy(e.id); try { const r = await probe(a.id, e.id, { allowPaid }); const bad = r.find((x) => !x.result.ok && x.result.kind !== 'needs_confirm'); show(bad ? `${t(roleLabel(bad.role))}：${bad.result.reason ?? ''}` : t('测试完成')); } finally { setBusy(null); } };
  const addOne = async (model: string, rs: RoleId[], lbl?: string): Promise<ModelEntry | null> => {
    let made: ModelEntry | null = null; let bad: string | null = null;
    await mutate((acc) => { const r = addModelEntry(acc, { model, roles: rs, label: lbl, source: listed?.some((x) => x.id === model) ? 'fetched' : 'manual' }); if (r.ok) made = r.entry; else bad = r.error === 'no_roles' ? t('至少勾一项能力') : t(MODEL_NAME_MESSAGES[r.error]); });
    if (bad) setErr(bad);
    return made;
  };
  const addManual = async () => {
    setErr(null);
    const e = await addOne(name, roles, label);
    if (e) { setName(''); setLabel(''); show(t('已添加，正在自动测试一次')); await runProbe(e); }
  };
  const doFetch = async () => {
    setBusy('list'); setListErr(null);
    try {
      const r = await fetchList(a.id);
      if (!r.ok) { setListErr('unsupported' in r && r.unsupported || ('error' in r && (r.error as { status?: number }).status === 404) ? t('这家服务没有提供模型列表，请手动填写') : `${(r.error as { reason: string }).reason}`); return; }
      setListed(r.models);
      await mutate((acc) => { markAgainstList(acc, r.models.map((m) => m.id)); acc.listSupport = 'yes'; acc.listFetchedAt = Date.now(); });
    } finally { setBusy(null); }
  };
  const addPicked = async () => { for (const m of picked) await addOne(m, roles); setPicked([]); show(t('已添加所选模型名')); };
  const delEntry = async (e: ModelEntry) => {
    const refs = referencesOf(s, e.id);
    if (refs.length && !window.confirm(`${t('这个模型名正被使用')}：${refs.map((r) => `${t(roleLabel(r.role))}·${t(r.slot)}`).join('、')}。${t('删除后这些位置会变成“未配置”，不会自动换成别的模型。确定删除？')}`)) return;
    await saveModelsV3(removeModelEntry(await getModelsV3(), e.id));
  };
  const toggleRole = async (e: ModelEntry, r: RoleId) => mutate((acc) => { const x = acc.models.find((m) => m.id === e.id)!; x.roles = x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r]; if (!x.roles.length) x.roles = [r]; x.updatedAt = Date.now(); });
  const replaceKey = async () => { if (!newKey.trim()) return; const r = await setSecret(a.secretRef ?? `secret:${a.id}`, newKey); await mutate((acc) => { acc.secretRef ??= `secret:${acc.id}`; acc.hasKey = true; acc.keyTail = r.tail; }); setNewKey(''); show(t('Key 已更新')); };
  const removeKey = async () => { await deleteSecret(a.secretRef ?? `secret:${a.id}`); await mutate((acc) => { acc.hasKey = false; acc.keyTail = undefined; }); show(t('Key 已删除')); };
  const removeAccount = async () => { if (!window.confirm(t('删除这个服务商和它的全部模型名？用到它的能力会变成“未配置”。'))) return; let cur = await getModelsV3(); for (const e of a.models) cur = removeModelEntry(cur, e.id); cur.accounts = cur.accounts.filter((x) => x.id !== a.id); await deleteSecret(a.secretRef ?? `secret:${a.id}`); await saveModelsV3(cur); go('me/models/accounts'); };
  const shown = (listed ?? []).filter((m) => m.id.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="account-detail">
      {toast}
      <BackBar label={a.label} onBack={() => go('me/models/accounts')} />
      <Note>{ad?.label ?? a.vendor} · {a.baseURL || t('（无地址）')}</Note>
      <Section title={t('Key')}>
        <Note tone={a.hasKey || ad?.keyRequired === false ? 'ok' : 'warn'}>{ad?.keyRequired === false ? t('这家服务不需要 Key') : a.hasKey ? `${t('已保存')} ••••${tails[a.secretRef ?? '']?.tail ?? a.keyTail ?? ''}${tails[a.secretRef ?? '']?.encrypted === false ? ` · ${t('未加密（浏览器不支持加密存储）')}` : ''}` : t('还没填 Key')}</Note>
        <div className="flex flex-wrap items-end gap-2"><label className="field !m-0 grow"><span>{t('换一个 Key')}</span><input type="password" autoComplete="off" value={newKey} onChange={(e) => setNewKey(e.target.value)} /></label><button type="button" onClick={() => void replaceKey()}>{t('保存 Key')}</button>{a.hasKey && <button type="button" className="danger" onClick={() => void removeKey()}>{t('删除 Key')}</button>}</div>
      </Section>
      <Section title={t('模型名')} testId="entries">
        {!a.models.length && <Note>{t('还没有模型名。下面手填，或点“获取列表”选择。')}</Note>}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {a.models.map((e) => {
            const tone = entryTone(e);
            return (
              <li key={e.id} className="v9-entry" data-testid={`entry-${e.model}`}>
                <div className="flex flex-wrap items-center gap-2"><strong className="break-all text-[15px]">{displayModel(e)}</strong><StatusDot tone={tone}>{e.status === 'not_in_list' ? t('可能已下线或改名') : t(TONE_TEXT[tone])}</StatusDot></div>
                <div className="mt-1 flex flex-wrap gap-1">{ROLE_IDS.map((r) => <label key={r} className={`v9-chip ${e.roles.includes(r) ? 'on' : ''}`}><input type="checkbox" checked={e.roles.includes(r)} onChange={() => void toggleRole(e, r)} />{t(roleDef(r).short)}{ad && !ad.roles.includes(r) && e.roles.includes(r) ? '?' : ''}</label>)}</div>
                {Object.entries(e.probes ?? {}).filter(([, p]) => p && !p.ok).map(([r, p]) => (
                  <div key={r} className="mt-2"><Problem title={`${t(roleLabel(r as RoleId))}：${p!.reason ?? t('测试未通过')}`} advice={p!.kind === 'model_not_found' ? t('不会自动换成别的模型，也不会切备用。') : undefined} action={p!.kind === 'needs_confirm' ? t('确认花费并测试') : p!.kind === 'model_not_found' ? t('获取列表') : undefined} onAction={() => (p!.kind === 'needs_confirm' ? void runProbe(e, true) : void doFetch())} secondary={p!.kind === 'model_not_found' ? <button type="button" onClick={() => { setName(e.model); void delEntry(e); }}>{t('改模型名')}</button> : undefined} testId={`probe-error-${e.model}-${r}`} /></div>
                ))}
                {Object.values(e.probes ?? {}).some((p) => p?.respondedModel) && <Note>{t('请求')} {e.model} → {t('实际')} {Object.values(e.probes ?? {}).find((p) => p?.respondedModel)?.respondedModel}</Note>}
                <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => void runProbe(e)} disabled={!!busy} data-testid={`test-${e.model}`}>{busy === e.id ? <Busy label={t('测试中…')} /> : t('测试')}</button><button type="button" className="ghost danger" onClick={() => void delEntry(e)}>{t('删除')}</button></div>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={t('添加模型名')} testId="add-entry">
        <label className="field !m-0"><span>{t('模型名称（必填，原样发送，大小写和 / : . 都保留）')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t('例如')} ${EXAMPLES[a.vendor] ?? 'model-name'}`} spellCheck={false} autoCapitalize="off" data-testid="model-name" /></label>
        <label className="field !m-0"><span>{t('显示名（可不填）')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-[13px] font-medium">{t('这个模型名能做什么（可多选）')}</legend>
          <div className="flex flex-wrap gap-1">{ROLE_IDS.map((r) => <label key={r} className={`v9-chip ${roles.includes(r) ? 'on' : ''}`}><input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))} data-testid={`new-role-${r}`} />{t(roleDef(r).short)}</label>)}</div>
        </fieldset>
        {roles.map((r) => { const d = mergeDecl(r, a.vendor, name || 'x', ad?.declare(r, name || 'x')); return d.verified !== 'unverified' ? null : <Note key={r} tone="warn">{t(roleLabel(r))}：{t(VERIFIED_LABEL[d.verified])}{t('，测试通过后再用')}</Note>; })}
        {err && <Problem title={err} />}
        <div className="flex flex-wrap gap-2"><button type="button" className="primary" onClick={() => void addManual()} data-testid="add-model">{t('添加并测试')}</button><button type="button" onClick={() => void doFetch()} disabled={busy === 'list'} data-testid="fetch-list">{busy === 'list' ? <Busy label={t('获取中…')} /> : t('获取列表')}</button></div>
        {listErr && <Problem title={listErr} advice={t('不影响保存：模型名可以直接手填')} testId="list-error" />}
        {listed && (
          <div className="flex flex-col gap-2" data-testid="model-list">
            <input placeholder={t('搜索模型名')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('搜索模型名')} />
            <Note>{t('共')} {listed.length} {t('个')}{t('；列表只缓存在本机内存，不进导出')}</Note>
            <ul className="m-0 max-h-72 list-none overflow-auto p-0">{shown.map((m) => <li key={m.id}><label className="list-row cursor-pointer !min-h-11"><input type="checkbox" checked={picked.includes(m.id)} onChange={() => setPicked((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))} /><span className="row-text break-all">{m.id}</span></label></li>)}</ul>
            <button type="button" className="primary" disabled={!picked.length} onClick={() => void addPicked()}>{t('添加所选')}（{picked.length}）</button>
          </div>
        )}
      </Section>
      <button type="button" className="danger self-start" onClick={() => void removeAccount()}>{t('删除这个服务商')}</button>
    </div>
  );
}
