import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/rocket-landing-3d-version2/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  plugins: [],
});
