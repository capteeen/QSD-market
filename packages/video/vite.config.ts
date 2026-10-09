import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { port: 4178, strictPort: false, host: '127.0.0.1' },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, target: 'es2022' },
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  optimizeDeps: { include: ['react', 'react-dom', 'three', '@react-three/fiber'] },
});
