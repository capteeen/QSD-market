import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown, formatHMS, parseTarget } from './Countdown.js';
import { DataRow } from './DataRow.js';
import { EmptyState } from './EmptyState.js';
import { HashDisplay, truncateMiddle } from './HashDisplay.js';
import { LineageBreadcrumb } from './LineageBreadcrumb.js';
import { MeasureButton } from './MeasureButton.js';
import { Panel } from './Panel.js';
import { ProofBadge, proofStatusToken, UNSAFE_DEV_WARNING, type ProofStatus } from './ProofBadge.js';
import { Unavailable } from './Unavailable.js';

const DIGIT = /\d/;

describe('Unavailable', () => {
  it('renders the dash, label and reason with no digits', () => {
    const { container } = render(<Unavailable reason="provider down" />);
    expect(container.textContent).toContain('—');
    expect(container.textContent).toContain('not available');
    expect(container.textContent).toContain('provider down');
    expect(container.textContent).not.toMatch(DIGIT);
  });
});

describe('Panel', () => {
  it('renders children normally', () => {
    render(<Panel eyebrow="eb" title="T">child</Panel>);
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.getByText('eb')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument();
  });
  it('renders the unavailable state instead of children', () => {
    const { container } = render(
      <Panel unavailable={{ reason: 'indexer unreachable' }}>
        <span>should not render</span>
      </Panel>,
    );
    expect(screen.queryByText('should not render')).toBeNull();
    expect(screen.getByText('indexer unreachable', { exact: false })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-unavailable', 'true');
  });
  it('marks computing', () => {
    const { container } = render(<Panel computing>x</Panel>);
    expect(container.firstElementChild).toHaveAttribute('data-computing', 'true');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });
});

describe('DataRow', () => {
  it('renders a string value', () => {
    render(<DataRow label="ticker" value="EXAMPLE" />);
    expect(screen.getByRole('cell')).toHaveTextContent('EXAMPLE');
  });
  it('renders a numeric value with a unit', () => {
    render(<DataRow label="half-life" value={3600} unit="s" />);
    expect(screen.getByRole('cell')).toHaveTextContent('3600');
    expect(screen.getByRole('cell')).toHaveTextContent('s');
  });
  it('never renders a digit when value is undefined', () => {
    render(<DataRow label="holders" unavailable={{ reason: 'DAS unreachable' }} />);
    const cell = screen.getByRole('cell');
    expect(cell).toHaveAttribute('data-unavailable', 'true');
    expect(cell.textContent).toContain('not available');
    expect(cell.textContent).toContain('DAS unreachable');
    expect(cell.textContent).not.toMatch(DIGIT);
  });
  it('never renders a digit when value is undefined and no reason is given', () => {
    render(<DataRow label="holders" />);
    const cell = screen.getByRole('cell');
    expect(cell.textContent).not.toMatch(DIGIT);
    expect(cell.textContent).toContain('not available');
  });
  it('treats NaN as unavailable', () => {
    render(<DataRow label="x" value={Number.NaN} />);
    expect(screen.getByRole('cell').textContent).not.toMatch(DIGIT);
  });
  it('does not render a number when value is 0 only if it is really 0', () => {
    render(<DataRow label="x" value={0} />);
    expect(screen.getByRole('cell')).toHaveTextContent('0');
  });
});

describe('HashDisplay', () => {
  const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('truncates with a middle ellipsis and exposes the full hash as title', () => {
    render(<HashDisplay hash={hex} />);
    const code = screen.getByTitle(hex);
    expect(code).toHaveTextContent('a1b2c3d4…7e8f90');
    expect(truncateMiddle('abc', 8, 6)).toBe('abc');
  });
  it('renders the full hash when full', () => {
    render(<HashDisplay hash={hex} full />);
    expect(screen.getByTitle(hex)).toHaveTextContent(hex);
  });
  it('renders "no hash" for undefined and empty', () => {
    const { container, rerender } = render(<HashDisplay unavailable={{ reason: 'nothing hashed' }} />);
    expect(container.textContent).toContain('no hash');
    expect(container.textContent).toContain('nothing hashed');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<HashDisplay hash="" />);
    expect(container.textContent).toContain('no hash');
  });
  it('copies to the clipboard and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onCopied = vi.fn();
    render(<HashDisplay hash={hex} onCopied={onCopied} />);
    const btn = screen.getByRole('button', { name: 'copy' });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith(hex);
    expect(onCopied).toHaveBeenCalledWith(hex);
    expect(btn).toHaveTextContent('copied');
    expect(btn).toHaveAttribute('data-copied', 'true');
  });
  it('reports a failed copy honestly', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<HashDisplay hash={hex} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('button')).toHaveTextContent('copy failed');
  });
});

