// Masks: show only part of a layer. Pure functions, no runtime imports (renderer, editor, tests).
//
// A mask is a shape inside the layer's own box: a rectangle, a rounded rectangle or an ellipse, placed by
// its centre and size as fractions of the box. Feather softens its edge; invert shows everything but the
// shape. It is drawn as an SVG image used as a CSS mask, so the same mask works in the preview and the render.

export type MaskShape = "rect" | "rounded" | "ellipse";

export interface Mask {
  shape: MaskShape;
  /** Centre of the shape, 0..1 of the layer's box. */
  x?: number;
  y?: number;
  /** Size of the shape, 0..1 of the layer's box. */
  w?: number;
  h?: number;
  /** Softness of the edge, 0 (sharp) .. 1 (very soft). */
  feather?: number;
  /** Show everything except the shape. */
  invert?: boolean;
}

export const MASK_SHAPES: { id: MaskShape; name: string }[] = [
  { id: "rect", name: "Rectangle" },
  { id: "rounded", name: "Rounded rectangle" },
  { id: "ellipse", name: "Ellipse" },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const n = (v: number) => Number(v.toFixed(2));

/** The mask with every field filled in and kept in range. */
export function maskOf(m: Mask): Required<Mask> {
  const shape: MaskShape = m.shape === "rounded" || m.shape === "ellipse" ? m.shape : "rect";
  return {
    shape,
    x: clamp(m.x ?? 0.5, 0, 1),
    y: clamp(m.y ?? 0.5, 0, 1),
    w: clamp(m.w ?? 0.8, 0.02, 2),
    h: clamp(m.h ?? 0.8, 0.02, 2),
    feather: clamp(m.feather ?? 0, 0, 1),
    invert: !!m.invert,
  };
}

const S = 1000; // the SVG is drawn on a 1000 x 1000 grid and stretched over the box

/**
 * The mask as an SVG document. White shows the layer, black hides it. The shape is blurred by its feather,
 * and the blur's margin is kept inside the drawing so a soft edge never gets cut off square.
 */
export function maskSvg(input: Mask): string {
  const m = maskOf(input);
  const w = m.w * S;
  const h = m.h * S;
  const x = m.x * S - w / 2;
  const y = m.y * S - h / 2;
  const blur = m.feather * 60; // up to 6% of the box
  const show = m.invert ? "#000" : "#fff";
  const hide = m.invert ? "#fff" : "#000";
  const r = m.shape === "rounded" ? Math.min(w, h) * 0.18 : 0;
  const shape =
    m.shape === "ellipse"
      ? `<ellipse cx="${n(m.x * S)}" cy="${n(m.y * S)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${show}"${blur ? ' filter="url(#f)"' : ""}/>`
      : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"${blur ? ' filter="url(#f)"' : ""} fill="${show}"/>`;
  const defs = blur ? `<defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(blur)}"/></filter></defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" preserveAspectRatio="none">${defs}<rect width="${S}" height="${S}" fill="${hide}"/>${shape}</svg>`;
}

/** CSS that applies the mask to an element (luminance: white shows, black hides). */
export function maskStyle(input: Mask | undefined): Record<string, string> {
  if (!input) return {};
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(maskSvg(input))}")`;
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskMode: "luminance",
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
}
