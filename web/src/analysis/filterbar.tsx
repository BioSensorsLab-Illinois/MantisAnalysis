// analysis-page-overhaul-v1 Phase 3 — shared filter-bar primitives.
// Type-clean. Used by `<AnalysisShell>` (channel chips + gain segmented +
// BgColorPicker) and re-exported for any future per-mode filter chunk
// that wants to match the existing visual language.

import React from 'react';
import * as _shared from '../shared.tsx';

// shared.tsx is still under @ts-nocheck (Phase 5c follow-up). Bridge it
// once with a single `as any` cast so the rest of this module sees the
// primitives as untyped functions — TypeScript treats them as
// `React.ComponentType<any>` on consumption.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const useTheme: () => Theme = _s.useTheme;
const ChannelChip = _s.ChannelChip as React.ComponentType<ChannelChipProps>;
const Segmented = _s.Segmented as React.ComponentType<SegmentedProps<string>>;
const Button = _s.Button as React.ComponentType<ButtonProps>;
const Tip = _s.Tip as React.ComponentType<{ title: string; children: React.ReactNode }>;

interface Theme {
  panel: string;
  panelAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  warn: string;
  // ...other tokens exist; add as consumed.
  [key: string]: string;
}

interface ChannelChipProps {
  id: string;
  multi?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  size?: 'xs' | 'sm' | 'md';
}

interface SegmentedProps<V extends string> {
  value: V;
  onChange: (next: V) => void;
  options: ReadonlyArray<{ value: V; label: string }>;
}

interface ButtonProps {
  size?: 'xs' | 'sm' | 'md';
  variant?: 'primary' | 'subtle' | 'danger';
  icon?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

import type { GainFilter } from './types';

// ---------------------------------------------------------------------------
// FilterLabel — small uppercase caption used between filter clusters.
// ---------------------------------------------------------------------------
export const FilterLabel: React.FC<{ children: React.ReactNode; marginLeft?: number }> = ({
  children,
  marginLeft,
}) => {
  const t = useTheme();
  return (
    <span
      style={{
        fontSize: 10,
        color: t.textMuted,
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginLeft,
      }}
    >
      {children}
    </span>
  );
};

// ---------------------------------------------------------------------------
// ChannelFilterRow — channel chips + All/None.
// ---------------------------------------------------------------------------
interface ChannelFilterRowProps {
  allChannels: readonly string[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
}

export const ChannelFilterRow: React.FC<ChannelFilterRowProps> = ({
  allChannels,
  selected,
  onChange,
}) => {
  const toggle = (c: string): void => {
    onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  };
  return (
    <>
      <FilterLabel>Channels</FilterLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {allChannels.map((c) => (
          <ChannelChip
            key={c}
            id={c.includes('-') ? c : `HG-${c}`}
            multi
            selected={selected.includes(c)}
            onToggle={() => toggle(c)}
            size="sm"
          />
        ))}
        <Button size="xs" onClick={() => onChange([...allChannels])}>
          All
        </Button>
        <Button size="xs" onClick={() => onChange([])}>
          None
        </Button>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// GainFilterRow — HG/LG segmented; only renders if any channel is HG-prefixed.
// ---------------------------------------------------------------------------
interface GainFilterRowProps {
  allChannels: readonly string[];
  value: GainFilter;
  onChange: (v: GainFilter) => void;
}

export const GainFilterRow: React.FC<GainFilterRowProps> = ({ allChannels, value, onChange }) => {
  if (!allChannels.some((c) => c.startsWith('HG-'))) return null;
  return (
    <>
      <FilterLabel marginLeft={6}>Gain</FilterLabel>
      <Segmented
        value={value}
        onChange={(v) => onChange(v as GainFilter)}
        options={[
          { value: 'all', label: 'All' },
          { value: 'HG', label: 'HG' },
          { value: 'LG', label: 'LG' },
        ]}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// BgColorPicker — moved out of analysis.tsx so the new shell has zero
// dependency on the @ts-nocheck island for filter UI. DoF gains parity by
// virtue of this living in the shared shell. Behavior unchanged from the
// original (analysis.tsx 318–396):
//   `null`              → match theme (panelAlt)
//   '#ffffff'/'#000000' → literal hex
//   'transparent'       → no fill (PNG keeps alpha; live view shows checker)
//   any custom hex      → via the native <input type="color">
// Persisted by the caller's setBgColor (typically useLocalStorageState).
// ---------------------------------------------------------------------------
interface BgColorPickerProps {
  bgColor: string | null;
  setBgColor: (v: string | null) => void;
}

export const BgColorPicker: React.FC<BgColorPickerProps> = ({ bgColor, setBgColor }) => {
  const t = useTheme();
  const presets: ReadonlyArray<{
    id: string | null;
    label: string;
    swatch: string;
    title: string;
  }> = [
    { id: null, label: 'Theme', swatch: t.panelAlt, title: 'Match the current app theme' },
    {
      id: '#ffffff',
      label: 'White',
      swatch: '#ffffff',
      title: 'Solid white — best for journals/print',
    },
    {
      id: '#000000',
      label: 'Black',
      swatch: '#000000',
      title: 'Solid black — best for dark-themed slides',
    },
    {
      id: 'transparent',
      label: 'Clear',
      swatch: 'transparent',
      title: 'Transparent — exports a PNG with alpha',
    },
  ];
  const isCustom = !!bgColor && !presets.some((p) => p.id === bgColor);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
      <FilterLabel>Background</FilterLabel>
      {presets.map((p) => {
        const active = bgColor === p.id;
        return (
          <button
            key={String(p.id)}
            onClick={() => setBgColor(p.id)}
            title={p.title}
            aria-label={`Background: ${p.label}`}
            aria-pressed={active}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              border: `2px solid ${active ? t.accent : t.border}`,
              borderRadius: 4,
              cursor: 'pointer',
              background:
                p.id === 'transparent'
                  ? 'linear-gradient(45deg, #d8dbe0 25%, #ffffff 25% 50%, #d8dbe0 50% 75%, #ffffff 75%) 0/8px 8px'
                  : p.swatch,
            }}
          />
        );
      })}
      <Tip title="Custom — pick any hex color">
        <input
          type="color"
          value={isCustom ? (bgColor as string) : bgColor || '#ffffff'}
          onChange={(e) => setBgColor(e.target.value)}
          aria-label="Background: custom hex"
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: `2px solid ${isCustom ? t.accent : t.border}`,
            borderRadius: 4,
            cursor: 'pointer',
            background: 'transparent',
          }}
        />
      </Tip>
    </span>
  );
};

// ---------------------------------------------------------------------------
// tabBodyBgStyle — derive the tab-body background style from `bgColor`.
// 'transparent' triggers the checker pattern in the live view; PNG export
// honors the literal value through `renderChartToPng(themeFallbackBg)`.
// ---------------------------------------------------------------------------
export const tabBodyBgStyle = (
  bgColor: string | null,
  themeFallback: string
): React.CSSProperties => {
  if (bgColor === 'transparent') {
    return {
      background: 'transparent',
      backgroundImage:
        'linear-gradient(45deg, #d8dbe0 25%, transparent 25%), linear-gradient(-45deg, #d8dbe0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d8dbe0 75%), linear-gradient(-45deg, transparent 75%, #d8dbe0 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
    };
  }
  return { background: bgColor || themeFallback };
};
