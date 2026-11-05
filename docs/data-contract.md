# 데이터 계약 (Data Contract) v2

DB / 엔진 / 프론트 공통 참조. 원본은 `data/*.json`. 이 문서와 JSON이 다르면 JSON이 우선.
설계 원문은 `docs/design-draft.md` (이하 "설계 N번" = 해당 절). `node data/validate.mjs` 가 JSON 일관성을 검증한다(통과 필수).

## 1. Enum

| 이름 | 값 |
|---|---|
| domain | `transport` `education` `medical` `convenience` `nature` `safety` `environment` `nuisance` |
| kind | `positive`(가까울수록 좋음) `negative`(가까울수록 나쁨) `bell`(양면: 너무 가까우면 감점, 적정거리에서 최고) |
| curve.type | `decay` `bell` `step` |
| geometry | `point`(점 시설, 기본) `metric`(점이 아닌 지표형) |
| life_stage | `infant` `school` `young_single` `middle_aged` `senior` |
| attitude (개인 태도) | `must` `prefer` `neutral` `avoid` `never` |
| time_of_day | `weekday` `weekend` `night` |
| transport_mode | `walk` `transit` `car` `bicycle` |

domain 은 설계 1번의 8개 영역(교통/교육·육아/의료/생활편의/자연·여가/안전/환경·쾌적/기피 요인)에 1:1 대응. 설계 2번 기피시설은 전부 `nuisance`(단, 소음원·송전선은 `environment`, 공공 위험지역은 `safety`).

## 2. data/facility_types.json
배열. 항목:
```json
{ "id": "subway_station", "name_ko": "지하철역", "domain": "transport",
  "kind": "bell", "geometry": "point", "radius_m": 1000,
  "curve": {"type": "bell", "params": {"min_m":100,"peak_from_m":250,"peak_to_m":600,"max_m":1000}},
  "time_modifiers": {"weekday":1.2,"weekend":1.0,"night":0.8},
  "source_hint": "..." }
```
- `id`: 영문 snake_case, 전체 유일. DB 키/가중치 키로 사용.
- `radius_m`: 영향 반경(m). 이 거리 밖은 기여 0, `must`/`never` 판정 반경도 동일.
- `geometry`: 필수. `metric` = 점이 아닌 지표형(`air_quality` `greenery_ratio` `sunlight_view` `flat_terrain` `steep_slope` `crime_hotspot` `flood_risk_area` `cctv`(밀도) + 노년 변수 `stairs_elevator` `car_free_living` `bus_headway`). 지표형은 사전 계산한 격자/구역 중심점을 facilities 에 점으로 적재해 point 와 같은 거리 모델로 평가하는 것을 기본 구현으로 한다(정밀 값 모델은 추후 협의 항목).
- `kind`↔`curve.type`: `bell` 이면 반드시 `bell`, 그 외는 `decay`(또는 `step`).
- 곡선 파라미터 키/순서 고정: decay `{half_distance_m}`, bell `{min_m, peak_from_m, peak_to_m, max_m}` (`min<peak_from<=peak_to<max<=radius_m`), step `{within_m}`.
- `time_modifiers`(선택): `{weekday, weekend, night}` 각 0..3 배수. 해당 시간대에 이 시설 기여(부호 포함 최종 contribution)에 곱한다. 없으면 1. 혼잡/소음의 시간대 변화를 표현(예: 번화가 night 1.8, 학교 weekday 1.3 / weekend 0.6, 대형마트·쇼핑몰·경기장은 주말 혼잡으로 효용 감소 0.6~0.75). 현재 28개 시설에 실데이터 입력됨.
- 시설 수: 98개(bell 12). 설계 3번 8개 양면 시설 중 `대형마트 지하철역 종합병원 학교(초·중·고) 대학가 경기장·대형쇼핑몰 고속도로IC 공원(근린·대형)` 이 bell. 번화가·술집(`nightlife_street`)은 설계 4번에서 대부분 단계가 음수이므로 bell 이 아닌 `negative`+`decay` 로 둔다(대학가·번화가의 '상권 이득' 쪽은 `university`, `cafe_restaurant_street` 가 담당).
- 설계의 "터미널"은 기피(교통 유발)이므로 `express_bus_terminal` 은 `nuisance`/`negative`. 광역버스·GTX 는 별도 `gtx_express_bus`(교통, positive).
- 요양병원(`nursing_hospital`) / 복지관(`welfare_center`) / 경로당·노인복지관(`senior_center`)은 분리. 복지·돌봄은 설계 2번 취지대로 기본 감점 목록에는 없고 생애단계 가중치로만 반영. 복지시설 인접·종교시설 인접은 `homeless_welfare_facility` / `religious_facility`(기본 가중치 0, 개인 태도로만 반영).
- 제거된 id: `senior_care_facility` (→ `nursing_hospital` + `welfare_center` + `senior_center`).

