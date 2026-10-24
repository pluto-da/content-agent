/**
 * Agent 对话面板（0.8.0）：头部（会话标题 / 新会话 / 会话列表 / 模型胶囊 / 收起）+ 标签（对话 | 草稿 | 素材）+ 消息流（逐字流式、思考折叠、工具卡片）+ 输入区。
 * variant：full = 首页全宽（电脑带会话列表）；panel = 平台旁的右栏；sheet = 手机 / 平板竖屏底部抽屉。
 */
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { cn } from '../components/ui/utils';
import { Drawer, DrawerContent, DrawerItem } from '../components/ui/drawer';
import type { Layout } from '../nav';
import { presetOf } from '../data/providers';
import { center } from '../data/platforms';
import { checkState, configuredProviders, resolveProvider } from '../local/store';
import { useModels } from '../local/useModels';
import { useStoreChange, useStoreValue } from '../local/useStore';
import { SkeletonLines } from '../ui';
import type { ProviderConfig } from '../local/llm';
import type { AgentEvent } from '../agent/events';
import { runTurnV9 } from '../v9/engine';
import { ThinkingToggle } from '../v11/ThinkingToggle';
import { ConfirmCard, ToolCard, type CardActions } from '../agent/cards';
import { addInbox, bus, createConversation, deleteConversation, deleteInbox, listConversations, listInbox, listMessages, updateConversation, type CardData, type Conversation, type InboxItem, type StoredMsg } from '../agent/store';
import { toolByName } from '../agent/tools';
import { computeOverview, type Overview } from '../agent/overview';
import { overlayManager } from '../browser/browserHost';
import { AtChips, AtMenu, atQuery, pickLabel, type AtPick } from '../v10/AtMenu';
import { useModelsV3 } from '../pages/me/v9/common';
import { CAPS, coverage, displayModel } from '@content-agent/shared';
import { tr } from '../i18n';
import { CommandBar } from '../v12/CommandBar';
import { handleMention, isPausedNow } from '../v12/store';
import { handleGroupCommand } from '../v13/store';

const Write = lazy(() => import('../pages/write').then((m) => ({ default: m.Write })));

/** 1.1.0：第二个起手式改为自由创作（不预设平台）；文案走 i18n id。 */
export const STARTERS = ['ui.starter_hot', 'ui.starter_free_write', 'ui.starter_metrics'] as const;
export const DEFINITION = '一个 Agent 帮你管理各大平台：找热点、写内容、准备发布、记录效果。发布由你本人点击。';

/* ---------- 极简 Markdown（不使用 innerHTML） ---------- */
function inline(s: string, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${k}b${i}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={`${k}c${i}`}>{t.slice(1, -1)}</code>);
    else { const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(t)!; out.push(<a key={`${k}a${i}`} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a>); }
    last = m.index + t.length; i++;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  const flush = () => { if (list) { const L = list.ordered ? 'ol' : 'ul'; blocks.push(<L key={`l${blocks.length}`} className="my-1 pl-5">{list.items.map((x, i) => <li key={i}>{inline(x, `li${blocks.length}-${i}`)}</li>)}</L>); list = null; } };
  lines.forEach((ln, idx) => {
    if (ln.startsWith('```')) { if (code) { blocks.push(<pre key={`p${idx}`} className="my-1 overflow-auto rounded-md bg-surface-2 p-2 text-[13px]">{code.join('\n')}</pre>); code = null; } else { flush(); code = []; } return; }
    if (code) { code.push(ln); return; }
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(ln);
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(ln);
    if (h) { flush(); blocks.push(<p key={idx} className="my-1 font-semibold text-fg">{inline(h[2]!, `h${idx}`)}</p>); }
    else if (ul || ol) { const ordered = !!ol; if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push((ul ?? ol)![1]!); }
    else if (!ln.trim()) flush();
    else { flush(); blocks.push(<p key={idx} className="my-1">{inline(ln, `p${idx}`)}</p>); }
  });
  if (code) blocks.push(<pre key="pend">{(code as string[]).join('\n')}</pre>);
  flush();
  return <>{blocks}</>;
}

