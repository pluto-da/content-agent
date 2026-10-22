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
import { getModels, type ModelsState } from '../local/store';
import type { ProviderConfig } from '../local/llm';
import { runTurn, type AgentEvent } from '../agent/loop';
import { ConfirmCard, ToolCard, type CardActions } from '../agent/cards';
import { addInbox, bus, createConversation, deleteConversation, deleteInbox, listConversations, listInbox, listMessages, updateConversation, type CardData, type Conversation, type InboxItem, type StoredMsg } from '../agent/store';
import { toolByName } from '../agent/tools';
import { computeOverview, type Overview } from '../agent/overview';
import { overlayManager } from '../browser/browserHost';

const Write = lazy(() => import('../pages/write').then((m) => ({ default: m.Write })));

export const STARTERS = ['看看今天各平台热点', '把一个想法写成小红书笔记', '这周数据怎么样'];
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
interface Pending { tool: string; label: string; args: unknown; resolve: (d: 'allow' | 'deny' | 'remember') => void }
export function useAgent() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [cid, setCid] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<StoredMsg[]>([]);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [models, setModels] = useState<ModelsState | null>(null);
  const [pick, setPick] = useState<{ providerId: string; model: string } | null>(null);
  const [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null);
  const refreshConvs = useCallback(async () => setConvs(await listConversations()), []);
  useEffect(() => { void refreshConvs(); void getModels().then(setModels); }, [refreshConvs]);
  useEffect(() => { if (cid) void listMessages(cid).then(setMsgs); else setMsgs([]); }, [cid]);
  const cfg = useMemo<ProviderConfig | null>(() => {
    if (!models) return null;
    const p = (pick && models.providers.find((x) => x.id === pick.providerId)) || models.providers.find((x) => x.id === models.defaultProvider) || models.providers.find((x) => x.check?.ok) || null;
    return p ? { ...p, model: pick?.providerId === p.id ? pick.model : p.model } : null;
  }, [models, pick]);

  const onEvent = useCallback((e: AgentEvent) => {
    if (e.type === 'message') setMsgs((m) => { const i = m.findIndex((x) => x.id === e.msg.id); if (i >= 0) { const n = [...m]; n[i] = { ...n[i]!, ...e.msg, cards: e.msg.cards ?? n[i]!.cards }; return n; } return [...m, e.msg]; });
    else if (e.type === 'delta') setMsgs((m) => m.map((x) => (x.id === e.id ? { ...x, content: x.content + e.content, reasoning: (x.reasoning ?? '') + e.reasoning, meta: { ...(x.meta ?? {}), streaming: true } } : x)));
    else if (e.type === 'card') setMsgs((m) => m.map((x) => { if (x.id !== e.id) return x; const cards = [...(x.cards ?? [])]; cards[e.index] = e.card; return { ...x, cards }; }));
    else if (e.type === 'confirm') setConfirm({ tool: e.tool, label: e.label, args: e.args, resolve: e.resolve });
    else if (e.type === 'mode') setNotice('这个模型不支持原生工具调用，已自动切换为兼容模式（JSON 指令）');
  }, []);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || running) return;
    if (!cfg) { setNotice('先连接一个模型，Agent 才能工作'); return; }
    let id = cid;
    if (!id) { const c = await createConversation(); id = c.id; setCid(id); setMsgs([]); }
    setRunning(true);
    abort.current = new AbortController();
    if (pick) await updateConversation(id, { model: `${cfg.label} · ${cfg.model}` });
    await runTurn({ conversationId: id, text: t, cfg, signal: abort.current.signal, onEvent: (e) => { onEvent(e); if (e.type === 'done') { setRunning(false); setMsgs((m) => m.map((x) => ({ ...x, meta: { ...(x.meta ?? {}), streaming: false }, stopped: e.stopped && x.meta?.streaming ? true : x.stopped }))); void refreshConvs(); } } });
    setRunning(false);
    void getModels().then(setModels);
  }, [cfg, cid, onEvent, pick, refreshConvs, running]);

  // 首启引导第 3 步：进入首页后真实发送第一句话
  useEffect(() => {
    const first = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ca.firstAsk') : null;
    if (first && cfg && !running) { sessionStorage.removeItem('ca.firstAsk'); void send(first); }
  }, [cfg, running, send]);
  const stop = useCallback(() => abort.current?.abort(), []);
  const userTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const spec = toolByName(name);
    if (!spec) return null;
    return spec.run(args, { conversationId: cid ?? 0, cfg });
  }, [cfg, cid]);
  return { convs, cid, setCid, msgs, running, send, stop, confirm, setConfirm, cfg, models, pick, setPick, notice, setNotice, refreshConvs, userTool };
}
export type AgentState = ReturnType<typeof useAgent>;