## 3. 거리 -> 기여도 (엔진 정의가 기준)
`w` = 유효 가중치(4절), `d` = 가장 가까운 시설까지의 거리(m).
- `d > radius_m` → 기여 0.
- **decay**: `f = 0.5 ^ (d / half_distance_m)`, 기여 = `w * f`.
- **step**: `d <= within_m` 이면 `f=1` 아니면 0, 기여 = `w * f`. (현재 데이터 미사용, 구현 필수)
- **bell** (`w` 는 보통 양수):
  - `d < min_m`: **근접 감점** `-|w| * (1 - d/min_m)` (부호는 항상 감점; w 부호와 무관)
  - `min_m <= d < peak_from_m`: f 가 0 → 1 선형 상승, 기여 = `w * f`
  - `peak_from_m <= d <= peak_to_m`: f = 1 (최고)
  - `peak_to_m < d <= max_m`: f 가 1 → 0 선형 하락
  - `d >= max_m`: 0
- 따라서 `kind=bell` 은 "가까우면 나쁘고 적정거리면 좋은" 시설에만 쓴다. 가중치가 전 단계 음수이거나 이득이 없는 시설은 `negative`+`decay`. 검증기가 강제: bell 시설의 5단계 가중치는 모두 `>= 0` 이고 하나 이상 `> 0`.
  - 주의: bell 시설에 개인 태도 `avoid` 를 쓰면 유효 가중치가 음수가 되어 전 구간이 감점(근접 구간 포함)이 된다. 의도된 동작("이 시설이 싫다").
- 같은 유형 시설이 여러 개: 거리별 기여 크기 `c_i`(0..1)를 `1 - Π(1 - c_i)` 로 합성. bell 근접 감점은 가장 가까운 1개 기준(합성 안 함).
- 정규화: 합산 raw 를 50 중립 기준으로 0..100 으로 변환(`score = clamp(50 + 50*raw/ref)`, 50 = 주변에 특이사항 없음). **음수 기여에는 `config.penalty_scale`(기본 1.75)을 곱한다.** `ref` 산식은 엔진 README 가 기준.
- 시간대: `profile.timeOfDay` 가 있으면 유형별 `time_modifiers[timeOfDay]` 를 기여에 곱한다.

## 4. data/weights.json 과 태도 보정
```json
{ "subway_station": {"infant":1,"school":1,"young_single":2,"middle_aged":2,"senior":1}, ... }
```
- 키: facility_types.json 의 모든 `id` (집합 일치). 값: 5개 life_stage 각각 정수 -2..2. 설계 4번 표 기호: `++`=2 `+`=1 `0` `-`=-1 `--`=-2.
- 설계 4번 표와 정확히 일치하는 행(검증기가 강제): 어린이집·소아과(`daycare` `pediatric_clinic`), 학원가(`academy_cluster`), 번화가·술집(`nightlife_street`), 지하철·GTX(`subway_station` `gtx_express_bus`), 종합병원·응급실(`general_hospital` `emergency_room`), 요양병원·복지관(`nursing_hospital` `welfare_center`), 경로당·노인복지관(`senior_center`), 공원·산책로(`park_neighborhood` `park_large` `walking_trail`).
- 유효가중치 `w_eff` (범위 -3..3), `w` = 위 기본 가중치:

