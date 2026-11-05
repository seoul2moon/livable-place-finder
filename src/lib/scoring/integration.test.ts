// Integration tests against the real data/*.json (single source of truth).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, scoreLocation, LIFE_STAGES, type Facility, type FacilityType, type LifeStage, type Profile } from "./index";

const dataDir = path.resolve(__dirname, "../../../data");
const readJson = (f: string) => JSON.parse(readFileSync(path.join(dataDir, f), "utf8"));
const config = loadConfig(readJson("facility_types.json"), readJson("weights.json"));
const types = config.types as FacilityType[];
const byId = new Map(types.map((t) => [t.id, t]));

const M = 111195;
const here = { lat: 37, lng: 127 };
const at = (m: number, typeId: string): Facility => ({ typeId, lat: 37 + m / M, lng: 127 });
const prof = (lifeStage: LifeStage, overrides: Record<string, any> = {}, extra: Partial<Profile> = {}): Profile => ({ lifeStage, overrides, ...extra });
const sc = (fac: Facility[], p: Profile, cfg = config) => scoreLocation(here, fac, p, cfg);

test("data loads: >= 74 types, unique ids, every type has weights", () => {
  assert.ok(types.length >= 74, `types: ${types.length}`);
  for (const t of types) for (const s of LIFE_STAGES) assert.ok(config.weights[t.id][s] !== undefined);
});

test("large_mart bell curve at 0/299/600/1500/3000 m (real params)", () => {
  const t = byId.get("large_mart")!;
  assert.equal(t.curve.type, "bell");
  const { min_m, peak_from_m, peak_to_m, max_m } = (t.curve as any).params;
  const w = config.weights.large_mart.middle_aged!;
  assert.ok(w > 0, "large_mart should be positive for middle_aged");
  const s = (m: number) => sc([at(m, "large_mart")], prof("middle_aged")).score;
  assert.ok(s(0) < 50, "0 m: too close -> penalty");
  assert.ok(s(0) < s(299), "penalty fades as distance approaches min_m");
  assert.ok(299 >= min_m - 1 ? s(299) <= 50.01 : s(299) > 50, "just inside min_m is still ~neutral/penalty");
  assert.ok(peak_from_m <= 600 && 600 <= peak_to_m, "600 m on the peak (data assumption)");
  assert.ok(s(600) > 50);
  assert.ok(Math.abs(s(1500) - s(600)) < 0.01 || 1500 > peak_to_m);
  assert.ok(s(1500) > s(3000) - 1e-9);
  assert.equal(s(max_m + 1), 50);
  assert.equal(s(3000) >= 50, true);
  // reason flags
  assert.equal(sc([at(0, "large_mart")], prof("middle_aged")).reasons[0].tooClose, true);
  assert.equal(sc([at(600, "large_mart")], prof("middle_aged")).reasons[0].tooClose, undefined);
});

test("life stage sample: nightlife and school-related differ by stage in the expected direction", () => {
  const fac = [at(200, "nightlife_street"), at(300, "pediatric_clinic"), at(400, "park_neighborhood"), at(250, "academy_cluster")];
  const s = (st: LifeStage) => sc(fac, prof(st));
  const reasonFor = (r: ReturnType<typeof s>, id: string) => r.reasons.find((x) => x.typeId === id)?.contribution ?? 0;
  assert.ok(reasonFor(s("young_single"), "nightlife_street") > reasonFor(s("infant"), "nightlife_street"));
  assert.ok(reasonFor(s("infant"), "pediatric_clinic") > reasonFor(s("young_single"), "pediatric_clinic"));
  assert.ok(reasonFor(s("school"), "academy_cluster") >= reasonFor(s("senior"), "academy_cluster"));
  assert.notEqual(s("infant").score, s("senior").score);
  for (const st of LIFE_STAGES) assert.ok(s(st).score >= 0 && s(st).score <= 100);
});

test("nuisance sample drops a young single below 50 (penalty_scale)", () => {
  const fac = [at(800, "waste_incinerator"), at(100, "noise_major_road"), at(1000, "industrial_complex"), at(400, "subway_station")];
  const r = sc(fac, prof("young_single"));
  assert.ok(r.score < 50, `score ${r.score}`);
  assert.ok(r.domainScores.nuisance < 50 && r.domainScores.environment < 50);
  // without penalty scaling it would be noticeably higher
  assert.ok(sc(fac, prof("young_single"), { ...config, penalty_scale: 1 }).score > r.score);
  for (const st of LIFE_STAGES) assert.ok(sc(fac, prof(st)).score < 50, st);
});

