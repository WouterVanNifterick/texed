import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/texed/ in production, root in dev.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/texed/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    // The coverage HTML report lands inside the served root, and writing its
    // thousands of files otherwise reloads the open editor once per file.
    watch: { ignored: ['**/coverage/**'] },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
      // The worklet and the entry point only run inside an
      // AudioWorkletGlobalScope or the browser, and the re-export barrel holds
      // no logic worth counting.
      exclude: ['src/worklet/**', 'src/main.tsx', 'src/components/ui.tsx', '**/*.d.ts'],
      // Floors, not targets: they exist to catch a drop, so raise them as the
      // untested layers get covered.
      thresholds: {
        statements: 54,
        branches: 43,
        functions: 34,
        lines: 55,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
}));
