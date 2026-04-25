// analysis-page-overhaul-v1 Phase 3 — Storybook story for <AnalysisShell>.
// Synthetic RunRecord fixtures so the shell renders without a live FastAPI
// backend. Each mode rendered against ThemeFrame + PlotStyleCtx.

import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import * as _shared from '../shared.tsx';
import { AnalysisShell } from './shell';
import type { RunRecord, ToastFn } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const ThemeCtx = _s.ThemeCtx;
const THEMES = _s.THEMES;

const ThemeFrame: React.FC<{
  theme?: 'light' | 'dark';
  children: React.ReactNode;
}> = ({ theme = 'light', children }) => (
  <ThemeCtx.Provider value={THEMES[theme]}>
    <div
      style={{
        padding: 0,
        background: THEMES[theme].bg,
        color: THEMES[theme].text,
        fontFamily: '"Inter Tight", system-ui, sans-serif',
        minHeight: '100vh',
      }}
    >
      {children}
    </div>
  </ThemeCtx.Provider>
);

// ---------------------------------------------------------------------------
// Synthetic RunRecord fixtures.
// Minimal — exercises the shell chrome without requiring chart bodies to
// have data. Tabs that try to render charts will show empty grids; that's
// fine for shell-level visual verification.
// ---------------------------------------------------------------------------
const usafRun: RunRecord = {
  mode: 'usaf',
  response: {
    channels: ['HG-R', 'HG-G', 'HG-B', 'LG-R'],
    specs: [],
    measurements: {},
    per_channel_detection_limit: { 'HG-R': 12.5, 'HG-G': 13.1, 'HG-B': 11.2, 'LG-R': null },
    threshold: 0.3,
  },
};

const fpnRun: RunRecord = {
  mode: 'fpn',
  response: {
    channels: ['HG-R', 'HG-G'],
    rois: [
      [40, 40, 200, 200],
      [240, 240, 400, 400],
    ],
    measurements: {},
    settings: {
      drift_order: 2,
      hot_sigma: 4,
      lo_pct: 0.5,
      hi_pct: 99.5,
      median_size: 0,
      gaussian_sigma: 0,
      bilateral: false,
    },
  },
  rois: [{ label: 'flat-1' }, { label: 'flat-2' }],
};

const dofRun: RunRecord = {
  mode: 'dof',
  response: {
    channels: ['HG-G'],
    results: { 'HG-G': { lines: [], points: [] } },
    settings: {
      metric: 'laplacian',
      half_window: 8,
      threshold: 0.5,
      compute_all_metrics: false,
      fit_tilt_plane: false,
      calibration: null,
    },
  },
  channels: ['HG-G'],
  lines: [{ p0: [10, 10], p1: [200, 50], label: 'L1' }],
  points: [],
  source: { source_id: 'storybook' },
};

interface ShellHostProps {
  run: RunRecord;
  theme?: 'light' | 'dark';
}

const noopToast: ToastFn = () => undefined;
const noopClose = (): void => undefined;

const ShellHost: React.FC<ShellHostProps> = ({ run, theme = 'light' }) => (
  <ThemeFrame theme={theme}>
    <AnalysisShell run={run} onClose={noopClose} onToast={noopToast} />
  </ThemeFrame>
);

const meta: Meta<typeof ShellHost> = {
  title: 'Analysis/Shell',
  component: ShellHost,
  parameters: {
    layout: 'fullscreen',
    a11y: { config: { rules: [] } },
  },
};
export default meta;

type Story = StoryObj<typeof ShellHost>;

export const USAF: Story = { args: { run: usafRun, theme: 'light' } };
export const FPN: Story = { args: { run: fpnRun, theme: 'light' } };
export const DoF: Story = { args: { run: dofRun, theme: 'light' } };
export const USAFDark: Story = { args: { run: usafRun, theme: 'dark' } };
