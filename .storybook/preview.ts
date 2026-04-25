// bundler-migration-v1 Phase 7 — Storybook preview config.
// Wraps every story in a minimal dark-backdrop viewport so the
// MantisAnalysis theme (which ships a dark default) renders legibly in
// the Storybook iframe.
import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'app-dark',
      values: [
        { name: 'app-dark', value: '#121212' },
        { name: 'app-light', value: '#fafafa' },
        { name: 'white', value: '#ffffff' },
      ],
    },
  },
};

export default preview;
