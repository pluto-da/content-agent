import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts', '../evals/**/*.test.ts'], testTimeout: 20000, coverage: { include: ['src/**'], exclude: ['src/vfs/defaults.generated.ts'] } } });
