/**
 * 我的 → 收益（8.13）：手动录入表单（凭据 = 表单事件）+ 官方导出 CSV 导入（预览 → 列映射 → 确认 → hash 去重）+ 漏斗五层与四种归因（allocated 标“分摊估计”）。
 * 我的 → 成长记录（8.14）：页顶诚实声明；修订建议（看 diff → 采纳 / 拒绝；已采纳可一键回滚）；经验看板（候选 / 测试中 / 有效 / 降级）；收益趋势（图注“不代表因果”）；最近变更。
 * 收入只来自你录入或你导出的官方数据；Agent 没有写收入的工具；任何建议都要你确认后才生效。
 */
import { useState } from 'react';
import {
  validateRevenue, previewImport, computeAttribution, summarize, funnel, METHOD_LABEL, applyProposal, rollbackProposal, evolutionRisk, t as ct, sha256,
  type RevenueRecord, type RevenueType, type ColumnMap, type ImportPreview, type Proposal, type Lesson, type MetricRecord,
} from '@content-agent/shared';
import { useT } from '../../../i18n';
import { db } from '../../../local/db';
import { getVfs } from '../../../v9/vfsBackend';
import { audit } from '../../../v9/ops';
import { GroupList, Problem, useToast, Sparkline, EmptyState } from '../../../ui';
import { useAsync, Section, Note, SegTabs } from './common';
import { DiffInline } from './diffInline';

const TYPES: [RevenueType, string][] = [['creator_share', '平台分成'], ['ad_deal', '广告合作'], ['commission', '带货佣金'], ['paid_content', '付费内容'], ['other', '其他']];
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const loadRevenue = async () => (await db.all('revenue')) as unknown as (RevenueRecord & { id: string })[];

export function RevenuePage() {
  const { t } = useT();
  const [tab, setTab] = useState<'summary' | 'form' | 'import'>('summary');
  const { data: rev, reload } = useAsync(loadRevenue, ['revenue']);
  const { data: metrics } = useAsync(async () => (await db.all('metrics')) as unknown as MetricRecord[], ['metrics']);
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="revenue-page">
      <Note>{t('ui.income_comes_only_from_what')}</Note>
      <SegTabs value={tab} onChange={setTab} label={t('ui.revenue')} options={[['summary', '汇总'], ['form', '录入'], ['import', '导入 CSV']]} />
      {tab === 'summary' && <Summary rev={rev ?? []} metrics={metrics ?? []} />}
      {tab === 'form' && <RevenueForm existing={rev ?? []} onDone={() => { reload(); setTab('summary'); }} />}
      {tab === 'import' && <RevenueImport existing={rev ?? []} onDone={() => { reload(); setTab('summary'); }} />}
    </div>
  );
}

function Summary({ rev, metrics }: { rev: RevenueRecord[]; metrics: MetricRecord[] }) {
  const { t } = useT();
  if (!rev.length) return <div className="card !p-0"><EmptyState icon="coin" title={t('ui.no_revenue_data_yet')} why={t('ui.add_an_entry_by_hand')} /></div>;
  const attr = computeAttribution(rev);
  const s = summarize(rev, attr);
  const f = funnel(metrics, rev);
  const byDay = new Map<string, number>(); for (const r of rev) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.amount);
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <Section title={`${t('ui.total_2')} ¥${s.total.toFixed(2)} · ${s.count} ${t('ui.items_2')}`} testId="revenue-total">
        <div className="flex flex-wrap gap-4 text-[14px]">{(Object.keys(METHOD_LABEL) as (keyof typeof METHOD_LABEL)[]).map((m) => <span key={m} data-testid={`attr-${m}`}>{t(METHOD_LABEL[m])}：¥{(s.byMethod[m] ?? 0).toFixed(2)}</span>)}</div>
        <Note>{t('ui.allocated_estimate_splits_one_income')}</Note>
      </Section>
      <Section title={t('ui.funnel_only_data_you_entered')}>
        <div className="flex flex-wrap gap-4 text-[14px]">{f.map((x) => <span key={x.layer}>{t(x.layer)}：{x.layer === '收入' ? `¥${x.value.toFixed(2)}` : x.value}</span>)}</div>
      </Section>
      {days.length > 1 && <Section title={t('ui.income_trend')}><Sparkline values={days.map(([, v]) => v)} w={300} h={48} label={t('ui.income_trend')} /><Note>{ct('growth.not_causal')}</Note></Section>}
      <GroupList title={t('ui.details')}>
        {rev.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100).map((r) => (
          <li key={r.id}><div className="list-row static"><span className="row-text"><span className="row-label">¥{r.amount.toFixed(2)} · {r.platform} · {t(TYPES.find((x) => x[0] === r.type)?.[1] ?? '其他')}</span><span className="row-hint">{r.date} · {r.basis === 'settled' ? t('ui.settled') : t('ui.estimate')} · {r.source.kind === 'user_entered' ? t('ui.entered_by_you') : `${t('ui.import')} ${r.source.fileName} ${t('ui.x')} ${r.source.row} ${t('ui.rows')}`}</span></span></div></li>
        ))}
      </GroupList>
    </>
  );
}

