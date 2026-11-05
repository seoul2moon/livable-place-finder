import test from "node:test";
import assert from "node:assert/strict";
import { scoreLocation, effectiveWeight, haversine, step, curveValue, type FacilityType, type ScoreConfig, type Facility, type LifeStage, type Profile } from "./index";

const M = 111195; // meters per degree latitude
const at = (m: number, typeId: string): Facility => ({ typeId, lat: 37 + m / M, lng: 127 });
const here = { lat: 37, lng: 127 };

// Synthetic config: engine-logic tests only. Real-data behaviour is in integration.test.ts.
const types: FacilityType[] = [
  { id: "bigbox", domain: "shop", kind: "bell", radius_m: 3000,
    curve: { type: "bell", params: { min_m: 300, peak_from_m: 600, peak_to_m: 1500, max_m: 3000 } } },
  { id: "school", domain: "edu", kind: "positive", radius_m: 1000, curve: { type: "decay", params: { half_distance_m: 400 } } },
  { id: "bar", domain: "night", kind: "negative", radius_m: 500, curve: { type: "decay", params: { half_distance_m: 200 } } },
  { id: "plant", domain: "night", kind: "negative", radius_m: 2000, curve: { type: "decay", params: { half_distance_m: 800 } } },
  { id: "park", domain: "nature", kind: "positive", radius_m: 800, curve: { type: "step", params: { within_m: 400 } } },
  { id: "air", domain: "nature", kind: "negative", radius_m: 3000, geometry: "metric", curve: { type: "decay", params: { half_distance_m: 1000 } } },
];
const weights = {
  bigbox: { infant: 1, school: 1, young_single: 1, middle_aged: 2, senior: 0 },
  school: { infant: 1, school: 2, young_single: 0, middle_aged: 1, senior: 0 },
  bar: { infant: -2, school: -2, young_single: 1, middle_aged: -1, senior: -1 },
  plant: { infant: -2, school: -2, young_single: -2, middle_aged: -2, senior: -2 },
  park: { infant: 2, school: 1, young_single: 1, middle_aged: 1, senior: 2 },
  air: { infant: -2, school: -2, young_single: -2, middle_aged: -2, senior: -2 },
};
const config: ScoreConfig = { types, weights, saturation: 4 }; // large saturation keeps scores away from the 0/100 clamps
const p = (lifeStage: LifeStage, overrides: any = {}, extra: Partial<Profile> = {}): Profile => ({ lifeStage, overrides, ...extra });
const score = (fac: Facility[], prof: Profile, cfg = config) => scoreLocation(here, fac, prof, cfg);

test("haversine ~ 1km", () => {
  assert.ok(Math.abs(haversine(here, { lat: 37 + 1000 / M, lng: 127 }) - 1000) < 5);
});

test("effectiveWeight: prefer/avoid by clamp(|w|+1,1,3), neutral 0, must/never keep base", () => {
  assert.equal(effectiveWeight(0, "prefer"), 1);
  assert.equal(effectiveWeight(1, "prefer"), 2);
  assert.equal(effectiveWeight(2, "prefer"), 3);
  assert.equal(effectiveWeight(-2, "prefer"), 3); // negative-kind + prefer flips to a bonus (documented)
  assert.equal(effectiveWeight(2, "avoid"), -3);
  assert.equal(effectiveWeight(-2, "avoid"), -3); // already-negative facility gets stronger
  assert.equal(effectiveWeight(0, "avoid"), -1);
  assert.equal(effectiveWeight(2, "neutral"), 0);
  assert.equal(effectiveWeight(2, "must"), 2);
  assert.equal(effectiveWeight(-1, "never"), -1);
  assert.equal(effectiveWeight(2), 2);
});

test("avoid strengthens an already negative facility; prefer flips it to a bonus", () => {
  const fac = [at(300, "plant")];
  const base = score(fac, p("young_single")).score;
  assert.ok(base < 50);
  assert.ok(score(fac, p("young_single", { plant: "avoid" })).score < base);
  assert.ok(score(fac, p("young_single", { plant: "prefer" })).score > 50);
  assert.equal(score(fac, p("young_single", { plant: "neutral" })).score, 50);
});

test("must adds no bonus: score equals the no-override score", () => {
  const fac = [at(300, "park")];
  const a = score(fac, p("senior"));
  const b = score(fac, p("senior", { park: "must" }));
  assert.equal(b.excluded, false);
  assert.equal(b.score, a.score);
});

