// @ts-nocheck
// playback/RoiOverlay — extracted from web/src/playback.tsx in
// B-0037 Phase 3.
//
// Pure helpers + a presentational SVG component for the polygon ROI
// surface that the Play canvas overlays on top of the rendered <img>.
// Used by overlay-mode mask drawing AND TBR Analysis Tumor /
// Background ROI drawing — both flows share the same geometry math.
//
// Why a separate file:
//   * The ``preserveAspectRatio="xMidYMid meet"`` letterbox math is
//     ~25 lines and easy to get wrong (Chromium's getScreenCTM does
//     not include CSS transforms, so naive math drifts at non-1×
//     zoom). One owner.
//   * The polygon-rendering JSX (polylines + vertex dots + hint
//     text) is identical for overlay-mask + tumor + background ROIs;
//     extracting collapses three near-duplicate inlined blocks into
//     one helper.
//
// Public surface:
//   * clientToImagePx(args) → { ix, iy } | null
//     Hit-test math: convert a (clientX, clientY) on the SVG element's
//     bounding-rect into image-pixel coords, honoring the SVG's
//     preserveAspectRatio="xMidYMid meet" letterboxing. Returns null
//     when the click was outside the rendered image content rect.
//   * <RoiOverlaySvg ... />
//     The SVG element with the polygon polylines + vertex dots +
//     optional draw-mode hint text. The parent component still owns
//     the click handler (it has the local state mutations) — this
//     just renders.

import React from 'react';

/**
 * Compute image-pixel coordinates from a click event on the canvas
 * SVG. Returns null when the click was outside the rendered image
 * content rect (e.g., in the letterbox margin of a non-square image
 * fitted into a square SVG box).
 *
 * @param svgEl   - the <svg> element (must have `getBoundingClientRect`)
 * @param imageW  - source image width in pixels
 * @param imageH  - source image height in pixels
 * @param clientX - click clientX (e.g. e.clientX)
 * @param clientY - click clientY
 */
export function clientToImagePx({ svgEl, imageW, imageH, clientX, clientY }) {
  if (!svgEl || imageW <= 0 || imageH <= 0) return null;
  const rect = svgEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const aspectImg = imageW / imageH;
  const aspectRect = rect.width / rect.height;
  let contentW;
  let contentH;
  let contentLeft;
  let contentTop;
  if (aspectImg > aspectRect) {
    contentW = rect.width;
    contentH = rect.width / aspectImg;
    contentLeft = rect.left;
    contentTop = rect.top + (rect.height - contentH) / 2;
  } else {
    contentH = rect.height;
    contentW = rect.height * aspectImg;
    contentLeft = rect.left + (rect.width - contentW) / 2;
    contentTop = rect.top;
  }
  const fx = (clientX - contentLeft) / contentW;
  const fy = (clientY - contentTop) / contentH;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  return {
    ix: Math.round(fx * imageW),
    iy: Math.round(fy * imageH),
  };
}

const PolyEl = ({ pts, color, fillAlpha, imageW }) => {
  if (!pts || pts.length === 0) return null;
  const polyStr = pts.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <g>
      {pts.length >= 2 && (
        <polyline
          points={polyStr}
          fill={pts.length >= 3 ? `${color}${fillAlpha}` : 'none'}
          stroke={color}
          strokeWidth={Math.max(1, imageW / 600)}
          strokeLinejoin="round"
        />
      )}
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={Math.max(2, imageW / 300)}
          fill={color}
          stroke="#fff"
          strokeWidth={Math.max(1, imageW / 1200)}
        />
      ))}
    </g>
  );
};

/**
 * SVG polygon overlay for the Play canvas. Renders any combination of
 * overlay-mask polygon (blue), TBR tumor polygon (red), and TBR
 * background polygon (cyan) at correct image-pixel coordinates inside
 * the SVG viewBox. Shares the parent <img>'s CSS transform via the
 * `panX`, `panY`, `zoom` props so vertices stay glued to the image
 * when the user pans / zooms the canvas.
 *
 * The PARENT owns the click handler — this component is purely
 * presentational. Use `clientToImagePx` from this file for the
 * hit-test math in the parent's onClick.
 */
export const RoiOverlaySvg = React.forwardRef(function RoiOverlaySvg(
  { imageW, imageH, overlayPts, tumorPts, bgPts, panX, panY, zoom, hint },
  ref
) {
  const iw = imageW || 1;
  const ih = imageH || 1;
  const ovPts = Array.isArray(overlayPts) ? overlayPts : [];
  const tPts = Array.isArray(tumorPts) ? tumorPts : [];
  const bPts = Array.isArray(bgPts) ? bgPts : [];
  if (ovPts.length === 0 && tPts.length === 0 && bPts.length === 0 && !hint) {
    return null;
  }
  const hintAnchor = tPts[0] || bPts[0] || ovPts[0] || [iw * 0.05, iw * 0.05];
  return (
    <svg
      ref={ref}
      data-overlay-roi-svg
      viewBox={`0 0 ${iw} ${ih}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        transform: `translate(${panX || 0}px, ${panY || 0}px) scale(${zoom || 1})`,
        transformOrigin: 'center center',
      }}
    >
      <PolyEl pts={ovPts} color="#3a82f7" fillAlpha="1A" imageW={iw} />
      <PolyEl pts={tPts} color="#ff5b5b" fillAlpha="24" imageW={iw} />
      <PolyEl pts={bPts} color="#3ecbe5" fillAlpha="24" imageW={iw} />
      {hint && (
        <text
          x={hintAnchor[0] + Math.max(4, iw / 200)}
          y={hintAnchor[1] - Math.max(4, iw / 200)}
          fontSize={Math.max(8, iw / 90)}
          fill="#fff"
          stroke="#000"
          strokeWidth={Math.max(0.5, iw / 1800)}
          paintOrder="stroke"
        >
          {hint}
        </text>
      )}
    </svg>
  );
});
