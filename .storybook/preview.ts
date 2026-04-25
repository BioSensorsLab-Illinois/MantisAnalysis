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
    a11y: {
      // Match the same WCAG A/AA ruleset the Playwright gate uses (see
      // tests/web/test_accessibility.py).
      config: {
        rules: [
          // The component-level check shouldn't enforce rules that only
          // make sense on a full-app layout (e.g. document-title).
          { id: 'document-title', enabled: false },
          { id: 'html-has-lang', enabled: false },
        ],
      },
    },
  },
};

export default preview;
