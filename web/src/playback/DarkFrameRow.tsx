// @ts-nocheck
// recording-inspection-implementation-v1 M6 — dark-frame row.
// Per spec.md §7.1.3 + W4. Shows averaging strategy + frame count
// + match status; remove button on hover.

import React from 'react';
import { Icon, useTheme } from '../shared.tsx';
import { ConfirmRemoveButton } from './ConfirmRemoveButton.tsx';

export const DarkFrameRow = ({ dark, baseExposure, onRemove }) => {
  const t = useTheme();
  const matched =
    baseExposure != null &&
    dark.exposure != null &&
    Math.abs(dark.exposure - baseExposure) / Math.max(Math.abs(baseExposure), 1e-9) <= 0.1;
  const hasExp = dark.exposure != null;
  const stateColor = !hasExp
    ? t.warn
    : matched
      ? t.success
      : baseExposure != null
        ? t.warn
        : t.textFaint;
  const stateLabel = !hasExp
    ? 'No exposure metadata'
    : matched
      ? 'Matched · auto-applied'
      : baseExposure != null
        ? `Available · ${dark.exposure} vs ${baseExposure} mismatch`
        : 'Available';

  return (
    <li
      data-dark-id={dark.dark_id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        background: t.panel,
        listStyle: 'none',
      }}
    >
      <Icon name="moon" size={12} style={{ color: t.textMuted }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'ui-monospace, Menlo, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: t.text,
          }}
        >
          {dark.name}
        </div>
        <div style={{ fontSize: 10, color: stateColor, marginTop: 1 }}>{stateLabel}</div>
      </div>
      <span
        title="averaging strategy"
        style={{
          padding: '1px 5px',
          background: t.chipBg,
          color: t.textMuted,
          border: `1px solid ${t.chipBorder}`,
          borderRadius: 3,
          fontSize: 9.5,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        {dark.strategy ?? 'mean'}
      </span>
      <span
        style={{
          padding: '1px 5px',
          background: t.chipBg,
          color: t.textMuted,
          border: `1px solid ${t.chipBorder}`,
          borderRadius: 3,
          fontSize: 9.5,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        ×{dark.frames_averaged}
      </span>
      <ConfirmRemoveButton
        ariaLabel={`Remove dark frame ${dark.name}`}
        iconMode
        iconNode={<Icon name="close" size={10} />}
        iconWidth={18}
        iconHeight={18}
        onConfirm={() => onRemove?.(dark.dark_id)}
      />
    </li>
  );
};
