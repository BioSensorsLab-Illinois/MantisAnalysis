// @ts-nocheck
// recording-inspection-implementation-v1 M7 — ViewerCard.
// Per spec.md §7.1.4 + W5/W6. Single <img> swapping its src on every
// frame/view change; race-aware via an epoch counter (risk-skeptic
// P3-X). Header chip + processing badges + footer timestamp pill;
// lock indicator amber; selection accent.

import React from 'react';
import { Icon, useTheme } from '../shared.tsx';
import { previewPngUrl } from './api.ts';

const { useEffect, useMemo, useRef, useState } = React;

const BADGE_DEF = [
  { id: 'RAW', tone: 'neutral', title: 'Raw channel · no processing' },
  { id: 'DRK', tone: 'accent', title: 'Dark-corrected' },
  { id: 'NRM', tone: 'accent', title: 'Normalized (min / max)' },
  { id: 'LUT', tone: 'accent', title: 'Non-linear colormap applied' },
  { id: 'RGB', tone: 'accent', title: 'RGB grading applied' },
  { id: 'OVL', tone: 'warn', title: 'Overlay layer active' },
  { id: 'LCK', tone: 'warn', title: 'Locked to specific frame' },
];

const badgesFor = (view) => {
  const out = [];
  if (!view.dark_on && !view.normalize && view.colormap === 'gray' && view.type !== 'rgb') {
    out.push('RAW');
  }
  if (view.dark_on) out.push('DRK');
  if (view.normalize) out.push('NRM');
  if (view.colormap && view.colormap !== 'gray' && view.type !== 'rgb') out.push('LUT');
  if (view.type === 'rgb') out.push('RGB');
  if (view.overlay_on) out.push('OVL');
  if (view.locked_frame != null) out.push('LCK');
  return out;
};

