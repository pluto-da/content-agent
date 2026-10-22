import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { get, post, put, mediaUrl } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import type { Layout } from '../nav';
import type { Route } from '../route';
import { shareToLocalApp } from '../native';
import { appOs, copyText, openExternal } from '../runtime';
import { Button } from '../components/ui/button';
import { Drawer, DrawerContent, DrawerItem } from '../components/ui/drawer';
import { ResizableSplit } from '../components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../components/ui/utils';
import { Badge, Empty, ErrorBox, Field, Loading, SkeletonLines, StatusBadge, useLoad, useToast } from '../ui';
import { ago } from './content';
import { useLocalApps } from './localapps';
import { CreatorCenters, PLATFORM_LABEL } from './publish';
import { ModelSwitch } from './modelswitch';
import { MoreMenu } from '../components/MoreMenu';

/** 4 个状态过滤（参考 postiz 列表视图：全部 / 草稿 / 已排期 / 已发布）；已驳回的在“全部”里查看。 */
const FILTERS: [string, string][] = [['pending', '待审核'], ['approved', '已通过'], ['handed_off', '已交接'], ['', '全部']];

/** 创作：草稿列表 + 编辑/审核详情 + 平台预览；审核通过后“去发布”交接到官方后台或本地应用，由用户本人点击发布。桌面可切看板。 */
export function Create({ route, go, lay, openCenter, center, setCenter }: {
  route: Route; go: (p: string) => void; lay: Layout; openCenter: (id: string) => void; center: string; setCenter: (id: string) => void;
}) {
  const { t } = useT();
  const isPhone = lay === 'phone';
  const phoneDetail = isPhone && route.sub === 'drafts' && !!route.id;
  const views: [string, string, string][] = [['drafts', '草稿', 'list'], ...(lay === 'desktop' ? [['board', '看板', 'kanban'] as [string, string, string]] : []), ['publish', '发布台', 'creator']];
  const header = !phoneDetail && (
    <div className={cn('flex shrink-0 items-center gap-3', isPhone ? 'sticky top-14 z-10 bg-canvas px-4 pb-3' : 'px-6 pb-3')}>
      <Tabs value={route.sub} onValueChange={(v) => go(`create/${v}`)} className={cn(isPhone && 'w-full')}>
        <TabsList aria-label={t('创作')} className={cn(isPhone && 'flex w-full')}>
          {views.map(([id, label, icon]) => (
            <TabsTrigger key={id} value={id} className={cn(isPhone && 'h-10 min-h-10 flex-1')}><Icon name={icon} size={14} />{t(label)}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!isPhone && <span className="ml-auto hidden text-[12px] text-muted md:inline">{t('发布由你本人在官方后台或 App 中点击完成')}</span>}
    </div>
  );
  let content: ReactNode;
  if (route.sub === 'board') content = <Board go={go} />;
  else if (route.sub === 'publish') content = <div className={cn(isPhone ? 'px-4' : 'flex min-h-0 flex-1 flex-col px-6 pb-6')}><CreatorCenters active={center} setActive={setCenter} /></div>;
  else content = <Drafts selected={route.id ? Number(route.id) : null} go={go} lay={lay} openCenter={openCenter} />;
  return <div className={cn('flex flex-col', !isPhone && 'min-h-0 flex-1')}>{header}{content}</div>;
}

/* ---------- 草稿：列表 | 详情 ---------- */

function Drafts({ selected, go, lay, openCenter }: { selected: number | null; go: (p: string) => void; lay: Layout; openCenter: (id: string) => void }) {
  const { t, lang } = useT();
  const [status, setStatus] = useState('pending');
  const drafts = useLoad(() => get(`/api/drafts${status ? '?status=' + status : ''}`), [status]);
  const rows: any[] = Array.isArray(drafts.data?.drafts) ? drafts.data.drafts : [];
  const isPhone = lay === 'phone';
  const select = (id: number) => go(`create/drafts/${id}`);

  const list = (
    <div className={cn('flex min-h-0 flex-1 flex-col', !isPhone && 'bg-surface')}>
      <div className={cn('shrink-0', isPhone ? 'px-4 pb-2' : 'border-b border-line px-3 py-3')}>
        <div className="filter-chips" role="group" aria-label={t('状态筛选')}>
          {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{t(l)}</button>)}
        </div>
      </div>
      <div className={cn('min-h-0 flex-1', !isPhone && 'overflow-y-auto')}>
        <ErrorBox error={drafts.error} />
        {drafts.loading ? <div className="p-4"><SkeletonLines lines={6} /></div> : rows.length ? (
          <ul className={cn('m-0 list-none p-0', isPhone && 'mx-4 overflow-hidden rounded-card border border-line bg-surface')}>
            {rows.map((d) => (
              <li key={d.id} className="border-t border-line first:border-t-0">
                <button
                  type="button" onClick={() => select(d.id)} aria-current={selected === d.id ? 'true' : undefined}
                  className={cn('!flex !h-auto !min-h-0 w-full !flex-col !items-stretch !justify-start !gap-1 !whitespace-normal !rounded-none !border-0 !bg-transparent !px-4 !py-3 text-left !font-normal hover:!bg-surface-2', selected === d.id && '!bg-accent-soft')}
                >
                  <span className={cn('line-clamp-1 text-sm text-fg', selected === d.id && 'font-medium')}>{d.title || String(d.body ?? '').slice(0, 60)}</span>
                  <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
                    <span className="text-fg-2">{PLATFORM_LABEL[d.platform] ?? d.platform}</span>
                    <StatusBadge status={d.status} />
                    <span className="ml-auto shrink-0">{ago(d.created_at, lang)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty icon="review">{t('暂无数据')}</Empty>}
      </div>
    </div>
  );

  const detail = selected !== null
    ? <DraftDetail key={selected} id={selected} onChange={drafts.reload} openCenter={openCenter} lay={lay} go={go} />
    : <div className="flex flex-1 items-center justify-center p-8"><Empty icon="create">{t('从左侧选择一篇草稿进行编辑与审核')}</Empty></div>;

  if (isPhone) return selected !== null ? detail : list;
  if (lay === 'tablet') return (
    <div className="flex min-h-0 flex-1 border-t border-line">
      <div className="flex w-[320px] shrink-0 flex-col border-r border-line">{list}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{detail}</div>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 border-t border-line">
      <ResizableSplit storageKey="ca.create.listW" initial={340} min={280} max={560} left={list} right={detail} />
    </div>
  );
}

function useWidthOf(): [(el: HTMLElement | null) => void, number] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver((es) => setW(es[0]?.contentRect.width ?? 0));
    ro.current.observe(el);
  }, []);
  return [ref, w];
}

interface Act { id: string; label: string; run: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; hint?: string; group: 'review' | 'handoff' }

/** 草稿详情：编辑、审核、合规提示、素材、平台预览、发布交接。所有接口调用与 0.2.x 审核页一致。 */
function DraftDetail({ id, onChange, openCenter, lay, go }: { id: number; onChange: () => void; openCenter: (id: string) => void; lay: Layout; go: (p: string) => void }) {
  const { t } = useT();
  const d = useLoad(() => get(`/api/drafts/${id}`), [id]);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [card, setCard] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, say] = useToast();
  const [questionUrl, setQuestionUrl] = useState('');
  const [more, setMore] = useState(false);
  const [pane, setPane] = useState('edit');
  const localApps = useLocalApps();
  const [boxRef, boxW] = useWidthOf();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [instr, setInstr] = useState('');
  useEffect(() => { if (d.data?.draft) { setBody(d.data.draft.body ?? ''); setTitle(d.data.draft.title ?? ''); } }, [d.data]);
  useEffect(() => {
    if (d.data?.draft?.status !== 'approved') { setCard(null); return; }
    const q = questionUrl.trim() ? `?questionUrl=${encodeURIComponent(questionUrl.trim())}` : '';
    get(`/api/drafts/${id}/handoff${q}`).then(setCard).catch(setErr);
  }, [d.data, id, questionUrl]);
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); d.reload(); onChange(); } catch (e) { setErr(e); } };
  const isPhone = lay === 'phone';
  if (!d.data?.draft) return <div className="p-6"><Loading show={d.loading} /><ErrorBox error={d.error} /></div>;
  const dr = d.data.draft;
  const os = appOs();
  const localApp = card && os ? localApps.data?.apps?.find((a) => a.platform === card.center.id && a.os === os) : undefined;
  const locked = dr.status === 'handed_off';

  const acts: Act[] = [];
  if (!locked) acts.push({ id: 'save', group: 'review', label: t('保存'), run: () => act(async () => { await put(`/api/drafts/${id}`, { body, title, note: '人工编辑' }); say('已保存，修改已留痕'); }) });
  if (dr.status === 'pending') {
    acts.push({ id: 'approve', group: 'review', primary: true, label: t('通过'), run: () => act(async () => { if (body !== dr.body || title !== (dr.title ?? '')) await put(`/api/drafts/${id}`, { body, title }); await post(`/api/drafts/${id}/status`, { status: 'approved' }); }) });
    acts.push({ id: 'reject', group: 'review', danger: true, label: t('驳回'), run: () => act(async () => { await post(`/api/drafts/${id}/status`, { status: 'rejected' }); }) });
  }
  if (!locked) acts.push({ id: 'partial', group: 'review', label: t('局部重写所选'), hint: '只发送选中段与前后各 200 字，不整篇重生成', run: () => act(async () => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? 0, end = el?.selectionEnd ?? 0;
    if (start === end) { say('先在正文中选中要改写的一段'); return; }
    if (body !== dr.body || title !== (dr.title ?? '')) await put(`/api/drafts/${id}`, { body, title, note: '人工编辑' });
    const r = await post(`/api/drafts/${id}/partial-rewrite`, { start, end, instruction: instr });
    setBody(r.body);
    say(`已重写所选（发送 ${r.sentChars}/${r.totalChars} 字）${r.warnings?.length ? '；' + r.warnings[0] : ''}`);
  }) });
  if (dr.pipeline?.some((s: any) => !s.ok)) acts.push({ id: 'resume', group: 'review', label: t('续跑失败步骤'), hint: '只重跑失败或未完成的步骤，已成功的保持不变', run: () => act(async () => {
    const r = await post(`/api/drafts/${id}/resume`);
    say(r.rerun?.length ? `已重跑：${r.rerun.join('、')}` : '没有需要重跑的步骤');
  }) });
  if (dr.status === 'rejected' || dr.status === 'approved') acts.push({ id: 'back', group: 'review', label: t('退回待审'), run: () => act(async () => { await post(`/api/drafts/${id}/status`, { status: 'pending' }); }) });
  if (card) {
    acts.push({ id: 'publish', group: 'handoff', primary: true, label: `${t('复制')}并${t('去发布')}（${t('网页端')}）`, run: () => act(async () => {
      const ok = await copyText(card.copyText);
      await post(`/api/drafts/${id}/handoff/copy`);
      say(ok ? '已复制全文，请在官方 App 中粘贴并由你本人发布' : '复制失败，请手动复制');
      if (card.jumpUrl && card.jumpUrl !== card.center.url) await openExternal(card.jumpUrl);
      else openCenter(card.center.id);
    }) });
    acts.push({ id: 'share', group: 'handoff', label: `${t('分享草稿到应用')}${localApp ? `（${localApp.label}）` : ''}`, hint: localApp ? `分享到 ${localApp.label}` : '未登记本机应用时，使用系统分享或仅复制', run: () => act(async () => {
      const r = await shareToLocalApp(localApp ?? null, { id, text: card.copyText, assets: dr.assets });
      if (r.ok) await post(`/api/drafts/${id}/handoff/copy`);
      say(r.message);
    }) });
    if (card.intentUrl) acts.push({ id: 'intent', group: 'handoff', label: '打开 X 发帖页（预填）', run: () => void openExternal(card.intentUrl) });
    if (card.platform === 'wechat_article') acts.push({ id: 'wechat', group: 'handoff', label: t('推送公众号草稿箱'), disabled: !card.canPushWechatDraft, hint: card.canPushWechatDraft ? '' : '需配置 AppID、AppSecret 与封面素材 media_id', run: () => act(async () => { const r = await post(`/api/drafts/${id}/handoff/wechat-draft`); say(`已进入草稿箱 media_id=${r.media_id}`); }) });
  }
  const btn = (a: Act, size: 'sm' | 'md' | 'lg' = 'md') => (
    <Button key={a.id} size={size} variant={a === primary ? 'primary' : a.danger ? 'danger' : 'default'} disabled={a.disabled} title={a.hint} onClick={a.run}>{a.label}</Button>
  );
  // 一屏一个主动作：通过后主动作是“去发布”，否则是“通过”；最多 2 个可见次按钮，其余进“⋯”。
  const primary = acts.find((a) => a.id === 'publish') ?? acts.find((a) => a.primary) ?? acts[0];
  const rest = acts.filter((a) => a !== primary);
  const ORDER = ['share', 'save', 'reject', 'back', 'partial', 'resume', 'intent', 'wechat', 'approve'];
  const ranked = [...rest].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const visible = ranked.slice(0, 2).map((a) => ({ ...a, primary: false }));
  const overflow = ranked.slice(2);

  const editor = (
    <div className="min-w-0">
      {String(dr.model).startsWith('mock') && <div className="alert info">{t('模拟输出')}：当前使用 Mock 模型，仅用于演示流程。</div>}
      {dr.confidence && <p className="small"><Badge tone={dr.confidence === 'high' ? 'ok' : dr.confidence === 'medium' ? 'info' : 'warn'}>{({ high: '高置信', medium: '中置信', low: '低置信' } as Record<string, string>)[dr.confidence] ?? dr.confidence}</Badge>{dr.first_pass === 0 && <span className="muted"> · 格式修复过一次</span>}</p>}
      <Field label="标题"><input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} /></Field>
      <Field label="正文"><textarea ref={bodyRef} rows={isPhone ? 12 : 14} value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} /></Field>
      {!locked && <div className="mb-2"><ModelSwitch go={go} /></div>}
      {!locked && <Field label={t('局部重写要求')} hint="选中正文一段后，在“⋯”里点“局部重写所选”"><input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="例如：更口语、更短（可留空）" /></Field>}
      {dr.tags?.length > 0 && <p className="small muted">{dr.tags.map((g: string) => `#${g}`).join(' ')}</p>}
      {dr.pipeline?.length > 0 && <p className="small"><b>{t('流水线')}：</b>{dr.pipeline.map((s: any) => `${s.step}${s.ok ? '✓' : '✗'}${s.message ? '（' + s.message + '）' : ''}`).join(' → ')}</p>}
      {dr.assets?.length > 0 && (
        <div className="assets">
          <b>{t('素材')}</b>
          <div className="row wrap">
            {dr.assets.map((a: any) => a.type === 'image' ? <img key={a.url} src={mediaUrl(a.url)} alt={a.note ?? '配图'} className="thumb" />
              : a.type === 'audio' ? <audio key={a.url} controls src={mediaUrl(a.url)} aria-label="配音" />
              : a.type === 'video' ? <video key={a.url} controls src={mediaUrl(a.url)} className="thumb" aria-label="视频" />
              : <a key={a.url} href={mediaUrl(a.url)} target="_blank" rel="noreferrer">字幕 SRT</a>)}
          </div>
        </div>
      )}
      <details open={dr.compliance?.some((c: any) => c.level === 'warn')}>
        <summary>{t('合规提示')}（{dr.compliance?.length ?? 0}）</summary>
        <ul className="small">{dr.compliance?.map((c: any, i: number) => <li key={i}>{c.level === 'warn' ? '⚠️' : 'ℹ️'} {c.rule}{c.match && `「${c.match}」`}：{c.advice}</li>)}</ul>
      </details>
      {card && (
        <div className="handoff" aria-label="发布交接卡">
          <h3>{t('发布交接')}</h3>
          <ul className="small">{card.checklist?.map((c: string) => <li key={c}>☐ {c}</li>)}</ul>
          {card.platform === 'zhihu_answer' && (
            <Field label="知乎问题链接（可选）" hint={card.needsQuestionUrl ? '粘贴要回答的问题链接，复制后会直接打开该问题页；不填则打开知乎创作中心' : '复制后将打开该问题页'}>
              <input value={questionUrl} onChange={(e) => setQuestionUrl(e.target.value)} placeholder="https://www.zhihu.com/question/…" />
            </Field>
          )}
          <p className="muted small">{card.lastStep}</p>
        </div>
      )}
      {d.data.edits?.length > 0 && <details><summary>修改记录（{d.data.edits.length}）</summary><ul className="small">{d.data.edits.map((e: any) => <li key={e.id}>{e.created_at} {e.note ?? ''}</li>)}</ul></details>}
    </div>
  );
  const preview = <PlatformPreview platform={dr.platform} title={title} body={body} tags={dr.tags ?? []} assets={dr.assets ?? []} />;
  const wide = boxW >= 860;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', !isPhone && 'bg-canvas')}>
      {toast}
      <div ref={boxRef} className={cn('min-h-0 flex-1', !isPhone && 'overflow-y-auto')}>
        <div className={cn('mx-auto w-full', isPhone ? 'px-4 pt-1' : 'max-w-[1100px] px-6 py-5')}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base">{PLATFORM_LABEL[dr.platform] ?? dr.platform} · #{dr.id}</h2>
            <StatusBadge status={dr.status} />
            {!isPhone && <span className="ml-auto text-[12px] text-muted">{t('修改会留痕；通过后可去发布')}</span>}
          </div>
          <ErrorBox error={err} />
          {wide ? (
            <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
              {editor}
              <div className="sticky top-0">{preview}</div>
            </div>
          ) : (
            <Tabs value={pane} onValueChange={setPane}>
              <TabsList aria-label={t('编辑或预览')} className={cn('mb-2', isPhone && 'flex w-full')}>
                <TabsTrigger value="edit" className={cn(isPhone && 'h-10 min-h-10 flex-1')}><Icon name="create" size={14} />{t('编辑')}</TabsTrigger>
                <TabsTrigger value="preview" className={cn(isPhone && 'h-10 min-h-10 flex-1')}><Icon name="eye" size={14} />{t('平台预览')}</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="outline-none">{editor}</TabsContent>
              <TabsContent value="preview" className="outline-none">{preview}</TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      {acts.length > 0 && (isPhone ? (
        <>
          <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 bg-surface/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 shadow-bar backdrop-blur-md">
            {rest.length > 0 && <Button size="lg" aria-label={t('更多操作')} onClick={() => setMore(true)}><Icon name="more" size={18} />{t('更多')}</Button>}
            {primary && <Button size="lg" variant={primary.primary ? 'primary' : primary.danger ? 'danger' : 'default'} className="flex-1" disabled={primary.disabled} onClick={primary.run}>{primary.label}</Button>}
          </div>
          <Drawer open={more} onOpenChange={setMore}>
            <DrawerContent title={t('更多操作')} description={card ? t('发布始终由你本人在官方后台或 App 中点击完成') : undefined}>
              {rest.map((a) => <DrawerItem key={a.id} label={a.label} hint={a.hint || undefined} tone={a.danger ? 'danger' : undefined} disabled={a.disabled} onClick={() => { setMore(false); a.run(); }} />)}
            </DrawerContent>
          </Drawer>
        </>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-3">
          {visible.map((a) => btn(a))}
          <MoreMenu label={t('更多操作')} items={overflow.map((a) => ({ label: a.label, hint: a.hint || undefined, disabled: a.disabled, danger: a.danger, onSelect: a.run }))} />
          <span className="flex-1" />
          {primary && btn(primary)}
        </div>
      ))}
    </div>
  );
}

