import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from '../components/EmptyState.js';

const meta: Meta<typeof EmptyState> = { title: 'Components/EmptyState', component: EmptyState };
export default meta;
type S = StoryObj<typeof EmptyState>;

export const WithAction: S = {
  args: {
    eyebrow: 'no live coins',
    sentence: 'Nothing has been launched on this network yet.',
    action: { label: 'launch a coin', href: '#' },
  },
};

export const NoAction: S = {
  args: { eyebrow: 'no measurements', sentence: 'This coin has not been measured.' },
};
