/** 页面用到的数据函数：本机与服务端两种模式在这里抹平返回形状差异。 */
import { apiMode, get, post } from './api';

export interface Draft {
  id: number; platform: string; title: string; body: string; status: 'pending' | 'approved' | 'rejected' | 'handed_off';
  tags?: string[]; model?: string; idea?: string; created_at?: string; updated_at?: string; published_at?: string;
  compliance?: { level: string; rule: string; match: string; advice: string }[];
}
export interface HotItem { title: string; url?: string; source: string; rank: number }
export interface HotState { items: HotItem[]; sources: { id: string; label: string; ok: boolean; count: number; reason?: string }[]; at: string | null; fresh?: boolean }

export const STATUS_LABEL: Record<string, string> = { pending: '待审核', approved: '待发布', handed_off: '已发布', rejected: '已退回' };

export async function listDrafts(status?: string): Promise<Draft[]> {
  return (await get<{ drafts: Draft[] }>(`/api/drafts${status ? `?status=${status}` : ''}`)).drafts;
}

/** 服务端 /api/hot 是“合并榜单”形状，这里转成本机同形。 */
function fromServerHot(d: any): HotState {
  const items = (d.merged ?? d.items ?? []).map((m: any, i: number) => ({ title: String(m.title), url: m.url ?? m.items?.[0]?.url, source: Array.isArray(m.boards) ? m.boards.join('、') : String(m.source ?? m.board ?? '热榜'), rank: i + 1 }));
  const sources = (d.runs ?? []).map((r: any) => ({ id: String(r.board ?? r.id), label: String(r.label ?? r.board), ok: r.status === 'ok', count: Number(r.count ?? 0), reason: r.status === 'ok' ? undefined : String(r.message ?? r.status) }));
  return { items, sources, at: d.at ?? null };
}

export async function loadHot(): Promise<HotState> {
  const d = await get('/api/hot');
  return apiMode() === 'server' ? fromServerHot(d) : d;
}
export async function refreshHot(): Promise<HotState> {
  if (apiMode() === 'server') { await post('/api/hot/fetch', {}); return { ...fromServerHot(await get('/api/hot')), fresh: true }; }
  return post<HotState>('/api/hot/fetch', {});
}

export async function compose(idea: string, platform: string, pick?: { providerId?: string | null; model?: string | null }): Promise<{ draft: Draft; ms?: number; cost?: number; warnings?: string[]; suggestBackup?: boolean }> {
  const t = Date.now();
  const r = await post<any>('/api/compose', { idea, platform, ...pick });
  return { ...r, ms: r.ms ?? Date.now() - t };
}

export async function revise(d: Draft, instruction: string, pick?: { providerId?: string | null; model?: string | null }): Promise<Draft> {
  if (apiMode() === 'server') {
    const end = Math.min(d.body.length, 2000);
    await post(`/api/drafts/${d.id}/partial-rewrite`, { start: 0, end, instruction });
    return (await get<{ draft: Draft }>(`/api/drafts/${d.id}`)).draft;
  }
  return (await post<{ draft: Draft }>(`/api/drafts/${d.id}/revise`, { instruction, ...pick })).draft;
}

export const setStatus = (id: number, status: string) => post(`/api/drafts/${id}/status`, { status });
export const markPublished = (id: number) => post(`/api/drafts/${id}/handoff/copy`, {});

/** 一句话意图识别：找选题 / 改写 / 写一篇。 */
export type Intent = { kind: 'topics' } | { kind: 'revise'; instruction: string } | { kind: 'write'; idea: string; platform: string | null };
export function parseIntent(text: string, detect: (t: string) => string | null): Intent {
  const t = text.trim();
  if (/^(帮我)?(找|看看?|推荐)(一下|几个|今天的?)?(热点|选题|灵感)|热点|热榜/.test(t) && t.length <= 16) return { kind: 'topics' };
  if (/^(把|将)?(这篇|上一篇|刚才那篇|它).{0,4}(改|润色|重写)|^改写|^润色|^改得/.test(t)) return { kind: 'revise', instruction: t };
  const platform = detect(t);
  const idea = t.replace(/^(帮我|请)?(写|生成|来)(一篇|一条|个)?/, '').replace(/^(小红书|抖音|公众号|知乎|闲鱼|视频号|X)(笔记|口播|脚本|文章|回答|帖子|文案)?[:：，,\s]*/, '').replace(/^(关于|讲讲|聊聊)/, '').trim();
  return { kind: 'write', idea: idea || t, platform };
}
