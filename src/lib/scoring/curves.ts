import type { BellParams, Curve, DecayParams, LatLng, StepParams } from "./types";

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 0.5 ^ (d / half_distance_m); 0 beyond radius. */
export function decay(d: number, p: DecayParams, radius: number): number {
  if (d > radius) return 0;
  return Math.pow(0.5, d / Math.max(1e-9, p.half_distance_m));
}

/**
 * Benefit part of the bell: 0 below min_m (the too-close penalty is handled by `bellNear`),
 * ramp to 1 at peak_from_m, 1 until peak_to_m, ramp to 0 at max_m, 0 beyond.
 */
export function bell(d: number, p: BellParams): number {
  if (d < p.min_m || d >= p.max_m) return 0;
  if (d < p.peak_from_m) return (d - p.min_m) / Math.max(1e-9, p.peak_from_m - p.min_m);
  if (d <= p.peak_to_m) return 1;
  return (p.max_m - d) / Math.max(1e-9, p.max_m - p.peak_to_m);
}

/** Too-close ratio of a bell: 1 at 0 m, 0 at min_m (and beyond). Penalty = -|w| * bellNear. */
export function bellNear(d: number, p: BellParams): number {
  if (d >= p.min_m) return 0;
  return 1 - Math.max(0, d) / Math.max(1e-9, p.min_m);
}

/** 1 if d <= within, else 0. */
export function step(d: number, within: number): number {
  return d <= within ? 1 : 0;
}

export function stepWithin(params: StepParams | undefined, radius: number): number {
  return params?.within_m ?? params?.threshold_m ?? radius;
}

/** Curve value for a distance: decay/step 0..1, bell benefit part 0..1 (see bellNear for the penalty). */
export function curveValue(curve: Curve, d: number, radius: number): number {
  if (d > radius) return 0;
  switch (curve.type) {
    case "decay": return decay(d, curve.params, radius);
    case "bell": return bell(d, curve.params);
    case "step": return step(d, stepWithin(curve.params, radius));
  }
}
