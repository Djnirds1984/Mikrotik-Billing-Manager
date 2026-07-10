
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
      allowedHosts: true,
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
        '/api/hotspot': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/nodemcu': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/auth': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/roles': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/permissions': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/panel-users': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/billing-ledger': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/client-balance': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/api/public': {
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
      target: 'es2020',
      minify: true,
      cssMinify: true,
      sourcemap: false,
      cssCodeSplit: true,
      assetsDir: 'assets',
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-charts': ['chart.js', 'react-chartjs-2'],
            'vendor-recharts': ['recharts'],
            'vendor-maps': ['leaflet'],
          }
        }
      }
    }
  };
});
