/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ['@qsd/ui-tokens', '@qsd/scene', '@qsd/protocol', '@qsd/quantum', '@qsd/crypto', '@qsd/solana'],
  experimental: {
    // Keep node-only packages out of the client bundle and out of the server webpack graph.
    serverComponentsExternalPackages: ['@prisma/client', 'ioredis', 'bullmq', 'pino', 'pino-pretty'],
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
