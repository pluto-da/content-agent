import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { useT } from './i18n';

/** 通用数据加载 hook：返回数据、错误、刷新函数。 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: ApiError | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? e : new ApiError('error', String(e))); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <strong>{error.message}</strong>
      {error.advice && <div className="muted">{error.advice}</div>}
    </div>
  );
}

export function Loading({ show }: { show: boolean }) {
  const { t } = useT();
  return show ? <p className="muted" aria-live="polite">{t('加载中')}</p> : null;
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, ['ok' | 'warn' | 'bad' | 'neutral' | 'info', string]> = {
    ok: ['ok', '成功'], ready: ['ok', '已就绪'], succeeded: ['ok', '成功'], approved: ['ok', '已通过'], handed_off: ['info', '已交接'],
    not_configured: ['warn', '未配置'], robots_disallow: ['warn', 'robots 禁止'], pending: ['neutral', '待审核'], queued: ['neutral', '排队'], running: ['info', '运行中'],
    network_error: ['bad', '网络失败'], parse_error: ['bad', '解析失败'], error: ['bad', '失败'], failed: ['bad', '失败'], rejected: ['bad', '已驳回'],
    candidate: ['neutral', '候选'], adopted: ['info', '已采用'], dismissed: ['neutral', '已跳过'],
  };
  const [tone, label] = map[status] ?? ['neutral', status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** 轻提示：屏幕阅读器可读。 */
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return [<div key="toast" className={`toast ${msg ? 'show' : ''}`} role="status" aria-live="polite">{msg}</div>, setMsg];
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
