import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { ProofBadge } from '../components/ProofBadge.js';

const meta: Meta<typeof ProofBadge> = { title: 'Components/ProofBadge', component: ProofBadge };
export default meta;
type S = StoryObj<typeof ProofBadge>;

export const Verified: S = { args: { status: 'verified' } };
export const Pending: S = { args: { status: 'pending', reason: 'awaiting witness attestation' } };
export const Invalid: S = { args: { status: 'invalid', reason: 'attestation signature mismatch' } };
export const Unverified: S = { args: { status: 'unverified', reason: 'verify() has not been run' } };
export const Unavailable: S = { args: { status: 'unavailable', reason: 'no proof bundle for this coin' } };

/** The live provider (ANU) is witness-signed by the QSD protocol key — see docs/physics.md. */
export const VerifiedWitnessSigned: S = { args: { status: 'verified', attestationKind: 'witness-signed' } };
export const VerifiedProviderSigned: S = { args: { status: 'verified', attestationKind: 'provider-signed' } };
export const UnsafeDev: S = {
  args: { status: 'verified', attestationKind: 'unsafe-dev', reason: 'UNSAFE_DEV_RANDOM — local tests only' },
};

export const EveryStatus: S = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
      <ProofBadge status="verified" />
      <ProofBadge status="verified" attestationKind="witness-signed" />
      <ProofBadge status="verified" attestationKind="provider-signed" />
      <ProofBadge status="verified" attestationKind="unsafe-dev" />
      <ProofBadge status="pending" reason="awaiting witness attestation" />
      <ProofBadge status="invalid" reason="attestation signature mismatch" />
      <ProofBadge status="unverified" reason="verify() has not been run" />
      <ProofBadge status="unavailable" reason="no proof bundle for this coin" />
    </div>
  ),
};
