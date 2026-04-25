// @ts-nocheck
// playback-ux-polish-v1 M5 — Viewer right-click context menu (W11).
//
// Right-clicking a ViewerCard opens this menu with the same actions
// the hover toolbar already exposes:
//   * Send to USAF Resolution / FPN / Depth of Field
//   * Lock to current frame  /  Unlock  (toggles)
//   * Duplicate view
//   * Remove view  (destructive — opens the same 2-step confirm
//     pattern via ConfirmRemoveButton on the toolbar; here we just
//     route to onRemove which is wrapped at the higher level)
//
// The menu positions itself at the click coordinates, clips to the
// viewport, traps focus while open, closes on Esc / outside-click /
// item-click. Uses the existing `mantis:source-evicted` /
// `data-region` patterns for tests.

import React from 'react';
import { useTheme } from '../shared.tsx';

const { useEffect, useRef, useState } = React;

const MENU_ITEMS = [
  { id: 'handoff-usaf', label: 'Send to USAF Resolution', kind: 'handoff' },
  { id: 'handoff-fpn', label: 'Send to FPN', kind: 'handoff' },
  { id: 'handoff-dof', label: 'Send to Depth of Field', kind: 'handoff' },
  { id: 'sep1', sep: true },
  { id: 'lock', label: 'Lock to current frame', kind: 'lock' },
  { id: 'duplicate', label: 'Duplicate view', kind: 'duplicate' },
  { id: 'sep2', sep: true },
  { id: 'remove', label: 'Remove view', kind: 'remove', destructive: true },
];

export const ViewerCardContextMenu = ({
  x,
  y,
  isLocked,
  onClose,
  onHandoff,
  onToggleLock,
  onDuplicate,
  onRemove,
}) => {
  const t = useTheme();
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [armRemove, setArmRemove] = useState(false); // 2-step destructive

  useEffect(() => {
    // Clip to viewport.
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - 4) nx = vw - rect.width - 4;
    if (ny + rect.height > vh - 4) ny = vh - rect.height - 4;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    setPos({ x: nx, y: ny });
    // Move focus into the menu.
    const first = node.querySelector('button[role="menuitem"]');
    if (first) {
      try {
        first.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
  }, [x, y]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const fire = (kind) => {
    if (kind === 'handoff-usaf') onHandoff?.('usaf');
    else if (kind === 'handoff-fpn') onHandoff?.('fpn');
    else if (kind === 'handoff-dof') onHandoff?.('dof');
    else if (kind === 'lock') onToggleLock?.();
    else if (kind === 'duplicate') onDuplicate?.();
    else if (kind === 'remove') {
      // 2-step destructive guard inline (mirrors ConfirmRemoveButton):
      // first selection arms, second commits.
      if (!armRemove) {
        setArmRemove(true);
        return; // keep menu open
      }
      onRemove?.();
    } else return;
    onClose?.();
  };

  return (
    <div
      ref={ref}
      data-region="viewer-context-menu"
      role="menu"
      aria-label="Viewer actions"
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 200,
        minWidth: 200,
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        boxShadow: t.shadowLg,
        padding: 4,
        fontFamily: 'inherit',
        fontSize: 12,
        color: t.text,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {MENU_ITEMS.map((item) => {
        if (item.sep) {
          return (
            <div
              key={item.id}
              role="separator"
              style={{
                height: 1,
                background: t.border,
                margin: '4px 0',
              }}
            />
          );
        }
        const label =
          item.id === 'lock'
            ? isLocked
              ? 'Unlock view'
              : 'Lock to current frame'
            : item.id === 'remove' && armRemove
              ? 'Click again to confirm removal'
              : item.label;
        const destructive = item.destructive && armRemove;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-action={`menu-${item.id}`}
            data-armed={item.destructive ? (armRemove ? '1' : '0') : undefined}
            onClick={() => fire(item.id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: 4,
              border: 'none',
              background: destructive ? t.danger : 'transparent',
              color: destructive ? '#fff' : item.destructive ? t.danger : t.text,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
              fontWeight: destructive ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (!destructive) e.currentTarget.style.background = t.chipBg;
            }}
            onMouseLeave={(e) => {
              if (!destructive) e.currentTarget.style.background = 'transparent';
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};
