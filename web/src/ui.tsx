import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError } from './api';
import { useT } from './i18n';
import { Icon } from './icons';

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

/** 是否开启了“减少动态效果”。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 数字显示（v3：不做滚动动画，直接显示，等宽数字）。 */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '' }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  return <span className="num">{prefix}{value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

export function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <Icon name="alert" size={16} />
      <div>
        <strong>{error.message}</strong>
        {error.advice && <div className="muted">{error.advice}</div>}
      </div>
    </div>
  );
}

/** 骨架占位。 */
export function Skeleton({ w = '100%', h = 12, r = 6, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="skeleton" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} w={`${92 - ((i * 17) % 40)}%`} />)}
    </div>
  );
}

export function Loading({ show, lines = 3 }: { show: boolean; lines?: number }) {
  const { t } = useT();
  if (!show) return null;
  return (
    <div className="loading" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('加载中')}</span>
      <SkeletonLines lines={lines} />
    </div>
  );
}

/** 卡片：平面 + 发丝线。v3 起标题不再带彩色图标底块（icon 参数保留以兼容调用方，但不渲染）。 */
export function Card({ title, actions, children, subtitle, className, style }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; subtitle?: ReactNode; icon?: string; className?: string; style?: CSSProperties }) {
  return (
    <section className={`card ${className ?? ''}`} style={style}>
      {(title || actions) && (
        <header className="card-h">
          <div className="card-t">
            <div className="grow">
              {title && <h2>{title}</h2>}
              {subtitle && <p className="card-sub">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="row wrap card-a">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children, icon = 'inbox' }: { children: ReactNode; icon?: string }) {
  return <div className="empty"><span className="empty-ico"><Icon name={icon} size={20} /></span><span>{children}</span></div>;
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
  return <StatusDot tone={tone}>{label}</StatusDot>;
}

/** 状态：一个小圆点 + 文字（0.5.0 起替代列表里的彩色徽章，降低视觉噪声）。 */
export function StatusDot({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'info'; children: ReactNode }) {
  return <span className={`status-dot ${tone}`}>{children}</span>;
}

/** 迷你折线（纯 SVG）。values 为空或全 0 时显示平线。 */
export function Sparkline({ values, w = 120, h = 36, label }: { values: number[]; w?: number; h?: number; label?: string }) {
  const vs = values.length > 1 ? values : [0, ...values, 0].slice(0, Math.max(2, values.length));
  const max = Math.max(...vs, 1);
  const min = Math.min(...vs, 0);
  const pad = 3;
  const x = (i: number) => (i / (vs.length - 1)) * w;
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const pts = vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path className="spark-area" d={area} />
      <path className="spark-line" d={line} pathLength={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 迷你柱状（纯 SVG）。 */
export function MiniBars({ values, w = 120, h = 36, label }: { values: number[]; w?: number; h?: number; label?: string }) {
  const vs = values.length ? values : [0];
  const max = Math.max(...vs, 1);
  const gap = 3;
  const bw = Math.max(2, (w - gap * (vs.length - 1)) / vs.length);
  return (
    <svg className="spark bars" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {vs.map((v, i) => {
        const bh = Math.max(2, (v / max) * (h - 2));
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={1} />;
      })}
    </svg>
  );
}

/** 轻提示：屏幕阅读器可读，150–200ms 淡入淡出。 */
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState('');
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!msg) return;
    setShown(msg);
    const t = setTimeout(() => setMsg(''), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return [
    <div key="toast" className={`toast ${msg ? 'show' : ''}`} role="status" aria-live="polite">
      {shown && <Icon name="check" size={16} className="toast-ico" />}
      <span>{msg ? msg : <span aria-hidden="true">{shown}</span>}</span>
    </div>,
    setMsg,
  ];
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
