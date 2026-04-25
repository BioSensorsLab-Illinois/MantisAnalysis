// @ts-nocheck
// playback-ux-polish-v1 M2 — destructive-action guard.
//
// 2-step confirm pattern: first click flips the button to a red
// "Click again to confirm" state for 3 seconds, the second click
// fires the real delete, and any third destination (mouse leaves,
// 3s elapses, Esc) reverts to the safe state.
//
// This replaces the prior pattern across FilePill / DarkFrameRow /
// ViewerCard Remove buttons where a single click immediately fired
// the destructive request — flagged by react-ui-ux M12 P1.

import React from 'react';
import { useTheme } from '../shared.tsx';

const { useEffect, useRef, useState } = React;

const REVERT_AFTER_MS = 3000;

export const ConfirmRemoveButton = ({
  onConfirm,
  ariaLabel,
  size = 'md',
  variant = 'subtle',
  children = 'Remove',
  confirmLabel = 'Click again to confirm',
  dataAction = 'remove',
  disabled = false,
  iconMode = false,
  iconNode = null,
  iconWidth = 22,
  iconHeight = 22,
}) => {
  const t = useTheme();
  const [armed, setArmed] = useState(false);
  const timerRef = useRef(null);

  const disarm = () => {
    setArmed(false);
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => () => disarm(), []);
  useEffect(() => {
    if (!armed) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') disarm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);

  const onClick = (ev) => {
    ev.stopPropagation();
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(() => {
        setArmed(false);
        timerRef.current = null;
      }, REVERT_AFTER_MS);
      return;
    }
    disarm();
    onConfirm?.(ev);
  };

  const padding = size === 'sm' ? '3px 8px' : '4px 10px';
  const fontSize = size === 'sm' ? 10 : 11;
  const palette = armed
    ? {
        bg: t.danger,
        fg: '#fff',
        border: t.danger,
      }
    : variant === 'danger'
      ? {
          bg: 'transparent',
          fg: t.danger,
          border: t.danger,
        }
      : {
          bg: 'transparent',
          fg: t.textMuted,
          border: t.chipBorder,
        };

  if (iconMode) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        title={armed ? confirmLabel : ariaLabel}
        data-action={dataAction}
        data-armed={armed ? '1' : '0'}
        aria-pressed={armed ? 'true' : 'false'}
        onClick={onClick}
        onMouseLeave={armed ? disarm : undefined}
        onBlur={armed ? disarm : undefined}
        disabled={disabled}
        style={{
          width: iconWidth,
          height: iconHeight,
          background: armed ? t.danger : 'transparent',
          color: armed ? '#fff' : t.textFaint,
          border: armed ? `1px solid ${t.danger}` : 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          borderRadius: 3,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 80ms, color 80ms',
        }}
      >
        {iconNode}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={armed ? confirmLabel : ariaLabel}
      data-action={dataAction}
      data-armed={armed ? '1' : '0'}
      aria-pressed={armed ? 'true' : 'false'}
      onClick={onClick}
      onMouseLeave={armed ? disarm : undefined}
      onBlur={armed ? disarm : undefined}
      disabled={disabled}
      style={{
        padding,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize,
        fontFamily: 'inherit',
        fontWeight: armed ? 600 : 400,
        transition: 'background 80ms, color 80ms, border-color 80ms',
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
};
