import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/texed/ in production, root in dev.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/texed/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  test: {
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