describe('ProofBadge', () => {
  const expected: Record<ProofStatus, string> = {
    verified: 'probability',
    pending: 'decay',
    invalid: 'collapse',
    unverified: 'muted',
    unavailable: 'dead',
  };
  for (const [status, token] of Object.entries(expected) as [ProofStatus, string][]) {
    it(`maps ${status} → ${token}`, () => {
      const { container } = render(<ProofBadge status={status} reason="r" />);
      const el = container.firstElementChild as HTMLElement;
      expect(proofStatusToken[status]).toBe(token);
      expect(el).toHaveAttribute('data-token', token);
      expect(el).toHaveAttribute('data-status', status);
      expect(el.className).toContain(`qsd-badge--${token}`);
      expect(el.className).toContain(`text-${token}`);
    });
  }
  it('always shows a reason for non-verified statuses', () => {
    render(<ProofBadge status="unavailable" />);
    expect(screen.getByRole('status')).toHaveTextContent('no reason given');
  });
  it('shows no attestation kind unless one is given', () => {
    const { container } = render(<ProofBadge status="verified" />);
    expect(container.firstElementChild).toHaveAttribute('data-attestation', 'none');
    expect(container.textContent).not.toMatch(/signed|unsafe/);
  });
  it('renders witness-signed as witness-signed, never provider-signed', () => {
    const { container } = render(<ProofBadge status="verified" attestationKind="witness-signed" />);
    expect(container.firstElementChild).toHaveAttribute('data-attestation', 'witness-signed');
    expect(container.querySelector('.qsd-badge__kind')).toHaveTextContent('witness-signed');
    expect(container.textContent).not.toContain('provider-signed');
  });
  it('renders provider-signed', () => {
    const { container } = render(<ProofBadge status="verified" attestationKind="provider-signed" />);
    expect(container.querySelector('.qsd-badge__kind')).toHaveTextContent('provider-signed');
  });
  it('renders unsafe-dev in the collapse colour with a warning', () => {
    const { container } = render(<ProofBadge status="verified" attestationKind="unsafe-dev" />);
    expect(container.firstElementChild).toHaveAttribute('data-attestation', 'unsafe-dev');
    expect(container.querySelector('.qsd-badge__kind')).toHaveAttribute('data-unsafe', 'true');
    expect(container.querySelector('.qsd-badge__warning')).toHaveTextContent(UNSAFE_DEV_WARNING);
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain(UNSAFE_DEV_WARNING);
  });
});

