/** 0.9.0 新卡片：图片、音频、视频、转写、推理、未配置、记忆、提醒、子任务、清单、修订建议、收益、检索、工具失败。每张失败卡都有原因 + 下一步。 */
import { useEffect, useState, type ReactNode } from 'react';
import { roleLabel, type RoleId } from '@content-agent/shared';
import type { CardData } from '../agent/store';
import type { CardActions } from '../agent/cards';
import { getMedia, type MediaRow } from './models';
import { tr } from '../i18n';

const Btn = ({ children, onClick, primary, testId }: { children: ReactNode; onClick: () => void; primary?: boolean; testId?: string }) => <button type="button" data-testid={testId} className={`!min-h-9 !px-3 !text-[14px] ${primary ? 'primary' : ''}`} onClick={onClick}>{children}</button>;
/** 0.10.0：内置工具的中文名（0.9 运行时的卡片头部原来显示英文工具名）。 */
export const V9_TITLES: Record<string, string> = { draft_write: '写稿', image_generate: '生图', image_edit: '改图', image_understand: '看图', speech_synthesize: '配音', speech_transcribe: '转写', video_generate: '生成视频', video_status: '查视频进度', reason_deep: '深度推理', library_search: '检索', hot_list: '看热点', publish_check: '发布前检查', reminder_create: '设提醒', reminder_cancel: '取消提醒', memory_propose: '记住偏好', memory_delete: '忘掉', drafts_delete: '删除草稿', models_status: '模型状态', revenue_summary: '收益汇总', system_file_propose: '修订建议', text_delegate: '子任务', self_check: '自检' };
type MediaItem = { id: string; dataUrl?: string; kind?: MediaRow['kind']; prompt?: string; aiLabel?: MediaRow['aiLabel'] };
function Media({ item }: { item: MediaItem }) {
  const id = item.id;
  const [m, setM] = useState<MediaRow | null>(item.dataUrl ? ({ id: 0, kind: item.kind ?? 'image', mime: '', dataUrl: item.dataUrl, model: '', prompt: item.prompt ?? '', role: 'image', aiLabel: item.aiLabel ?? { explicit: true, implicit: true } } as MediaRow) : null);
  useEffect(() => { if (!item.dataUrl) void getMedia(id).then(setM); }, [id, item.dataUrl]);
  if (!m) return <div className="h-24 w-24 animate-pulse rounded-[10px] bg-surface-2" />;
  const implicitLine = m.aiLabel?.implicit ? '已写入隐式 AI 标识' : `未写入隐式标识${m.aiLabel?.reason ? `（${m.aiLabel.reason}）` : ''}，发布时请在平台勾选 AI 生成声明`;
  if (m.kind === 'audio') return <figure className="m-0 w-full"><audio controls src={m.dataUrl} className="w-full" data-testid="media-audio" /><figcaption className="text-[11px] text-muted">{implicitLine}</figcaption></figure>;
  if (m.kind === 'video') return <figure className="m-0 w-full"><video controls src={m.dataUrl} className="max-h-60 w-full rounded-[10px]" data-testid="media-video" /><figcaption className="text-[11px] text-muted">{implicitLine}</figcaption></figure>;
  return (
    <figure className="m-0">
      <img src={m.dataUrl} alt={m.prompt} className="h-28 w-28 rounded-[10px] object-cover" data-testid="media-image" />
      <figcaption className="text-[11px] text-muted">{m.aiLabel.explicit ? 'AI 生成·已加角标' : 'AI 生成·发布时请在平台勾选声明'}</figcaption>
    </figure>
  );
}
const ModelLine = ({ d }: { d: Record<string, any> }) => (d.model ? <p className="m-0 mt-1 text-[12px] text-muted" data-testid="card-model">模型：{d.model}{d.respondedModel ? `（服务商实际返回：${d.respondedModel}）` : ''}{d.cost ? ` · ¥${Number(d.cost).toFixed(3)}` : ''}</p> : null);