test("never: hard filter within radius, exclusion shape, ok outside", () => {
  const prof = p("young_single", { bar: "never" });
  const r = score([at(300, "bar")], prof);
  assert.equal(r.excluded, true);
  assert.equal(r.score, 0);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.exclusion?.code, "never_hit");
  assert.equal(r.exclusion?.typeId, "bar");
  assert.ok(Math.abs(r.exclusion!.distance_m! - 300) <= 1);
  assert.equal(score([at(900, "bar")], prof).excluded, false);
  assert.equal(score([], prof).excluded, false);
});

test("must: radius-based presence, exclusion shape", () => {
  const prof = p("senior", { park: "must" });
  const none = score([], prof);
  assert.equal(none.excluded, true);
  assert.equal(none.exclusion?.code, "must_missing");
  assert.equal(none.exclusion?.distance_m, undefined);
  const far = score([at(900, "park")], prof); // beyond radius 800
  assert.equal(far.exclusion?.code, "must_missing");
  assert.ok(Math.abs(far.exclusion!.distance_m! - 900) <= 1);
  assert.equal(score([at(790, "park")], prof).excluded, false); // inside radius (even outside within_m)
});

test("unknown override id: warnings by default, throw when strict", () => {
  const r = score([], p("infant", { nope: "prefer" }));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /nope/);
  assert.throws(() => score([], p("infant", { nope: "prefer" }), { ...config, strict: true }), /nope/);
  assert.deepEqual(score([], p("infant")).warnings, []);
  // unknown id never causes a filter
  assert.equal(score([], p("infant", { nope: "must" })).excluded, false);
});

test("geometry metric types are ignored (scoring, filters, domain)", () => {
  const withAir = score([at(10, "air")], p("infant"));
  assert.equal(withAir.score, 50);
  assert.deepEqual(withAir.reasons, []);
  const m = score([], p("infant", { air: "never" }));
  assert.equal(m.excluded, false);
  assert.ok(m.warnings.some((w) => /air/.test(w)));
});

test("step: within_m wins, threshold_m read as fallback, default radius", () => {
  assert.equal(step(400, 400), 1);
  assert.equal(step(401, 400), 0);
  const c = (params: any) => curveValue({ type: "step", params } as any, 500, 800);
  assert.equal(c({ within_m: 400, threshold_m: 700 }), 0);
  assert.equal(c({ threshold_m: 700 }), 1);
  assert.equal(c(undefined), 1);
  assert.equal(c({}), 1);
  // engine: park within_m=400
  assert.ok(score([at(350, "park")], p("senior")).score > 50);
  assert.equal(score([at(450, "park")], p("senior")).score, 50);
});

test("bell: too close is always a penalty (even for prefer), ramps and peak, 0 at/after max_m", () => {
  const s = (m: number, prof = p("middle_aged")) => score([at(m, "bigbox")], prof).score;
  assert.ok(s(100) < 50 && s(0) < s(100));
  assert.ok(s(100, p("middle_aged", { bigbox: "prefer" })) < 50);
  assert.ok(s(450) > 50 && s(450) < s(600));
  assert.ok(Math.abs(s(600) - s(1500)) < 0.01);
  assert.ok(s(1500) > s(2200) && s(2200) > 50);
  assert.equal(s(3100), 50);
  const r = score([at(100, "bigbox")], p("middle_aged"));
  assert.equal(r.reasons[0].tooClose, true);
  assert.equal(score([at(700, "bigbox")], p("middle_aged")).reasons[0].tooClose, undefined);
});

test("life stage changes score", () => {
  const fac = [at(200, "school"), at(150, "bar"), at(300, "park")];
  const sc = (s: LifeStage) => score(fac, p(s)).score;
  assert.ok(sc("young_single") > sc("infant"), "bar nearby is bad for infant, fine for young single");
});

test("attitude overrides: avoid lowers, prefer raises", () => {
  const fac = [at(200, "school")];
  const base = score(fac, p("young_single")).score;
  assert.ok(score(fac, p("young_single", { school: "prefer" })).score > base);
  assert.ok(score(fac, p("young_single", { school: "avoid" })).score < base);
});

