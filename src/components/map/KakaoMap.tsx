"use client";
import PlaceholderMap from "./PlaceholderMap";
import type { MapViewProps } from "./MapView";

// TODO(kakao): NEXT_PUBLIC_KAKAO_MAP_KEY 설정 시 사용.
//  1) //dapi.kakao.com/v2/maps/sdk.js?appkey=KEY&autoload=false 스크립트 로드
//  2) kakao.maps.load(() => new kakao.maps.Map(container, {center, level}))
//  3) areas -> 커스텀 오버레이(점수 색), visibleDomains 에 맞는 시설 마커, radiusKm -> Circle
//  4) 마커 클릭 시 props.onSelect(area.id)
// 구현 전까지는 플레이스홀더로 폴백한다.
export default function KakaoMap(props: MapViewProps) {
  return <PlaceholderMap {...props} />;
}
