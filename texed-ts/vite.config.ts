import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/texed/ in production, root in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/texed/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
}));
