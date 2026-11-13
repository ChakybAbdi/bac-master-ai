import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API runs on its own port (PORT in .env) and Vite proxies /api to it.
// The target is 127.0.0.1, where the API listens, rather than "localhost", which can
// resolve to the IPv6 address first. changeOrigin stays false so the Host header keeps
// matching the browser's Origin, which the API's same-origin check relies on.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT || '8787';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
    build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
  };
});
