/** Shared by the wagmi stand-in and the page tests. Absent until a test connects one. */
export const walletState = {
  address: null as string | null,
  signMessage: undefined as ((m: Uint8Array) => Promise<Uint8Array>) | undefined,
  get publicKey(): { toBase58(): string } | null {
    return this.address ? { toBase58: () => this.address as string } : null;
  },
  set publicKey(v: { toBase58(): string } | null) {
    this.address = v ? v.toBase58() : null;
  },
};
