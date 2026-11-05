// 온보딩 응답(Answers) -> 계약 프로필(ContractProfile) 변환. 규칙 출처: docs/onboarding.md
import type { Attitude, ContractProfile, DomainAttitude, DomainId, FacilityType, LifeStageId } from "./types";

export type TransportMode = "walk" | "transit" | "car" | "bike";
export type Commute = "short" | "medium" | "any";
export type Noise = "low" | "mid" | "high";
export type Style = "urban" | "quiet";
export type Floor = "high" | "low";
export type Household = "single" | "couple" | "kids" | "parents";
export type Health = "mobility" | "chronic" | "respiratory";
export type Plan = "childbirth" | "schooling" | "retire" | "mobile";
export type Yn = boolean | null; // null = 건너뜀(neutral)
export type Dislike = "avoid" | "never";

export interface Answers {
  lifeStage: LifeStageId | null; // 필수
  household: Household[];
  health: Health[];
  plans: Plan[];
  domainPrefs: DomainId[]; // 최대 3, prefer
  transport: TransportMode | null;
  commute: Commute | null;
  noise: Noise | null;
  style: Style | null;
  floor: Floor | null;
  sunView: Yn;
  nightLife: Yn; // Q7
  pet: Yn; // Q8
  outdoor: Yn; // Q9
  remote: Yn; // Q10
  eldercare: Yn; // Q11
  must: string[]; // Q3
  dislike: Record<string, Dislike>; // Q4/Q5 (시설 id 하나당 하나의 값 -> 중복 불가)
  religious: Dislike | null; // 종교시설 인접 거부감
}

export const DEFAULT_ANSWERS: Answers = {
  lifeStage: null, household: [], health: [], plans: [], domainPrefs: [],
  transport: null, commute: null, noise: null, style: null, floor: null, sunView: null,
  nightLife: null, pet: null, outdoor: null, remote: null, eldercare: null,
  must: [], dislike: {}, religious: null,
};

export const MAX_DOMAIN_PREFS = 3;
export const RECOMMENDED_MAX_MUST = 3;

type Opt<T extends string> = [T, string];
export const HOUSEHOLDS: Opt<Household>[] = [["single", "1인 가구"], ["couple", "부부·커플"], ["kids", "자녀와 함께"], ["parents", "부모님과 함께·돌봄"]];
export const HEALTHS: Opt<Health>[] = [["mobility", "이동이 불편해요"], ["chronic", "자주 병원에 가요(만성질환)"], ["respiratory", "호흡기·알레르기가 있어요"]];
export const PLANS: Opt<Plan>[] = [["childbirth", "출산·영유아 육아 예정"], ["schooling", "자녀 학교·학원 진학 예정"], ["retire", "은퇴·한적한 생활 준비"], ["mobile", "이직·이사가 잦을 듯"]];
export const TRANSPORTS: Opt<TransportMode>[] = [["transit", "대중교통(차 없이 지하철·버스)"], ["walk", "도보 위주"], ["car", "자차"], ["bike", "자전거"]];
export const COMMUTES: Opt<Commute>[] = [["short", "30분 이내"], ["medium", "1시간 이내"], ["any", "상관없어요(재택 등)"]];
export const NOISES: Opt<Noise>[] = [["low", "둔감해요"], ["mid", "보통"], ["high", "민감해요"]];
export const STYLES: Opt<Style>[] = [["urban", "도시형 (북적여도 편리)"], ["quiet", "한적형 (조용한 곳)"]];
export const FLOORS: Opt<Floor>[] = [["high", "고층"], ["low", "저층"]];
export const QUICK_MUST: string[] = ["subway_station", "elementary_school", "general_hospital", "large_mart", "park_neighborhood", "pediatric_clinic", "library"];
export const ASKABLE_DOMAINS: DomainId[] = ["transport", "education", "medical", "convenience", "nature", "safety", "environment"];

export const DISLIKE_GROUPS: { label: string; ids: string[] }[] = [
  { label: "소각장·매립장", ids: ["waste_incinerator", "landfill"] },
  { label: "하수처리장", ids: ["sewage_plant"] },
  { label: "화장장·장례식장·묘지", ids: ["crematorium_funeral", "cemetery_charnel"] },
  { label: "유흥·성인업소", ids: ["adult_entertainment", "nightlife_street"] },
  { label: "고압선·변전소", ids: ["overhead_power_line", "high_voltage_substation"] },
  { label: "군부대·사격장", ids: ["military_base"] },
  { label: "교정시설", ids: ["prison_detention"] },
  { label: "위험물·주유소", ids: ["hazardous_facility", "gas_station"] },
  { label: "공장·산업단지", ids: ["industrial_complex"] },
  { label: "대로·철도·항공기 소음", ids: ["noise_major_road", "noise_railway", "noise_aircraft"] },
];
/** 그룹 + 그룹에 없는 domain==='nuisance' 시설을 개별 항목으로 (religious_facility 는 별도 질문). */
export function dislikeGroups(types: FacilityType[]): { label: string; ids: string[] }[] {
  const valid = new Set(types.map((t) => t.id));
  const used = new Set<string>(["religious_facility"]);
  const out = DISLIKE_GROUPS.map((g) => ({ label: g.label, ids: g.ids.filter((i) => valid.has(i)) })).filter((g) => g.ids.length);
  out.forEach((g) => g.ids.forEach((i) => used.add(i)));
  for (const t of types) if (t.domain === "nuisance" && !used.has(t.id)) out.push({ label: t.name_ko, ids: [t.id] });
  return out;
}

