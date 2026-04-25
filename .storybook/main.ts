import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../web/src/**/*.stories.@(ts|tsx|js|jsx|mdx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  typescript: {
    // Storybook's docgen scans components for TSDoc types. With @ts-nocheck
    // on most of our .tsx files that docgen can't extract much yet; that's
    // fine — stories still render. Phase 5c tightening enables real
    // auto-generated docs per component.
    reactDocgen: 'react-docgen-typescript',
  },
};

export default config;
