import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { Countdown } from '../components/Countdown.js';
import { Panel } from '../components/Panel.js';

const meta: Meta<typeof Countdown> = { title: 'Components/Countdown', component: Countdown };
export default meta;
type S = StoryObj<typeof Countdown>;

function LiveCountdown(): React.ReactElement {
  // Target is derived from the clock at mount — an example, labelled as such.
  const [target] = useState(() => new Date(Date.now() + 90_000).toISOString());
  return (
    <Panel eyebrow="example input — 90 s from story mount">
      <Countdown target={target} size="lg" />
    </Panel>
  );
}

export const ExampleTarget: S = { render: () => <LiveCountdown /> };
export const Unavailable: S = {
  render: () => (
    <Panel eyebrow="auto-measurement">
      <Countdown size="lg" unavailable={{ reason: 'coin is not superposed' }} />
    </Panel>
  ),
};
export const InvalidTimestamp: S = {
  render: () => (
    <Panel eyebrow="auto-measurement">
      <Countdown size="md" target="not-a-timestamp" />
    </Panel>
  ),
};
