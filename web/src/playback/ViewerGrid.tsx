// @ts-nocheck
// recording-inspection-implementation-v1 M7 — ViewerGrid + layout presets.
// Per spec.md §7.1.6 + W5/W6.

import React from 'react';
import { Icon, useTheme } from '../shared.tsx';
import { ViewerCard } from './ViewerCard.tsx';

const LAYOUT_PRESETS = [
  { id: 'single', label: 'Single', cells: [[0, 0, 2, 2]], rows: 2 },
  {
    id: 'side',
    label: 'Side',
    cells: [
      [0, 0, 1, 2],
      [1, 0, 1, 2],
    ],
    rows: 2,
  },
  {
    id: 'stack',
    label: 'Stack',
    cells: [
      [0, 0, 2, 1],
      [0, 1, 2, 1],
    ],
    rows: 2,
  },
  {
    id: '2x2',
    label: '2 × 2',
    cells: [
      [0, 0, 1, 1],
      [1, 0, 1, 1],
      [0, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    rows: 2,
  },
  {
    id: '3plus1',
    label: '3 + 1',
    cells: [
      [0, 0, 1, 2],
      [1, 0, 1, 1],
      [1, 1, 1, 1],
      [0, 2, 2, 1],
    ],
    rows: 3,
  },
];

export const LAYOUT_OPTIONS = LAYOUT_PRESETS;

export const ViewerGrid = ({
  views,
  layout,
  selectedViewId,
  onSelect,
  onAddView,
  onRemoveView,
  onDuplicateView,
  onToggleLock,
  onChangeLayout,
  frame,
  streamId,
}) => {
  const t = useTheme();
  const preset = LAYOUT_PRESETS.find((p) => p.id === layout) || LAYOUT_PRESETS[0];
  const cells = preset.cells;
  const rows = preset.rows;
  const visible = views.slice(0, cells.length);

  return (
    <div
      data-region="viewer-grid"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
      }}
    >
      <div
        data-region="grid-toolbar"
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div role="group" aria-label="Viewer layout" style={{ display: 'flex', gap: 2 }}>
          {LAYOUT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-layout={p.id}
              aria-pressed={layout === p.id}
              onClick={() => onChangeLayout?.(p.id)}
              style={{
                padding: '4px 10px',
                background: layout === p.id ? t.accentSoft : 'transparent',
                color: layout === p.id ? t.accent : t.textMuted,
                border: `1px solid ${layout === p.id ? t.accent : t.chipBorder}`,
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          {views.length} view{views.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          aria-label="Add view"
          data-action="add-view"
          onClick={onAddView}
          disabled={views.length >= 12}
          style={{
            padding: '3px 10px',
            background: 'transparent',
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            cursor: views.length >= 12 ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Icon name="plus" size={10} /> Add view
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: 8,
        }}
      >
        {visible.map((v, i) => {
          const [c, r, cs, rs] = cells[i];
          return (
            <div
              key={v.view_id}
              style={{
                gridColumn: `${c + 1} / span ${cs}`,
                gridRow: `${r + 1} / span ${rs}`,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <ViewerCard
                view={v}
                frame={frame}
                streamId={streamId}
                selected={v.view_id === selectedViewId}
                onSelect={onSelect}
                onToggleLock={onToggleLock}
                onRemove={onRemoveView}
                onDuplicate={onDuplicateView}
              />
            </div>
          );
        })}
        {visible.length < cells.length && (
          <div
            style={{
              gridColumn: '1 / span 2',
              gridRow: 'auto',
              minHeight: 60,
              border: `1px dashed ${t.border}`,
              borderRadius: 4,
              background: t.panelAlt,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: t.textFaint,
              fontSize: 11,
              fontFamily: 'ui-monospace, Menlo, monospace',
            }}
          >
            Click &ldquo;Add view&rdquo; to fill the layout ({cells.length - visible.length} more)
          </div>
        )}
      </div>
    </div>
  );
};
