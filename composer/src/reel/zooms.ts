// Zooms on the footage (screen recordings): pure functions for the renderer, the editor and tests.
//
// A zoom is {start, end, x, y, zoom}: SOURCE seconds, centre as fractions of the footage box. The view eases
// in over RAMP seconds from the zoom's start, holds, and eases back out after its end. When the next zoom
// starts soon after one ends, the view pans straight across instead of pulling out and back in.

export interface Zoom {
  start: number;
  end: number;
  x: number;
  y: number;
  zoom: number;
}

export interface View {
  zoom: number;
  x: number;
  y: number;
}

/** Seconds a zoom takes to ease in or out. */
export const RAMP = 0.6;
const FULL: View = { zoom: 1, x: 0.5, y: 0.5 };

const ease = (p: number) => {
  const q = Math.min(1, Math.max(0, p));
  return q * q * (3 - 2 * q);
};
const mix = (a: View, b: View, p: number): View => ({ zoom: a.zoom + (b.zoom - a.zoom) * p, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
const viewOf = (z: Zoom): View => ({ zoom: Math.max(1, z.zoom), x: z.x, y: z.y });

/** Zooms in time order, without ones that have no length. */
export function sortZooms(zooms: Zoom[] | undefined): Zoom[] {
  return (zooms || []).filter((z) => z.end > z.start).sort((a, b) => a.start - b.start);
}

/** Two zooms close enough that the view pans from one to the next instead of pulling out in between. */
const linked = (a: Zoom, b: Zoom) => b.start - a.end < 2 * RAMP;

/** The view at SOURCE second t. */
export function viewAt(zooms: Zoom[] | undefined, t: number): View {
  const zs = sortZooms(zooms);
  let i = -1;
  for (let k = 0; k < zs.length; k++) if (zs[k].start <= t) i = k;
  if (i < 0) return FULL;
  const z = zs[i];
  if (t <= z.end) {
    const from = i > 0 && linked(zs[i - 1], z) ? viewOf(zs[i - 1]) : FULL;
    return mix(from, viewOf(z), ease((t - z.start) / RAMP));
  }
  const next = zs[i + 1];
  if (next && linked(z, next)) return viewOf(z); // hold until the next one pans across
  return mix(viewOf(z), FULL, ease((t - z.end) / RAMP));
}

/**
 * CSS transform (origin top left) that shows `view` in a w x h box. The centre is kept far enough from the
 * edges that the zoomed picture always covers the box.
 */
export function viewTransform(view: View, w: number, h: number): string | undefined {
  const z = Math.max(1, view.zoom);
  if (z <= 1.0005) return undefined;
  const half = 0.5 / z;
  const cx = Math.min(1 - half, Math.max(half, view.x));
  const cy = Math.min(1 - half, Math.max(half, view.y));
  const tx = w / 2 - cx * w * z;
  const ty = h / 2 - cy * h * z;
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(4)})`;
}

/** Add a zoom at SOURCE second t on point (x, y), or move the one already there. Keeps zooms from overlapping. */
export function setZoomAt(zooms: Zoom[] | undefined, t: number, x: number, y: number, zoom = 1.8, length = 2.5): Zoom[] {
  const zs = sortZooms(zooms);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const here = zs.findIndex((z) => z.start <= t && t <= z.end);
  if (here >= 0) {
    const out = zs.slice();
    out[here] = { ...zs[here], x: r(x), y: r(y) };
    return out;
  }
  const next = zs.find((z) => z.start > t);
  const end = next ? Math.min(t + length, next.start) : t + length;
  return sortZooms([...zs, { start: r(t), end: r(end), x: r(x), y: r(y), zoom }]);
}

/** Remove the zoom covering SOURCE second t. */
export function removeZoomAt(zooms: Zoom[] | undefined, t: number): Zoom[] {
  return sortZooms(zooms).filter((z) => !(z.start <= t && t <= z.end));
}

/** The zoom covering SOURCE second t, if any. */
export function zoomAt(zooms: Zoom[] | undefined, t: number): Zoom | undefined {
  return sortZooms(zooms).find((z) => z.start <= t && t <= z.end);
}
