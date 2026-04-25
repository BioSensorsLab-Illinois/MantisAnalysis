// ViewerCard — one cell in the viewer grid.
//
// Per design spec §7.1.4: top channel-colored stripe + title bar with
// channel chip + processing badges; canvas in the middle; mono frame
// readout in the footer.

import React from 'react';

import { CHANNEL_COLOR } from '../tokens';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';
import { ViewDTO, frameUrl } from '../api';

import { ChannelChip } from './ChannelChip';
import { ProcessingBadge } from './ProcessingBadge';

const { useMemo, useState } = React;

interface Props {
  tabId: string;
  view: ViewDTO;
  activeFrame: number;
  selected: boolean;
  onSelect: () => void;
}

function _badgesFor(view: ViewDTO): Array<'RAW' | 'DRK' | 'NRM' | 'LUT' | 'LCK'> {
  const out: Array<'RAW' | 'DRK' | 'NRM' | 'LUT' | 'LCK'> = [];
  if (!view.dark_on && !view.normalize && view.colormap === 'gray') out.push('RAW');
  if (view.dark_on) out.push('DRK');
  if (view.normalize) out.push('NRM');
  if (view.colormap && view.colormap !== 'gray') out.push('LUT');
  if (view.locked_frame != null) out.push('LCK');
  return out;
}

export const ViewerCard: React.FC<Props> = ({ tabId, view, activeFrame, selected, onSelect }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Epoch derived from every URL-affecting setting so the <img> reloads
  // when the user changes display params.
  const epoch = useMemo(() => {
    return [
      view.channel,
      view.colormap,
      view.low,
      view.high,
      view.normalize ? 1 : 0,
      view.invert ? 1 : 0,
      view.gain,
      view.offset,
      view.dark_on ? 1 : 0,
      view.dark_id ?? '',
    ].join(':');
  }, [view]);

  const frame = view.locked_frame ?? activeFrame;
  const url = frameUrl(tabId, view.view_id, frame, epoch);
  const channelColor = (CHANNEL_COLOR as Record<string, string>)[view.channel] ?? PALETTE.textMuted;
  const badges = _badgesFor(view);

  return (
    <div
      role="button"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      data-region="viewer-card"
      data-channel={view.channel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        background: PALETTE.shell,
        // Per design spec §11.7: 2 px inset accent border on selected
        // viewer cards. We use a 1 px subtle border + an inner 2 px
        // accent ring via boxShadow inset so layout stays stable.
        border: `1px solid ${PALETTE.border}`,
        borderRadius: RADIUS.md,
        overflow: 'hidden',
        cursor: 'pointer',
        outline: 'none',
        boxShadow: selected ? `inset 0 0 0 2px ${PALETTE.accent}` : undefined,
      }}
    >
      {/* Channel-colored top stripe */}
      <div aria-hidden style={{ height: 3, background: channelColor, flexShrink: 0 }} />

      {/* Title bar: channel chip + badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.sm,
          padding: `${SPACE.xs}px ${SPACE.sm}px`,
          background: selected ? PALETTE.accentSoft : PALETTE.panel,
          borderBottom: `1px solid ${PALETTE.border}`,
          flexShrink: 0,
        }}
      >
        <ChannelChip channel={view.channel} size="sm" />
        <span
          style={{
            flex: 1,
            font: FONT.small,
            color: PALETTE.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={view.name}
        >
          {view.name}
        </span>
        <span style={{ display: 'inline-flex', gap: 2 }}>
          {badges.map((b) => (
            <ProcessingBadge key={b} id={b} />
          ))}
        </span>
      </div>

      {/* Canvas area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          position: 'relative',
        }}
      >
        {!failed && (
          <img
            key={url}
            src={url}
            alt={`Frame ${frame} of ${view.channel}`}
            onLoad={() => {
              setLoaded(true);
              setFailed(false);
            }}
            onError={() => {
              setFailed(true);
              setLoaded(false);
            }}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              imageRendering: 'auto',
              opacity: loaded ? 1 : 0.5,
              transition: 'opacity 100ms linear',
            }}
          />
        )}
        {failed && (
          <div
            style={{
              color: '#fca5a5',
              font: FONT.small,
              padding: SPACE.lg,
              textAlign: 'center',
            }}
          >
            Frame not decoded.
          </div>
        )}
      </div>

      {/* Footer: mono frame readout */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.sm,
          padding: `${SPACE.xs}px ${SPACE.sm}px`,
          background: PALETTE.panel,
          borderTop: `1px solid ${PALETTE.border}`,
          font: FONT.monoSmall,
          color: PALETTE.textFaint,
          flexShrink: 0,
        }}
      >
        <span>f{String(frame).padStart(5, '0')}</span>
        {view.locked_frame != null && <span style={{ color: PALETTE.warn }}>· LOCKED</span>}
      </div>
    </div>
  );
};
