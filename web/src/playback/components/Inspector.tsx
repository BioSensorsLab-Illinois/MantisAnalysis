// Inspector — right panel with tabbed sections (M5).
//
// Per design spec §7.1.8 + the rebuild: tabbed instead of stacked
// sections. Tabs: View / Source / Display / Color / Labels / Export.
// At 1024 px workspace width, every tab + every action button fits
// inside the panel without clipping.

import React from 'react';

import { TabDTO, ViewDTO } from '../api';
import { FONT, LAYOUT, PALETTE, RADIUS, SPACE } from '../theme';

import { ViewTab } from '../inspector/ViewTab';
import { DisplayTab } from '../inspector/DisplayTab';
import { LabelsTab } from '../inspector/LabelsTab';
import { ExportTab } from '../inspector/ExportTab';

import { Glyph } from './Glyph';

const { useState } = React;

interface Props {
  tab: TabDTO;
  view: ViewDTO | null;
  onError: (msg: string) => void;
  onCollapse: () => void;
  collapsed?: boolean;
}

type SectionId = 'view' | 'display' | 'labels' | 'export';

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'view', label: 'View' },
  { id: 'display', label: 'Display' },
  { id: 'labels', label: 'Labels' },
  { id: 'export', label: 'Export' },
];

export const Inspector: React.FC<Props> = ({
  tab,
  view,
  onError,
  onCollapse,
  collapsed = false,
}) => {
  const [active, setActive] = useState<SectionId>('display');
  if (collapsed) {
    return (
      <aside
        data-region="inspector"
        data-collapsed="true"
        style={{
          width: 32,
          background: PALETTE.panel,
          borderLeft: `1px solid ${PALETTE.border}`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: `${SPACE.sm}px 0`,
          flexShrink: 0,
        }}
      >
        <button
          aria-label="Expand inspector"
          title="Expand inspector"
          onClick={onCollapse}
          style={{
            background: 'transparent',
            color: PALETTE.textMuted,
            border: 'none',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <Glyph name="chevronLeft" size={14} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-region="inspector"
      style={{
        width: LAYOUT.inspectorW.default,
        minWidth: LAYOUT.inspectorW.min,
        maxWidth: LAYOUT.inspectorW.max,
        background: PALETTE.panel,
        borderLeft: `1px solid ${PALETTE.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          borderBottom: `1px solid ${PALETTE.border}`,
          gap: SPACE.sm,
        }}
      >
        <span style={{ font: FONT.label, color: PALETTE.textMuted, letterSpacing: 0.6 }}>
          INSPECTOR
        </span>
        <span style={{ flex: 1 }} />
        <button
          aria-label="Collapse inspector"
          title="Collapse"
          onClick={onCollapse}
          style={{
            background: 'transparent',
            color: PALETTE.textMuted,
            border: 'none',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <Glyph name="chevronRight" size={14} />
        </button>
      </header>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Inspector sections"
        style={{
          display: 'flex',
          gap: 2,
          padding: SPACE.xs,
          background: PALETTE.panelAlt,
          flexShrink: 0,
        }}
      >
        {SECTIONS.map((s) => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(s.id)}
              style={{
                flex: 1,
                padding: `${SPACE.xs}px ${SPACE.sm}px`,
                font: isActive ? FONT.uiBold : FONT.small,
                color: isActive ? PALETTE.accent : PALETTE.textMuted,
                background: isActive ? PALETTE.shell : 'transparent',
                border: 'none',
                borderRadius: RADIUS.sm,
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: SPACE.md,
        }}
      >
        {!view ? (
          <div style={{ font: FONT.small, color: PALETTE.textFaint, textAlign: 'center' }}>
            Select a view to inspect.
          </div>
        ) : active === 'view' ? (
          <ViewTab tab={tab} view={view} onError={onError} />
        ) : active === 'display' ? (
          <DisplayTab tab={tab} view={view} onError={onError} />
        ) : active === 'labels' ? (
          <LabelsTab tab={tab} view={view} onError={onError} />
        ) : (
          <ExportTab tab={tab} view={view} onError={onError} />
        )}
      </div>
    </aside>
  );
};
