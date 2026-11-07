/**
 * Shared module mocks for page tests. jsdom has no WebGL and no wallet, so the
 * scenes render a labelled placeholder and the wallet adapter reports
 * "not connected". Nothing here fabricates data: every mock is the absence
 * of a device, not a stand-in value.
 */
import { vi } from 'vitest';
import React from 'react';

vi.mock('@/components/scenes', () => {
  const Placeholder = (props: { coins?: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'scene', 'data-coins': Array.isArray(props.coins) ? String(props.coins.length) : undefined });
  return { FieldScene: Placeholder, LaunchSequence: Placeholder, MeasurementScene: Placeholder, CollapseScene: Placeholder };
});

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useConnect: () => ({ connect: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSendTransaction: () => ({ sendTransactionAsync: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: undefined }),
  useConfig: () => ({}),
  WagmiProvider: ({ children }: { children: React.ReactNode }) => children,
  createConfig: () => ({}),
  http: () => ({}),
}));
vi.mock('wagmi/connectors', () => ({ injected: () => ({}) }));
vi.mock('@wagmi/core', () => ({ injected: () => ({}) }));
vi.mock('wagmi/actions', () => ({ waitForTransactionReceipt: vi.fn() }));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    // Resolve the dynamic import eagerly in tests.
    const Lazy = React.lazy(() => (loader() as Promise<{ default?: React.ComponentType } | React.ComponentType>).then((m) => ('default' in (m as object) ? (m as { default: React.ComponentType }) : { default: m as React.ComponentType })));
    return (props: Record<string, unknown>) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}));
