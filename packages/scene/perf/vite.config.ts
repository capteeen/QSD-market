import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: resolve(here, '../test/fixtures/generated'),
  plugins: [react()],
  server: { port: 4177, strictPort: false, host: '127.0.0.1' },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true },
  resolve: { dedupe: ['react', 'react-dom', 'three'] },
  optimizeDeps: { include: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing', 'zustand'] },
});