/* ---------- 会话状态 ---------- */
interface Pending { tool: string; label: string; args: unknown; rememberable?: boolean; spend?: boolean; estCost?: number | null; resolve: (d: 'allow' | 'deny' | 'remember') => void }
export function useAgent() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [cid, setCid] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<StoredMsg[]>([]);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  // 0.8.1：Agent 面板常驻不卸载，模型在“我的→模型”里保存后必须重新读取，否则会一直显示“未连接模型”
  const [models] = useModels();
  const [pick, setPick] = useState<{ providerId: string; model: string } | null>(null);
  const [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null);
  const refreshConvs = useCallback(async () => setConvs(await listConversations()), []);
  useEffect(() => { void refreshConvs(); }, [refreshConvs]);
  // 0.8.1：会话可能在别处新建（分享 / 发给 Agent / 平台绑定），会话列表跟着变
  useStoreChange(['conversations'], () => void refreshConvs());
  const runningRef = useRef(false);
  const reloadMsgs = useCallback(() => { if (runningRef.current) return; if (cid) void listMessages(cid).then((m) => { if (!runningRef.current) setMsgs(m); }); else setMsgs([]); }, [cid]);
  useEffect(reloadMsgs, [reloadMsgs]);
  // 运行中由流式事件维护消息，避免库里的半截内容覆盖屏幕上的增量；空闲时外部写入（如分享进来的素材消息）立即显示
  useStoreChange(['messages'], reloadMsgs);
  const cfg = useMemo<ProviderConfig | null>(() => (models ? resolveProvider(models, pick ?? undefined) : null), [models, pick]);
  const cfgState = cfg ? checkState(cfg) : null;

  const onEvent = useCallback((e: AgentEvent) => {
    if (e.type === 'message') setMsgs((m) => { const i = m.findIndex((x) => x.id === e.msg.id); if (i >= 0) { const n = [...m]; n[i] = { ...n[i]!, ...e.msg, cards: e.msg.cards ?? n[i]!.cards }; return n; } return [...m, e.msg]; });
    else if (e.type === 'delta') setMsgs((m) => m.map((x) => (x.id === e.id ? { ...x, content: x.content + e.content, reasoning: (x.reasoning ?? '') + e.reasoning, meta: { ...(x.meta ?? {}), streaming: true } } : x)));
    else if (e.type === 'card') setMsgs((m) => m.map((x) => { if (x.id !== e.id) return x; const cards = [...(x.cards ?? [])]; cards[e.index] = e.card; return { ...x, cards }; }));
    else if (e.type === 'confirm') setConfirm({ tool: e.tool, label: e.label, args: e.args, rememberable: e.rememberable, spend: e.spend, estCost: e.estCost, resolve: e.resolve });
    else if (e.type === 'mode') setNotice('这个模型不支持原生工具调用，已自动切换为兼容模式（JSON 指令）');
  }, []);

  const send = useCallback(async (text: string, at?: AtPick[]) => {
    const t = text.trim();
    if (!t || running || runningRef.current) return;
    if (isPausedNow()) { setNotice(tr('ui.v12_paused_send_blocked')); return; }
    if (!cfg) { setNotice(models?.providers.length ? '模型还没填 Key：到“我的 → 模型”填好 Key 再发' : '先连接一个模型，Agent 才能工作'); return; }
    // 0.8.1：运行状态用 ref 兜底；任何一步抛错都要复位“停止”按钮并用白话说明，不能卡在运行中或静默失败
    runningRef.current = true;
    setRunning(true);
    setNotice('');
    try {
      let id = cid;
      if (!id) { const c = await createConversation(); id = c.id; setCid(id); setMsgs([]); }
      abort.current = new AbortController();
      if (pick) await updateConversation(id, { model: `${cfg.label} · ${cfg.model}` });
      // 1.2.0：@子Agent 名 → 直接交给该子 Agent（回复写明交给了谁、花了多少、结果在哪）
      if (await handleGroupCommand(id, t).catch(() => false)) { setMsgs(await listMessages(id)); void refreshConvs(); return; }
      if (t.startsWith('@') && await handleMention(id, t)) { setMsgs(await listMessages(id)); void refreshConvs(); return; }
      // 0.11.0：0.8 循环已删除，agent.runtime.v9 开关到期，一律走 v9 运行时（ADR-005 重审）
      await runTurnV9({ conversationId: id, text: t, cfg, signal: abort.current.signal, ...(at?.length ? { override: Object.fromEntries(at.map((p) => [p.role, p.target])), overrideLabels: at.map(pickLabel) } : {}), onEvent: (e) => { onEvent(e); if (e.type === 'done') { setMsgs((m) => m.map((x) => ({ ...x, meta: { ...(x.meta ?? {}), streaming: false }, stopped: e.stopped && x.meta?.streaming ? true : x.stopped }))); if (e.error && cfgState !== 'ok') setNotice(`发送失败：${e.error}。这个模型还没测试通过，可到“我的 → 模型”点“测试连接”看具体原因`); void refreshConvs(); } } });
    } catch (e) {
      setNotice(`发送失败：${e instanceof Error ? e.message : String(e)}。可以再发一次，或到“我的 → 模型”检查设置`);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [cfg, cfgState, cid, models, onEvent, pick, refreshConvs, running]);

  // 首启引导第 3 步：进入首页后真实发送第一句话
  useEffect(() => {
    const first = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ca.firstAsk') : null;
    if (first && cfg && !running) { sessionStorage.removeItem('ca.firstAsk'); void send(first); }
  }, [cfg, running, send]);
  const stop = useCallback(() => abort.current?.abort(), []);
  // 1.2.0：全部暂停 → 立即停止当前对话运行
  useEffect(() => { const on = () => abort.current?.abort(); window.addEventListener('ca:pause-all', on); return () => window.removeEventListener('ca:pause-all', on); }, []);
  // 恢复后清掉“已全部暂停”的提示
  useEffect(() => { const on = () => setNotice((n) => (n === tr('ui.v12_paused_send_blocked') ? '' : n)); window.addEventListener('ca:resume-all', on); return () => window.removeEventListener('ca:resume-all', on); }, []);
  const userTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const spec = toolByName(name);
    if (!spec) return null;
    return spec.run(args, { conversationId: cid ?? 0, cfg });
  }, [cfg, cid]);
  return { convs, cid, setCid, msgs, running, send, stop, confirm, setConfirm, cfg, cfgState, models, pick, setPick, notice, setNotice, refreshConvs, userTool };
}
export type AgentState = ReturnType<typeof useAgent>;

