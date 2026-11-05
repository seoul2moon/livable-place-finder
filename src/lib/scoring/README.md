# scoring

Pure TypeScript scoring engine (no DOM/Next dependencies, no runtime deps). Source of truth for fields: `docs/data-contract.md` and `data/*.json`.

```ts
import { loadConfig, scoreLocation } from "@/lib/scoring";
const config = loadConfig(rawFacilityTypesJson, rawWeightsJson, { penalty_scale: 1.75 }); // validates, throws ConfigError
const result = scoreLocation({ lat, lng }, facilities, profile, config);
```

## Input
- `location`: `{lat, lng}`; `facilities`: `[{typeId, lat, lng}]` (haversine distance; unknown typeIds are ignored).
- `profile`:
  - `lifeStage`: `infant|school|young_single|middle_aged|senior` (invalid -> throws)
  - `overrides?`: `{[typeId]: must|prefer|neutral|avoid|never}`
  - `domainOverrides?`: `{[domain]: prefer|neutral|avoid}` same prefer/avoid rule applied to every facility of the domain; a facility override wins (even `neutral`); domain `neutral` = base weight.
  - `domainMultipliers?`: `{[domain]: 0..2}` (default 1, clamped with a warning) multiplies that domain's contributions.
  - `timeOfDay?`: `weekday|weekend|night` -> `type.time_modifiers[timeOfDay]` (default 1) multiplies the type's contribution.
- `config`: `{types, weights, saturation?=0.5, penalty_scale?=1.75, strict?}`. Build it with `loadConfig(rawTypes, rawWeights, extra?)`, which validates JSON by hand and throws `ConfigError` (`.errors` lists every problem: ids, enums, curve params, bell ordering, weight rows -2..2 for all 5 stages, extra/missing weight rows, time_modifiers keys).
- `FacilityType`: `id, name_ko?, domain, kind, radius_m, curve, geometry?, time_modifiers?`.

## Output
```
{ score: 0..100, excluded, exclusion?: {code: "never_hit"|"must_missing", typeId, distance_m?},
  reasons: [{typeId, contribution, distance_m, tooClose?}], domainScores: {[domain]: 0..100}, warnings: string[] }
```
- `reasons`: sorted by |contribution| desc; `contribution` in score points (after penalty_scale and domain multiplier; sum = score - 50 before clamping); `distance_m` = nearest facility of the type; `tooClose` = bell type whose nearest facility is closer than `min_m`.
- Excluded: `score: 0`, `reasons: []`, `domainScores` all 50.
- `domainScores`: 50 neutral; same normalisation computed per domain; 50 when the domain has no facilities nearby. Domains containing only `geometry:"metric"` types are absent.
- `warnings`: invalid profile input. Unknown override typeId / invalid attitude / unknown domain -> warning (or `throw` if `config.strict`). Overrides on metric types produce a warning and are ignored.

## Model
score = 50 + Σ contributions, clamped 0..100.

- **Effective weight** (-3..3), `w` = stage base weight from `weights`:
  `prefer` = +clamp(|w|+1, 1, 3); `avoid` = -clamp(|w|+1, 1, 3); `neutral` = 0; `must`/`never` = w (no score change, filter only).
  Note: `prefer` on a negative-kind facility (w<0) deliberately flips it to a **bonus** ("prefer = bonus"), and `avoid` on a positive one makes it a penalty; `avoid` on an already negative facility strengthens it (-2 -> -3).
- **Hard filters** (first): `never` -> excluded if nearest <= `radius_m`; `must` -> excluded unless nearest <= `radius_m`. Per-facility overrides only (not domainOverrides).
- **Curves** (0 beyond `radius_m`): `decay` = 0.5^(d/half_distance_m); `step` = 1 if d <= `within_m` (falls back to `threshold_m`, then `radius_m`); `bell` (trapezoid):
  d < `min_m`: too-close penalty `-|w|*(1 - d/min_m)` (always a penalty, whatever the sign/attitude); `min_m..peak_from_m` rises 0->1; `peak_from_m..peak_to_m` = 1; `peak_to_m..max_m` falls 1->0; >= `max_m` 0. Benefit = `w * value` (so a negative w makes the band a penalty).
- Several facilities of one type: `1 - Π(1 - c_i)` (bell: benefit part; too-close uses the closest one).
- **geometry:"metric"** types are area-level metrics, not point facilities: they are ignored entirely (no score, no filter, no domain). Anything without `geometry` or with another value is scored as a point.
- **Normalisation**: `ref = saturation x Σ(positive base stage weights)` (falls back to Σ|base| if there are none); `contribution = 50 x raw / ref`. The reference uses base weights (not attitude-adjusted) so prefer/avoid always move the score. Negative contributions are multiplied by `penalty_scale` (1.75) so nuisance facilities hurt more. Sample: incinerator 800 m + major road 100 m + industrial complex 1 km + subway 400 m -> every life stage < 50 (young_single ~47).
- `domainMultipliers` do not change `ref`.

Run tests: `npx tsx --test src/lib/scoring/*.test.ts` (unit tests use a small synthetic config; `integration.test.ts` reads the real `data/*.json`). Typecheck: `npx tsc --noEmit`.
