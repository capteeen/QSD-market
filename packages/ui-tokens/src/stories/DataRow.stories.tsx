import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { DataRow } from '../components/DataRow.js';
import { Panel } from '../components/Panel.js';
import { EXAMPLE_INPUT, EXAMPLE_LABEL } from './example.js';

const meta: Meta<typeof DataRow> = { title: 'Components/DataRow', component: DataRow };
export default meta;
type S = StoryObj<typeof DataRow>;

export const WithExampleInput: S = {
  render: () => (
    <Panel eyebrow={EXAMPLE_LABEL}>
      <DataRow label="input string" value={EXAMPLE_INPUT} />
      <DataRow label="input length" value={EXAMPLE_INPUT.length} unit="bytes" />
    </Panel>
  ),
};

export const Unavailable: S = {
  render: () => (
    <Panel eyebrow="live values">
      <DataRow label="holders" unavailable={{ reason: 'DAS indexer unreachable' }} />
      <DataRow label="market cap" unavailable={{ reason: 'pump.fun API returned no quote' }} />
      <DataRow label="decay progress" />
    </Panel>
  ),
};