function RevenueForm({ existing, onDone }: { existing: RevenueRecord[]; onDone: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ date: today(), amount: '', platform: 'xiaohongshu', type: 'creator_share' as RevenueType, basis: 'settled' as 'settled' | 'estimated', contentId: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    try {
      const rec = validateRevenue({ date: f.date, amount: Number(f.amount), platform: f.platform, type: f.type, basis: f.basis, contentIds: f.contentId.trim() ? [f.contentId.trim()] : [], note: f.note || undefined, source: { kind: 'user_entered', formEventId: `form-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` } }, existing);
      await db.insert('revenue', rec as unknown as Record<string, unknown>);
      await audit({ kind: 'setting_change', actor: 'user', summary: `录入收入 ¥${rec.amount}（${rec.platform}，${rec.date}）`, outcome: 'ok' });
      onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Section testId="revenue-form">
      <div className="form-row"><label className="field"><span>{t('ui.date_beijing_time')}</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label><label className="field"><span>{t('ui.amount')}</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="rev-amount" /></label></div>
      <div className="form-row"><label className="field"><span>{t('ui.platforms')}</span><input value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /></label><label className="field"><span>{t('ui.type')}</span><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as RevenueType })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></label></div>
      <div className="form-row"><label className="field"><span>{t('ui.definition')}</span><select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as 'settled' | 'estimated' })}><option value="settled">{t('ui.settled')}</option><option value="estimated">{t('ui.estimate')}</option></select></label><label className="field"><span>{t('ui.linked_content_draft_number_optional')}</span><input value={f.contentId} onChange={(e) => setF({ ...f, contentId: e.target.value })} /></label></div>
      <label className="field !m-0"><span>{t('ui.note')}</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      {err && <Problem title={err} advice={t('ui.fix_it_then_save')} />}
      <button type="button" className="primary" onClick={() => void submit()} data-testid="rev-save">{t('ui.save')}</button>
    </Section>
  );
}

