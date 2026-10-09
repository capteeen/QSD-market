import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // apps/web uses the `@/` path alias for its own src; Agent H imports the app's files by that alias.
    alias: { '@': path.resolve(__dirname, '../apps/web/src'), 'server-only': path.resolve(__dirname, 'web/empty.ts'), '@prisma/client': path.resolve(__dirname, 'web/prisma-stub.ts'),
      // the scene tests' renderer and three: the scene package's own copies (one React / one three instance), typed via tsconfig paths
      'scene-three': path.resolve(__dirname, '../packages/scene/node_modules/three/build/three.module.js'),
      'scene-rttr': path.resolve(__dirname, '../packages/scene/node_modules/@react-three/test-renderer/dist/react-three-test-renderer.esm.js') },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Independent verification: no mocks of the packages under test.
    // Default node; the web page tests opt into jsdom with a per-file docblock.
    environment: 'node',
    pool: 'forks',
    css: false,
    server: { deps: { inline: ['@qsd/ui-tokens', '@qsd/scene', '@qsd/protocol', '@qsd/quantum', '@qsd/crypto', '@qsd/solana'] } },
  },
});