/* ---------- 总览卡 ---------- */
function OverviewCard({ onOpen, onResume }: { onOpen: (p: string) => void; onResume: () => void }) {
  const o = useStoreValue<Overview>(computeOverview, ['drafts', 'inbox', 'tasks', 'kv:prefs', 'kv:hot.cache']).value ?? null;
  if (!o || (!o.rows.length && !o.resume)) return null;
  return (
    <section className="mb-4 rounded-[12px] border border-line bg-surface" data-testid="overview" aria-label={tr('ui.workspace_overview')}>
      {o.resume && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[14px]">
          <Icon name="history" size={15} className="text-muted" />
          <span className="min-w-0 flex-1 truncate">上次的任务停在第 {o.resume.steps.length} 步：{o.resume.steps.at(-1)?.name}</span>
          <button type="button" className="!min-h-9 !px-3 !text-[14px]" data-testid="resume" onClick={onResume}>{tr('ui.continue_from_last_time')}</button>
        </div>
      )}
      <ul className="m-0 list-none p-0">
        {o.rows.map((r) => (
          <li key={r.platform}>
            <button type="button" className="!flex !min-h-11 w-full !justify-start gap-3 !rounded-none !border-0 !bg-transparent !px-3 text-left !text-[14px] !font-normal" onClick={() => onOpen(r.platform)}>
              <span className="w-14 shrink-0 font-medium text-fg">{r.label}</span>
              {(() => { const line = `${tr(r.stage)} · ${tr('ui.overview_pending').replace('{n}', String(r.pendingPublish))}${r.inbox ? ` · ${tr('ui.overview_inbox').replace('{n}', String(r.inbox))}` : ''} · ${tr(r.hotToday ? 'ui.overview_hot_updated' : 'ui.overview_hot_stale')}${r.lastOpen ? ` · ${tr('ui.overview_last').replace('{t}', r.lastOpen.slice(5, 16).replace('T', ' '))}` : ''}`; return <span className="min-w-0 flex-1 truncate text-muted" title={`${r.label} · ${line}`}>{line}</span>; })()}
              <Icon name="chevronRight" size={16} className="text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- 面板 ---------- */
export function AgentPanel({ a, variant, lay, go, onOpenPlatform, onCollapse, route, onBackToWeb }: {
  a: AgentState; variant: 'full' | 'panel' | 'sheet'; lay: Layout; go: (to: string) => void; onOpenPlatform: (p: string) => void;
  onCollapse?: () => void; route: { sub: string; id: string | null; query?: Record<string, string> }; onBackToWeb?: () => void;
}) {
  const [tab, setTab] = useState<'chat' | 'drafts' | 'inbox'>(route.sub === 'drafts' ? 'drafts' : route.sub === 'inbox' ? 'inbox' : 'chat');
  useEffect(() => { setTab(route.sub === 'drafts' ? 'drafts' : route.sub === 'inbox' ? 'inbox' : 'chat'); }, [route.sub]);
  const [text, setText] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [delId, setDelId] = useState<number | null>(null);
  const [atPicks, setAtPicks] = useState<AtPick[]>([]);
  const [atQ, setAtQ] = useState<string | null>(null);
  const v3 = useModelsV3().data;
  const endRef = useRef<HTMLDivElement>(null);
  const showSideList = variant === 'full' && lay === 'desktop';
  const conv = a.convs.find((c) => c.id === a.cid);
  // 旧路由 #topics / #results → 预填起手式（不自动发送）
  useEffect(() => {
    const ask = route.query?.ask;
    if (ask === 'hot') setText('看看今天的热点');
    else if (ask === 'metrics') setText('这周数据怎么样');
    else if (ask === 'publish' && /^\d+$/.test(route.query?.draft ?? '')) setText(`${tr('ui.prepare_publish_draft')} #${route.query!.draft}`); // 1.1.0：编辑器“去发布”→ 预填，由用户发送
  }, [route.query?.ask, route.query?.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [a.msgs.length, a.running]);
  // 抽屉 / 下拉打开时收起原生网页（避免被原生视图挡住）
  useEffect(() => (sessionsOpen || modelOpen || plusOpen || delId !== null ? overlayManager.push() : undefined), [sessionsOpen, modelOpen, plusOpen, delId]);

  const actions: CardActions = { ask: (t) => void a.send(t), userTool: a.userTool, openDraft: (id) => go(`agent/drafts/${id}`) };
  const submit = () => { const t = text; const at = atPicks; setText(''); setAtPicks([]); setAtQ(null); void a.send(t, at); };
  const onAtPick = (p: AtPick) => { setAtPicks((l) => [...l.filter((x) => x.role !== p.role), p]); setText((x) => { const q = atQuery(x); return q ? x.slice(0, q.start) : x; }); setAtQ(null); };
  const visible = a.msgs.filter((m) => m.role !== 'tool' && !m.meta?.toolResult && !m.meta?.hidden);
  const connected = a.models ? configuredProviders(a.models) : [];

  const header = (
    <header className="flex min-h-12 shrink-0 items-center gap-1 border-b border-line px-2" data-testid="agent-header">
      {variant === 'sheet' && onBackToWeb && <button type="button" className="!min-h-11 !border-0 !bg-transparent !px-2 !text-[14px]" onClick={onBackToWeb} data-testid="back-to-web"><Icon name="chevronDown" size={16} /> {tr('ui.back_to_web_page')}</button>}
      {renaming && conv ? (
        <input autoFocus defaultValue={conv.title} aria-label={tr('ui.conversation_title')} className="!min-h-9 min-w-0 flex-1 !text-[15px]" onBlur={async (e) => { await updateConversation(conv.id, { title: e.target.value.trim().slice(0, 30) || conv.title }); setRenaming(false); void a.refreshConvs(); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      ) : (
        <button type="button" className="!min-h-11 min-w-0 flex-1 !justify-start !border-0 !bg-transparent !px-2 !text-[15px] !font-semibold" onClick={() => conv && setRenaming(true)} title={tr('ui.conversation_title_tap_to_rename')} data-testid="conv-title">
          <span className="truncate" title={conv?.title ?? (variant === 'full' ? tr('ui.super_workbench') : 'Agent')}>{conv?.title ?? (variant === 'full' ? tr('ui.super_workbench') : 'Agent')}</span>
        </button>
      )}
      <button type="button" title={a.cfg ? `${tr('ui.switch_model')}: ${presetOf(a.cfg.id)?.label ?? a.cfg.label} · ${a.cfg.model}` : tr('ui.switch_model')} data-testid="model-pill" className="!min-h-9 max-w-[42%] !rounded-full !px-3 !text-[13px] !font-normal" onClick={() => setModelOpen(true)}>
        <span className="shrink-0 text-muted max-[420px]:hidden" data-testid="model-pill-role">{tr('ui.text_2')}</span>{a.models === null ? <span className="skeleton inline-block h-3 w-24" aria-label={tr('ui.loading_models')} /> : <span key={a.cfg ? `${a.cfg.id}:${a.cfg.model}` : 'none'} className="anim-swap truncate" data-testid="model-pill-label">{a.cfg ? `${presetOf(a.cfg.id)?.label ?? a.cfg.label} · ${a.cfg.model}` : tr('ui.no_model_connected')}</span>}{a.cfgState && a.cfgState !== 'ok' && <><span className="shrink-0 text-[12px] text-muted max-[420px]:hidden" data-testid="model-untested">{tr(a.cfgState === 'failed' ? 'ui.test_failed' : 'ui.model_untested')}</span><span className="hidden h-2 w-2 shrink-0 rounded-full bg-[var(--warn,#d97706)] max-[420px]:inline-block" role="img" aria-label={tr(a.cfgState === 'failed' ? 'ui.test_failed' : 'ui.model_untested')} /></>}<Icon name="chevronDown" size={14} />
      </button>
      <button type="button" aria-label={tr('ui.new_conversation')} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => { a.setCid(null); setTab('chat'); }}><Icon name="newChat" size={18} /></button>
      {!showSideList && <button type="button" aria-label={tr('ui.conversations')} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => setSessionsOpen(true)}><Icon name="history" size={18} /></button>}
      {onCollapse && <button type="button" aria-label={tr('ui.collapse_agent_panel')} className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={onCollapse}><Icon name="panelRight" size={18} /></button>}
    </header>
  );

  const tabs = (
    <div role="tablist" aria-label="Agent" className="flex shrink-0 gap-1 border-b border-line px-2">
      {([['chat', '对话'], ['drafts', '草稿'], ['inbox', '素材']] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} type="button" className={cn('!min-h-11 !rounded-none !border-0 !border-b-2 !bg-transparent !px-3 !text-[14px]', tab === k ? '!border-b-fg !font-semibold !text-fg' : '!border-b-transparent !font-normal !text-muted')} onClick={() => { setTab(k); if (variant === 'full') go(k === 'chat' ? 'agent' : `agent/${k}`); }}>{tr(l)}</button>
      ))}
    </div>
  );

  const empty = (
    <div className="anim-fade mx-auto w-full max-w-[720px] px-4 pt-6" data-testid="agent-empty">
      {!connected.length ? (
        <div className="py-8 text-center" data-testid="no-model">
          <h2 className="text-[22px]">{tr('ui.super_workbench')}</h2>
          <p className="mt-2 text-muted">{tr('ui.connect_a_model_first_so')}</p>
          <button type="button" className="primary mt-4" onClick={() => go('me/models')}>{tr('ui.connect')}</button>
        </div>
      ) : (
        <>
          <OverviewCard onOpen={onOpenPlatform} onResume={() => void a.send('接着上次继续')} />
          <h2 className="text-[22px]" data-testid="hero-title">{tr('ui.super_workbench')}</h2>
          <p className="mt-1 text-[15px] text-fg-2" data-testid="definition">{tr('ui.definition_line')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS.map((s) => <button key={s} type="button" className="!min-h-10 !rounded-full !px-4 !text-[14px] !font-normal" data-testid="starter" onClick={() => void a.send(tr(s))}>{tr(s)}</button>)}
          </div>
        </>
      )}
    </div>
  );

  const thread = (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-1 px-3 py-3" data-testid="thread">
      {visible.map((m) => (
        <Fragment key={m.id}>
          {m.role === 'user' ? (
            <div className="ml-auto flex max-w-[85%] flex-col items-end">
              {Array.isArray(m.meta?.atOverride) && (m.meta!.atOverride as string[]).length > 0 && <p className="m-0 mb-0.5 text-[12px] text-muted" data-testid="msg-at-label">本轮指定：{(m.meta!.atOverride as string[]).join('；')}</p>}
              <div className="anim-msg whitespace-pre-wrap rounded-[12px] bg-surface-2 px-3 py-2 text-[15px] text-fg" data-testid="msg-user">{m.content}</div>
            </div>
          ) : (
            <div className="anim-msg max-w-full text-[15px] leading-relaxed text-fg" data-testid="msg-agent" data-streamed={m.streamed ? 'true' : 'false'}>
              {m.reasoning && <details className="mb-1 text-[13px] text-muted"><summary>{tr('ui.thought')}</summary><div className="whitespace-pre-wrap">{m.reasoning.slice(0, 3000)}</div></details>}
              {m.content && <div className={cn(!!m.meta?.error && 'text-bad')}><Markdown text={m.content} /></div>}
              {!!m.meta?.streaming && <span className="stream-caret" aria-hidden="true" />}
              {!m.content && !m.cards?.length && a.running && m.id === visible.at(-1)?.id && <p className="m-0 text-[14px] text-muted" data-testid="generating">{tr('ui.generating_2')}</p>}
              {m.stopped && <p className="m-0 text-[12px] text-muted">{tr('ui.stopped')}</p>}
              {(m.cards ?? []).map((c: CardData, i) => <ToolCard key={i} card={c} actions={{ ...actions, retry: c.status === 'error' ? () => void a.send(`重试：${toolByName(c.tool)?.label ?? c.tool}`) : undefined }} />)}
              {m.model && !m.meta?.error && (m.content || m.cards?.length) ? <p className="m-0 mt-0.5 text-[12px] text-faint">{m.model}{m.streamed === false ? ' · 整段返回' : ''}</p> : null}
            </div>
          )}
        </Fragment>
      ))}
      {a.confirm && <ConfirmCard label={a.confirm.label} args={a.confirm.args} rememberable={a.confirm.rememberable !== false} spend={a.confirm.spend} estCost={a.confirm.estCost} onDecide={(d) => { a.confirm!.resolve(d); a.setConfirm(null); }} />}
      <div ref={endRef} />
    </div>
  );

  const input = (
    <div className="shrink-0 border-t border-line bg-canvas px-3 pt-2 pb-[calc(8px+var(--sa-bottom))]">
      {a.notice && <p className="m-0 mb-1 text-[13px] text-muted" role="status">{a.notice} <button type="button" className="!min-h-0 !border-0 !bg-transparent !p-0 !text-[13px] !text-accent" onClick={() => a.setNotice('')}>{tr('ui.got_it')}</button></p>}
      <AtChips picks={atPicks} onRemove={(r) => setAtPicks((l) => l.filter((x) => x.role !== r))} />
      <div className="relative flex items-end gap-2">
        {atQ !== null && <AtMenu state={v3} q={atQ} onPick={onAtPick} onClose={() => setAtQ(null)} />}
        <button type="button" aria-label={tr('ui.attachment')} className="!min-h-11 !min-w-11 !rounded-full !p-0" onClick={() => setPlusOpen(true)}><Icon name="plus" size={18} /></button>
        <ThinkingToggle />
        <textarea value={text} rows={1} placeholder={tr('ui.say_something_to_the_agent_2')} aria-label={tr('ui.say_something_to_the_agent')} data-testid="agent-input"
          className="!min-h-11 max-h-40 min-w-0 flex-1 resize-none !py-2.5 !text-[15px]"
          onChange={(e) => { setText(e.target.value); const q = atQuery(e.target.value, e.target.selectionStart ?? e.target.value.length); setAtQ(q ? q.q : null); }}
          onKeyDown={(e) => { if (e.key === 'Escape' && atQ !== null) { setAtQ(null); return; } if (e.key === 'Enter' && !e.shiftKey && lay !== 'phone' && atQ === null) { e.preventDefault(); submit(); } }} />
        {a.running
          ? <button type="button" aria-label={tr('ui.stop')} data-testid="stop" className="!min-h-11 !min-w-11 !rounded-full !p-0" onClick={a.stop}><Icon name="stop" size={16} /></button>
          : <button type="button" aria-label={tr('ui.send')} data-testid="send" className="primary !min-h-11 !min-w-11 !rounded-full !p-0" disabled={!text.trim()} onClick={submit}><Icon name="sendUp" size={18} /></button>}
      </div>
    </div>
  );

  const body = tab === 'chat' ? (visible.length ? thread : empty)
    : tab === 'drafts' ? <Suspense fallback={<div className="p-4" aria-label={tr('ui.loading')}><SkeletonLines lines={4} /></div>}><Write filter={route.query?.filter ?? 'all'} id={route.id} go={go} lay={variant === 'full' ? lay : 'phone'} /></Suspense>
    : <InboxTab onUse={(i) => { setTab('chat'); void a.send(`结合这条素材：${i.title || i.text || i.url}`); }} />;

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-1 bg-canvas', variant !== 'full' && 'flex-col')} data-testid={`agent-${variant}`}>
      {showSideList && (
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-line" aria-label={tr('ui.conversations')} data-testid="session-list">
          <div className="flex min-h-12 items-center px-3 text-[13px] text-muted">{tr('ui.conversation')}</div>
          <SessionList a={a} onPick={() => setTab('chat')} onDelete={setDelId} />
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        {variant === 'full' && <CommandBar go={go} />}
        {tabs}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-scroll"><div key={tab} className="anim-page">{body}</div></div>
        {tab === 'chat' && input}
      </div>

      <Drawer open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DrawerContent title={tr('ui.conversation')}>
          <SessionList a={a} onPick={() => { setSessionsOpen(false); setTab('chat'); }} onDelete={(id) => { setSessionsOpen(false); setDelId(id); }} />
        </DrawerContent>
      </Drawer>
      <Drawer open={modelOpen} onOpenChange={setModelOpen}>
        <DrawerContent title={tr('ui.switch_model')} description="只影响之后的回复；每条消息会标注所用模型">
          {connected.flatMap((p) => {
            const models = [...new Set([p.model, ...(presetOf(p.id)?.models ?? [])].filter(Boolean))];
            const base = presetOf(p.id)?.prices?.[models[0]!]?.input;
            return models.map((m) => {
              const price = presetOf(p.id)?.prices?.[m]?.input;
              return <DrawerItem key={`${p.id}:${m}`} label={`${presetOf(p.id)?.label ?? p.label} · ${m}`} hint={price && base ? `单价 ×${(price / base).toFixed(price / base >= 10 ? 0 : 1)}${p.toolMode ? ` · 工具调用：${p.toolMode === 'json' ? '兼容模式' : '原生'}` : ''}` : p.toolMode === 'json' ? '工具调用：兼容模式' : undefined} onClick={() => { a.setPick({ providerId: p.id, model: m }); setModelOpen(false); }} />;
            });
          })}
          {v3 && (() => { const cov = coverage(v3); const lit = CAPS.filter((c) => cov[c.id]); return lit.length > 0 && (
            <div className="px-3 pt-2 pb-1" data-testid="role-bindings">
              <p className="m-0 text-[12px] font-semibold text-muted">{tr('ui.current_model_per_capability_in')}</p>
              <ul className="m-0 list-none p-0 text-[13px] text-fg-2">{lit.map((c) => <li key={c.id} className="py-0.5">{tr(c.label)}：{displayModel(cov[c.id]!.entry)} · {cov[c.id]!.account.label}</li>)}</ul>
            </div>
          ); })()}
          <DrawerItem label="管理模型" onClick={() => { setModelOpen(false); go('me/models'); }} />
        </DrawerContent>
      </Drawer>
      <Drawer open={plusOpen} onOpenChange={setPlusOpen}>
        <DrawerContent title={tr('ui.attachment')}>
          <DrawerItem label="当前网页" hint="发送当前平台页面的网址与标题（不读页面内容）" onClick={() => { setPlusOpen(false); window.dispatchEvent(new CustomEvent('ca:send-current-page')); }} />
          <DrawerItem label="素材箱里的一条" onClick={() => { setPlusOpen(false); setTab('inbox'); }} />
          <DrawerItem label="粘贴文本" onClick={async () => { setPlusOpen(false); try { const t = await navigator.clipboard.readText(); if (t) setText((x) => `${x}${x ? '\n' : ''}${t}`); } catch { a.setNotice('读取剪贴板失败，请在输入框长按粘贴'); } }} />
          <DrawerItem label="导入数据（平台导出的 CSV）" onClick={() => { setPlusOpen(false); go('me/backup'); }} />
        </DrawerContent>
      </Drawer>
      <Drawer open={delId !== null} onOpenChange={(o) => { if (!o) setDelId(null); }}>
        <DrawerContent title={tr('ui.delete_this_conversation')} description="会话里的消息会一起删除，不能恢复">
          <DrawerItem label="删除" tone="danger" onClick={async () => { const id = delId!; setDelId(null); await deleteConversation(id); if (a.cid === id) a.setCid(null); void a.refreshConvs(); }} />
          <DrawerItem label="取消" onClick={() => setDelId(null)} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function SessionList({ a, onPick, onDelete }: { a: AgentState; onPick: () => void; onDelete: (id: number) => void }) {
  const [q, setQ] = useState('');
  const shown = a.convs.filter((c) => !q || c.title.includes(q));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('ui.search_conversation_titles')} aria-label={tr('ui.search_conversations')} className="!mx-2 !mb-2 !w-[calc(100%-16px)] !min-h-9 !text-[14px]" />
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 px-1">
        {shown.map((c) => (
          <li key={c.id} className={cn('group flex items-center rounded-[10px]', c.id === a.cid && 'bg-side-active')}>
            <button type="button" className="!min-h-11 min-w-0 flex-1 !justify-start !border-0 !bg-transparent !px-2 text-left !text-[14px] !font-normal" onClick={() => { a.setCid(c.id); onPick(); }}>
              {c.pinned && <Icon name="pin" size={13} className="mr-1 text-muted" />}<span className="truncate">{c.title}</span>
            </button>
            <button type="button" aria-label={c.pinned ? '取消置顶' : '置顶'} className="!min-h-11 !min-w-9 !border-0 !bg-transparent !p-0 !text-muted" onClick={async () => { await updateConversation(c.id, { pinned: !c.pinned }); void a.refreshConvs(); }}><Icon name="pin" size={14} /></button>
            <button type="button" aria-label={tr('ui.delete_conversation')} className="!min-h-11 !min-w-9 !border-0 !bg-transparent !p-0 !text-muted" onClick={() => onDelete(c.id)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
        {!shown.length && <li className="px-3 py-4 text-[13px] text-muted">{tr('ui.no_conversations_yet')}</li>}
      </ul>
    </div>
  );
}

function InboxTab({ onUse }: { onUse: (i: InboxItem) => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const load = useCallback(() => void listInbox().then(setItems), []);
  useEffect(() => { load(); return bus.on((e) => { if (e.type === 'inbox-changed') load(); }); }, [load]);
  useStoreChange(['inbox'], load);
  const [paste, setPaste] = useState('');
  return (
    <div className="mx-auto w-full max-w-[760px] p-3" data-testid="inbox-tab">
      <form className="mb-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (paste.trim()) { await addInbox({ kind: /^https?:\/\//.test(paste.trim()) ? 'url' : 'text', text: paste.trim(), url: /^https?:\/\//.test(paste.trim()) ? paste.trim() : undefined, channel: 'paste' }); setPaste(''); } }}>
        <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={tr('ui.paste_text_or_a_link')} aria-label={tr('ui.paste_into_asset_box')} className="!min-h-10 min-w-0 flex-1 !text-[14px]" />
        <button type="submit" className="!min-h-10">{tr('ui.save_2')}</button>
      </form>
      <ul className="m-0 list-none p-0">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-2 border-b border-line py-2 text-[14px]">
            <div className="min-w-0 flex-1">
              <p className="m-0 line-clamp-2 text-fg">{i.title || i.text || i.url}</p>
              <p className="m-0 text-[12px] text-muted">{i.platform ? `${center(i.platform)?.label ?? i.platform} · ` : ''}{i.channel === 'share' ? '系统分享' : i.channel === 'process_text' ? '选中文字' : i.channel === 'toolbar' ? '工具栏' : i.channel === 'patrol' ? '巡视' : '粘贴'} · {i.createdAt.slice(5, 16).replace('T', ' ')}{i.used ? ' · 已使用' : ''}</p>
            </div>
            <button type="button" className="!min-h-9 !px-3 !text-[13px]" onClick={() => onUse(i)}>{tr('ui.use_this_one')}</button>
            <button type="button" aria-label={tr('ui.delete_asset')} className="!min-h-9 !min-w-9 !border-0 !bg-transparent !p-0 !text-muted" onClick={() => void deleteInbox(i.id)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
        {!items.length && <li className="py-6 text-center text-[14px] text-muted">{tr('ui.the_asset_box_is_empty_2')}</li>}
      </ul>
    </div>
  );
}