type Rule = { prefer?: string[]; avoid?: string[] };
const NOISE_IDS = ["noise_major_road", "noise_railway", "noise_aircraft"];
const RULES = {
  household: {
    single: {}, couple: {},
    kids: { prefer: ["playground", "school_zone", "pediatric_clinic"] },
    parents: { prefer: ["general_hospital", "nursing_hospital", "senior_center", "flat_terrain"] },
  } as Record<Household, Rule>,
  health: {
    mobility: { prefer: ["flat_terrain", "bus_stop", "clinic", "stairs_elevator"], avoid: ["steep_slope"] },
    chronic: { prefer: ["general_hospital", "emergency_room", "clinic", "pharmacy"] },
    respiratory: { prefer: ["greenery_ratio", "park_neighborhood"], avoid: ["air_quality"] },
  } as Record<Health, Rule>,
  plans: {
    childbirth: { prefer: ["kindergarten", "daycare", "pediatric_clinic", "playground"] },
    schooling: { prefer: ["elementary_school", "middle_school", "academy_cluster", "library"] },
    retire: { prefer: ["mountain_trail", "river_stream", "walking_trail", "general_hospital"] },
    mobile: { prefer: ["subway_station", "train_station", "ic_highway"] },
  } as Record<Plan, Rule>,
  transport: {
    transit: { prefer: ["subway_station", "bus_stop"] }, // Q6
    walk: { prefer: ["bus_stop", "convenience_store", "supermarket"] },
    car: { prefer: ["ic_highway"] },
    bike: { prefer: ["bike_lane"] },
  } as Record<TransportMode, Rule>,
  commute: {
    short: { prefer: ["subway_station", "bus_stop", "ic_highway"] },
    medium: { prefer: ["subway_station"] },
    any: {},
  } as Record<Commute, Rule>,
  noise: { low: {}, mid: {}, high: { avoid: [...NOISE_IDS, "nightlife_street"] } } as Record<Noise, Rule>,
  style: {
    urban: { prefer: ["cafe_restaurant_street", "cinema_culture", "department_store"] },
    quiet: { prefer: ["park_neighborhood", "walking_trail"], avoid: ["nightlife_street"] },
  } as Record<Style, Rule>,
  floor: {
    high: { prefer: ["sunlight_view", "sea_lake_view"] },
    low: { prefer: ["flat_terrain"], avoid: ["steep_slope"] }, // 계단·경사 부담 완화
  } as Record<Floor, Rule>,
  sunView: { prefer: ["sunlight_view", "sea_lake_view", "greenery_ratio"] } as Rule,
  nightYes: { prefer: ["cafe_restaurant_street", "nightlife_street", "cinema_culture"] } as Rule, // Q7
  nightNo: { avoid: ["nightlife_street"] } as Rule,
  pet: { prefer: ["pet_facility", "park_neighborhood", "walking_trail"] } as Rule, // Q8
  outdoor: { prefer: ["mountain_trail", "river_stream", "gym_sports_center", "park_large"] } as Rule, // Q9
  remote: { prefer: ["coworking_cafe", "sunlight_view"], avoid: ["noise_major_road"] } as Rule, // Q10
  eldercare: { prefer: ["general_hospital", "nursing_hospital", "senior_center", "flat_terrain"] } as Rule, // Q11
};

// 충돌 우선순위: never > must > avoid > prefer > neutral
const RANK: Record<Attitude, number> = { neutral: 0, prefer: 1, avoid: 2, must: 3, never: 4 };

export function buildProfile(a: Answers, validIds: Set<string>): ContractProfile {
  const overrides: Record<string, Attitude> = {};
  const put = (id: string, att: Attitude) => {
    if (!validIds.has(id)) return;
    if (RANK[att] > RANK[overrides[id] ?? "neutral"]) overrides[id] = att;
  };
  const apply = (r?: Rule) => { r?.prefer?.forEach((i) => put(i, "prefer")); r?.avoid?.forEach((i) => put(i, "avoid")); };

  a.household.forEach((k) => apply(RULES.household[k]));
  a.health.forEach((k) => apply(RULES.health[k]));
  a.plans.forEach((k) => apply(RULES.plans[k]));
  if (a.transport) apply(RULES.transport[a.transport]);
  if (a.commute) apply(RULES.commute[a.commute]);
  if (a.noise) apply(RULES.noise[a.noise]);
  if (a.style) apply(RULES.style[a.style]);
  if (a.floor) apply(RULES.floor[a.floor]);
  if (a.sunView) apply(RULES.sunView);
  if (a.nightLife === true) apply(RULES.nightYes);
  if (a.nightLife === false) apply(RULES.nightNo);
  if (a.pet) apply(RULES.pet);
  if (a.outdoor) apply(RULES.outdoor);
  if (a.remote) apply(RULES.remote);
  if (a.eldercare) apply(RULES.eldercare);
  if (a.religious) put("religious_facility", a.religious);
  for (const [id, att] of Object.entries(a.dislike)) put(id, att);
  a.must.forEach((id) => put(id, "must"));

  const domain_overrides: ContractProfile["domain_overrides"] = {};
  a.domainPrefs.slice(0, MAX_DOMAIN_PREFS).forEach((d) => { domain_overrides[d] = "prefer" as DomainAttitude; });
  return { life_stage: a.lifeStage ?? "young_single", overrides, domain_overrides };
}

/** must 와 never 가 동시에 지정된 시설 id (UI 에서 차단되므로 정상적으로는 빈 배열) */
export function mustNeverConflicts(a: Answers): string[] {
  return a.must.filter((id) => a.dislike[id] === "never");
}
