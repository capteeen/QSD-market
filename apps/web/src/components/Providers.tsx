'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { elysiumTestnet } from '@qsd/elysium/chain';
import { publicRpcUrl } from '@/lib/env';
import { LiveProvider } from './LiveProvider';

const wagmiConfig = createConfig({
  chains: [elysiumTestnet],
  connectors: [injected()],
  transports: { [elysiumTestnet.id]: http(publicRpcUrl()) },
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
