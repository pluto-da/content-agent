import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App';
import { runtime } from './runtime';
import './styles.css';

// 1.0：未处理的异步错误留一份（名称 / 信息 / 调用栈，最多 20 条，不含任何数据），供 我的 → 诊断 与桌面冒烟定位。
const caErrors: { name: string; message: string; stack?: string; at: string }[] = [];
(window as unknown as { __caErrors: typeof caErrors }).__caErrors = caErrors;
window.addEventListener('unhandledrejection', (ev) => { const e = ev.reason as Error | undefined; if (caErrors.length < 20) caErrors.push({ name: e?.name ?? 'Error', message: String(e?.message ?? e).slice(0, 300), stack: e?.stack?.slice(0, 1200), at: new Date().toISOString() }); });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// App（Capacitor）：状态栏不覆盖网页内容（修 0.5.0“最上边看不清”），图标颜色随深浅色切换。
if (runtime() === 'capacitor') void import('./statusbar').then((m) => m.initStatusBar());

// 网页版注册 Service Worker（离线缓存应用外壳）；App 内由原生容器负责。
if (runtime() === 'web' && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
