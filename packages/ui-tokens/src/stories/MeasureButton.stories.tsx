import type { Meta, StoryObj } from '@storybook/react';
import { MeasureButton } from '../components/MeasureButton.js';

const meta: Meta<typeof MeasureButton> = { title: 'Components/MeasureButton', component: MeasureButton };
export default meta;
type S = StoryObj<typeof MeasureButton>;

/** Reward and risk are opaque strings supplied by the protocol layer; these are labelled examples. */
export const Ready: S = { args: { reward: 'example reward string', risk: 'example risk string' } };
export const RewardUnknown: S = { args: {} };
export const Measuring: S = { args: { measuring: true } };
export const Unavailable: S = { args: { disabledReason: 'QRNG provider unreachable' } };
