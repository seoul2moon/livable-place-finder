// 사용법: node data/validate.mjs [--list-arbitrary]
// facility_types.json / weights.json / aversion_groups.json 일관성 검증. 실패 시 exit 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const types = read('facility_types.json');
const weights = read('weights.json');
const groups = read('aversion_groups.json');

const DOMAINS = ['transport', 'education', 'medical', 'convenience', 'nature', 'safety', 'environment', 'nuisance'];
const KINDS = ['positive', 'negative', 'bell'];
const STAGES = ['infant', 'school', 'young_single', 'middle_aged', 'senior'];
const GEOMETRIES = ['point', 'metric'];
const TIMES = ['weekday', 'weekend', 'night'];
const PARAM_KEYS = {
  decay: ['half_distance_m'],
  bell: ['min_m', 'peak_from_m', 'peak_to_m', 'max_m'],
  step: ['within_m'],
};
const errors = [];
const err = (m) => errors.push(m);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// 설계 4번 가중치표 (++=2 +=1 0 -=-1 --=-2), 순서: infant, school, young_single, middle_aged, senior
const DESIGN_TABLE = {
  daycare: [2, 1, 0, 0, 0],               // 어린이집·소아과
  pediatric_clinic: [2, 1, 0, 0, 0],
  academy_cluster: [0, 2, 0, 0, -1],      // 학원가
  nightlife_street: [-2, -1, 1, 0, -2],   // 번화가·술집
  subway_station: [1, 1, 2, 2, 1],        // 지하철·GTX
  gtx_express_bus: [1, 1, 2, 2, 1],
  general_hospital: [1, 1, 0, 1, 2],      // 종합병원·응급실
  emergency_room: [1, 1, 0, 1, 2],
  nursing_hospital: [0, 0, 0, 1, 2],      // 요양병원·복지관
  welfare_center: [0, 0, 0, 1, 2],
  senior_center: [0, 0, 0, 0, 2],         // 경로당·노인복지관
  park_neighborhood: [2, 1, 1, 1, 2],     // 공원·산책로
  park_large: [2, 1, 1, 1, 2],
  walking_trail: [2, 1, 1, 1, 2],
};
// 설계 3번 양면 시설(bell 이어야 함)
const BELL_REQUIRED = ['large_mart', 'subway_station', 'general_hospital', 'elementary_school', 'middle_school',
  'high_school', 'university', 'department_store', 'stadium_event_venue', 'ic_highway', 'park_neighborhood', 'park_large'];
// 설계 1~3·5번 필수 시설
const REQUIRED_IDS = ['horse_racing', 'cycle_boat_racing', 'offtrack_betting', 'casino', 'gambling_arcade', 'love_hotel',
  'red_light_district', 'livestock_farm', 'recycling_sorting', 'asphalt_concrete_plant', 'thermal_power_plant',
  'logistics_center', 'bus_truck_depot', 'public_parking', 'gtx_express_bus', 'dental_clinic', 'laundry',
  'street_lighting', 'religious_facility', 'homeless_welfare_facility', 'senior_center', 'nursing_hospital',
  'welfare_center', 'stairs_elevator', 'car_free_living', 'bus_headway'];
const METRIC_REQUIRED = ['air_quality', 'greenery_ratio', 'sunlight_view', 'flat_terrain', 'steep_slope',
  'crime_hotspot', 'flood_risk_area', 'cctv', 'stairs_elevator', 'car_free_living', 'bus_headway'];

// 1) id 집합
const ids = types.map((t) => t.id);
if (new Set(ids).size !== ids.length) err('facility_types: 중복 id 존재');
const idSet = new Set(ids);
const wIds = Object.keys(weights);
for (const id of ids) if (!(id in weights)) err(`weights 에 없음: ${id}`);
for (const id of wIds) if (!idSet.has(id)) err(`facility_types 에 없는 weights 키: ${id}`);
for (const id of REQUIRED_IDS) if (!idSet.has(id)) err(`필수 시설 누락: ${id}`);
const typeById = Object.fromEntries(types.map((t) => [t.id, t]));