/* ---------- 总览卡 ---------- */
function OverviewCard({ onOpen, onResume }: { onOpen: (p: string) => void; onResume: () => void }) {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => { void computeOverview().then(setO); }, []);
  if (!o || (!o.rows.length && !o.resume)) return null;
  return (
    <section className="mb-4 rounded-[12px] border border-line bg-surface" data-testid="overview" aria-label="工作台总览">
      {o.resume && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[14px]">
          <Icon name="history" size={15} className="text-muted" />
          <span className="min-w-0 flex-1 truncate">上次的任务停在第 {o.resume.steps.length} 步：{o.resume.steps.at(-1)?.name}</span>
          <button type="button" className="!min-h-9 !px-3 !text-[14px]" data-testid="resume" onClick={onResume}>接着上次继续</button>
        </div>
      )}
      <ul className="m-0 list-none p-0">
        {o.rows.map((r) => (
          <li key={r.platform}>
            <button type="button" className="!flex !min-h-11 w-full !justify-start gap-3 !rounded-none !border-0 !bg-transparent !px-3 text-left !text-[14px] !font-normal" onClick={() => onOpen(r.platform)}>
              <span className="w-14 shrink-0 font-medium text-fg">{r.label}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{r.stage} · 待发布 {r.pendingPublish}{r.inbox ? ` · 素材 ${r.inbox}` : ''} · 热点{r.hotToday ? '已更新' : '未更新'}{r.lastOpen ? ` · 上次 ${r.lastOpen.slice(5, 16).replace('T', ' ')}` : ''}</span>
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
  const endRef = useRef<HTMLDivElement>(null);
  const showSideList = variant === 'full' && lay === 'desktop';
  const conv = a.convs.find((c) => c.id === a.cid);
  // 旧路由 #topics / #results → 预填起手式（不自动发送）
  useEffect(() => {
    const ask = route.query?.ask;
    if (ask === 'hot') setText('看看今天的热点');
    else if (ask === 'metrics') setText('这周数据怎么样');
  }, [route.query?.ask]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [a.msgs.length, a.running]);
  // 抽屉 / 下拉打开时收起原生网页（避免被原生视图挡住）
  useEffect(() => (sessionsOpen || modelOpen || plusOpen || delId !== null ? overlayManager.push() : undefined), [sessionsOpen, modelOpen, plusOpen, delId]);

  const actions: CardActions = { ask: (t) => void a.send(t), userTool: a.userTool, openDraft: (id) => go(`agent/drafts/${id}`) };
  const submit = () => { const t = text; setText(''); void a.send(t); };
  const visible = a.msgs.filter((m) => m.role !== 'tool' && !m.meta?.toolResult);
  const connected = (a.models?.providers ?? []).filter((p) => p.check?.ok || p.apiKey);

  const header = (
    <header className="flex min-h-12 shrink-0 items-center gap-1 border-b border-line px-2" data-testid="agent-header">
      {variant === 'sheet' && onBackToWeb && <button type="button" className="!min-h-11 !border-0 !bg-transparent !px-2 !text-[14px]" onClick={onBackToWeb} data-testid="back-to-web"><Icon name="chevronDown" size={16} /> 回到网页</button>}
      {renaming && conv ? (
        <input autoFocus defaultValue={conv.title} aria-label="会话标题" className="!min-h-9 min-w-0 flex-1 !text-[15px]" onBlur={async (e) => { await updateConversation(conv.id, { title: e.target.value.trim().slice(0, 30) || conv.title }); setRenaming(false); void a.refreshConvs(); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      ) : (
        <button type="button" className="!min-h-11 min-w-0 flex-1 !justify-start !border-0 !bg-transparent !px-2 !text-[15px] !font-semibold" onClick={() => conv && setRenaming(true)} aria-label="会话标题（点按改名）" data-testid="conv-title">
          <span className="truncate">{conv?.title ?? (variant === 'full' ? '超级工作台' : 'Agent')}</span>
        </button>
      )}
      <button type="button" aria-label="模型" data-testid="model-pill" className="!min-h-9 max-w-[42%] !rounded-full !px-3 !text-[13px] !font-normal" onClick={() => setModelOpen(true)}>
        <span className="truncate">{a.cfg ? `${presetOf(a.cfg.id)?.label ?? a.cfg.label} · ${a.cfg.model}` : '未连接模型'}</span><Icon name="chevronDown" size={14} />
      </button>
      <button type="button" aria-label="新会话" className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => { a.setCid(null); setTab('chat'); }}><Icon name="newChat" size={18} /></button>
      {!showSideList && <button type="button" aria-label="会话列表" className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={() => setSessionsOpen(true)}><Icon name="history" size={18} /></button>}
      {onCollapse && <button type="button" aria-label="收起 Agent 面板" className="!min-h-11 !min-w-11 !border-0 !bg-transparent !p-0" onClick={onCollapse}><Icon name="panelRight" size={18} /></button>}
    </header>
  );

  const tabs = (
    <div role="tablist" aria-label="Agent" className="flex shrink-0 gap-1 border-b border-line px-2">
      {([['chat', '对话'], ['drafts', '草稿'], ['inbox', '素材']] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} type="button" className={cn('!min-h-11 !rounded-none !border-0 !border-b-2 !bg-transparent !px-3 !text-[14px]', tab === k ? '!border-b-fg !font-semibold !text-fg' : '!border-b-transparent !font-normal !text-muted')} onClick={() => { setTab(k); if (variant === 'full') go(k === 'chat' ? 'agent' : `agent/${k}`); }}>{l}</button>
      ))}
    </div>
  );

  const empty = (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-6" data-testid="agent-empty">
      {!connected.length ? (
        <div className="py-8 text-center" data-testid="no-model">
          <h2 className="text-[22px]">超级工作台</h2>
          <p className="mt-2 text-muted">先连接一个模型，Agent 才能工作</p>
          <button type="button" className="primary mt-4" onClick={() => go('me/models')}>去连接</button>
        </div>
      ) : (
        <>
          <OverviewCard onOpen={onOpenPlatform} onResume={() => void a.send('接着上次继续')} />
          <h2 className="text-[22px]" data-testid="hero-title">超级工作台</h2>
          <p className="mt-1 text-[15px] text-fg-2" data-testid="definition">{DEFINITION}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS.map((s) => <button key={s} type="button" className="!min-h-10 !rounded-full !px-4 !text-[14px] !font-normal" data-testid="starter" onClick={() => void a.send(s)}>{s}</button>)}
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
            <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-[12px] bg-surface-2 px-3 py-2 text-[15px] text-fg" data-testid="msg-user">{m.content}</div>
          ) : (
            <div className="max-w-full text-[15px] leading-relaxed text-fg" data-testid="msg-agent" data-streamed={m.streamed ? 'true' : 'false'}>
              {m.reasoning && <details className="mb-1 text-[13px] text-muted"><summary>已思考</summary><div className="whitespace-pre-wrap">{m.reasoning.slice(0, 3000)}</div></details>}
              {m.content && <div className={cn(!!m.meta?.error && 'text-bad')}><Markdown text={m.content} /></div>}
              {!!m.meta?.streaming && <span className="stream-caret" aria-hidden="true" />}
              {!m.content && !m.cards?.length && a.running && m.id === visible.at(-1)?.id && <p className="m-0 text-[14px] text-muted" data-testid="generating">正在生成…</p>}
              {m.stopped && <p className="m-0 text-[12px] text-muted">已停止</p>}
              {(m.cards ?? []).map((c: CardData, i) => <ToolCard key={i} card={c} actions={{ ...actions, retry: c.status === 'error' ? () => void a.send(`重试：${toolByName(c.tool)?.label ?? c.tool}`) : undefined }} />)}
              {m.model && !m.meta?.error && (m.content || m.cards?.length) ? <p className="m-0 mt-0.5 text-[12px] text-faint">{m.model}{m.streamed === false ? ' · 整段返回' : ''}</p> : null}
            </div>
          )}
        </Fragment>
      ))}
      {a.confirm && <ConfirmCard label={a.confirm.label} args={a.confirm.args} onDecide={(d) => { a.confirm!.resolve(d); a.setConfirm(null); }} />}
      <div ref={endRef} />
    </div>
  );

  const input = (
    <div className="shrink-0 border-t border-line bg-canvas px-3 pt-2 pb-[calc(8px+var(--sa-bottom))]">
      {a.notice && <p className="m-0 mb-1 text-[13px] text-muted" role="status">{a.notice} <button type="button" className="!min-h-0 !border-0 !bg-transparent !p-0 !text-[13px] !text-accent" onClick={() => a.setNotice('')}>知道了</button></p>}
      <div className="flex items-end gap-2">
        <button type="button" aria-label="附加" className="!min-h-11 !min-w-11 !rounded-full !p-0" onClick={() => setPlusOpen(true)}><Icon name="plus" size={18} /></button>
        <textarea value={text} rows={1} placeholder="和 Agent 说点什么…" aria-label="和 Agent 说点什么" data-testid="agent-input"
          className="!min-h-11 max-h-40 min-w-0 flex-1 resize-none !py-2.5 !text-[15px]"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && lay !== 'phone') { e.preventDefault(); submit(); } }} />
        {a.running
          ? <button type="button" aria-label="停止" data-testid="stop" className="!min-h-11 !min-w-11 !rounded-full !p-0" onClick={a.stop}><Icon name="stop" size={16} /></button>
          : <button type="button" aria-label="发送" data-testid="send" className="primary !min-h-11 !min-w-11 !rounded-full !p-0" disabled={!text.trim()} onClick={submit}><Icon name="sendUp" size={18} /></button>}
      </div>
    </div>
  );

  const body = tab === 'chat' ? (visible.length ? thread : empty)
    : tab === 'drafts' ? <Suspense fallback={<p className="p-4 text-muted">加载中…</p>}><Write filter={route.query?.filter ?? 'all'} id={route.id} go={go} lay={variant === 'full' ? lay : 'phone'} /></Suspense>
    : <InboxTab onUse={(i) => { setTab('chat'); void a.send(`结合这条素材：${i.title || i.text || i.url}`); }} />;

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-1 bg-canvas', variant !== 'full' && 'flex-col')} data-testid={`agent-${variant}`}>
      {showSideList && (
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-line" aria-label="会话列表" data-testid="session-list">
          <div className="flex min-h-12 items-center px-3 text-[13px] text-muted">会话</div>
          <SessionList a={a} onPick={() => setTab('chat')} onDelete={setDelId} />
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        {tabs}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-scroll">{body}</div>
        {tab === 'chat' && input}
      </div>

      <Drawer open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DrawerContent title="会话">
          <SessionList a={a} onPick={() => { setSessionsOpen(false); setTab('chat'); }} onDelete={(id) => { setSessionsOpen(false); setDelId(id); }} />
        </DrawerContent>
      </Drawer>
      <Drawer open={modelOpen} onOpenChange={setModelOpen}>
        <DrawerContent title="切换模型" description="只影响之后的回复；每条消息会标注所用模型">
          {connected.flatMap((p) => {
            const models = [...new Set([p.model, ...(presetOf(p.id)?.models ?? [])].filter(Boolean))];
            const base = presetOf(p.id)?.prices?.[models[0]!]?.input;
            return models.map((m) => {
              const price = presetOf(p.id)?.prices?.[m]?.input;
              return <DrawerItem key={`${p.id}:${m}`} label={`${presetOf(p.id)?.label ?? p.label} · ${m}`} hint={price && base ? `单价 ×${(price / base).toFixed(price / base >= 10 ? 0 : 1)}${p.toolMode ? ` · 工具调用：${p.toolMode === 'json' ? '兼容模式' : '原生'}` : ''}` : p.toolMode === 'json' ? '工具调用：兼容模式' : undefined} onClick={() => { a.setPick({ providerId: p.id, model: m }); setModelOpen(false); }} />;
            });
          })}
          <DrawerItem label="管理模型" onClick={() => { setModelOpen(false); go('me/models'); }} />
        </DrawerContent>
      </Drawer>
      <Drawer open={plusOpen} onOpenChange={setPlusOpen}>
        <DrawerContent title="附加">
          <DrawerItem label="当前网页" hint="发送当前平台页面的网址与标题（不读页面内容）" onClick={() => { setPlusOpen(false); window.dispatchEvent(new CustomEvent('ca:send-current-page')); }} />
          <DrawerItem label="素材箱里的一条" onClick={() => { setPlusOpen(false); setTab('inbox'); }} />
          <DrawerItem label="粘贴文本" onClick={async () => { setPlusOpen(false); try { const t = await navigator.clipboard.readText(); if (t) setText((x) => `${x}${x ? '\n' : ''}${t}`); } catch { a.setNotice('读取剪贴板失败，请在输入框长按粘贴'); } }} />
          <DrawerItem label="导入数据（平台导出的 CSV）" onClick={() => { setPlusOpen(false); go('me/backup'); }} />
        </DrawerContent>
      </Drawer>
      <Drawer open={delId !== null} onOpenChange={(o) => { if (!o) setDelId(null); }}>
        <DrawerContent title="删除这个会话？" description="会话里的消息会一起删除，不能恢复">
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
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话标题" aria-label="搜索会话" className="!mx-2 !mb-2 !min-h-9 !text-[14px]" />
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 px-1">
        {shown.map((c) => (
          <li key={c.id} className={cn('group flex items-center rounded-[10px]', c.id === a.cid && 'bg-side-active')}>
            <button type="button" className="!min-h-11 min-w-0 flex-1 !justify-start !border-0 !bg-transparent !px-2 text-left !text-[14px] !font-normal" onClick={() => { a.setCid(c.id); onPick(); }}>
              {c.pinned && <Icon name="pin" size={13} className="mr-1 text-muted" />}<span className="truncate">{c.title}</span>
            </button>
            <button type="button" aria-label={c.pinned ? '取消置顶' : '置顶'} className="!min-h-11 !min-w-9 !border-0 !bg-transparent !p-0 !text-muted" onClick={async () => { await updateConversation(c.id, { pinned: !c.pinned }); void a.refreshConvs(); }}><Icon name="pin" size={14} /></button>
            <button type="button" aria-label="删除会话" className="!min-h-11 !min-w-9 !border-0 !bg-transparent !p-0 !text-muted" onClick={() => onDelete(c.id)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
        {!shown.length && <li className="px-3 py-4 text-[13px] text-muted">还没有会话</li>}
      </ul>
    </div>
  );
}

function InboxTab({ onUse }: { onUse: (i: InboxItem) => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const load = useCallback(() => void listInbox().then(setItems), []);
  useEffect(() => { load(); return bus.on((e) => { if (e.type === 'inbox-changed') load(); }); }, [load]);
  const [paste, setPaste] = useState('');
  return (
    <div className="mx-auto w-full max-w-[760px] p-3" data-testid="inbox-tab">
      <form className="mb-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (paste.trim()) { await addInbox({ kind: /^https?:\/\//.test(paste.trim()) ? 'url' : 'text', text: paste.trim(), url: /^https?:\/\//.test(paste.trim()) ? paste.trim() : undefined, channel: 'paste' }); setPaste(''); } }}>
        <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="粘贴一段文字或链接，存进素材箱" aria-label="粘贴到素材箱" className="!min-h-10 min-w-0 flex-1 !text-[14px]" />
        <button type="submit" className="!min-h-10">存入</button>
      </form>
      <ul className="m-0 list-none p-0">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-2 border-b border-line py-2 text-[14px]">
            <div className="min-w-0 flex-1">
              <p className="m-0 line-clamp-2 text-fg">{i.title || i.text || i.url}</p>
              <p className="m-0 text-[12px] text-muted">{i.platform ? `${center(i.platform)?.label ?? i.platform} · ` : ''}{i.channel === 'share' ? '系统分享' : i.channel === 'process_text' ? '选中文字' : i.channel === 'toolbar' ? '工具栏' : i.channel === 'patrol' ? '巡视' : '粘贴'} · {i.createdAt.slice(5, 16).replace('T', ' ')}{i.used ? ' · 已使用' : ''}</p>
            </div>
            <button type="button" className="!min-h-9 !px-3 !text-[13px]" onClick={() => onUse(i)}>用这条</button>
            <button type="button" aria-label="删除素材" className="!min-h-9 !min-w-9 !border-0 !bg-transparent !p-0 !text-muted" onClick={() => void deleteInbox(i.id)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
        {!items.length && <li className="py-6 text-center text-[14px] text-muted">素材箱是空的。在平台页面点“发给 Agent”，选中文字后点“发给 Agent”，或在官方 App 里“分享 → 超级工作台”。</li>}
      </ul>
    </div>
  );
}
