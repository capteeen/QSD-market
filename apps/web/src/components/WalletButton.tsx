'use client';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from '@wagmi/core';
import { WALLET } from '@/copy';

export function WalletButton() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected) {
    return (
      <button type="button" className="qsd-btn" title={WALLET.connected} onClick={() => disconnect()}>
        {WALLET.disconnect}
      </button>
    );
  }
  return (
    <button type="button" className="qsd-btn" onClick={() => connect({ connector: injected() })}>
      {WALLET.connect}
    </button>
  );
}
