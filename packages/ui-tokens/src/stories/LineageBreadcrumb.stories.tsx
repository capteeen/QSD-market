import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { LineageBreadcrumb } from '../components/LineageBreadcrumb.js';
import { Panel } from '../components/Panel.js';

const meta: Meta<typeof LineageBreadcrumb> = { title: 'Components/LineageBreadcrumb', component: LineageBreadcrumb };
export default meta;
type S = StoryObj<typeof LineageBreadcrumb>;

export const ExampleChain: S = {
  render: () => (
    <Panel eyebrow="example input — labels exist only in this story">
      <LineageBreadcrumb
        nodes={[
          { label: 'EXAMPLE-MOTHER', href: '#', generation: 0, state: 'collapsed' },
          { label: 'EXAMPLE-DAUGHTER', href: '#', generation: 1, state: 'tunnelled' },
          { label: 'EXAMPLE-CURRENT', generation: 2, state: 'superposed' },
        ]}
      />
    </Panel>
  ),
};

export const Empty: S = {
  render: () => (
    <Panel eyebrow="lineage">
      <LineageBreadcrumb nodes={[]} />
    </Panel>
  ),
};
