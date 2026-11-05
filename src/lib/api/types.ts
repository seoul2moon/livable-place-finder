// 프론트엔드 공용 타입. 시설/태도/생애단계 등은 엔진(src/lib/scoring) 타입을 그대로 재사용한다.
import type {
  Attitude, DomainAttitude, FacilityType as EngineFacilityType, LifeStage, TimeOfDay,
} from "../scoring";

export type { Attitude, DomainAttitude, TimeOfDay };
export type LifeStageId = LifeStage;
export type DomainId =
  | "transport" | "education" | "medical" | "convenience"
  | "nature" | "safety" | "environment" | "nuisance";

/** 엔진 FacilityType + 화면용 한글명 (kind 는 엔진의 positive/negative/bell). */
export type FacilityType = Omit<EngineFacilityType, "domain" | "name_ko"> & {
  domain: DomainId;
  name_ko: string;
};

export interface LifeStageInfo { id: LifeStageId; name_ko: string; desc_ko: string }

/** 계약(data-contract.md 5절) 프로필 스키마. 엔진 입력으로 변환되는 직렬화 형태. */
export interface ContractProfile {
  life_stage: LifeStageId;
  overrides: Record<string, Attitude>;
  domain_overrides: Partial<Record<DomainId, DomainAttitude>>;
}

export interface FacilityPoint { typeId: string; lat: number; lng: number }
export interface Area {
  id: string;
  name_ko: string;
  lat: number;
  lng: number;
  facilities: FacilityPoint[];
}

export interface Factor {
  typeId: string;
  domain: DomainId;
  label: string;
  /** 점수 기여(+가산 / -감점), 엔진 점수 단위 */
  contribution: number;
  distance_m: number;
  tooClose: boolean;
  reason: string;
}
export interface AreaScore {
  areaId: string;
  total: number; // 0~100 (반올림)
  domainScores: Partial<Record<DomainId, number>>; // 0~100, 50 = 중립
  factors: Factor[];
  excluded: boolean;
  /** 제외 사유(한글, 시설명 포함) */
  excludedReason?: string;
  warnings: string[];
}
