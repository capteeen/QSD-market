import type { Meta, StoryObj } from '@storybook/react';
import React, { useEffect, useState } from 'react';
import { HashDisplay } from '../components/HashDisplay.js';
import { Panel } from '../components/Panel.js';
import { EXAMPLE_INPUT, EXAMPLE_LABEL, sha256Hex } from './example.js';

const meta: Meta<typeof HashDisplay> = { title: 'Components/HashDisplay', component: HashDisplay };
export default meta;
type S = StoryObj<typeof HashDisplay>;

function ExampleHash(props: { full?: boolean }): React.ReactElement {
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | undefined>(undefined);
  useEffect(() => {
    sha256Hex(EXAMPLE_INPUT).then(setHash, (e: unknown) => setErr(String(e)));
  }, []);
  return (
    <Panel eyebrow={EXAMPLE_LABEL}>
      <HashDisplay
        hash={hash}
        {...(props.full ? { full: true } : {})}
        unavailable={{ reason: err ?? 'computing SHA-256 in the browser' }}
      />
    </Panel>
  );
}

export const ComputedExample: S = { render: () => <ExampleHash /> };
export const Full: S = { render: () => <ExampleHash full /> };
export const Empty: S = {
  render: () => (
    <Panel eyebrow="identity root">
      <HashDisplay unavailable={{ reason: 'no identity has been generated' }} />
    </Panel>
  ),
};
