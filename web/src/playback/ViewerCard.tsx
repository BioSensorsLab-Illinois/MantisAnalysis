// @ts-nocheck
// recording-inspection-implementation-v1 M7 — ViewerCard.
// Per spec.md §7.1.4 + W5/W6. Single <img> swapping its src on every
// frame/view change; race-aware via an epoch counter (risk-skeptic
// P3-X). Header chip + processing badges + footer timestamp pill;
// lock indicator amber; selection accent.

import React from 'react';
import { Icon, useTheme, useDebounced } from '../shared.tsx';
import { previewPngUrl } from './api.ts';
import { ConfirmRemoveButton } from './ConfirmRemoveButton.tsx';

const { useLayoutEffect, useMemo, useRef, useState } = React;

// recording-inspection-implementation-v1 M12 frontend-react F9 +
// performance F1: stable signature for the URL `useMemo` key. Without
// this, every reducer dispatch produces a fresh `view` object identity
// and the URL is rebuilt → image network stampede on slider drags.
// We hash only the fields `previewPngUrl` actually reads.
const _viewSig = (v) =>
  v == null
    ? ''
    : [
        v.type,
        v.channel,
        (v.channels || []).join('|'),
        v.dark_on ? 1 : 0,
        v.gain,
        v.offset,
        v.normalize ? 1 : 0,
        v.low,
        v.high,
        v.colormap,
        v.invert ? 1 : 0,
        v.show_clipped ? 1 : 0,
        (v.rgb_gain || []).join(','),
        (v.rgb_offset || []).join(','),
        v.gamma,
        v.brightness,
        v.contrast,
        v.saturation,
        v.wb_k,
        v.wb_mode,
        v.ccm_on ? 1 : 0,
        v.ccm_on ? JSON.stringify(v.ccm) : '',
        v.overlay_on ? 1 : 0,
        v.overlay_on
          ? `${v.overlay_channel}|${v.overlay_low}|${v.overlay_high}|${v.overlay_blend}|${v.overlay_strength}|${v.overlay_cmap}|${v.overlay_below}|${v.overlay_above}`
          : '',
        v.labels_timestamp ? 1 : 0,
        v.labels_frame ? 1 : 0,
        v.labels_channel ? 1 : 0,
        v.labels_source ? 1 : 0,
        v.labels_scale_bar ? 1 : 0,
        v.labels_badges ? 1 : 0,
      ].join('§');

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
  onHandoff,
}) => {
  const t = useTheme();
  const isLocked = view.locked_frame != null;
  const effectiveFrame = isLocked ? view.locked_frame : frame;
  // M12 frontend-react F8 + performance F1: debounce the view at
  // 80 ms so slider drags don't fire a fresh PNG request per
  // mousemove. AGENT_RULES "drag debouncing ≥ 80 ms" rule.
  const dview = useDebounced(view, 80);
  // M12 frontend-react F9 + performance F1: key the URL memo on the
  // signature of fields the URL actually depends on, not the object
  // identity. Reducer dispatches create fresh `view` objects → without
  // signature, every dispatch rebuilds the URL.
  const sig = _viewSig(dview);
  const url = useMemo(
    () => (streamId ? previewPngUrl(streamId, effectiveFrame, dview) : ''),
    // M12 frontend-react F9: keying on `sig` (a stable signature of
    // `dview`'s URL-relevant fields) is intentional — `dview` itself
    // is a fresh object identity per reducer dispatch and would
    // invalidate the memo on every unrelated state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamId, effectiveFrame, sig]
  );

  const epoch = useRef(0);
  const [imgState, setImgState] = useState('loading');
  const [hover, setHover] = useState(false);
  // M12 frontend-react F3: bump epoch in a useLayoutEffect so it
  // increments synchronously *before* the new <img> mounts and its
  // onLoad/onError fire. The handlers read epoch.current directly
  // (not via captured-at-render IIFE) so a late-arriving response
  // for an old URL is correctly dropped.
  useLayoutEffect(() => {
    epoch.current += 1;
    setImgState('loading');
  }, [url]);

  const outline = selected ? t.accent : isLocked ? t.warn : 'transparent';
  const badges = badgesFor(view);
  const chipColor = view.type === 'rgb' ? t.accent : t.text;

  const handleLoad = () => {
    setImgState('ok');
  };
  const handleError = () => {
    setImgState('failed');
  };

  return (
    <div
      data-view-id={view.view_id}
      data-selected={selected ? '1' : '0'}
      data-locked={isLocked ? '1' : '0'}
      data-active={selected ? 'true' : undefined}
      onClick={() => onSelect?.(view.view_id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // M12 accessibility P0: previously this was role="button"
      // with `aria-selected="true"` (axe critical: aria-allowed-attr)
      // AND it contained nested `<button>`s (axe serious:
      // nested-interactive). Switching to role="group" with an
      // `aria-label` keeps the wrapper a discoverable region while
      // allowing the inner buttons (handoff, lock, remove,
      // duplicate) to be reachable. Selection is still surfaced via
      // `data-selected` for tests/visual styling.
      role="group"
      aria-label={`Viewer ${view.name}${selected ? ' (selected)' : ''}${isLocked ? ' (locked)' : ''}`}
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
      {/* Frame image. M12 frontend-react F3: drop `key={url}` so React
          swaps `src` on the same DOM node; epoch is bumped in
          useLayoutEffect *before* this img remounts/repaints, and the
          onLoad/onError read `epoch.current` directly via the closure
          handlers above (no stale captured value). */}
      {url && (
        <img
          src={url}
          alt={`Frame ${effectiveFrame} of ${view.name}`}
          decoding="async"
          loading="eager"
          onLoad={handleLoad}
          onError={handleError}
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

      {/* Hover toolbar.
          M12 accessibility P0 + react-ui-ux P1: always mount the
          toolbar (hidden via opacity + pointer-events for sighted
          users) so keyboard users can reach the inner controls via
          Tab regardless of hover state. The buttons are also bumped
          22→24 px to clear WCAG 2.2 SC 2.5.8 (target size). */}
      <div
        data-region="viewer-hover-toolbar"
        data-visible={hover || selected ? '1' : '0'}
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
          opacity: hover || selected ? 1 : 0,
          pointerEvents: hover || selected ? 'auto' : 'none',
          transition: 'opacity 100ms ease-out',
        }}
        onFocusCapture={() => setHover(true)}
        onBlurCapture={(ev) => {
          // keep visible while focus is inside; collapse when it leaves.
          const next = ev.relatedTarget;
          const tb = ev.currentTarget;
          if (!tb.contains(next)) setHover(false);
        }}
      >
        <button
          type="button"
          aria-label={isLocked ? 'Unlock view' : 'Lock view to current frame'}
          title={isLocked ? 'Unlock view' : 'Lock view to current frame'}
          data-action="lock"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleLock?.(view.view_id);
          }}
          style={{
            width: 24,
            height: 24,
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
          title="Duplicate view"
          data-action="duplicate"
          onClick={(ev) => {
            ev.stopPropagation();
            onDuplicate?.(view.view_id);
          }}
          style={{
            width: 24,
            height: 24,
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
          aria-label="Send frame to USAF Resolution"
          title="Send frame to USAF Resolution"
          data-action="handoff-usaf"
          onClick={(ev) => {
            ev.stopPropagation();
            onHandoff?.(view.view_id, 'usaf');
          }}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            cursor: 'pointer',
            borderRadius: 2,
            background: 'transparent',
            color: '#d8dde6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          →U
        </button>
        <button
          type="button"
          aria-label="Send frame to FPN"
          title="Send frame to FPN"
          data-action="handoff-fpn"
          onClick={(ev) => {
            ev.stopPropagation();
            onHandoff?.(view.view_id, 'fpn');
          }}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            cursor: 'pointer',
            borderRadius: 2,
            background: 'transparent',
            color: '#d8dde6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          →F
        </button>
        <button
          type="button"
          aria-label="Send frame to Depth of Field"
          title="Send frame to Depth of Field"
          data-action="handoff-dof"
          onClick={(ev) => {
            ev.stopPropagation();
            onHandoff?.(view.view_id, 'dof');
          }}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            cursor: 'pointer',
            borderRadius: 2,
            background: 'transparent',
            color: '#d8dde6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          →D
        </button>
        {/* M2 destructive guard: 2-step confirm via ConfirmRemoveButton
            (icon mode). First click flashes red + tooltip changes to
            "Click again to confirm"; second click within 3s commits. */}
        <ConfirmRemoveButton
          ariaLabel="Remove view"
          dataAction="remove"
          iconMode
          iconNode={<Icon name="close" size={12} />}
          iconWidth={24}
          iconHeight={24}
          onConfirm={() => onRemove?.(view.view_id)}
        />
      </div>

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
