// 목업 지도용 좌표 변환 (격자 km <-> 위경도). 실제 지도 API 연결 시에는 불필요.
export const ORIGIN = { lat: 37.52, lng: 127.0 }; // 지도 좌상단 (가상 좌표)
export const MAP_EXTENT_KM = { w: 4.2, h: 4.4 };
const KM_PER_DEG_LAT = 110.57;
const kmPerDegLng = () => 111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** 위경도 -> 지도 격자 km (x: 동쪽, y: 남쪽) */
export function toKm(lat: number, lng: number) {
  return { x: (lng - ORIGIN.lng) * kmPerDegLng(), y: (ORIGIN.lat - lat) * KM_PER_DEG_LAT };
}
export function fromKm(x: number, y: number) {
  return { lat: ORIGIN.lat - y / KM_PER_DEG_LAT, lng: ORIGIN.lng + x / kmPerDegLng() };
}
