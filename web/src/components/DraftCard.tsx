import { useT } from '../i18n';
import { Icon } from '../icons';
import { writePlatform } from '../data/platforms';
import { STATUS_LABEL, type Draft } from '../services';
import { StatusDot } from '../ui';

/** 生成结果卡片：标题 + 正文 + 字数，两个动作“编辑”“去发布”。 */
export function DraftCard({ draft, go, ms, note }: { draft: Draft; go: (to: string) => void; ms?: number; note?: string }) {
  const { t } = useT();
  const len = [...(draft.body ?? '')].length;
  return (
    <article className="draft-card" data-testid="draft-card" aria-label={t('ui.generated_results')}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span className="chip">{writePlatform(draft.platform).label}</span>
        <StatusDot tone={draft.status === 'pending' ? 'neutral' : draft.status === 'approved' ? 'info' : 'ok'}>{STATUS_LABEL[draft.status] ?? draft.status}</StatusDot>
        {ms !== undefined && <span>{t('ui.time_taken')} {(ms / 1000).toFixed(1)} {t('ui.s')}</span>}
        <span>{t('ui.body')} {len} {t('ui.chars')}</span>
      </div>
      {draft.title && <h3 data-testid="draft-title">{draft.title}</h3>}
      <div className="body" data-testid="draft-body">{draft.body}</div>
      {!!draft.tags?.length && <div className="chips mt-3">{draft.tags.slice(0, 6).map((x) => <span key={x} className="chip">#{x.replace(/^#/, '')}</span>)}</div>}
      {note && <p className="mt-3 mb-0 text-[14px] text-fg-2"><Icon name="info" size={14} className="mr-1 inline" />{note}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => go(`write/${draft.id}`)}><Icon name="edit" size={16} />{t('ui.edit')}</button>
        <button type="button" className="primary" onClick={() => go(draft.status === 'pending' ? `write/${draft.id}` : 'publish')} data-testid="card-publish">{draft.status === 'pending' ? t('ui.publish_after_review') : t('ui.go_publish')}</button>
      </div>
    </article>
  );
}
