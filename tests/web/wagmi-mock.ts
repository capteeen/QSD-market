import React from 'react';
import { vi } from 'vitest';
import { walletState } from './wallet-state';

export function useAccount() {
  return { address: walletState.address ?? undefined, isConnected: !!walletState.address, status: walletState.address ? 'connected' : 'disconnected' };
}
export function useConnect() {
  return { connect: vi.fn(), isPending: false };
}
export function useDisconnect() {
  return { disconnect: vi.fn() };
}
export function useSendTransaction() {
  return { sendTransactionAsync: vi.fn() };
}
export function useSignMessage() {
  return {
    signMessageAsync: walletState.signMessage
      ? async ({ message }: { message: string }) => {
          const bytes = await walletState.signMessage!(new TextEncoder().encode(message));
          return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
        }
      : undefined,
  };
}
export function useConfig() {
  return {};
}
export function WagmiProvider({ children }: { children: React.ReactNode }) {
  return children;
}
export function createConfig() {
  return {};
}
export function http() {
  return {};
}
export const waitForTransactionReceipt = vi.fn();
export function injected() {
  return {};
}