| 사용자 태도 | w_eff |
|---|---|
| (override 없음) | `w` |
| `prefer` | `+clamp(abs(w)+1, 1, 3)` |
| `avoid` | `-clamp(abs(w)+1, 1, 3)` |
| `neutral` | `0` (이 시설 무시) |
| `must` / `never` | 점수 보정 없음(`w` 유지). 필터 전용 |

- 필터: `never` → `radius_m` 안에 하나라도 있으면 제외. `must` → `radius_m` 안에 없으면 제외.
- 도메인 단위 태도(`domainOverrides`)는 시설별 override 가 없는 해당 도메인 시설에 같은 표(prefer/avoid/neutral)를 적용. `domainMultipliers`(0..2)는 해당 도메인 기여에 곱함.

## 5. 사용자 프로필

### 5.1 저장/온보딩 프로필 JSON (프론트 ↔ DB, snake_case)
설계 5번 전 항목. 필수는 `life_stage` 뿐, 나머지는 기본값 있음.
```jsonc
{
  "life_stage": "school",                       // 필수. infant|school|young_single|middle_aged|senior
  "transport_mode": "transit",                  // walk|transit|car|bicycle (기본 transit)
  "noise_sensitivity": 2,                       // 0(둔감)..4(매우 민감), 기본 2
  "night_active": false,                        // 야간 활동(외식·유흥·귀가) 많음
  "urban_pref": "urban",                        // urban(활기·도시형) | quiet(한적형), 기본 urban
  "commute_max_min": 45,                        // 통근 허용 시간(분) 0..180 | null
  "work_location": {"lat": 37.5, "lng": 127.0}, // null 가능. 후보지 필터용(엔진 입력 아님)
  "family_location": null,                      // null 가능. 후보지 필터용(엔진 입력 아님)
  "floor_pref": "any",                          // low|mid|high|any
  "view_importance": 2,                         // 조망 중요도 0..4, 기본 2
  "sunlight_importance": 2,                     // 일조 중요도 0..4, 기본 2
  "pet": false,                                 // 반려동물 유무
  "works_from_home": false,                     // 재택근무
  "household": {"adults": 2, "children_ages": [7, 10], "seniors": 0},
  "health_notes": [],                           // 태그: mobility_limited wheelchair respiratory allergy chronic_care pregnancy light_sleeper
  "life_plan": {"horizon_years": 5, "events": [], "next_stage": null},
                                                // horizon_years 5|10; events: child_birth child_school child_independent retirement parent_care job_change; next_stage: life_stage|null
  "overrides": { "<facility_id>": "must|prefer|neutral|avoid|never" },
  "domain_overrides": { "<domain>": "prefer|neutral|avoid" },
  "aversions": {"never": [], "avoid": []}       // 선택. 온보딩 UI 복원용 그룹 id (data/aversion_groups.json 키)
}
```
- 서버 저장 시 `health_notes` 는 민감정보: 동의가 있을 때만 저장, 기본은 로컬(브라우저)에만 보관.
- `overrides` 가 최종 진실. `aversions` 는 UI 복원용이며 `overrides` 로 이미 전개된 상태여야 한다.
- `overrides` 에 없으면 기본 가중치 그대로. `must`/`never` 는 `domain_overrides` 에 쓸 수 없음(시설 단위만).
- 충돌 우선순위 `never > must > avoid > prefer > neutral`; `never` 와 `must` 동시 지정은 UI 에서 차단.

### 5.2 엔진 입력 profile (프론트 → 엔진, camelCase)
```ts
{ lifeStage, overrides: {typeId: attitude},
  domainOverrides?: {domain: "prefer"|"neutral"|"avoid"},
  domainMultipliers?: {domain: number /*0..2*/},
  timeOfDay?: "weekday"|"weekend"|"night" }
```
변환: `life_stage→lifeStage`, `domain_overrides→domainOverrides`, 나머지 설문 값(소음 민감도·이동수단·건강 태그 등)은 프론트가 `docs/onboarding.md` 의 매핑 규칙으로 `overrides`/`domainMultipliers` 에 전개한다. `timeOfDay` 는 화면 상태(프로필 저장 대상 아님). `work_location`/`commute_max_min`/`floor_pref` 등 위치·주거형태 항목은 후보지 생성·표시 단계에서 사용하며 엔진 점수에는 직접 들어가지 않는다.

