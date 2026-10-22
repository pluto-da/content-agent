import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App';
import { runtime } from './runtime';
import './styles.css';

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
