/**
 * Agent H — jsdom stand-ins for devices the browser would supply and the app
 * cannot have under test: WebGL (the @qsd/scene canvases), a wallet, and
 * Next's dynamic/link runtime. Every stand-in is the ABSENCE of a device,
 * never a value: the scene placeholder renders nothing but a marker; the
 * wallet reports "not connected" unless a test connects one explicitly.
 */
import { vi } from 'vitest';
import React from 'react';

export const walletState: { publicKey: { toBase58(): string } | null; signMessage?: ((m: Uint8Array) => Promise<Uint8Array>) | undefined } = { publicKey: null };

vi.mock('server-only', () => ({}));

vi.mock('@/components/scenes', () => {
  const Marker = (props: { coins?: unknown[] }) => React.createElement('div', { 'data-testid': 'scene', 'data-coins': Array.isArray(props.coins) ? String(props.coins.length) : undefined });
  return { FieldScene: Marker, LaunchSequence: Marker, MeasurementScene: Marker, CollapseScene: Marker };
});

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({ publicKey: walletState.publicKey, connected: !!walletState.publicKey, signMessage: walletState.signMessage, sendTransaction: vi.fn() }),
  useConnection: () => ({ connection: {} }),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => children,
  WalletProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletMultiButton: () => React.createElement('button', { type: 'button' }, 'Connect wallet'),
  WalletModalProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@solana/wallet-adapter-react-ui/styles.css', () => ({}));
vi.mock('@solana/wallet-adapter-phantom', () => ({ PhantomWalletAdapter: class {} }));
vi.mock('@solana/wallet-adapter-solflare', () => ({ SolflareWalletAdapter: class {} }));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const Lazy = React.lazy(() =>
      (loader() as Promise<{ default?: React.ComponentType } | React.ComponentType>).then((m) => ('default' in (m as object) ? (m as { default: React.ComponentType }) : { default: m as React.ComponentType })),
    );
    return (props: Record<string, unknown>) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}));
