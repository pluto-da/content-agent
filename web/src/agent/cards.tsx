/**
 * 工具卡片（0.8.0）：统一外框 = 图标 + 工具中文名 + 状态（准备中 / 进行中 / 完成 / 失败）+ 用时；可展开查看参数与结果（密钥永不出现）。
 * 失败卡：白话原因 + 重试 + 与工具相关的“手动补充”入口。一张卡最多一个主按钮。
 */
import { useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { ROUTE_LABEL, type Route } from '../data/hotSources';
import { writePlatform } from '../data/platforms';
import { cn } from '../components/ui/utils';
import { saveProfile, type CardData } from './store';
import { toolByName } from './tools';
import { db } from '../local/db';

import { V9Body, V9_TITLES } from '../v9/cards';
export interface CardActions {
  ask: (text: string) => void;
  retry?: () => void;
  userTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  openDraft?: (id: number) => void;
}

const STATUS: Record<CardData['status'], string> = { pending: '准备中', running: '进行中', done: '完成', error: '失败' };
const ICON: Record<string, string> = { hot_fetch: 'hot', hot_analyze: 'topics', hot_patrol: 'compass', inbox_list: 'inbox', draft_write: 'create', draft_revise: 'edit', draft_format: 'wand', browser_open: 'globe', clipboard_copy: 'copy', publish_check: 'review', publish_prepare: 'send', publish_mark: 'check', metrics_record: 'analytics', metrics_summary: 'analytics', profile_update: 'user', profile_read: 'user', task_resume: 'history', skill_route: 'agent', platform_list: 'platforms', metrics_import: 'upload' };

function Btn({ children, primary, onClick, testId }: { children: ReactNode; primary?: boolean; onClick: () => void; testId?: string }) {
  return <button type="button" data-testid={testId} className={cn('!min-h-9 !px-3 !text-[14px]', primary ? 'primary' : '')} onClick={onClick}>{children}</button>;
}
function Src({ source, route }: { source: string; route?: string }) {
  return <span className="ml-1 whitespace-nowrap text-[12px] text-muted" data-testid="src-tag">· {source}{route ? `（${ROUTE_LABEL[route as Route] ?? route}）` : ''}</span>;
}

export function ToolCard({ card, actions }: { card: CardData; actions: CardActions }) {
  const [open, setOpen] = useState(false);
  // 收起时保留内容到过渡结束（高度过渡），第一次展开前不渲染
  const [ever, setEver] = useState(false);
  const spec = toolByName(card.tool);
  const label = spec?.label ?? V9_TITLES[card.tool] ?? card.tool;
  return (
    <section className="tool-card my-2 rounded-[12px] border border-line bg-surface" data-testid={`card-${card.type === 'tool' ? card.tool : card.type}`} data-status={card.status} aria-label={label}>
      <header className="flex min-h-10 items-center gap-2 border-b border-line px-3 text-[13px] text-muted">
        <Icon name={card.status === 'running' ? 'spinner' : ICON[card.tool] ?? 'agent'} size={15} className={card.status === 'running' ? 'animate-spin motion-reduce:animate-none' : ''} />
        <span className="font-medium text-fg">{label}</span>
        <span className={cn(card.status === 'error' && 'text-bad')}>{STATUS[card.status]}</span>
        {card.ms !== undefined && <span className="tabular-nums">{(card.ms / 1000).toFixed(1)} 秒</span>}
        <button type="button" className="!ml-auto !min-h-8 !border-0 !bg-transparent !px-1 !text-[13px] !text-muted" aria-expanded={open} onClick={() => { setEver(true); setOpen((x) => !x); }}>{open ? '收起' : '详情'}</button>
      </header>
      <div className="px-3 py-2 text-[14px] text-fg-2">
        {card.status === 'error' ? <ErrorBody card={card} actions={actions} /> : card.status === 'done' ? <Body card={card} actions={actions} /> : <p className="m-0 text-muted">{card.status === 'running' ? '正在执行…' : '准备参数…'}</p>}
      </div>
      <div className="card-details" data-open={open} aria-hidden={!open} inert={!open}><div>{ever && <pre className="m-0 max-h-56 overflow-auto border-t border-line bg-surface-2 px-3 py-2 text-[12px] leading-snug text-muted" data-testid="card-debug">{JSON.stringify({ args: card.args, data: card.type === 'hot' ? { sources: card.data?.sources, count: card.data?.items?.length } : card.data }, null, 2).slice(0, 4000)}</pre>}</div></div>
    </section>
  );
}

function ErrorBody({ card, actions }: { card: CardData; actions: CardActions }) {
  const [text, setText] = useState('');
  const manual = card.tool.startsWith('hot_') ? { ph: '粘贴一个你看到的热点', send: (t: string) => `这是我看到的热点：${t}。请一起分析` } : card.tool.startsWith('draft_') ? { ph: '补充一句要求或素材', send: (t: string) => t } : null;
  return (
    <div role="alert">
      <p className="m-0 text-fg"><Icon name="error" size={14} className="mr-1 inline text-bad" />{card.error?.reason ?? '没有成功'}</p>
      {card.error?.advice && <p className="m-0 mt-1 text-[13px] text-muted">{card.error.advice}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {actions.retry && <Btn primary onClick={actions.retry} testId="card-retry">重试</Btn>}
        {manual && (
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { actions.ask(manual.send(text.trim())); setText(''); } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={manual.ph} aria-label="手动补充" className="!min-h-9 min-w-0 flex-1 !text-[14px]" data-testid="manual-input" />
            <Btn onClick={() => { if (text.trim()) { actions.ask(manual.send(text.trim())); setText(''); } }}>手动补充</Btn>
          </form>
        )}
      </div>
    </div>
  );
}

function Body({ card, actions }: { card: CardData; actions: CardActions }) {
  const d = card.data ?? {};
  switch (card.type) {
    case 'hot': {
      const sources = (d.sources ?? []) as { id: string; label: string; route: string; ok: boolean; count: number; reason?: string }[];
      return (
        <div>
          <p className="m-0">共 {d.items?.length ?? 0} 条{d.cached ? '（30 分钟内的缓存）' : ''}</p>
          <ul className="m-0 mt-1 list-none p-0 text-[13px]">
            {sources.map((s) => (
              <li key={s.id} className={cn('flex gap-2 py-0.5', !s.ok && 'text-muted')} data-testid={`src-${s.id}`}>
                <span className="w-[5.5em] shrink-0 text-muted">{ROUTE_LABEL[s.route as Route]}</span>
                <span className="min-w-0 flex-1">{s.label}{s.ok ? ` ${s.count} 条` : `：${s.reason}`}</span>
              </li>
            ))}
          </ul>
          {(d.gaps ?? []).map((g: { platform: string; hint: string }) => <p key={g.platform} className="m-0 mt-1 text-[13px] text-muted" data-testid="gap">{g.hint}</p>)}
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn onClick={() => actions.ask('开始热点巡视，我自己翻看各平台热榜')}>热点巡视</Btn>
          </div>
        </div>
      );
    }
    case 'analysis': {
      const clusters = (d.clusters ?? []) as { id: string; title: string; score: number; trend: string; sources: string[]; angles: string[]; risk: string; why: string; members: { title: string; source: string; route?: string }[]; perPlatform: Record<string, { titles: string[]; risk?: string }> }[];
      return (
        <div>
          {!d.usedModel && <p className="m-0 mb-1 text-[13px] text-muted">本次为快速分析（未调用模型，只做本机去重与评分）。</p>}
          <ol className="m-0 list-none p-0">
            {clusters.slice(0, 6).map((c, i) => (
              <li key={c.id} className="border-b border-line py-2 last:border-0" data-testid="cluster">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-muted">{i + 1}</span>
                  <strong className="min-w-0 flex-1 truncate text-fg">{c.title}</strong>
                  {c.trend !== 'flat' && <span className="rounded-full border border-line px-2 text-[12px] text-accent">{c.trend === 'up' ? '升温' : '新'}</span>}
                  {c.risk !== 'ok' && <span className="text-[12px] text-warn">{c.risk === 'avoid' ? '建议不写' : '谨慎'}</span>}
                </div>
                <div className="mt-1 h-1 rounded-full bg-surface-3" aria-label={`评分 ${Math.round(c.score * 100)}`}><span className="block h-1 rounded-full bg-accent" style={{ width: `${Math.round(c.score * 100)}%` }} /></div>
                <p className="m-0 mt-1 text-[13px] text-muted">{c.members.slice(0, 2).map((m, k) => <span key={k}>{m.title}<Src source={m.source} route={m.route} />{k === 0 && c.members.length > 1 ? '；' : ''}</span>)}</p>
                {c.angles.length > 0 && <p className="m-0 mt-1 text-[13px]">角度：{c.angles.join(' / ')}</p>}
                {Object.entries(c.perPlatform).slice(0, 3).map(([p, v]) => (
                  <div key={p} className="mt-1">
                    <span className="text-[12px] text-muted">{writePlatform(p).short}</span>
                    {(v.titles ?? []).map((t) => (
                      <div key={t} className="flex items-center gap-2 text-[14px]">
                        <span className="min-w-0 flex-1">{t}</span>
                        <button type="button" className="!min-h-8 !px-2 !text-[13px]" data-testid="write-this" onClick={() => actions.ask(`把「${t}」写成${writePlatform(p).label}`)}>写这篇</button>
                      </div>
                    ))}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case 'draft': return <DraftBody d={d} actions={actions} />;
    case 'check': {
      const checks = (d.checks ?? []) as { id: string; label: string; pass: boolean; detail: string; fix?: string; blocking: boolean }[];
      return (
        <div>
          <ul className="m-0 list-none p-0">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 py-0.5 text-[14px]" data-testid={`check-${c.id}`} data-pass={c.pass}>
                <Icon name={c.pass ? 'check' : c.blocking ? 'error' : 'alert'} size={15} className={cn('mt-0.5 shrink-0', c.pass ? 'text-ok' : c.blocking ? 'text-bad' : 'text-warn')} />
                <span className="min-w-0 flex-1">{c.label}<span className="text-muted"> · {c.detail}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            {d.blocking
              ? <Btn primary testId="fix-by-advice" onClick={() => actions.ask(`按检查建议修改草稿 #${d.draftId}：${checks.filter((c) => !c.pass).map((c) => `${c.label}（${c.fix ?? c.detail}）`).join('；')}`)}>按建议修改</Btn>
              : <Btn primary testId="go-publish" onClick={() => actions.ask(`准备发布草稿 #${d.draftId}`)}>去发布</Btn>}
          </div>
        </div>
      );
    }
    case 'publish': return <PublishBody d={d} actions={actions} />;
    case 'metrics': return (
      <div>
        <p className="m-0">{d.totals.posts} 篇 · 阅读 {d.totals.views} · 赞 {d.totals.likes} · 收藏 {d.totals.collects} · 评论 {d.totals.comments}</p>
        {d.series?.length > 1 && <MiniChart values={d.series.map((s: { v: number }) => s.v)} />}
        {d.best?.length > 0 && <p className="m-0 mt-1 text-[13px]">最好：{d.best.map((b: { title: string; views: number }) => `${b.title}（${b.views}）`).join('、')}</p>}
        <ul className="m-0 mt-1 pl-5 text-[13px]">{(d.tips ?? []).map((t: string) => <li key={t}>{t}</li>)}</ul>
      </div>
    );
    case 'metrics-form': return <MetricsForm d={d} actions={actions} />;
    case 'inbox': return (
      <ul className="m-0 list-none p-0 text-[14px]">
        {(d.items ?? []).map((i: { id: number; title?: string; text?: string; url?: string; platform?: string; used?: boolean }) => <li key={i.id} className="truncate py-0.5">{i.title || i.text || i.url}<Src source={i.platform || '素材'} route="c" />{i.used ? ' · 已使用' : ''}</li>)}
        {!(d.items ?? []).length && <li className="text-muted">素材箱是空的。在平台页面点“发给 Agent”，或在官方 App 里“分享 → 超级工作台”。</li>}
      </ul>
    );
    case 'profile': return <ProfileBody d={d} />;
    case 'progress': return d.none ? <p className="m-0 text-muted">没有未完成的任务。</p> : (
      <div>
        <p className="m-0 text-fg">{d.goal}</p>
        <ul className="m-0 mt-1 list-none p-0 text-[13px]">
          {(d.steps ?? []).map((s: { name: string; status: string; summary: string }, i: number) => <li key={i} className="flex gap-2"><Icon name={s.status === 'done' ? 'check' : 'error'} size={14} className={s.status === 'done' ? 'text-ok' : 'text-bad'} />{s.name}{s.status !== 'done' ? `：${s.summary}` : ''}</li>)}
        </ul>
        {d.status !== 'done' && <div className="mt-2"><Btn primary onClick={() => actions.ask('接着上次继续')}>继续</Btn></div>}
      </div>
    );
    case 'open': return <p className="m-0">{d.opened ? `已在主区打开 ${d.label}${d.page === 'publish' ? ' · 发布页' : ''}` : `没有打开：${d.reason}`}</p>;
    case 'patrol': return <p className="m-0">已开始巡视：{(d.stops ?? []).map((s: { label: string }) => s.label).join(' → ')}。由你本人翻看，看到值得写的就点“发给 Agent”。</p>;
    case 'note': return <p className="m-0">{d.text}</p>;
    default: return <V9Body card={card} actions={actions} />;
  }
}

function MiniChart({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 240; const h = 48;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h} className="mt-1 max-w-full text-accent" role="img" aria-label="阅读趋势"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function DraftBody({ d, actions }: { d: any; actions: CardActions }) {
  const lines = String(d.body ?? '').split('\n').filter(Boolean);
  const [status, setStatus] = useState<string>(d.status);
  return (
    <div>
      {d.assistant && <p className="m-0 mb-1 text-[12px] text-muted" data-testid="draft-assistant">使用：{d.assistant}{d.assistantNote ? ` · ${d.assistantNote}` : ''}</p>}
      <strong className="text-fg">{d.title || '（无标题）'}</strong>
      <div className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed">{lines.slice(0, 5).join('\n')}{lines.length > 5 ? '\n…' : ''}</div>
      <p className="m-0 mt-1 text-[12px] text-muted">{d.platformLabel} · {[...String(d.body ?? '')].length}{d.standard?.bodyMax ? ` / ${d.standard.bodyMax}` : ''} 字{d.warnings?.length ? ` · ${d.warnings.join('；')}` : ''}</p>
      {d.previous && <details className="mt-1 text-[13px] text-muted"><summary>对比上一版</summary><div className="whitespace-pre-wrap">{String(d.previous.title ?? '')}{'\n'}{String(d.previous.body ?? '').slice(0, 300)}</div></details>}
      {d.standard && <details className="mt-1 text-[13px] text-muted"><summary>本篇标准</summary>{d.standard.titleMax ? `标题 ≤ ${d.standard.titleMax} 字；` : ''}{d.standard.bodyMax ? `正文 ≤ ${d.standard.bodyMax} 字；` : ''}{(d.standard.must ?? []).join('；')}</details>}
      <div className="mt-2 flex flex-wrap gap-2">
        {status === 'pending'
          ? <Btn primary testId="draft-approve" onClick={async () => { await db.update('drafts', d.id, { status: 'approved' }); setStatus('approved'); actions.ask(`草稿 #${d.id} 我通过了，做发布前检查`); }}>通过</Btn>
          : <Btn primary onClick={() => actions.ask(`做发布前检查：草稿 #${d.id}`)}>去发布</Btn>}
        <Btn onClick={() => actions.ask(`改写草稿 #${d.id}：更口语一点`)}>改写</Btn>
        {actions.openDraft && <Btn onClick={() => actions.openDraft!(d.id)}>展开编辑</Btn>}
      </div>
    </div>
  );
}

function PublishBody({ d, actions }: { d: any; actions: CardActions }) {
  const [state, setState] = useState<'ready' | 'done' | 'later'>('ready');
  return (
    <div>
      <p className="m-0 text-fg">{d.label}：{d.copied ? '文案已复制' : '复制失败，请手动复制'} · 已打开发布页</p>
      <ol className="m-0 mt-1 pl-5 text-[14px]">{(d.steps ?? []).map((s: string) => <li key={s}>{s}</li>)}</ol>
      {state === 'ready' ? (
        <div className="mt-2 flex gap-2">
          <Btn primary testId="published" onClick={async () => { await actions.userTool('publish_mark', { draftId: d.draftId, platform: d.platform }); setState('done'); }}>我已发布</Btn>
          <Btn onClick={() => setState('later')}>还没发</Btn>
        </div>
      ) : <p className="m-0 mt-2 text-[13px] text-muted">{state === 'done' ? '已记为“已发布”。过几天告诉我数据，我来复盘。' : '好的，草稿保留在“待发布”。'}</p>}
    </div>
  );
}

function MetricsForm({ d, actions }: { d: any; actions: CardActions }) {
  const keys: [string, string][] = [['views', '阅读'], ['likes', '赞'], ['comments', '评论'], ['collects', '收藏'], ['shares', '分享']];
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(keys.map(([k]) => [k, d.prefill?.[k] !== undefined ? String(d.prefill[k]) : ''])));
  const [saved, setSaved] = useState(!!d.saved);
  return (
    <div>
      <p className="m-0 mb-1">{d.title || `草稿 #${d.draftId}`}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {keys.map(([k, l]) => <label key={k} className="text-[12px] text-muted">{l}<input inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, '') })} className="!min-h-9 w-full !text-[14px]" /></label>)}
      </div>
      <div className="mt-2">{saved ? <span className="text-[13px] text-muted">已保存</span> : <Btn primary onClick={async () => { const args: Record<string, unknown> = { draftId: d.draftId }; for (const [k] of keys) if (v[k]) args[k] = Number(v[k]); await actions.userTool('metrics_record', args); setSaved(true); }}>保存</Btn>}</div>
    </div>
  );
}

function ProfileBody({ d }: { d: any }) {
  const [adopted, setAdopted] = useState(!!d.adopted);
  return (
    <div>
      <p className="m-0 text-[13px] text-muted">理由：{d.reason}</p>
      <ul className="m-0 mt-1 list-none p-0 text-[14px]">
        {(d.diff ?? []).map((x: { field: string; before: unknown; after: unknown }) => <li key={x.field} className="py-0.5"><span className="text-muted">{x.field}：</span><s className="text-muted">{JSON.stringify(x.before)}</s> → {JSON.stringify(x.after)}</li>)}
      </ul>
      <div className="mt-2">{adopted ? <span className="text-[13px] text-muted">已采纳，写入画像</span> : <Btn primary testId="profile-adopt" onClick={async () => { await saveProfile(d.next); setAdopted(true); }}>采纳</Btn>}</div>
    </div>
  );
}

/** L2 确认卡。 */
export function ConfirmCard({ label, args, onDecide }: { label: string; args: unknown; onDecide: (d: 'allow' | 'deny' | 'remember') => void }) {
  return (
    <section className="my-2 rounded-[12px] border border-line bg-surface px-3 py-2" data-testid="confirm-card" role="alertdialog" aria-label={`确认：${label}`}>
      <p className="m-0 text-[14px] text-fg">Agent 想要「{label}」，会修改你本机已有的数据。允许吗？</p>
      <pre className="m-0 mt-1 max-h-24 overflow-auto text-[12px] text-muted">{JSON.stringify(args)}</pre>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="primary !min-h-9" data-testid="confirm-allow" onClick={() => onDecide('allow')}>允许</button>
        <button type="button" className="!min-h-9" data-testid="confirm-deny" onClick={() => onDecide('deny')}>拒绝</button>
        <button type="button" className="!min-h-9" data-testid="confirm-remember" onClick={() => onDecide('remember')}>允许并记住此类</button>
      </div>
    </section>
  );
}
