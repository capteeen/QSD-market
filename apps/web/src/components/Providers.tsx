'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import '@solana/wallet-adapter-react-ui/styles.css';
import { publicRpcUrl } from '@/lib/env';
import { LiveProvider } from './LiveProvider';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: false } } }));
  // The public mainnet endpoint refuses browsers (HTTP 403), so without NEXT_PUBLIC_SOLANA_RPC_URL the wallet talks to our own /api/rpc relay.
  const endpoint = useMemo(() => publicRpcUrl() ?? (typeof window === 'undefined' ? 'http://localhost/api/rpc' : `${window.location.origin}/api/rpc`), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <QueryClientProvider client={client}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <LiveProvider>{children}</LiveProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