describe('MeasureButton', () => {
  it('shows the label and nothing else when reward/risk are undefined', () => {
    render(<MeasureButton />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Measure');
    expect(btn).not.toHaveTextContent('reward');
    expect(btn).not.toHaveTextContent('risk');
    expect(btn).not.toBeDisabled();
  });
  it('shows reward and risk only when provided', () => {
    render(<MeasureButton reward="R" risk="K" />);
    expect(screen.getByRole('button')).toHaveTextContent('reward R');
    expect(screen.getByRole('button')).toHaveTextContent('risk K');
  });
  it('renders the unavailable state with reason and is disabled', () => {
    render(<MeasureButton disabledReason="QRNG provider unreachable" reward="R" />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Measurement unavailable');
    expect(btn).toHaveTextContent('QRNG provider unreachable');
    expect(btn).not.toHaveTextContent('reward');
  });
  it('is busy while measuring', () => {
    render(<MeasureButton measuring />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveTextContent('Measuring');
  });
});

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats HH:MM:SS', () => {
    expect(formatHMS(0)).toBe('00:00:00');
    expect(formatHMS(61_000)).toBe('00:01:01');
    expect(formatHMS(3_600_000 * 101 + 59_000)).toBe('101:00:59');
    expect(formatHMS(-5000)).toBe('00:00:00');
  });
  it('renders "no scheduled time" for undefined', () => {
    const { container } = render(<Countdown />);
    expect(container.textContent).toContain('no scheduled time');
    expect(container.textContent).not.toMatch(DIGIT);
    expect(container.firstElementChild).toHaveAttribute('data-unavailable', 'true');
  });
  it('renders "no scheduled time" for an invalid timestamp', () => {
    expect(parseTarget('garbage')).toBeUndefined();
    const { container } = render(<Countdown target="garbage" />);
    expect(container.textContent).toContain('no scheduled time');
    expect(container.textContent).toContain('not valid ISO-8601');
  });
  it('counts down from an absolute target and fires onElapsed', () => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    let t = start;
    const now = (): number => t;
    const target = new Date(start + 2_500).toISOString();
    const onElapsed = vi.fn();
    render(<Countdown target={target} now={now} onElapsed={onElapsed} />);
    expect(screen.getByText('00:00:02')).toBeInTheDocument();
    act(() => {
      t += 1000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:00:01')).toBeInTheDocument();
    act(() => {
      t += 2000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:00:00')).toBeInTheDocument();
    expect(screen.getByText('00:00:00')).toHaveAttribute('data-elapsed', 'true');
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });
});

describe('LineageBreadcrumb', () => {
  it('renders "no lineage yet" for empty and undefined', () => {
    const { container, rerender } = render(<LineageBreadcrumb nodes={[]} />);
    expect(container.textContent).toContain('no lineage yet');
    rerender(<LineageBreadcrumb />);
    expect(container.textContent).toContain('no lineage yet');
  });
  it('renders the chain with state-coloured dots and marks the current page', () => {
    render(
      <LineageBreadcrumb
        nodes={[
          { label: 'M', href: '/m', generation: 0, state: 'collapsed' },
          { label: 'D', generation: 1, state: 'superposed' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('data-state', 'collapsed');
    expect(items[1]).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /M/ })).toHaveAttribute('href', '/m');
    const dots = screen.getAllByRole('img');
    expect(dots[0]).toHaveStyle({ background: '#E91E63' });
    expect(dots[1]).toHaveStyle({ background: '#4DD0E1' });
  });
  it('uses a custom link renderer', () => {
    render(
      <LineageBreadcrumb
        nodes={[{ label: 'M', href: '/m', generation: 0, state: 'dead' }]}
        renderLink={(n, children) => <span data-testid={`custom-${n.href}`}>{children}</span>}
      />,
    );
    expect(screen.getByTestId('custom-/m')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders eyebrow, sentence and a button action', () => {
    const onClick = vi.fn();
    render(<EmptyState eyebrow="no live coins" sentence="Nothing yet." action={{ label: 'launch', onClick }} />);
    expect(screen.getByText('no live coins')).toBeInTheDocument();
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'launch' }));
    expect(onClick).toHaveBeenCalled();
  });
  it('renders a link action when href is given', () => {
    render(<EmptyState eyebrow="e" sentence="s" action={{ label: 'go', href: '/x' }} />);
    expect(screen.getByRole('link', { name: 'go' })).toHaveAttribute('href', '/x');
  });
  it('renders without an action', () => {
    render(<EmptyState eyebrow="e" sentence="s" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
