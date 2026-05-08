import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Raise warning threshold — large chunks are expected and handled below
    chunkSizeWarningLimit: 600,

    // No source maps in production — reduces bundle size & avoids leaking source
    sourcemap: false,

    rollupOptions: {
      output: {
        /**
         * Manual chunk splitting strategy:
         *  - 'vendor'  → react, react-dom, react-router-dom (stable, cacheable)
         *  - 'charts'  → recharts (heavy, only used in warden dashboard)
         *  - 'qr'      → html5-qrcode (only used in security dashboard)
         *  - 'icons'   → react-icons (tree-shaken but still sizeable)
         *  Everything else lands in 'index' (app code).
         */
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('react-dom') ||
              id.includes('react-router') ||
              id.includes('/react/')
            ) {
              return 'vendor';
            }
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
              return 'charts';
            }
            if (id.includes('html5-qrcode') || id.includes('qrcode')) {
              return 'qr';
            }
            if (id.includes('react-icons')) {
              return 'icons';
            }
          }
        },
      },
    },
  },
});
