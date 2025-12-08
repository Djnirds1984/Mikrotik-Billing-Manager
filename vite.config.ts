
import { URL, fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', '');
  const isBuild = command === 'build';
  return {
    mode: isBuild ? 'production' : mode,
    base: env.BASE_URL || '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: ['verecund-millipede-5831.dataplicity.io', 'localhost', '127.0.0.1'],
      proxy: {
        '/mt-api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/db': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: 'http://localhost:3002',
          changeOrigin: true,
          secure: false,
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
        '@': fileURLToPath(new URL('.', import.meta.url)),
      }
    },
    build: {
      minify: true,
      sourcemap: false,
      cssCodeSplit: true,
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]'
        }
      }
    }
  };
});
