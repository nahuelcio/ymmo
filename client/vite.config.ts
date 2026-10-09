import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // GAME_PORT is the game server. Local cargo uses 3001. The Docker map is 3002.
    proxy: { '/ws': { target: `ws://127.0.0.1:${process.env.GAME_PORT ?? '3001'}`, ws: true } },
    allowedHosts: ['localhost', 'bus-sonic-screenshots-escape.trycloudflare.com', '0.0.0.0'],
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
