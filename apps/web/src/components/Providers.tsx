'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from '@wagmi/core';
import { elysiumChain } from '@qsd/elysium/chain';
import { publicCluster, publicRpcUrl } from '@/lib/env';
import { LiveProvider } from './LiveProvider';

const chain = elysiumChain(publicCluster());
const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(publicRpcUrl()) },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <WagmiProvider config={wagmiConfig}>
        <LiveProvider>{children}</LiveProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
