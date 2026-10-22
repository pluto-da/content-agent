import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 0.6.0：冷启动（首次导入 SQLite 与共用模块）偶发超过默认 10s 的钩子超时，放宽到 60s
    hookTimeout: 60000,
    testTimeout: 30000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/index.ts', 'src/scripts/**'], reporter: ['text-summary', 'text'] },
  },
});
