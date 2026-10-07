import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/ws': { target: 'ws://localhost:3001', ws: true } },
    allowedHosts: ['localhost', 'bus-sonic-screenshots-escape.trycloudflare.com', '0.0.0.0'],
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