### 5.3 엔진 출력
```ts
{ score: number /*0..100*/, excluded: boolean,
  exclusion?: {code: "never_hit"|"must_missing", typeId: string, distance_m?: number},
  reasons: [{typeId, contribution, distance_m, tooClose?: boolean}],   // |contribution| 내림차순
  domainScores: {transport: number, ... /*0..100*/} }
```
- 제외 사유는 구조화 코드. `never_hit` 은 가장 가까운 해당 시설 `distance_m` 포함, `must_missing` 은 생략 가능.
- `tooClose`: bell 시설이 `min_m` 안쪽이라 근접 감점 중임을 표시(UI "너무 가까움" 배지).

## 6. DB 매핑 (DB팀 `db/schema.sql` 기준 테이블명)
- `facility_types(id pk, name_ko, domain, kind, radius_m, curve_type, curve_params jsonb, source_hint)` + 이번 개정으로 추가 필요: `geometry text/enum ('point'|'metric') default 'point'`, `time_modifiers jsonb null`.
- `life_stage_weights(type_id fk, life_stage, weight smallint check -2..2, pk(type_id, life_stage))`
- `facilities(id, type_id fk, name, geom geography(Point,4326), source, source_id, updated_at)` + GiST 인덱스, 반경 질의 `ST_DWithin(geom, p, radius_m)`.
- `user_profiles(id, life_stage, transport_mode, noise_sensitivity, prefers_urban(=urban_pref), has_pet(=pet), works_from_home, ...)`. 5.1 중 컬럼이 없는 항목(`night_active` `commute_max_min` `work_location` `family_location` `floor_pref` `view_importance` `sunlight_importance` `household` `health_notes` `life_plan`)은 DB팀과 협의해 컬럼 추가 또는 `extra jsonb` 로 저장. `has_car` 는 `transport_mode='car'` 로 대체 가능.
- `user_overrides(profile_id fk, type_id fk, attitude, pk(profile_id, type_id))`
- `user_domain_overrides(profile_id fk, domain, attitude check in ('prefer','neutral','avoid'), pk(profile_id, domain))`
- seed 적재: `facility_types.json`(geometry/time_modifiers 포함), `weights.json` → `life_stage_weights`.

## 7. 결과 설명(Why)
엔진 출력의 `reasons`(시설유형별 `{typeId, contribution, distance_m, tooClose?}`)와 `exclusion`, `domainScores` 를 그대로 UI 에 표시. 가산·감점 상위 요인을 각각 3~5개 노출.

## 8. 보조 데이터
- `data/aversion_groups.json`: 온보딩 "심리적 거부감" 그룹 → facility id 목록(장례·묘지, 사행·유흥, 종교시설, 복지시설, 악취·폐기물, 소음·진동, 위험·유해, 교정시설, 교통 유발).

## 9. 설계표 밖 임의 값 목록
설계 4번 표(위 4절 14개 시설 × 5단계 = 70칸)에 없는 나머지 84개 시설 × 5단계 = **420칸**은 설계에 값이 없어 기획 담당이 합리적으로 정한 임의 값이다(확정 전 검토 필요). 생성: `node data/validate.mjs --list-arbitrary`. 값 순서 `[infant, school, young_single, middle_aged, senior]`. 적용한 원칙: 기피시설은 -1/-2(영유아·학령기·노년에 더 강하게), 생활 인프라는 생애단계 수요 방향(영유아→교육·놀이터, 노년→의료·시장·은행), bell 시설은 이득 없는 단계를 음수 대신 0, 설계 2번 취지에 따라 종교시설은 전 단계 0.

