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
      // main.tsx only mounts React into the page; there is nothing to assert.
      exclude: ['src/main.tsx', '**/*.d.ts'],
      // Floors, not targets: they catch a regression, so raise them as coverage
      // grows. Per-area, because a single global number hid that the engine sits
      // at 90% while the React layer is near zero - it could only ever be set
      // low enough to be meaningless for the part that matters most.
      thresholds: {
        'packages/dx7-engine/src/**': {
          statements: 88,
          branches: 79,
          functions: 84,
          lines: 89,
        },
        'packages/dx7-format/src/**': {
          statements: 73,
          branches: 60,
          functions: 64,
          lines: 76,
        },
        'packages/synth-protocol/src/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // The UI is the weak spot. This floor is deliberately just under where it
        // stands today; it should climb every time a component gains a test.
        'src/**': {
          statements: 13,
          branches: 9,
          functions: 10,
          lines: 14,
        },
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
