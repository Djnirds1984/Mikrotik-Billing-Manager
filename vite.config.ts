
import { URL, fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
          },
          '/public': {
            target: 'http://localhost:3001',
            changeOrigin: true,
          },
          '/mt-api': {
            target: 'http://localhost:3002',
            changeOrigin: true,
          },
          '/ws': {
            target: 'ws://localhost:3002',
            ws: true,
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          // @ts-ignore
          '@': fileURLToPath(new URL('.', import.meta.url)),
        }
      }
    };
});
