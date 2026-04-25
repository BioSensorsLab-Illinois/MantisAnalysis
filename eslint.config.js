// eslint.config.js — bundler-migration-v1 Phase 4 (+ Phase 5 additions).
//
// ESLint 9 flat config. Targets web/src/**/*.{js,jsx,ts,tsx} under Vite.
// Keeps rules tight enough to catch real bugs (react-hooks/rules-of-hooks,
// no-undef, no-unused-vars) but lenient on stylistic concerns — Prettier
// handles style, and the existing 5000-line files pre-date any linter, so
// cosmetic warnings would drown out the signal.
//
// Phase 5 (2026-04-24) added typescript-eslint for .ts/.tsx. TS files
// use the typescript-eslint parser; JS files keep the default parser.
// Both share the same React / Hooks / Refresh rule set.
//
// To run:  npx eslint web/src/
// Wire in: npm run lint  (see package.json scripts).
import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default [
  // Ignore build artifacts, dependencies, and output trees that aren't
  // source-of-truth.
  {
    ignores: [
      'web/dist/**',
      'node_modules/**',
      'build/**',
      'outputs/**',
      'dist/**',
    ],
  },

  js.configs.recommended,

  // typescript-eslint recommended — applies to .ts/.tsx only, adds a
  // parser + a set of TS-aware rules. Type-aware rules (requires the
  // whole-program type checker) are NOT enabled yet — they're 5×-10×
  // slower and the tree has no .tsx files to benefit from them today.
  // Promote to `recommendedTypeChecked` once a meaningful fraction of
  // the tree is .tsx.
  ...tseslint.configs.recommended,

  // React flat-config — plugin ships its own, but we customize below.
  {
    files: ['web/src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser runtime — most of the codebase uses these as ambient
        // globals. ESLint's `no-undef` needs them whitelisted.
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Image: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        crypto: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        WheelEvent: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        FileReader: 'readonly',
        XMLSerializer: 'readonly',
        DOMParser: 'readonly',
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      // Start from eslint-plugin-react's recommended preset, then
      // override per-rule below. Spread FIRST so our overrides win.
      ...reactPlugin.configs.recommended.rules,

      // --- React -------------------------------------------------------
      // React 18 automatic runtime — no need for `import React`.
      'react/react-in-jsx-scope': 'off',
      // Codebase doesn't use PropTypes; TypeScript is the Phase 5 goal.
      'react/prop-types': 'off',
      // Plenty of mouse-event handlers without keyboard equivalents in
      // canvas code; this rule is a11y-oriented and will move under the
      // Phase 6 axe-core integration.
      'react/no-unknown-property': ['error', { ignore: [] }],

      // --- Hooks -------------------------------------------------------
      // These catch real bugs — keep at error.
      'react-hooks/rules-of-hooks': 'error',
      // Exhaustive-deps fires on almost every real codebase; warn-only
      // so the first `npm run lint` doesn't explode.
      'react-hooks/exhaustive-deps': 'warn',

      // --- React Refresh -----------------------------------------------
      // Only-export-components is Vite-HMR-specific; warn is plenty.
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // --- Core --------------------------------------------------------
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // typescript-eslint ships its own no-unused-vars that runs as an
      // error by default. Demote to warn + match core's ignore pattern
      // so .ts/.tsx files behave like .js/.jsx. Also turn OFF core's
      // copy on TS files so we don't double-report.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // Allow `a && b()` / `a ? b() : c()` expression statements — common
      // in React conditional-render code.
      '@typescript-eslint/no-unused-expressions': [
        'warn',
        { allowShortCircuit: true, allowTernary: true },
      ],
      // Reassigning the iteration variable in a for-of is rare; flag it
      // but don't break on it.
      'no-case-declarations': 'warn',
      // Empty blocks can hide intent; warn but don't fail builds over
      // harmless catch {/* noop */} patterns.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // `no-inner-declarations` is off because block-scoped `function`
      // declarations are legitimate in modern JS (ES6+).
      'no-inner-declarations': 'off',
    },
  },

  // Prettier config last — disables all stylistic rules that conflict
  // with prettier's auto-formatting.
  prettierConfig,
];
