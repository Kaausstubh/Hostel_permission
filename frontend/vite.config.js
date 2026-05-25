import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Target modern browsers — enables native ES2020+ features (no polyfill overhead)
    target: 'es2020',

    // esbuild is 10-20x faster than terser and produces near-identical output
    minify: 'esbuild',

    // Split CSS per-chunk — only loads styles for the current route
    cssCodeSplit: true,

    // Skip compressed size calculation — saves 1-3s on every build
    reportCompressedSize: false,

    // No source maps in production — reduces bundle size & avoids leaking source
    sourcemap: false,

    // Raise limit since we split chunks below — avoids false warnings
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        /**
         * Granular chunk splitting strategy:
         *
         * Each chunk is independently cacheable by the browser/CDN.
         * When app code changes, only the app chunk is invalidated —
         * vendor/charts/qr/icons stay cached (they rarely change).
         *
         *  vendor-core   → react + react-dom  (stable, small, always needed)
         *  vendor-router → react-router-dom   (stable, rarely changes)
         *  vendor-utils  → axios + date-fns   (stable utility libs)
         *  charts        → recharts + d3-*    (heavy, only warden dashboard)
         *  qr            → html5-qrcode       (heavy, only security dashboard)
         *  icons         → react-icons        (medium, tree-shaken per page)
         *  toast         → react-hot-toast    (tiny, always loaded)
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('react-dom')) return 'vendor-core';
          if (id.includes('/react/') && !id.includes('react-dom') && !id.includes('react-router') && !id.includes('react-hot-toast') && !id.includes('react-icons')) return 'vendor-core';
          if (id.includes('react-router')) return 'vendor-router';

          if (id.includes('axios') || id.includes('date-fns')) return 'vendor-utils';

          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts';

          if (id.includes('html5-qrcode') || id.includes('qrcode')) return 'qr';

          if (id.includes('react-icons')) return 'icons';

          if (id.includes('react-hot-toast')) return 'toast';
        },

        // Content-hash filenames for long-term CDN caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
