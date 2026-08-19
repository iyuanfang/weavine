import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TAURI_BUILD=1 → base: './' for Tauri release WebView (fixes v0.2.23 white screen
// on macOS/Windows/Android). Otherwise base: '/' for Web SPA deep-link hard-reload.
const isTauri = !!process.env.TAURI_BUILD;

// Voice-recognition backend selector. pnpm filters process.env when spawning
// subprocesses, so VITE_VOICE_MODE set on the parent shell never reaches
// vite's transform phase. Statically baking it via `define` works on every
// platform (Windows / macOS / Linux) regardless of which shell launched pnpm.
//   cloud (default) — Android voice POSTs to server /api/voice/recognize
//   local           — Android voice runs sherpa-onnx on-device
const voiceMode = process.env.VITE_VOICE_MODE === 'local' ? 'local' : 'cloud';

export default defineConfig({
  plugins: [react()],
  base: isTauri ? './' : '/',
  define: {
    'import.meta.env.VITE_VOICE_MODE': JSON.stringify(voiceMode),
  },
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
      '/files': {
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