/* ---------- 平台预览：中性外框，不使用任何平台品牌素材 ---------- */

const LIMITS: Record<string, { title?: number; body?: number; weighted?: boolean }> = {
  xiaohongshu: { title: 20, body: 1000 },
  x_post: { body: 280, weighted: true },
};
const VIDEO = ['douyin_script', 'channels'];
const IMAGE_FIRST = ['xiaohongshu', 'xianyu'];

function countChars(s: string, weighted?: boolean): number {
  if (!weighted) return [...s].length;
  return [...s].reduce((n, ch) => n + (/[\u1100-\uffff]/.test(ch) ? 2 : 1), 0);
}

export function PlatformPreview({ platform, title, body, tags, assets }: { platform: string; title: string; body: string; tags: string[]; assets: any[] }) {
  const { t } = useT();
  const img = assets.find((a) => a.type === 'image');
  const audio = assets.find((a) => a.type === 'audio');
  const lim = LIMITS[platform] ?? {};
  const tl = countChars(title);
  const bl = countChars(body, lim.weighted);
  const firstLine = body.split(/[。！？\n]/).find((x) => x.trim()) ?? '';
  return (
    <section aria-label={t('平台预览')} className="rounded-card border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-surface-3 text-[13px] font-medium text-fg">{t('我')}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-medium text-fg">{t('我的账号')}</div>
          <div className="text-[12px] text-muted">{PLATFORM_LABEL[platform] ?? platform} · {t('预览')}</div>
        </div>
        <Icon name="phone" size={16} className="text-muted" />
      </header>
      {VIDEO.includes(platform) ? (
        <div className="relative mx-4 mt-4 aspect-[9/16] max-h-[420px] overflow-hidden rounded-ctl bg-[#111]">
          {img && <img src={mediaUrl(img.url)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />}
          <p className="absolute inset-x-3 bottom-6 m-0 text-center text-[15px] font-medium leading-snug text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{firstLine || t('（口播字幕预览）')}</p>
        </div>
      ) : IMAGE_FIRST.includes(platform) ? (
        <div className="mx-4 mt-4 grid aspect-[3/4] max-h-[360px] place-items-center overflow-hidden rounded-ctl bg-surface-2 text-[13px] text-muted">
          {img ? <img src={mediaUrl(img.url)} alt={img.note ?? ''} className="h-full w-full object-cover" /> : t('无配图')}
        </div>
      ) : null}
      <div className="px-4 py-4">
        {title && <h3 className={cn('m-0 mb-2 text-fg', platform === 'wechat_article' || platform === 'zhihu_article' ? 'text-lg' : 'text-[15px]')}>{title}</h3>}
        <p className="m-0 max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-2">{body || t('（正文为空）')}</p>
        {tags.length > 0 && <p className="mb-0 mt-3 text-sm text-accent">{tags.map((g) => `#${g}`).join(' ')}</p>}
        {audio && <audio controls src={mediaUrl(audio.url)} className="mt-3 w-full" aria-label="配音" />}
      </div>
      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[12px] tabular-nums text-muted">
        <span className={cn(lim.title && tl > lim.title && 'text-bad')}>{t('标题')} {tl}{lim.title ? ` / ${lim.title}` : ''}</span>
        <span className={cn(lim.body && bl > lim.body && 'text-bad')}>{t('正文')} {bl}{lim.body ? ` / ${lim.body}` : ''}{lim.weighted ? `（${t('中文计 2')}）` : ''}</span>
        <span className="ml-auto">{t('仅示意，以平台实际显示为准')}</span>
      </footer>
    </section>
  );
}

/* ---------- 看板：选题 → 生成中 → 待审 → 待发布 → 已发布 ---------- */

function Board({ go }: { go: (p: string) => void }) {
  const { t, lang } = useT();
  const topics = useLoad(() => get('/api/topics'));
  const tasks = useLoad(() => get('/api/tasks?limit=100'));
  const drafts = useLoad(() => get('/api/drafts'));
  const tp: any[] = Array.isArray(topics.data?.topics) ? topics.data.topics : [];
  const tk: any[] = Array.isArray(tasks.data?.tasks) ? tasks.data.tasks : [];
  const dr: any[] = Array.isArray(drafts.data?.drafts) ? drafts.data.drafts : [];
  const draftCard = (d: any) => ({ key: `d${d.id}`, title: d.title || String(d.body ?? '').slice(0, 40), meta: `${PLATFORM_LABEL[d.platform] ?? d.platform} · ${ago(d.created_at, lang)}`, to: `create/drafts/${d.id}` });
  const cols: { id: string; label: string; hint: string; items: { key: string; title: string; meta: string; to: string }[] }[] = [
    { id: 'topic', label: '选题', hint: '候选选题', items: tp.filter((x) => x.status === 'candidate').map((x) => ({ key: `t${x.id}`, title: x.title, meta: x.origin === 'hot' ? t('热点') : t('内容库'), to: 'inspire/topics' })) },
    { id: 'running', label: '生成中', hint: '排队或运行中的任务', items: tk.filter((x) => x.status === 'running' || x.status === 'queued').map((x) => ({ key: `k${x.id}`, title: x.label, meta: ago(x.created_at, lang), to: 'prefs/logs' })) },
    { id: 'pending', label: '待审', hint: '等你审核', items: dr.filter((x) => x.status === 'pending').map(draftCard) },
    { id: 'approved', label: '待发布', hint: '已通过，等你本人发布', items: dr.filter((x) => x.status === 'approved').map(draftCard) },
    { id: 'handed_off', label: '已发布', hint: '已交接给你发布', items: dr.filter((x) => x.status === 'handed_off').map(draftCard) },
  ];
  const loading = topics.loading || tasks.loading || drafts.loading;
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto border-t border-line px-6 py-4" aria-label={t('看板')}>
      {cols.map((c) => (
        <section key={c.id} aria-label={t(c.label)} className="flex min-h-0 w-0 min-w-[196px] flex-1 flex-col rounded-card bg-surface-2/60">
          <header className="flex items-baseline gap-2 px-3 pt-3 pb-2">
            <h2 className="m-0 text-sm">{t(c.label)}</h2>
            <span className="text-[12px] tabular-nums text-muted">{c.items.length}</span>
            <span className="ml-auto truncate text-[12px] text-muted">{t(c.hint)}</span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loading ? <div className="p-2"><SkeletonLines lines={3} /></div> : c.items.length ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {c.items.slice(0, 50).map((it) => (
                  <li key={it.key}>
                    <button type="button" onClick={() => go(it.to)}
                      className="!flex !h-auto !min-h-0 w-full !flex-col !items-stretch !gap-1 !whitespace-normal !rounded-ctl !border-line !bg-surface !p-3 text-left !font-normal hover:!border-line-strong">
                      <span className="line-clamp-2 text-sm text-fg">{it.title}</span>
                      <span className="text-[12px] text-muted">{it.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 px-2 py-6 text-center text-[12px] text-muted">{t('暂无')}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
