// ViewerGrid — CSS-grid layout with the 5 design-spec presets.

import React from 'react';

import { TabDTO } from '../api';
import { PALETTE, SPACE } from '../theme';

import { ViewerCard } from './ViewerCard';

interface Props {
  tab: TabDTO;
  onSelectView: (view_id: string) => void;
}

const PRESETS: Record<
  TabDTO['layout'],
  { cols: number; rows: number; cells: Array<[number, number, number, number]> }
> = {
  single: { cols: 1, rows: 1, cells: [[0, 0, 1, 1]] },
  side: {
    cols: 2,
    rows: 1,
    cells: [
      [0, 0, 1, 1],
      [1, 0, 1, 1],
    ],
  },
  stack: {
    cols: 1,
    rows: 2,
    cells: [
      [0, 0, 1, 1],
      [0, 1, 1, 1],
    ],
  },
  '2x2': {
    cols: 2,
    rows: 2,
    cells: [
      [0, 0, 1, 1],
      [1, 0, 1, 1],
      [0, 1, 1, 1],
      [1, 1, 1, 1],
    ],
  },
  '3plus1': {
    cols: 2,
    rows: 3,
    cells: [
      [0, 0, 1, 2],
      [1, 0, 1, 1],
      [1, 1, 1, 1],
      [0, 2, 2, 1],
    ],
  },
};

export const ViewerGrid: React.FC<Props> = ({ tab, onSelectView }) => {
  const preset = PRESETS[tab.layout] ?? PRESETS.single;
  const visible = tab.views.slice(0, preset.cells.length);
  return (
    <div
      data-region="viewer-grid"
      data-layout={tab.layout}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: PALETTE.shell,
        padding: SPACE.sm,
        display: 'grid',
        gridTemplateColumns: `repeat(${preset.cols}, 1fr)`,
        gridTemplateRows: `repeat(${preset.rows}, 1fr)`,
        gap: SPACE.sm,
      }}
    >
      {visible.map((v, i) => {
        const [c, r, cs, rs] = preset.cells[i];
        return (
          <div
            key={v.view_id}
            style={{
              gridColumn: `${c + 1} / span ${cs}`,
              gridRow: `${r + 1} / span ${rs}`,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <ViewerCard
              tabId={tab.tab_id}
              view={v}
              activeFrame={tab.active_frame}
              selected={v.view_id === tab.selected_view_id}
              onSelect={() => onSelectView(v.view_id)}
            />
          </div>
        );
      })}
    </div>
  );
};

export const LAYOUT_PRESETS: Array<{ id: TabDTO['layout']; label: string }> = [
  { id: 'single', label: 'Single' },
  { id: 'side', label: 'Side' },
  { id: 'stack', label: 'Stack' },
  { id: '2x2', label: '2×2' },
  { id: '3plus1', label: '3+1' },
];
