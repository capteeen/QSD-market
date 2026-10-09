import './setup-mocks';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { recordEvents, xmssKeyGen, deriveKeyMaterial } from '@qsd/crypto';
import { runXmss } from '@/components/terminal/xmssRun';
import { cryptoStreamLines } from '@/components/terminal/pages';
import { XmssVerifyTerminal } from '@/components/terminal/XmssVerifyTerminal';

describe('terminal: live XMSS verify', () => {
  it('verifies a fresh signature and reports what the verifier recomputed', () => {
    const r = runXmss(3);
    expect(r.valid).toBe(true);
    expect(r.startDepths).toHaveLength(67);
    expect(r.tips).toHaveLength(67);
    expect(r.climb).toHaveLength(3);
    expect(Buffer.from(r.computedRoot).equals(Buffer.from(r.expectedRoot))).toBe(true);
    expect(r.signatureBytes).toBe(4 + 32 + 67 * 32 + 3 * 32);
  });

  it('renders the verified line once the animation completes', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    // the terminal starts only once on screen; jsdom has no layout, so report every target as visible at once
    class VisibleAtOnce {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(el: Element) {
        this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    window.IntersectionObserver = VisibleAtOnce as unknown as typeof IntersectionObserver;
    const { container } = render(<XmssVerifyTerminal />);
    await waitFor(() => expect(container.textContent).toContain('signature verified'));
  });
});

describe('terminal: launch stream', () => {
  it('prints notable crypto events verbatim and counts the bulk ones', () => {
    const rec = recordEvents();
    xmssKeyGen(deriveKeyMaterial(new Uint8Array(32).fill(7)), 2, rec.observer);
    const lines = cryptoStreamLines(rec.events);
    expect(lines[0]!.text).toMatch(/keygenStart leaves=4/);
    expect(lines.some((l) => /chainStep ×\d+/.test(l.text))).toBe(true);
    expect(lines.every((l) => l.channel === 'crypto')).toBe(true);
  });
});
