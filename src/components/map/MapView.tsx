"use client";
import type { Area, DomainId, FacilityType } from "@/lib/api/types";
import { KAKAO_MAP_KEY } from "@/lib/api/config";
import PlaceholderMap from "./PlaceholderMap";
import KakaoMap from "./KakaoMap";

export interface AreaMark { total: number; excluded: boolean }

/** 지도 구현체가 따라야 하는 인터페이스. 카카오/네이버/플레이스홀더 모두 동일 props. */
export interface MapViewProps {
  areas: Area[];
  scores: Record<string, AreaMark>; // areaId -> 점수/제외 여부
  selectedId: string | null;
  onSelect: (areaId: string) => void;
  /** 화면 표시용 레이어. 점수 계산과는 무관. */
  visibleDomains: DomainId[];
  facilityTypes: FacilityType[];
  /** 선택 지역 주변에 그릴 반경(m). null 이면 표시 안 함. */
  highlightRadiusM: number | null;
}

export default function MapView(props: MapViewProps) {
  // 키가 있을 때만 실지도 사용 (현재 TODO 스켈레톤)
  return KAKAO_MAP_KEY ? <KakaoMap {...props} /> : <PlaceholderMap {...props} />;
}
