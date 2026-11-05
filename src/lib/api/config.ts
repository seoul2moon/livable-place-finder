// 데이터 로더 단일 지점. data/*.json 을 직접 import 하고 엔진 loadConfig 로 검증한다.
import facilityTypesJson from "../../../data/facility_types.json";
import weightsJson from "../../../data/weights.json";
import { loadConfig } from "../scoring";
import type { ScoreConfig } from "../scoring";
import { MOCK_AREAS } from "../mock";
import { MAP_EXTENT_KM } from "./geo";
import type { Area, Attitude, DomainId, FacilityType, LifeStageInfo, TimeOfDay } from "./types";

export const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

export const DOMAINS: { id: DomainId; name_ko: string; color: string }[] = [
  { id: "transport", name_ko: "교통", color: "#1d4ed8" },
  { id: "education", name_ko: "교육·육아", color: "#6d28d9" },
  { id: "medical", name_ko: "의료", color: "#b91c1c" },
  { id: "convenience", name_ko: "생활편의", color: "#c2410c" },
  { id: "nature", name_ko: "자연·여가", color: "#15803d" },
  { id: "safety", name_ko: "안전", color: "#0e7490" },
  { id: "environment", name_ko: "환경·쾌적", color: "#4d7c0f" },
  { id: "nuisance", name_ko: "기피요인", color: "#4b5563" },
];
const DOMAIN_IDS = new Set<string>(DOMAINS.map((d) => d.id));

export const LIFE_STAGES: LifeStageInfo[] = [
  { id: "infant", name_ko: "영유아 가정", desc_ko: "0~7세 자녀 · 어린이집·소아과·공원" },
  { id: "school", name_ko: "학령기 가정", desc_ko: "초중고 자녀 · 학교·학원·안전한 통학길" },
  { id: "young_single", name_ko: "청년 1인·부부", desc_ko: "20~30대 · 교통·편의·문화생활" },
  { id: "middle_aged", name_ko: "중장년", desc_ko: "40~50대 · 병원·마트·쾌적한 환경" },
  { id: "senior", name_ko: "시니어", desc_ko: "60세 이상 · 의료·완만한 지형·조용함" },
];

export const ATTITUDE_LABELS: Record<Attitude, string> = {
  must: "꼭 필요", prefer: "있으면 좋음", neutral: "상관없음", avoid: "피하고 싶음", never: "절대 불가",
};
export const TIME_LABELS: Record<TimeOfDay, string> = { weekday: "평일", weekend: "주말", night: "야간" };

// 엔진이 데이터를 검증한다(문제가 있으면 ConfigError 로 빌드/로드 시점에 즉시 드러남).
const engineConfig: ScoreConfig = loadConfig(facilityTypesJson, weightsJson);

const FACILITY_TYPES: FacilityType[] = (facilityTypesJson as unknown as FacilityType[]).filter((t) =>
  DOMAIN_IDS.has(t.domain),
);
const TYPE_MAP = new Map(FACILITY_TYPES.map((t) => [t.id, t]));

export function getEngineConfig(): ScoreConfig { return engineConfig; }
export function loadDomains() { return DOMAINS; }
export function loadFacilityTypes(): FacilityType[] { return FACILITY_TYPES; }
export function getFacilityType(id: string): FacilityType | undefined { return TYPE_MAP.get(id); }
export function loadLifeStages(): LifeStageInfo[] { return LIFE_STAGES; }
/** 점 시설이 아닌 지역 단위 지표(metric)인지 */
export function isMetric(t: FacilityType): boolean { return !!t.geometry && t.geometry !== "point"; }
/** 기피시설 질문 대상: domain === 'nuisance' */
export function nuisanceTypes(): FacilityType[] { return FACILITY_TYPES.filter((t) => t.domain === "nuisance"); }
// TODO(api): 실제 지역/시설 데이터는 DB(PostGIS) API 연결 후 fetch 로 교체.
export function loadAreas(): Area[] { return MOCK_AREAS; }
export const mapExtent = MAP_EXTENT_KM;
