import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ['@qsd/ui-tokens', '@qsd/scene', '@qsd/protocol', '@qsd/quantum', '@qsd/crypto', '@qsd/solana'],
  experimental: {
    // Keep node-only packages out of the client bundle and out of the server webpack graph.
    serverComponentsExternalPackages: ['@prisma/client', 'ioredis', 'bullmq', 'pino', 'pino-pretty'],
    // Trace from the monorepo root so serverless bundles (Vercel) keep the repo layout, and
    // ship docs/physics.md and docs/economics.md with the /how API: it renders those files verbatim at request time.
    outputFileTracingRoot: workspaceRoot,
    outputFileTracingIncludes: {
      '/api/how': ['../../docs/physics.md', '../../docs/economics.md'],
      '/how': ['../../docs/physics.md', '../../docs/economics.md'],
    },
  },
  webpack: (config, { isServer }) => {
    // Workspace packages import './x.js' meaning './x.ts' (TS "Bundler" resolution).
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    if (!isServer) {
      config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false, path: false, os: false, net: false, tls: false, crypto: false };
    }
    config.externals = [...(config.externals ?? []), 'pino-pretty', 'encoding'];
    return config;
  },
};
export default nextConfig;
