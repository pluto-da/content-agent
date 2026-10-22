import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 网页版（由后端同源提供）只允许连接自身；App 版（Capacitor/Electron）需要连接用户填写的服务地址。
const target = process.env.VITE_TARGET ?? 'web';
// 0.6.0 本机模式：网页版也要直连模型服务与 RSS（https），App 版还允许局域网 http（如 Ollama）。
const connect = target === 'app' ? "'self' http: https:" : "'self' https: http://localhost:* http://127.0.0.1:*";
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' blob: data: http: https:; connect-src ${connect}; frame-src https:; object-src 'none'; base-uri 'self'`;

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: 'csp', transformIndexHtml: (html: string) => html.replace('%CA_CSP%', csp) }],
  base: target === 'app' ? './' : '/',
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'jsdom', testTimeout: 20000, include: ['src/**/*.test.{ts,tsx}'], coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx', 'src/**/*.test.*'], reporter: ['text-summary', 'text'] } },
} as never);
