import { FACILITY_KINDS, LIFE_STAGES, TIMES_OF_DAY } from "./types";
import type { Curve, FacilityType, ScoreConfig, WeightsTable } from "./types";

/** Thrown by loadConfig; `errors` lists every problem found. */
export class ConfigError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    const shown = errors.slice(0, 20).map((e) => `  - ${e}`).join("\n");
    super(`invalid scoring config (${errors.length} error${errors.length > 1 ? "s" : ""}):\n${shown}${errors.length > 20 ? "\n  ..." : ""}`);
    this.name = "ConfigError";
    this.errors = errors;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function parseCurve(raw: unknown, where: string, err: string[]): Curve | undefined {
  if (!isObj(raw)) { err.push(`${where}.curve must be an object`); return undefined; }
  const params = raw.params;
  const p = isObj(params) ? params : undefined;
  switch (raw.type) {
    case "decay": {
      if (!p || !isNum(p.half_distance_m) || p.half_distance_m <= 0) { err.push(`${where}.curve.params.half_distance_m must be a number > 0`); return undefined; }
      return { type: "decay", params: { half_distance_m: p.half_distance_m } };
    }
    case "bell": {
      if (!p) { err.push(`${where}.curve.params must be an object (bell)`); return undefined; }
      const keys = ["min_m", "peak_from_m", "peak_to_m", "max_m"] as const;
      const bad = keys.filter((k) => !isNum(p[k]) || (p[k] as number) < 0);
      if (bad.length) { err.push(`${where}.curve.params: ${bad.join(", ")} must be numbers >= 0`); return undefined; }
      const [a, b, c, d] = keys.map((k) => p[k] as number);
      if (!(a <= b && b <= c && c <= d) || !(d > 0)) { err.push(`${where}.curve.params must satisfy min_m <= peak_from_m <= peak_to_m <= max_m (got ${a},${b},${c},${d})`); return undefined; }
      return { type: "bell", params: { min_m: a, peak_from_m: b, peak_to_m: c, max_m: d } };
    }
    case "step": {
      const out: { within_m?: number; threshold_m?: number } = {};
      for (const k of ["within_m", "threshold_m"] as const) {
        if (p && p[k] !== undefined) {
          if (!isNum(p[k]) || (p[k] as number) <= 0) { err.push(`${where}.curve.params.${k} must be a number > 0`); return undefined; }
          out[k] = p[k] as number;
        }
      }
      return { type: "step", params: out };
    }
    default:
      err.push(`${where}.curve.type must be decay|bell|step (got ${JSON.stringify(raw.type)})`);
      return undefined;
  }
}

/**
 * Validate and convert raw JSON (data/facility_types.json, data/weights.json) into a ScoreConfig.
 * Pure manual validation, no dependencies. Throws ConfigError listing all problems.
 * `extra` may carry saturation / penalty_scale / strict.
 */
export function loadConfig(rawTypes: unknown, rawWeights: unknown, extra: Partial<Pick<ScoreConfig, "saturation" | "penalty_scale" | "strict">> = {}): ScoreConfig {
  const err: string[] = [];
  const types: FacilityType[] = [];
  const weights: WeightsTable = {};

  if (!Array.isArray(rawTypes)) err.push("facility types must be an array");
  else {
    const seen = new Set<string>();
    rawTypes.forEach((r, i) => {
      if (!isObj(r)) { err.push(`types[${i}] must be an object`); return; }
      const id = r.id;
      const where = `types[${i}]${typeof id === "string" ? ` (${id})` : ""}`;
      const n0 = err.length;
      if (typeof id !== "string" || !/^[a-z][a-z0-9_]*$/.test(id)) err.push(`${where}.id must be snake_case string`);
      else if (seen.has(id)) err.push(`${where}.id is duplicated`);
      else seen.add(id);
      if (typeof r.domain !== "string" || !r.domain) err.push(`${where}.domain must be a non-empty string`);
      if (!FACILITY_KINDS.includes(r.kind as never)) err.push(`${where}.kind must be positive|negative|bell (got ${JSON.stringify(r.kind)})`);
      if (!isNum(r.radius_m) || r.radius_m <= 0) err.push(`${where}.radius_m must be a number > 0`);
      if (r.name_ko !== undefined && typeof r.name_ko !== "string") err.push(`${where}.name_ko must be a string`);
      if (r.geometry !== undefined && (typeof r.geometry !== "string" || !r.geometry)) err.push(`${where}.geometry must be a non-empty string`);
      let tm: FacilityType["time_modifiers"];
      if (r.time_modifiers !== undefined) {
        if (!isObj(r.time_modifiers)) err.push(`${where}.time_modifiers must be an object`);
        else {
          tm = {};
          for (const [k, v] of Object.entries(r.time_modifiers)) {
            if (!TIMES_OF_DAY.includes(k as never)) err.push(`${where}.time_modifiers has unknown key "${k}" (weekday|weekend|night)`);
            else if (!isNum(v) || v < 0) err.push(`${where}.time_modifiers.${k} must be a number >= 0`);
            else tm[k as keyof typeof tm] = v;
          }
        }
      }
      const curve = parseCurve(r.curve, where, err);
      if (r.kind === "bell" && r.curve && isObj(r.curve) && r.curve.type !== "bell") err.push(`${where}: kind "bell" requires curve.type "bell"`);
      if (err.length === n0 && curve) {
        const t: FacilityType = { id: id as string, domain: r.domain as string, kind: r.kind as FacilityType["kind"], radius_m: r.radius_m as number, curve };
        if (typeof r.name_ko === "string") t.name_ko = r.name_ko;
        if (typeof r.geometry === "string") t.geometry = r.geometry;
        if (tm) t.time_modifiers = tm;
        types.push(t);
      }
    });
  }

  if (!isObj(rawWeights)) err.push("weights must be an object keyed by facility id");
  else {
    const ids = new Set(types.map((t) => t.id));
    for (const [id, row] of Object.entries(rawWeights)) {
      if (Array.isArray(rawTypes) && !ids.has(id) && !rawTypes.some((x) => isObj(x) && x.id === id)) { err.push(`weights.${id}: no such facility type`); continue; }
      if (!isObj(row)) { err.push(`weights.${id} must be an object keyed by life stage`); continue; }
      const out: WeightsTable[string] = {};
      for (const s of LIFE_STAGES) {
        const v = row[s];
        if (!isNum(v) || v < -2 || v > 2) err.push(`weights.${id}.${s} must be a number in -2..2 (got ${JSON.stringify(v)})`);
        else out[s] = v;
      }
      for (const k of Object.keys(row)) if (!LIFE_STAGES.includes(k as never)) err.push(`weights.${id} has unknown life stage "${k}"`);
      weights[id] = out;
    }
    for (const t of types) if (!(t.id in rawWeights)) err.push(`weights.${t.id}: missing (every facility type needs a weight row)`);
  }

  for (const k of ["saturation", "penalty_scale"] as const) {
    const v = extra[k];
    if (v !== undefined && (!isNum(v) || v <= 0)) err.push(`${k} must be a number > 0`);
  }
  if (err.length) throw new ConfigError(err);
  return { types, weights, ...extra };
}
