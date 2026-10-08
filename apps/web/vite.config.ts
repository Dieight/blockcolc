import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: process.env.VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS === 'true' ? [] : [{
      find: /^\.\/performance-probe$/,
      replacement: fileURLToPath(new URL('./src/performance-probe-disabled.ts', import.meta.url)),
    }],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/');
          if (normalized.includes('/node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
