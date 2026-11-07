import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
    server: { deps: { inline: ['@qsd/ui-tokens', '@qsd/scene', '@qsd/protocol', '@qsd/quantum', '@qsd/crypto'] } },
  },
});