export function V9Body({ card, actions }: { card: CardData; actions: CardActions }) {
  const d = (card.data ?? {}) as Record<string, any>;
  switch (card.type) {
    case 'image': case 'audio': {
      if (d.status === 'failed') return <Fail reason={d.reason} advice={d.advice} actions={actions} retry />;
      const media = (d.media ?? []) as MediaItem[];
      return (
        <div>
          {d.note && <p className="m-0 mb-1 text-[13px] text-muted">{d.note}</p>}
          <div className="flex flex-wrap gap-2">{media.map((x) => <Media key={x.id} item={x} />)}</div>
          <ModelLine d={d} />
          <div className="mt-2 flex flex-wrap gap-2"><Btn onClick={() => actions.ask(card.type === 'image' ? '换个风格再出一张' : '换个音色再配一遍')}>{tr('ui.again')}</Btn></div>
        </div>
      );
    }
    case 'video': {
      if (d.status === 'failed') return <Fail reason={d.reason} advice={d.advice} actions={actions} />;
      if (d.status !== 'succeeded') return <p className="m-0">视频任务已提交（{d.status === 'running' ? '生成中' : '排队中'}），任务号 {d.jobId}。离开页面不会中断，完成后会通知你。<ModelLine d={d} /></p>;
      return <div className="flex flex-wrap gap-2">{(d.media ?? []).map((x: MediaItem) => <Media key={x.id} item={x} />)}</div>;
    }
    case 'transcript': return <div><p className="m-0 whitespace-pre-wrap" data-testid="transcript">{d.text || '（没有识别到文字）'}</p>{Array.isArray(d.segments) && d.segments.length > 0 && <p className="m-0 mt-1 text-[12px] text-muted">{d.segments.length} 段，带时间戳</p>}<ModelLine d={d} /></div>;
    case 'reason': return <div><p className="m-0">{d.conclusion}</p>{d.reasoning && <details className="mt-1 text-[13px] text-muted"><summary>{tr('ui.reasoning_2')}</summary><p className="m-0 whitespace-pre-wrap">{d.reasoning}</p></details>}<ModelLine d={d} /></div>;
    case 'not_configured': {
      const role = d.role as RoleId;
      return (
        <div data-testid="not-configured">
          <p className="m-0 text-fg">{d.text ?? `还没接${roleLabel(role)}模型`}</p>
          <p className="m-0 mt-1 text-[13px] text-muted">{tr('ui.the_text_part_is_unaffected')}</p>
          <div className="mt-2"><a className="button primary !min-h-9 !px-3 !text-[14px]" href={d.deepLink ?? `#me/models`} data-testid="go-configure">去接{roleLabel(role)}</a></div>
        </div>
      );
    }
    case 'memory': return <p className="m-0">{d.forgotten !== undefined ? `已删除 ${d.forgotten} 条，复查命中 ${d.verifyHits} 条；以后不再记这类信息。` : `已记住：${d.text}${d.condition ? `（条件：${d.condition}）` : ''}`}</p>;
    case 'reminder': return <p className="m-0">{d.when} 提醒你：{d.text}<br /><span className="text-[12px] text-muted">{tr('ui.at_the_set_time_only')}</span></p>;
    case 'subtask': return <div><p className="m-0">子任务：{d.summary}</p><p className="m-0 mt-1 text-[12px] text-muted">产物 {d.artifacts?.length ?? 0} 个{d.cost ? ` · ¥${Number(d.cost).toFixed(3)}` : ''}</p></div>;
    case 'checklist': return <ul className="m-0 list-none p-0">{(d.items ?? []).map((i: { ok: boolean; text: string }, k: number) => <li key={k} className={i.ok ? '' : 'text-warn'}>{i.ok ? '✓' : '!'} {i.text}</li>)}<li className="mt-1 text-[12px] text-muted">{d.note}</li></ul>;
    case 'proposal': return <div><p className="m-0">修订建议已生成：{d.target}</p><p className="m-0 mt-1 text-[13px] text-muted">{tr('ui.applies_only_after_you_review')}</p><div className="mt-2"><a className="button !min-h-9 !px-3 !text-[14px]" href="#me/growth">{tr('ui.confirm_in_growth_log')}</a></div></div>;
    case 'revenue': return <p className="m-0">{d.text}</p>;
    case 'search': return <div><p className="m-0 text-[13px] text-muted">{d.mode === 'keyword' ? '关键词检索（没接向量模型）' : '向量 + 关键词检索'}</p><ul className="m-0 list-none p-0">{(d.hits ?? []).slice(0, 5).map((h: { id: string; title: string }) => <li key={h.id}>{h.title}</li>)}</ul></div>;
    case 'tool_error': return <Fail reason={d.reason} advice={d.advice} actions={actions} retry />;
    default: return <p className="m-0 text-muted">{tr('ui.done_2')}</p>;
  }
}
function Fail({ reason, advice, actions, retry }: { reason?: string; advice?: string; actions: CardActions; retry?: boolean }) {
  return (
    <div role="alert">
      <p className="m-0 text-fg">{reason ?? '没有成功'}</p>
      {advice && <p className="m-0 mt-1 text-[13px] text-muted">{advice}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{retry && <Btn primary onClick={() => actions.ask('重试刚才失败的那一步')}>{tr('ui.retry')}</Btn>}<a className="button !min-h-9 !px-3 !text-[14px]" href="#me/models">{tr('ui.check_model_settings')}</a></div>
    </div>
  );
}
