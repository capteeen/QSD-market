import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // apps/web uses the `@/` path alias for its own src; Agent H imports the app's files by that alias.
    // Exact wagmi aliases: a prefix alias of `wagmi` would look for subpaths inside the mock file.
    alias: [
      { find: /^wagmi\/connectors$/, replacement: path.resolve(__dirname, 'web/wagmi-mock.ts') },
      { find: /^wagmi\/actions$/, replacement: path.resolve(__dirname, 'web/wagmi-mock.ts') },
      { find: /^wagmi$/, replacement: path.resolve(__dirname, 'web/wagmi-mock.ts') },
      { find: '@', replacement: path.resolve(__dirname, '../apps/web/src') },
      { find: 'server-only', replacement: path.resolve(__dirname, 'web/empty.ts') },
      { find: '@prisma/client', replacement: path.resolve(__dirname, 'web/prisma-stub.ts') },
      { find: 'scene-three', replacement: path.resolve(__dirname, '../packages/scene/node_modules/three/build/three.module.js') },
      { find: 'scene-rttr', replacement: path.resolve(__dirname, '../packages/scene/node_modules/@react-three/test-renderer/dist/react-three-test-renderer.esm.js') },
    ],
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