test("domainOverrides apply to the domain; facility override wins", () => {
  const fac = [at(200, "school"), at(150, "bar"), at(100, "plant")];
  const base = score(fac, p("middle_aged"));
  const avoidNight = score(fac, p("middle_aged", {}, { domainOverrides: { night: "avoid" } }));
  assert.ok(avoidNight.score < base.score);
  assert.ok(avoidNight.domainScores.night < base.domainScores.night);
  assert.equal(avoidNight.domainScores.edu, base.domainScores.edu);
  const preferNight = score(fac, p("middle_aged", {}, { domainOverrides: { night: "prefer" } }));
  assert.ok(preferNight.score > base.score);
  // facility override beats domain override
  const mixed = score(fac, p("middle_aged", { bar: "neutral" }, { domainOverrides: { night: "avoid" } }));
  assert.equal(mixed.reasons.find((r) => r.typeId === "bar"), undefined);
  assert.ok(mixed.reasons.find((r) => r.typeId === "plant")!.contribution < base.reasons.find((r) => r.typeId === "plant")!.contribution);
  // domain neutral = base
  assert.equal(score(fac, p("middle_aged", {}, { domainOverrides: { night: "neutral" } })).score, base.score);
  // unknown domain -> warning / strict throw
  assert.ok(score(fac, p("middle_aged", {}, { domainOverrides: { nowhere: "avoid" } })).warnings.length > 0);
  assert.throws(() => score(fac, p("middle_aged", {}, { domainOverrides: { nowhere: "avoid" } }), { ...config, strict: true }));
});

test("domainMultipliers scale that domain's contribution", () => {
  const fac = [at(200, "school"), at(100, "plant")];
  const prof = (m: number) => p("middle_aged", {}, { domainMultipliers: { night: m } });
  const c = (m: number) => score(fac, prof(m)).reasons.find((r) => r.typeId === "plant")?.contribution ?? 0;
  assert.ok(Math.abs(c(2) - 2 * c(1)) < 1e-9);
  assert.equal(c(0), 0);
  assert.ok(score(fac, prof(2)).score < score(fac, prof(1)).score);
  assert.equal(score(fac, p("middle_aged")).reasons.find((r) => r.typeId === "plant")!.contribution, c(1));
  assert.ok(score(fac, prof(5)).warnings.length > 0); // clamped to 2
});

test("penalty_scale multiplies negative contributions only", () => {
  const fac = [at(100, "plant"), at(200, "school")];
  const r1 = score(fac, p("middle_aged"), { ...config, penalty_scale: 1 });
  const r2 = score(fac, p("middle_aged"), { ...config, penalty_scale: 2 });
  const get = (r: typeof r1, id: string) => r.reasons.find((x) => x.typeId === id)!.contribution;
  assert.ok(Math.abs(get(r2, "plant") - 2 * get(r1, "plant")) < 1e-9);
  assert.equal(get(r2, "school"), get(r1, "school"));
});

test("reasons sorted by |contribution| desc, score within 0..100, domainScores", () => {
  const fac = [at(100, "school"), at(100, "bar"), at(300, "park"), at(1000, "bigbox")];
  const r = score(fac, p("infant"));
  const abs = r.reasons.map((x) => Math.abs(x.contribution));
  assert.deepEqual(abs, [...abs].sort((a, b) => b - a));
  assert.ok(r.reasons.length >= 3);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.reasons.find((x) => x.typeId === "bar")!.contribution < 0);
  for (const d of ["shop", "edu", "night", "nature"]) assert.ok(r.domainScores[d] >= 0 && r.domainScores[d] <= 100);
  assert.equal(score([], p("infant")).domainScores.edu, 50);
  assert.ok(r.domainScores.night < 50 && r.domainScores.edu > 50);
});

test("same-type facilities combine as 1-Π(1-c)", () => {
  const one = score([at(200, "school")], p("school")).score;
  const two = score([at(200, "school"), at(200, "school")], p("school")).score;
  assert.ok(two > one && (two - 50) < 2 * (one - 50));
});

test("time of day modifier", () => {
  const t2 = types.map((t) => (t.id === "bar" ? { ...t, time_modifiers: { night: 2 } } : t));
  const fac = [at(100, "bar")];
  const cfg = { types: t2, weights, saturation: 4 };
  const day = score(fac, { lifeStage: "infant", timeOfDay: "weekday" }, cfg);
  const night = score(fac, { lifeStage: "infant", timeOfDay: "night" }, cfg);
  assert.ok(night.score < day.score);
});

test("invalid lifeStage throws", () => {
  assert.throws(() => score([], { lifeStage: "baby" as any }));
});
