import { bell, bellNear, curveValue, haversine } from "./curves";
import { ATTITUDES, DOMAIN_ATTITUDES, LIFE_STAGES } from "./types";
import type { Attitude, DomainAttitude, Exclusion, Facility, FacilityType, LatLng, Profile, Reason, ScoreConfig, ScoreResult } from "./types";

export const DEFAULT_SATURATION = 0.5;
export const DEFAULT_PENALTY_SCALE = 1.75;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Effective signed weight (-3..3) from stage default `base` + attitude.
 *  prefer  -> +clamp(|base|+1, 1, 3)   (a negative-kind facility flips to a bonus: "prefer = bonus")
 *  avoid   -> -clamp(|base|+1, 1, 3)
 *  neutral -> 0
 *  must / never / undefined -> base (no score adjustment; filter only)
 */
export function effectiveWeight(base: number, attitude?: Attitude): number {
  const boost = clamp(Math.abs(base) + 1, 1, 3);
  switch (attitude) {
    case "prefer": return boost;
    case "avoid": return -boost;
    case "neutral": return 0;
    default: return clamp(base, -3, 3);
  }
}

function fail(strict: boolean | undefined, warnings: string[], msg: string) {
  if (strict) throw new Error(msg);
  warnings.push(msg);
}

export function scoreLocation(location: LatLng, facilities: Facility[], profile: Profile, config: ScoreConfig): ScoreResult {
  if (!LIFE_STAGES.includes(profile.lifeStage)) throw new Error(`invalid lifeStage: ${String(profile.lifeStage)}`);
  const allTypes: FacilityType[] = Array.isArray(config.types) ? config.types : Object.values(config.types);
  // geometry:"metric" types are area-level metrics, not point facilities: ignored entirely.
  const types = allTypes.filter((t) => t.geometry !== "metric");
  const typeById = new Map(allTypes.map((t) => [t.id, t]));
  const domains = [...new Set(types.map((t) => t.domain))];
  const strict = config.strict;
  const warnings: string[] = [];

  // ---- profile validation ----
  const overrides: Record<string, Attitude> = {};
  for (const [id, att] of Object.entries(profile.overrides ?? {})) {
    const t = typeById.get(id);
    if (!t) { fail(strict, warnings, `overrides: unknown facility type id "${id}"`); continue; }
    if (!ATTITUDES.includes(att)) { fail(strict, warnings, `overrides: invalid attitude "${String(att)}" for "${id}"`); continue; }
    if (t.geometry === "metric") { warnings.push(`overrides: "${id}" is a metric type and is ignored by the engine`); continue; }
    overrides[id] = att;
  }
  const domainOverrides: Record<string, DomainAttitude> = {};
  for (const [dom, att] of Object.entries(profile.domainOverrides ?? {})) {
    if (!allTypes.some((t) => t.domain === dom)) { fail(strict, warnings, `domainOverrides: unknown domain "${dom}"`); continue; }
    if (!DOMAIN_ATTITUDES.includes(att)) { fail(strict, warnings, `domainOverrides: invalid attitude "${String(att)}" for domain "${dom}" (only prefer|neutral|avoid)`); continue; }
    domainOverrides[dom] = att;
  }
  const domainMult: Record<string, number> = {};
  for (const [dom, m] of Object.entries(profile.domainMultipliers ?? {})) {
    if (!allTypes.some((t) => t.domain === dom)) { fail(strict, warnings, `domainMultipliers: unknown domain "${dom}"`); continue; }
    if (typeof m !== "number" || !Number.isFinite(m)) { fail(strict, warnings, `domainMultipliers: invalid value for domain "${dom}"`); continue; }
    if (m < 0 || m > 2) warnings.push(`domainMultipliers: "${dom}"=${m} clamped to 0..2`);
    domainMult[dom] = clamp(m, 0, 2);
  }

  // ---- distances ----
  const byType = new Map<string, number[]>();
  for (const f of facilities) {
    const arr = byType.get(f.typeId) ?? [];
    arr.push(haversine(location, f));
    byType.set(f.typeId, arr);
  }
  const nearestOf = (id: string) => Math.min(Infinity, ...(byType.get(id) ?? []));

  // ---- 1) hard filters (per-facility must/never only) ----
  for (const t of types) {
    const att = overrides[t.id];
    if (att !== "never" && att !== "must") continue;
    const nearest = nearestOf(t.id);
    const dist = Number.isFinite(nearest) ? Math.round(nearest) : undefined;
    let ex: Exclusion | undefined;
    if (att === "never" && nearest <= t.radius_m) ex = { code: "never_hit", typeId: t.id, distance_m: dist };
    else if (att === "must" && !(nearest <= t.radius_m)) ex = { code: "must_missing", typeId: t.id, ...(dist !== undefined ? { distance_m: dist } : {}) };
    if (ex) {
      const domainScores = Object.fromEntries(domains.map((d) => [d, 50]));
      return { score: 0, excluded: true, exclusion: ex, reasons: [], domainScores, warnings };
    }
  }

  // ---- 2) effective weights and raw contributions ----
  const sat = config.saturation ?? DEFAULT_SATURATION;
  const penalty = config.penalty_scale ?? DEFAULT_PENALTY_SCALE;
  const time = profile.timeOfDay;

  interface Row { t: FacilityType; raw: number; dist: number; tooClose: boolean }
  const rows: Row[] = [];
  const refPos = new Map<string, number>(); // per domain: Σ positive base (stage) weights
  const refAbs = new Map<string, number>(); // per domain: Σ |base weights| (fallback)
  for (const t of types) {
    const base = config.weights[t.id]?.[profile.lifeStage] ?? 0;
    const own = overrides[t.id];
    const dom = domainOverrides[t.domain];
    const w = own !== undefined ? effectiveWeight(base, own)
      : dom !== undefined && dom !== "neutral" ? effectiveWeight(base, dom)
      : effectiveWeight(base);
    // normalisation reference uses the stage's base weights (not attitude-adjusted), so the
    // denominator is stable and prefer/avoid really move the score.
    if (base > 0) refPos.set(t.domain, (refPos.get(t.domain) ?? 0) + base);
    refAbs.set(t.domain, (refAbs.get(t.domain) ?? 0) + Math.abs(base));
    if (w === 0) continue;
    const ds = byType.get(t.id) ?? [];
    if (ds.length === 0) continue;
    const dist = Math.min(...ds);

    let raw: number;
    let tooClose = false;
    if (t.curve.type === "bell") {
      const p = t.curve.params;
      let near = 0;
      let notPos = 1;
      for (const d of ds) {
        if (d > t.radius_m) continue;
        if (d < p.min_m) near = Math.max(near, bellNear(d, p));
        else notPos *= 1 - bell(d, p);
      }
      const pos = 1 - notPos;
      tooClose = dist < p.min_m && dist <= t.radius_m;
      // too-close is always a penalty; the min..max band is a benefit (w>0) or a penalty (w<0).
      raw = w > 0 ? w * pos - w * near : -Math.abs(w) * Math.max(pos, near);
    } else {
      let notC = 1;
      for (const d of ds) notC *= 1 - curveValue(t.curve, d, t.radius_m);
      raw = w * (1 - notC);
    }
    const tm = (time && t.time_modifiers?.[time]) ?? 1;
    rows.push({ t, raw: raw * tm, dist, tooClose });
  }

  // ---- 3) normalise: 50 neutral; negative contributions scaled by penalty_scale ----
  const sumPos = [...refPos.values()].reduce((s, x) => s + x, 0);
  const sumAbs = [...refAbs.values()].reduce((s, x) => s + x, 0);
  const refTotal = sat * (sumPos > 0 ? sumPos : sumAbs);
  const scaleTotal = refTotal > 0 ? 50 / refTotal : 0;

  const domRaw = new Map<string, number>();
  const reasons: Reason[] = [];
  for (const r of rows) {
    const adj = (r.raw < 0 ? r.raw * penalty : r.raw) * (domainMult[r.t.domain] ?? 1);
    domRaw.set(r.t.domain, (domRaw.get(r.t.domain) ?? 0) + adj);
    const contribution = adj * scaleTotal;
    if (contribution === 0 || !Number.isFinite(contribution)) continue;
    const reason: Reason = { typeId: r.t.id, contribution, distance_m: Math.round(r.dist) };
    if (r.tooClose) reason.tooClose = true;
    reasons.push(reason);
  }
  reasons.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const total = reasons.reduce((s, r) => s + r.contribution, 0);

  const domainScores: Record<string, number> = {};
  for (const d of domains) {
    const pos = refPos.get(d) ?? 0;
    const ref = sat * (pos > 0 ? pos : refAbs.get(d) ?? 0);
    const raw = domRaw.get(d) ?? 0;
    domainScores[d] = ref > 0 ? clamp(50 + (50 * raw) / ref, 0, 100) : 50;
  }

  return { score: clamp(50 + total, 0, 100), excluded: false, reasons, domainScores, warnings };
}
