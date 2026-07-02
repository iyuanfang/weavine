import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    host: '127.0.0.1',
    hmr: { port: 5182 },
  },
  clearScreen: false,
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
  },
});
