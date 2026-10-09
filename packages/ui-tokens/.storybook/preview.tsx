import type { Decorator, Preview } from '@storybook/react';
import React from 'react';
import '../src/tokens.css';

const withTheme: Decorator = (Story, ctx) => {
  const theme = (ctx.globals['theme'] as string | undefined) ?? 'darkfield';
  if (typeof document !== 'undefined') {
    if (theme === 'brightfield') document.documentElement.setAttribute('data-theme', 'brightfield');
    else document.documentElement.removeAttribute('data-theme');
    document.documentElement.setAttribute('data-qsd', '');
    document.body.setAttribute('data-qsd', '');
  }
  return (
    <div className="qsd-root" style={{ padding: '2rem', minHeight: '100vh' }}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Field',
      defaultValue: 'darkfield',
      toolbar: {
        title: 'Field',
        items: [
          { value: 'darkfield', title: 'Darkfield (default)' },
          { value: 'brightfield', title: 'Brightfield' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    backgrounds: { disable: true },
    layout: 'fullscreen',
    controls: { expanded: true },
  },
};

export default preview;