function RevenueImport({ existing, onDone }: { existing: RevenueRecord[]; onDone: () => void }) {
  const { t } = useT();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [map, setMap] = useState<ColumnMap>({ date: '', amount: '', platform: '', contentId: '' });
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  const headers = file ? (file.text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '').split(',').map((h) => h.replace(/^"|"$/g, '').trim()) : [];
  const guess = (hs: string[]): ColumnMap => ({ date: hs.find((h) => /日期|date|时间/i.test(h)) ?? '', amount: hs.find((h) => /金额|收入|amount|收益/i.test(h)) ?? '', platform: hs.find((h) => /平台|platform/i.test(h)) ?? '', contentId: hs.find((h) => /内容|作品|content|id/i.test(h)) ?? '' });
  const preview = async () => {
    setErr(null);
    if (!file || !map.date || !map.amount) { setErr(t('ui.choose_the_date_and_amount')); return; }
    const imported = (await db.getKV<string[]>('revenue.importedHashes')) ?? [];
    setPv(previewImport(file.name, file.text, { ...map, fixedPlatform: map.platform ? undefined : 'unknown' }, imported));
  };
  const confirm = async () => {
    if (!pv || !file) return;
    let n = 0; const list = [...existing];
    for (const r of pv.rows) { try { const rec = validateRevenue(r, list); list.push(rec); await db.insert('revenue', rec as unknown as Record<string, unknown>); n++; } catch { /* 已导入过的行跳过 */ } }
    const imported = (await db.getKV<string[]>('revenue.importedHashes')) ?? [];
    await db.setKV('revenue.importedHashes', [...new Set([...imported, pv.fileHash])]);
    await audit({ kind: 'import', actor: 'user', summary: `导入收入文件 ${file.name}：${n} 条（文件指纹 ${sha256(file.text).slice(0, 8)}）`, outcome: 'ok' });
    show(`${t('ui.imported')} ${n} ${t('ui.items_2')}`); setPv(null); setFile(null); onDone();
  };
  return (
    <Section testId="revenue-import">
      {toast}
      <label className="field !m-0"><span>{t('ui.choose_the_csv_exported_from')}</span><input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const text = await f.text(); setFile({ name: f.name, text }); setPv(null); const hs = (text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '').split(',').map((h) => h.replace(/^"|"$/g, '').trim()); setMap(guess(hs)); }} data-testid="rev-file" /></label>
      {file && <div className="form-row">{(['date', 'amount', 'platform', 'contentId'] as const).map((k) => (
        <label key={k} className="field"><span>{t({ date: '日期列', amount: '金额列', platform: '平台列（可不选）', contentId: '内容列（可不选）' }[k])}</span>
          <select value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>
      ))}</div>}
      {file && <button type="button" onClick={() => void preview()} data-testid="rev-preview">{t('ui.preview_2')}</button>}
      {err && <Problem title={err} />}
      {pv && (
        <div className="flex flex-col gap-2" data-testid="rev-preview-result">
          {pv.duplicateFile && <Problem title={t('ui.this_file_was_already_imported')} advice={t('ui.importing_again_skips_existing_rows')} />}
          <Note>{t('ui.importable')} {pv.rows.length} {t('ui.items_2')}；{t('ui.skip')} {pv.errors.length} {t('ui.items_2')}（{pv.errors.slice(0, 3).map((e) => `${t('ui.x')} ${e.row} ${t('ui.rows')}：${e.message}`).join('；')}）</Note>
          <ul className="m-0 list-none p-0 text-[14px]">{pv.rows.slice(0, 5).map((r, i) => <li key={i}>{r.date} · ¥{r.amount} · {r.platform}</li>)}</ul>
          <button type="button" className="primary" disabled={!pv.rows.length} onClick={() => void confirm()} data-testid="rev-confirm">{t('ui.confirm_import')}</button>
        </div>
      )}
    </Section>
  );
}