test("never / must with real radii", () => {
  const inc = byId.get("waste_incinerator")!;
  const never = prof("middle_aged", { waste_incinerator: "never" });
  const hit = sc([at(inc.radius_m - 10, "waste_incinerator")], never);
  assert.equal(hit.excluded, true);
  assert.equal(hit.exclusion?.code, "never_hit");
  assert.equal(hit.exclusion?.typeId, "waste_incinerator");
  assert.equal(hit.score, 0);
  assert.deepEqual(hit.reasons, []);
  assert.equal(sc([at(inc.radius_m + 10, "waste_incinerator")], never).excluded, false);

  const park = byId.get("park_neighborhood")!;
  const must = prof("senior", { park_neighborhood: "must" });
  assert.equal(sc([], must).exclusion?.code, "must_missing");
  assert.equal(sc([at(park.radius_m + 50, "park_neighborhood")], must).exclusion?.code, "must_missing");
  const ok = sc([at(park.radius_m - 10, "park_neighborhood")], must);
  assert.equal(ok.excluded, false);
  assert.equal(ok.score, sc([at(park.radius_m - 10, "park_neighborhood")], prof("senior")).score, "must gives no bonus");
});

test("unknown override id -> warnings, strict -> throw", () => {
  const r = sc([], prof("infant", { not_a_real_type: "prefer" }));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /not_a_real_type/);
  assert.throws(() => sc([], prof("infant", { not_a_real_type: "prefer" }), { ...config, strict: true }), /not_a_real_type/);
});

test("domainOverrides / domainMultipliers on real domains", () => {
  const fac = [at(150, "cctv"), at(100, "waste_incinerator"), at(200, "bus_stop")];
  const base = sc(fac, prof("middle_aged"));
  const avoidNuis = sc(fac, prof("middle_aged", {}, { domainOverrides: { nuisance: "avoid" } }));
  assert.ok(avoidNuis.score < base.score);
  const x2 = sc(fac, prof("middle_aged", {}, { domainMultipliers: { nuisance: 2 } }));
  const get = (r: typeof base, id: string) => r.reasons.find((x) => x.typeId === id)!.contribution;
  assert.ok(Math.abs(get(x2, "waste_incinerator") - 2 * get(base, "waste_incinerator")) < 1e-9);
  assert.equal(get(x2, "bus_stop"), get(base, "bus_stop"));
  assert.ok(sc(fac, prof("middle_aged", { waste_incinerator: "neutral" }, { domainOverrides: { nuisance: "avoid" } })).reasons.every((r) => r.typeId !== "waste_incinerator"));
  assert.ok(sc(fac, prof("middle_aged", {}, { domainOverrides: { bogus: "avoid" } })).warnings.length === 1);
  const dom = new Set(types.map((t) => t.domain));
  assert.deepEqual(Object.keys(base.domainScores).sort(), [...dom].sort().filter((d) => types.some((t) => t.domain === d && t.geometry !== "metric")));
  assert.ok(base.domainScores.nuisance < 50 && base.domainScores.transport > 50);
  assert.equal(base.domainScores.medical, 50);
});

test("every type, every stage: no NaN, in range, at many distances and attitudes", () => {
  const dists = [0, 1, 50, 150, 299, 300, 600, 1500, 3000, 10000, 40000];
  for (const t of types) {
    for (const st of LIFE_STAGES) {
      for (const d of dists) {
        for (const att of [undefined, "prefer", "avoid", "neutral"] as const) {
          const r = sc([at(d, t.id)], prof(st, att ? { [t.id]: att } : {}));
          assert.ok(Number.isFinite(r.score) && r.score >= 0 && r.score <= 100, `${t.id}/${st}/${d}/${att}: ${r.score}`);
          for (const x of r.reasons) assert.ok(Number.isFinite(x.contribution) && Number.isFinite(x.distance_m), `${t.id} reason NaN`);
          for (const v of Object.values(r.domainScores)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 100);
        }
      }
    }
  }
  assert.ok(types.length >= 74);
});

test("all facilities at once, all time-of-day values", () => {
  const fac = types.map((t, i) => at(50 + i * 40, t.id));
  for (const st of LIFE_STAGES) for (const tod of [undefined, "weekday", "weekend", "night"] as const) {
    const r = sc(fac, prof(st, {}, { timeOfDay: tod }));
    assert.ok(Number.isFinite(r.score));
    const abs = r.reasons.map((x) => Math.abs(x.contribution));
    assert.deepEqual(abs, [...abs].sort((a, b) => b - a));
  }
});

test("geometry metric types (if any) are ignored", () => {
  const metric = types.filter((t) => t.geometry === "metric");
  for (const t of metric) {
    const r = sc([at(10, t.id)], prof("infant"));
    assert.equal(r.reasons.find((x) => x.typeId === t.id), undefined, t.id);
  }
});