const ProcessingBadge = ({ id }) => {
  const t = useTheme();
  const def = BADGE_DEF.find((b) => b.id === id);
  if (!def) return null;
  const tones = {
    neutral: { bg: t.chipBg, fg: t.textMuted, br: t.chipBorder },
    accent: { bg: t.accentSoft, fg: t.accent, br: 'transparent' },
    warn: { bg: 'rgba(197, 127, 0, 0.14)', fg: t.warn, br: 'transparent' },
  };
  const tone = tones[def.tone];
  return (
    <span
      title={def.title}
      data-badge={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 5px',
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.br}`,
        borderRadius: 3,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      {id}
    </span>
  );
};

export const ViewerCard = ({
  view,
  frame,
  streamId,
  selected,
  onSelect,
  onToggleLock,
  onRemove,
  onDuplicate,
}) => {
  const t = useTheme();
  const isLocked = view.locked_frame != null;
  const effectiveFrame = isLocked ? view.locked_frame : frame;
  const url = useMemo(
    () => (streamId ? previewPngUrl(streamId, effectiveFrame, view) : ''),
    [streamId, effectiveFrame, view]
  );

  const epoch = useRef(0);
  const [imgState, setImgState] = useState('loading');
  const [hover, setHover] = useState(false);
  useEffect(() => {
    epoch.current += 1;
    setImgState('loading');
  }, [url]);

  const outline = selected ? t.accent : isLocked ? t.warn : 'transparent';
  const badges = badgesFor(view);
  const chipColor = view.type === 'rgb' ? t.accent : t.text;

  const handleLoad = (myEpoch) => {
    if (myEpoch !== epoch.current) return; // stale (race-aware, P3-X)
    setImgState('ok');
  };
  const handleError = (myEpoch) => {
    if (myEpoch !== epoch.current) return;
    setImgState('failed');
  };

  return (
    <div
      data-view-id={view.view_id}
      data-selected={selected ? '1' : '0'}
      data-locked={isLocked ? '1' : '0'}
      onClick={() => onSelect?.(view.view_id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="button"
      aria-label={`Viewer ${view.name}${selected ? ' (selected)' : ''}${isLocked ? ' (locked)' : ''}`}
      aria-selected={selected ? 'true' : 'false'}
      style={{
        position: 'relative',
        background: '#0a0a0a',
        border: `1px solid ${t.border}`,
        outline: selected || isLocked ? `1.5px solid ${outline}` : 'none',
        outlineOffset: -1,
        borderRadius: 4,
        overflow: 'hidden',
        height: '100%',
        minHeight: 0,
        cursor: selected ? 'default' : 'pointer',
      }}
    >
      {/* Frame image */}
      {url && (
        <img
          key={url}
          src={url}
          alt={`Frame ${effectiveFrame} of ${view.name}`}
          decoding="async"
          loading="eager"
          onLoad={(
            (cur) => () =>
              handleLoad(cur)
          )(epoch.current)}
          onError={(
            (cur) => () =>
              handleError(cur)
          )(epoch.current)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: imgState === 'ok' ? 1 : 0.25,
            transition: 'opacity 120ms',
          }}
        />
      )}

      {/* Top-left identity chip */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: 'rgba(14,16,20,0.72)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          padding: '3px 7px',
          fontSize: 10.5,
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: '#e8eaed',
          maxWidth: 'calc(100% - 16px)',
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: selected ? t.accent : isLocked ? t.warn : '#7f8ea0',
          }}
        />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 140,
          }}
        >
          {view.name}
        </span>
        <span style={{ color: '#8f9aab' }}>·</span>
        <span style={{ color: chipColor, fontWeight: 600 }}>
          {view.type === 'rgb' ? 'RGB' : view.channel}
        </span>
      </div>

      {/* Top-right badges */}
      {badges.length > 0 && (
        <div
          data-region="viewer-badges"
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            display: 'flex',
            gap: 2,
            background: 'rgba(14,16,20,0.6)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 3,
            padding: '2px 3px',
          }}
        >
          {badges.map((b) => (
            <ProcessingBadge key={b} id={b} />
          ))}
        </div>
      )}

      {/* Bottom-left frame/timestamp pill */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          background: 'rgba(14,16,20,0.72)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          padding: '2px 6px',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 10,
          color: '#e8eaed',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>f{String(effectiveFrame).padStart(4, '0')}</span>
        {isLocked && (
          <>
            <span style={{ color: '#8f9aab' }}>·</span>
            <span
              style={{
                color: t.warn,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <Icon name="lock" size={9} />
              LOCK
            </span>
          </>
        )}
        {!isLocked && view.sync_to_global && (
          <>
            <span style={{ color: '#8f9aab' }}>·</span>
            <span style={{ color: '#6fd48a' }}>SYNC</span>
          </>
        )}
      </div>

      {/* Hover toolbar */}
      {(hover || selected) && (
        <div
          data-region="viewer-hover-toolbar"
          style={{
            position: 'absolute',
            right: 8,
            top: 36,
            display: 'flex',
            gap: 2,
            background: 'rgba(14,16,20,0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 3,
            padding: 2,
          }}
        >
          <button
            type="button"
            aria-label={isLocked ? 'Unlock view' : 'Lock view to current frame'}
            data-action="lock"
            onClick={(ev) => {
              ev.stopPropagation();
              onToggleLock?.(view.view_id);
            }}
            style={{
              width: 22,
              height: 22,
              border: 'none',
              cursor: 'pointer',
              borderRadius: 2,
              background: isLocked ? 'rgba(197, 127, 0, 0.25)' : 'transparent',
              color: isLocked ? '#ffc36f' : '#d8dde6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <Icon name={isLocked ? 'unlock' : 'lock'} size={12} />
          </button>
          <button
            type="button"
            aria-label="Duplicate view"
            data-action="duplicate"
            onClick={(ev) => {
              ev.stopPropagation();
              onDuplicate?.(view.view_id);
            }}
            style={{
              width: 22,
              height: 22,
              border: 'none',
              cursor: 'pointer',
              borderRadius: 2,
              background: 'transparent',
              color: '#d8dde6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <Icon name="copy" size={12} />
          </button>
          <button
            type="button"
            aria-label="Remove view"
            data-action="remove"
            onClick={(ev) => {
              ev.stopPropagation();
              onRemove?.(view.view_id);
            }}
            style={{
              width: 22,
              height: 22,
              border: 'none',
              cursor: 'pointer',
              borderRadius: 2,
              background: 'transparent',
              color: '#d8dde6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {imgState === 'failed' && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#c97a7a',
            fontSize: 12,
            fontFamily: 'ui-monospace, Menlo, monospace',
            background: 'rgba(0,0,0,0.4)',
          }}
        >
          Frame not decoded
        </div>
      )}
    </div>
  );
};