/* ---------------- 成长记录 ---------------- */
export function GrowthPage() {
  const { t } = useT();
  const { data: props, reload } = useAsync(async () => (await db.all('proposals')) as unknown as (Proposal & { _row: number })[], ['proposals']);
  const rows = useAsync(async () => db.all('proposals'), ['proposals']).data ?? [];
  const { data: lessons } = useAsync(async () => (await db.all('lessons')) as unknown as Lesson[], ['lessons']);
  const { data: evo } = useAsync(async () => (await (await getVfs()).text('EVOLUTION.md')) ?? '', ['kv:vfs_files']);
  const { data: rev } = useAsync(loadRevenue, ['revenue']);
  const [tab, setTab] = useState<'proposals' | 'board' | 'trend' | 'learned'>('proposals');
  const [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  const rowId = (p: Proposal) => rows.find((r) => (r as unknown as Proposal).id === p.id)?.id;
  const decide = async (p: Proposal, act: 'approve' | 'reject' | 'rollback') => {
    setErr(null);
    const id = rowId(p); if (id === undefined) return;
    try {
      const v = await getVfs(); const next = { ...p };
      if (act === 'approve') { const r = await applyProposal(v, next); show(`${t('ui.adopted')} → v${r.version}`); }
      else if (act === 'rollback') {
        const r = await rollbackProposal(v, next);
        // 1.0：记忆条目的回滚同时删掉对应的记忆记录
        const mid = (p as Proposal & { memoryId?: string }).memoryId;
        if (p.kind === 'memory' && mid) for (const row of await db.all('memories')) if (String(row.id) === mid || (row as Record<string, unknown>).entryId === mid) await db.del('memories', row.id);
        show(`${t('ui.rolled_back')} → v${r.version}`);
      }
      else { next.status = 'rejected'; next.decidedAt = new Date().toISOString(); show(t('ui.denied')); }
      await db.update('proposals', id, next as unknown as Record<string, unknown>);
      await audit({ kind: 'system_file_change', actor: 'user', summary: `${act === 'approve' ? '采纳' : act === 'rollback' ? '回滚' : '拒绝'}修订建议 ${p.id}（${p.target}）`, target: p.target, outcome: act === 'reject' ? 'denied' : 'ok' });
      reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const recent = (evo ?? '').split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l)).slice(0, 10);
  const byStatus = (s: Lesson['status']) => (lessons ?? []).filter((l) => l.status === s);
  const days = new Map<string, number>(); for (const r of rev ?? []) days.set(r.date, (days.get(r.date) ?? 0) + r.amount);
  return (
    <div className="page page-narrow flex flex-col gap-3" data-testid="growth-page">
      {toast}
      <p className="v9-disclaimer m-0" role="note" data-testid="growth-disclaimer">{ct('growth.disclaimer')}</p>
      <SegTabs value={tab} onChange={setTab} label={t('ui.growth_log')} options={[['proposals', '修订建议'], ['board', '打法看板'], ['trend', '收益趋势'], ['learned', '我学到了什么']]} />
      {err && <Problem title={err} advice={t('ui.the_target_file_changed_after')} />}
      {tab === 'proposals' && <>
        {!(props ?? []).length && <div className="card !p-0"><EmptyState icon="history" title={t('ui.no_proposals_yet')} why={t('ui.after_reviews_or_your_corrections')} /></div>}
        {(props ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => (
          <Section key={p.id} title={`${p.target} · ${t({ pending: '待确认', approved: '已采纳', rejected: '已拒绝', rolled_back: '已回滚' }[p.status])}`} testId={`proposal-${p.status}`}>
            <div className="flex flex-wrap gap-2" data-testid="proposal-risk">{p.auto && <span className="v9-chip on">{t('ui.auto_adopted')}</span>}<span className="v9-chip">{(p.risk ?? evolutionRisk(p.target)) === 'low' ? t('ui.low_risk') : t('ui.core_file_needs_your_confirmation')}</span></div>
            <Note>{p.reason} · {t('ui.basis')}：{p.basedOn.join('、') || t('ui.your_request')} · {p.createdAt.slice(0, 10)}</Note>
            <DiffInline a={p.before} b={p.after} />
            <div className="flex flex-wrap gap-2">
              {p.status === 'pending' && <><button type="button" className="primary" onClick={() => void decide(p, 'approve')} data-testid="proposal-approve">{t('ui.approve_2')}</button><button type="button" onClick={() => void decide(p, 'reject')}>{t('ui.reject_2')}</button></>}
              {p.status === 'approved' && <button type="button" onClick={() => void decide(p, 'rollback')} data-testid="proposal-rollback">{t('ui.roll_back_2')}</button>}
            </div>
          </Section>
        ))}
        <GroupList title={t('ui.recent_changes')}>{recent.length ? recent.map((l) => <li key={l}><div className="list-row static"><span className="row-text"><span className="row-hint !text-[14px]">{l.slice(2)}</span></span></div></li>) : <li className="p-4 text-[14px] text-muted">{t('ui.no_changes_yet')}</li>}</GroupList>
      </>}
      {tab === 'board' && <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-testid="lesson-board">
        {(['candidate', 'testing', 'effective', 'degraded'] as const).map((s) => (
          <Section key={s} title={`${t({ candidate: '候选', testing: '测试中', effective: '有效', degraded: '降级' }[s])}（${byStatus(s).length}）`}>
            {byStatus(s).map((l) => <div key={l.id} className="text-[14px]"><strong>{l.pattern}</strong><Note>n={l.sampleSize} · {t('ui.confidence')} {l.confidence}{l.control ? '' : ` · ${t('ui.no_control')}`}{l.needsReview ? ` · ${t('ui.to_review_2')}` : ''}</Note></div>)}
            {!byStatus(s).length && <Note>{t('ui.none')}</Note>}
          </Section>
        ))}
      </div>}
      {tab === 'trend' && <Section title={t('ui.revenue_trend')} testId="growth-trend">
        {days.size > 1 ? <Sparkline values={[...days].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)} w={300} h={56} label={t('ui.revenue_trend')} /> : <Note>{t('ui.at_least_two_days_of')}</Note>}
        <Note>{ct('growth.not_causal')}</Note>
      </Section>}
      {tab === 'learned' && <Section title={t('ui.what_i_learned')} testId="growth-learned">
        {byStatus('effective').length ? byStatus('effective').map((l) => <div key={l.id}><strong className="text-[14px]">{l.pattern}</strong><Note>{l.conclusion}{l.sampleSize < 10 ? ` ${t('ui.correlation_causation')}` : ''} · {t('ui.condition')}：{l.conditions}</Note></div>) : <Note>{t('ui.no_verified_lessons_yet_sample')}</Note>}
      </Section>}
    </div>
  );
}
