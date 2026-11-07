import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Panel } from '../components/Panel.js';

const meta: Meta<typeof Panel> = { title: 'Components/Panel', component: Panel };
export default meta;
type S = StoryObj<typeof Panel>;

export const Default: S = {
  args: {
    eyebrow: 'proof bundle',
    title: 'Measurement',
    children: <p style={{ margin: 0, color: 'var(--qsd-muted)' }}>Children render here. The panel shows no data of its own.</p>,
  },
};

export const Computing: S = {
  args: { eyebrow: 'qrng', title: 'Entropy requested', computing: true, children: 'awaiting attestation' },
};

export const Unavailable: S = {
  args: { eyebrow: 'holders', title: 'Holder set', unavailable: { reason: 'DAS indexer unreachable' } },
};
