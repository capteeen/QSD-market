import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { colors, glassEdge, glow, motion, quantumStateColor, shape, typeScale } from '../tokens.js';

const meta: Meta = {
  title: 'Tokens/All',
};
export default meta;

function Swatch({ name, value }: { name: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid var(--qsd-border)' }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: shape.quantumRadius,
          background: value,
          boxShadow: `inset 0 0 0 1px ${glassEdge}`,
        }}
      />
      <code className="qsd-mono" style={{ minWidth: 140, color: 'var(--qsd-text)' }}>
        {name}
      </code>
      <code className="qsd-mono" style={{ color: 'var(--qsd-muted)' }}>
        {value}
      </code>
    </div>
  );
}

export const Colours: StoryObj = {
  render: () => (
    <div>
      <div className="qsd-eyebrow">colour tokens</div>
      {Object.entries(colors).map(([k, v]) => (
        <Swatch key={k} name={k} value={v} />
      ))}
      <Swatch name="glassEdge" value={glassEdge} />
      <Swatch name="glow.inner" value={glow.computeInner} />
      <Swatch name="glow.outer" value={glow.computeOuter} />
      <div className="qsd-eyebrow" style={{ marginTop: '2rem' }}>
        quantum state → colour
      </div>
      {Object.entries(quantumStateColor).map(([k, v]) => (
        <Swatch key={k} name={k} value={v} />
      ))}
    </div>
  ),
};

export const Glow: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '3rem', alignItems: 'center', padding: '3rem' }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: shape.quantumRadius,
          background: 'var(--glow-compute-radial)',
        }}
        title="--glow-compute-radial"
      />
      <div
        className="qsd-panel"
        data-computing="true"
        style={{ width: 200, height: 120, display: 'grid', placeItems: 'center' }}
      >
        <span className="qsd-eyebrow">computing</span>
      </div>
      <code className="qsd-mono" style={{ color: 'var(--qsd-muted)', maxWidth: 320, fontSize: typeScale.xs }}>
        {glow.compute}
      </code>
    </div>
  ),
};

export const TypeScale: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      {Object.entries(typeScale).map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '6rem 1fr', alignItems: 'baseline', gap: '1rem' }}>
          <code className="qsd-mono" style={{ color: 'var(--qsd-muted)', fontSize: typeScale.xs }}>
            {k} · {v}
          </code>
          <div>
            <div className="qsd-heading" style={{ fontSize: v }}>
              Quantum State Decay
            </div>
            <div className="qsd-mono" style={{ fontSize: v, color: 'var(--qsd-muted)' }}>
              0123456789 abcdef — tabular
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Motion: StoryObj = {
  render: () => {
    const [on, setOn] = React.useState(false);
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <button className="qsd-empty__action" type="button" onClick={() => setOn((v) => !v)}>
          toggle
        </button>
        {(
          [
            ['viscous · --dur-slow', motion.durSlow],
            ['viscous · --dur-slower', motion.durSlower],
            ['collapse · --dur-collapse (snaps)', motion.durCollapse],
          ] as const
        ).map(([label, dur]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '18rem 1fr', alignItems: 'center', gap: '1rem' }}>
            <code className="qsd-mono" style={{ color: 'var(--qsd-muted)', fontSize: typeScale.xs }}>
              {label}
            </code>
            <div style={{ position: 'relative', height: 24, borderBottom: '1px solid var(--qsd-border)' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 2,
                  left: on ? 'calc(100% - 20px)' : 0,
                  width: 20,
                  height: 20,
                  borderRadius: shape.quantumRadius,
                  background: dur === motion.durCollapse ? 'var(--qsd-collapse)' : 'var(--qsd-probability)',
                  transition: `left ${dur} ${motion.easeViscous}`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  },
};