```
교통  train_station[0,0,1,1,1] bus_stop[1,1,1,1,2] airport_access[0,0,1,1,0] ic_highway[0,0,1,1,0] bike_lane[0,1,2,1,0]
      public_parking[1,0,0,1,0] car_free_living[0,0,1,0,2] bus_headway[0,0,1,0,2]
교육  kindergarten[2,1,0,0,0] elementary_school[1,2,0,1,0] middle_school[0,2,0,1,0] high_school[0,1,0,1,0]
      library[1,2,1,1,1] university[0,0,1,0,0] culture_center[1,0,1,1,2]
의료  clinic[2,1,0,1,2] pharmacy[1,1,0,1,2] oriental_clinic[0,0,0,1,1] dental_clinic[1,1,1,1,2]
생활  convenience_store[1,1,2,1,1] supermarket[1,1,1,2,2] large_mart[1,1,1,2,1] traditional_market[0,0,0,1,2]
      department_store[0,0,1,1,0] cafe_restaurant_street[0,0,2,1,0] bank[0,0,0,1,2] post_office_public_office[0,0,0,1,2]
      gym_sports_center[0,1,2,1,1] cinema_culture[0,1,2,1,0] pet_facility[0,0,1,1,0] coworking_cafe[0,1,1,0,-1]
      stadium_event_venue[0,0,1,1,0] laundry[0,0,1,1,1]
자연  playground[2,1,0,0,0] river_stream[1,1,2,2,2] mountain_trail[0,0,1,2,2] sea_lake_view[0,0,1,1,1] greenery_ratio[2,1,1,2,2]
안전  police_station[1,1,1,1,1] fire_station[1,1,1,1,1] cctv[1,2,2,1,1] safe_return_route[0,2,2,0,0]
      crime_hotspot[-2,-2,-2,-2,-2] flood_risk_area[-2,-1,-1,-2,-2] steep_slope[-2,-1,0,-1,-2] school_zone[2,1,0,1,0] street_lighting[1,1,1,1,1]
환경  air_quality[-2,-2,-1,-2,-2] noise_major_road[-2,-1,-1,-2,-2] noise_railway[-2,-1,-1,-2,-2] noise_aircraft[-2,-2,-1,-2,-2]
      overhead_power_line[-2,-2,-1,-2,-2] sunlight_view[1,1,1,2,2] flat_terrain[1,0,0,1,2] stairs_elevator[1,0,0,0,2]
기피  express_bus_terminal[-1,-1,0,-1,-1] waste_incinerator[-2,-2,-2,-2,-2] landfill[-2,-2,-2,-2,-2] sewage_plant[-2,-2,-2,-2,-2]
      crematorium_funeral[-1,-1,-1,-1,-1] cemetery_charnel[-1,-1,-1,-1,-1] industrial_complex[-2,-2,-1,-2,-2] gas_station[-1,-1,0,-1,-1]
      hazardous_facility[-2,-2,-2,-2,-2] adult_entertainment[-2,-2,0,-2,-2] high_voltage_substation[-2,-2,-1,-2,-2]
      military_base[-1,-1,-1,-1,-1] prison_detention[-1,-1,-1,-1,-1] homeless_welfare_facility[-1,-1,0,-1,0]
      construction_redevelopment[-2,-2,-1,-2,-2] horse_racing[-2,-2,-1,-1,-1] cycle_boat_racing[-2,-2,-1,-1,-1]
      offtrack_betting[-2,-2,-1,-1,-1] casino[-2,-2,0,-1,-1] gambling_arcade[-2,-2,-1,-2,-2] love_hotel[-2,-2,0,-1,-1]
      red_light_district[-2,-2,-1,-2,-2] livestock_farm[-2,-2,-1,-2,-2] recycling_sorting[-2,-2,-1,-2,-2]
      asphalt_concrete_plant[-2,-2,-1,-2,-2] thermal_power_plant[-2,-2,-1,-2,-2] logistics_center[-1,-1,0,-1,-1]
      bus_truck_depot[-1,-1,0,-1,-1] religious_facility[0,0,0,0,0]
```
추가로 `time_modifiers` 28건(시설 목록은 facility_types.json 참조)도 설계에 수치가 없는 임의 값이다(방향성만 설계 6번 "평일/주말/야간 보정"에 근거).
