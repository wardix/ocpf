import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'OmniWidget',
      fileName: () => 'widget.js',
      formats: ['iife']
    },
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: 'dist'
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  }
});
