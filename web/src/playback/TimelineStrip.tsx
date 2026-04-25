// @ts-nocheck
// recording-inspection-implementation-v1 M7 — TimelineStrip.
// Per spec.md §7.1.7 + W8. Single track + transport row; locked-pin
// markers (amber); file-boundary shading. Range select = drag with
// shift-key.

import React from 'react';
import { Icon, Select, useTheme } from '../shared.tsx';

const { useMemo, useRef, useState } = React;

const fmtTime = (sec) => {
  if (sec == null || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
};

const tlBtn = (t) => ({
  width: 24,
  height: 22,
  border: `1px solid ${t.chipBorder}`,
  background: t.panel,
  color: t.text,
  borderRadius: 3,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
});

export const TimelineStrip = ({
  stream,
  frame,
  onChangeFrame,
  playing,
  onTogglePlay,
  range,
  onChangeRange,
  lockedFrames,
  speed,
  onChangeSpeed,
  fps,
  onChangeFps,
}) => {
  const t = useTheme();
  const totalFrames = stream?.total_frames ?? 1;
  const trackRef = useRef(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverPct, setHoverPct] = useState(null);

  const framePct = (frame / Math.max(1, totalFrames - 1)) * 100;

  const frameFromClient = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.round((x / rect.width) * (totalFrames - 1));
  };

  const onTrackPointerDown = (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const isShift = ev.shiftKey;
    setScrubbing(true);
    if (isShift) {
      const startFrame = frameFromClient(ev.clientX);
      onChangeRange?.([startFrame, startFrame]);
      const move = (e) =>
        onChangeRange?.([
          Math.min(startFrame, frameFromClient(e.clientX)),
          Math.max(startFrame, frameFromClient(e.clientX)),
        ]);
      const up = () => {
        setScrubbing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    } else {
      onChangeFrame?.(frameFromClient(ev.clientX));
      const move = (e) => onChangeFrame?.(frameFromClient(e.clientX));
      const up = () => {
        setScrubbing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
  };

  const step = (n) => onChangeFrame?.(Math.max(0, Math.min(totalFrames - 1, (frame || 0) + n)));

  const curBoundary = useMemo(() => {
    if (!stream) return null;
    return (stream.boundaries || []).find((b) => frame >= b.start_frame && frame < b.end_frame);
  }, [stream, frame]);

  return (
    <div
      data-region="timeline-strip"
      style={{
        background: t.panel,
        borderTop: `1px solid ${t.border}`,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '8px 12px 6px', position: 'relative' }}>
        <div
          ref={trackRef}
          role="slider"
          aria-label="Timeline scrubber"
          aria-valuemin={0}
          aria-valuemax={totalFrames - 1}
          aria-valuenow={frame}
          tabIndex={0}
          onPointerDown={onTrackPointerDown}
          onPointerMove={(ev) => {
            const rect = trackRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
            setHoverPct(x / rect.width);
          }}
          onPointerLeave={() => setHoverPct(null)}
          style={{
            height: 30,
            position: 'relative',
            cursor: scrubbing ? 'grabbing' : 'pointer',
            background: t.panelAlt,
            border: `1px solid ${t.border}`,
            borderRadius: 3,
            userSelect: 'none',
            overflow: 'hidden',
          }}
        >
          {/* File boundaries */}
          {stream?.boundaries?.map((b, i) => {
            const leftPct = (b.start_frame / totalFrames) * 100;
            const widthPct = ((b.end_frame - b.start_frame) / totalFrames) * 100;
            return (
              <div
                key={i}
                data-boundary-index={i}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  background: i % 2 === 0 ? 'rgba(74, 158, 255, 0.06)' : 'transparent',
                  borderRight:
                    i < stream.boundaries.length - 1 ? `1px dashed ${t.chipBorder}` : 'none',
                }}
              />
            );
          })}
          {/* Range */}
          {range && range[0] != null && range[1] != null && range[1] > range[0] && (
            <div
              data-region="timeline-range"
              style={{
                position: 'absolute',
                top: 2,
                bottom: 2,
                left: `${(range[0] / totalFrames) * 100}%`,
                width: `${((range[1] - range[0]) / totalFrames) * 100}%`,
                background: 'rgba(74, 158, 255, 0.15)',
                border: `1px solid ${t.accent}`,
                borderRadius: 2,
              }}
            />
          )}
          {/* Locked-view pins */}
          {(lockedFrames || []).map((lf, i) => (
            <div
              key={i}
              title={`Locked at frame ${lf}`}
              data-region="locked-pin"
              data-locked-frame={lf}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(lf / Math.max(1, totalFrames - 1)) * 100}%`,
                width: 2,
                background: t.warn,
                transform: 'translateX(-1px)',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: -3,
                  width: 8,
                  height: 4,
                  background: t.warn,
                  borderRadius: 1,
                }}
              />
            </div>
          ))}
          {/* Playhead */}
          <div
            data-region="playhead"
            style={{
              position: 'absolute',
              top: -2,
              bottom: -2,
              left: `${framePct}%`,
              width: 2,
              background: t.accent,
              transform: 'translateX(-1px)',
              pointerEvents: 'none',
              boxShadow: scrubbing ? `0 0 0 3px ${t.accentSoft}` : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -5,
                left: -4,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: t.accent,
                border: '2px solid #fff',
              }}
            />
          </div>
          {hoverPct != null && !scrubbing && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: `${hoverPct * 100}%`,
                transform: 'translateX(-50%)',
                marginBottom: 4,
                padding: '2px 6px',
                background: t.panel,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'ui-monospace, Menlo, monospace',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              f{Math.round(hoverPct * (totalFrames - 1))} ·{' '}
              {fmtTime((hoverPct * (totalFrames - 1)) / Math.max(stream?.fps ?? 30, 1e-9))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          height: 32,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: t.text,
          fontSize: 11,
          borderTop: `1px solid ${t.border}`,
          background: t.panelAlt,
        }}
      >
        <button
          type="button"
          aria-label="First frame"
          data-action="first-frame"
          onClick={() => onChangeFrame?.(0)}
          style={tlBtn(t)}
        >
          <Icon name="first" size={11} />
        </button>
        <button
          type="button"
          aria-label="Previous frame"
          data-action="prev-frame"
          onClick={() => step(-1)}
          style={tlBtn(t)}
        >
          <Icon name="prev" size={11} />
        </button>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          data-action="play-pause"
          onClick={onTogglePlay}
          style={{
            ...tlBtn(t),
            background: t.accent,
            color: '#fff',
            width: 30,
            borderColor: t.accent,
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} size={12} />
        </button>
        <button
          type="button"
          aria-label="Next frame"
          data-action="next-frame"
          onClick={() => step(1)}
          style={tlBtn(t)}
        >
          <Icon name="next" size={11} />
        </button>
        <button
          type="button"
          aria-label="Last frame"
          data-action="last-frame"
          onClick={() => onChangeFrame?.(totalFrames - 1)}
          style={tlBtn(t)}
        >
          <Icon name="last" size={11} />
        </button>
        <div style={{ width: 1, height: 18, background: t.border, margin: '0 6px' }} />
        <span
          style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            color: t.textMuted,
            fontSize: 10.5,
          }}
        >
          f
        </span>
        <input
          type="number"
          aria-label="Current frame number"
          value={frame}
          min={0}
          max={Math.max(0, totalFrames - 1)}
          onChange={(ev) =>
            onChangeFrame?.(Math.max(0, Math.min(totalFrames - 1, Number(ev.target.value) || 0)))
          }
          style={{
            width: 64,
            padding: '3px 6px',
            background: t.inputBg,
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 10.5,
          }}
        />
        <span
          style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            color: t.textFaint,
            fontSize: 10.5,
          }}
        >
          / {totalFrames - 1}
        </span>
        <span
          style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            color: t.textMuted,
            fontSize: 10.5,
            marginLeft: 10,
          }}
        >
          {fmtTime(frame / Math.max(stream?.fps ?? 30, 1e-9))}
        </span>
        {curBoundary && (
          <>
            <div style={{ width: 1, height: 18, background: t.border, margin: '0 8px' }} />
            <span
              style={{
                fontSize: 10,
                color: t.textFaint,
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              {curBoundary.recording_id?.slice(0, 6)} · {curBoundary.exposure ?? '—'}
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 9.5,
            color: t.textFaint,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Speed
        </span>
        <Select
          value={String(speed ?? 1)}
          options={['0.25', '0.5', '1', '2', '4'].map((v) => ({ value: v, label: `${v}×` }))}
          onChange={(v) => onChangeSpeed?.(Number(v))}
          ariaLabel="Playback speed"
        />
        <span
          style={{
            fontSize: 9.5,
            color: t.textFaint,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Fps
        </span>
        <Select
          value={String(fps ?? 30)}
          options={['24', '30', '60'].map((v) => ({ value: v, label: v }))}
          onChange={(v) => onChangeFps?.(Number(v))}
          ariaLabel="Playback fps"
        />
      </div>
    </div>
  );
};
