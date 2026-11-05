import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError } from "./index";

const goodTypes = () => [
  { id: "a", name_ko: "에이", domain: "d1", kind: "positive", radius_m: 500, curve: { type: "decay", params: { half_distance_m: 200 } } },
  { id: "b", domain: "d1", kind: "bell", radius_m: 900, geometry: "metric", time_modifiers: { night: 1.5 },
    curve: { type: "bell", params: { min_m: 100, peak_from_m: 200, peak_to_m: 500, max_m: 900 } } },
  { id: "c", domain: "d2", kind: "positive", radius_m: 300, curve: { type: "step", params: { within_m: 100 } } },
];
const row = (v: number) => ({ infant: v, school: v, young_single: v, middle_aged: v, senior: v });
const goodWeights = () => ({ a: row(1), b: row(0), c: row(-2) });

test("loadConfig accepts valid data and keeps optional fields", () => {
  const cfg = loadConfig(goodTypes(), goodWeights(), { penalty_scale: 2 });
  assert.equal((cfg.types as any[]).length, 3);
  assert.equal((cfg.types as any[])[1].geometry, "metric");
  assert.deepEqual((cfg.types as any[])[1].time_modifiers, { night: 1.5 });
  assert.equal(cfg.penalty_scale, 2);
});

function msg(t: unknown, w: unknown): string {
  try { loadConfig(t, w); } catch (e) { assert.ok(e instanceof ConfigError); return (e as Error).message; }
  assert.fail("expected ConfigError");
}

test("loadConfig rejects bad input with clear messages", () => {
  assert.match(msg({}, goodWeights()), /must be an array/);
  assert.match(msg([42], goodWeights()), /types\[0\] must be an object/);
  const dup = goodTypes(); dup[1].id = "a";
  assert.match(msg(dup, goodWeights()), /duplicated/);
  const kind = goodTypes(); (kind[0] as any).kind = "good";
  assert.match(msg(kind, goodWeights()), /types\[0\] \(a\)\.kind/);
  const curve = goodTypes(); (curve[0] as any).curve = { type: "decay", params: { half_distance_m: "x" } };
  assert.match(msg(curve, goodWeights()), /half_distance_m/);
  const bellOrder = goodTypes(); (bellOrder[1] as any).curve.params.peak_from_m = 50;
  assert.match(msg(bellOrder, goodWeights()), /min_m <= peak_from_m/);
  const badKindBell = goodTypes(); (badKindBell[1] as any).curve = { type: "decay", params: { half_distance_m: 5 } };
  assert.match(msg(badKindBell, goodWeights()), /requires curve.type "bell"/);
  const tm = goodTypes(); (tm[1] as any).time_modifiers = { midnight: 1 };
  assert.match(msg(tm, goodWeights()), /time_modifiers has unknown key/);
  const radius = goodTypes(); (radius[0] as any).radius_m = 0;
  assert.match(msg(radius, goodWeights()), /radius_m/);
});

test("loadConfig validates weights", () => {
  const miss: any = goodWeights(); delete miss.c;
  assert.match(msg(goodTypes(), miss), /weights\.c: missing/);
  const extra: any = { ...goodWeights(), zzz: row(1) };
  assert.match(msg(goodTypes(), extra), /weights\.zzz: no such facility type/);
  const range: any = goodWeights(); range.a.senior = 5;
  assert.match(msg(goodTypes(), range), /weights\.a\.senior/);
  const stage: any = goodWeights(); delete stage.a.infant;
  assert.match(msg(goodTypes(), stage), /weights\.a\.infant/);
  assert.match(msg(goodTypes(), null), /weights must be an object/);
});

test("ConfigError lists every problem", () => {
  try { loadConfig([{ id: "A" }, 3], []); assert.fail(); } catch (e) {
    assert.ok((e as ConfigError).errors.length >= 4);
  }
});