for (const t of types) {
  const p = `[${t.id}]`;
  if (!/^[a-z][a-z0-9_]*$/.test(t.id)) err(`${p} id 형식`);
  if (!t.name_ko) err(`${p} name_ko 없음`);
  if (!DOMAINS.includes(t.domain)) err(`${p} domain 값: ${t.domain}`);
  if (!KINDS.includes(t.kind)) err(`${p} kind 값: ${t.kind}`);
  if (!GEOMETRIES.includes(t.geometry)) err(`${p} geometry 값: ${t.geometry}`);
  if (!num(t.radius_m) || t.radius_m <= 0) err(`${p} radius_m`);
  // 2) kind <-> curve
  const c = t.curve;
  if (!c || !PARAM_KEYS[c.type]) { err(`${p} curve.type 값`); continue; }
  if (t.kind === 'bell' && c.type !== 'bell') err(`${p} kind=bell 인데 curve.type=${c.type}`);
  if (t.kind !== 'bell' && c.type === 'bell') err(`${p} kind=${t.kind} 인데 curve.type=bell`);
  // 3) 파라미터 키/순서
  const keys = Object.keys(c.params ?? {});
  if (!same(keys, PARAM_KEYS[c.type])) err(`${p} ${c.type} params 키/순서: [${keys}] (기대 [${PARAM_KEYS[c.type]}])`);
  const v = keys.map((k) => c.params[k]);
  if (!v.every((x) => num(x) && x > 0)) err(`${p} params 는 양수여야 함`);
  if (c.type === 'bell') {
    const [a, b, d, e] = v;
    if (!(a < b && b <= d && d < e)) err(`${p} bell 순서 min<peak_from<=peak_to<max 위반`);
    if (e > t.radius_m) err(`${p} bell max_m(${e}) > radius_m(${t.radius_m})`);
  }
  if (c.type === 'step' && v[0] > t.radius_m) err(`${p} within_m > radius_m`);
  // time_modifiers
  if (t.time_modifiers !== undefined) {
    for (const [k, m] of Object.entries(t.time_modifiers)) {
      if (!TIMES.includes(k)) err(`${p} time_modifiers 키: ${k}`);
      if (!num(m) || m < 0 || m > 3) err(`${p} time_modifiers.${k} 범위 0..3`);
    }
  }
  // 4) weights
  const w = weights[t.id];
  if (w) {
    if (!same(Object.keys(w), STAGES)) err(`${p} weights 단계 키/순서: [${Object.keys(w)}]`);
    for (const s of STAGES) {
      const x = w[s];
      if (!Number.isInteger(x) || x < -2 || x > 2) err(`${p} weights.${s}=${x} (정수 -2..2 아님)`);
    }
    // bell 규칙: 가중치가 전 단계 비양수면 bell 부적합, 음수가 하나라도 있으면 근접 감점 해석이 왜곡됨
    if (t.kind === 'bell') {
      const vals = STAGES.map((s) => w[s]);
      if (vals.every((x) => x <= 0)) err(`${p} bell 인데 모든 단계 가중치가 <=0 (negative+decay 로 바꿀 것)`);
      if (vals.some((x) => x < 0)) err(`${p} bell 에 음수 가중치 존재 (이득 없는 단계는 0 으로)`);
    }
    if (t.kind === 'negative' && STAGES.every((s) => w[s] > 0)) err(`${p} negative 인데 전 단계 양수`);
  }
}
for (const id of BELL_REQUIRED) if (typeById[id] && typeById[id].kind !== 'bell') err(`[${id}] 설계 3번 양면 시설인데 kind=${typeById[id].kind}`);
for (const id of METRIC_REQUIRED) if (typeById[id] && typeById[id].geometry !== 'metric') err(`[${id}] geometry 는 metric 이어야 함`);
const lm = typeById.large_mart?.curve.params;
if (lm && !(lm.min_m <= 300 && lm.peak_from_m === 500 && lm.peak_to_m === 1500 && lm.max_m >= 3000)) err('[large_mart] peak 는 500~1500m, min<=300, max>=3000 이어야 함');
if (typeById.express_bus_terminal && typeById.express_bus_terminal.kind !== 'negative') err('[express_bus_terminal] 터미널은 negative 여야 함');

// 설계 4번 표 일치
for (const [id, arr] of Object.entries(DESIGN_TABLE)) {
  const w = weights[id];
  if (!w) { err(`설계표 시설 weights 없음: ${id}`); continue; }
  STAGES.forEach((s, i) => { if (w[s] !== arr[i]) err(`[${id}] 설계표 불일치 ${s}: ${w[s]} (설계 ${arr[i]})`); });
}

// 상수 aversion_groups
for (const [g, list] of Object.entries(groups)) for (const id of list) if (!idSet.has(id)) err(`aversion_groups.${g}: 알 수 없는 id ${id}`);

// 임의 값(설계표 밖) 집계
const arbitrary = [];
for (const t of types) {
  if (DESIGN_TABLE[t.id]) continue;
  arbitrary.push(t.id);
}
const arbitraryCells = arbitrary.length * STAGES.length;
if (process.argv.includes('--list-arbitrary')) {
  for (const id of arbitrary) console.log(`${id}\t${STAGES.map((s) => weights[id][s]).join(',')}`);
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} error(s)`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
const count = (f) => types.filter(f).length;
console.log(`OK: ${types.length} types (bell ${count((t) => t.kind === 'bell')}, positive ${count((t) => t.kind === 'positive')}, negative ${count((t) => t.kind === 'negative')}; metric ${count((t) => t.geometry === 'metric')}; time_modifiers ${count((t) => t.time_modifiers)})`);
console.log(`design-table rows matched: ${Object.keys(DESIGN_TABLE).length} types (${Object.keys(DESIGN_TABLE).length * 5} cells)`);
console.log(`arbitrary (outside design table): ${arbitrary.length} types / ${arbitraryCells} cells`);
