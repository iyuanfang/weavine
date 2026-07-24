import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TAURI_BUILD=1 → base: './' for Tauri release WebView (fixes v0.2.23 white screen
// on macOS/Windows/Android). Otherwise base: '/' for Web SPA deep-link hard-reload.
const isTauri = !!process.env.TAURI_BUILD;

export default defineConfig({
  plugins: [react()],
  base: isTauri ? './' : '/',
  server: {
    port: 5181,
    strictPort: true,
    host: '127.0.0.1',
    hmr: { port: 5181 },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  clearScreen: false,
  build: {
    outDir: 'dist',
    assetsDir: 'spa',
    sourcemap: true,
    target: 'es2020',
  },
});
