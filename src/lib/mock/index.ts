// 목업 지역/시설 (DB API 연결 전까지). 시설 id 는 data/facility_types.json 의 실제 id 만 사용한다.
import facilityTypesJson from "../../../data/facility_types.json";
import { fromKm } from "../api/geo";
import type { Area, FacilityPoint } from "../api/types";

interface RawType { id: string; domain: string; radius_m: number; geometry?: string }
const RAW = facilityTypesJson as unknown as RawType[];

// 결정적 의사난수
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const AREA_DEFS: { id: string; name_ko: string; x: number; y: number; bias: Record<string, number> }[] = [
  { id: "a1", name_ko: "가온동 (역세권)", x: 0.8, y: 0.9, bias: { subway_station: 2, convenience_store: 4, large_mart: 1, nightlife_street: 2, academy_cluster: 2, bus_stop: 3, cafe_restaurant_street: 2 } },
  { id: "a2", name_ko: "나래동 (학원가)", x: 2.6, y: 0.8, bias: { academy_cluster: 3, elementary_school: 2, cctv: 3, library: 1, school_zone: 2 } },
  { id: "a3", name_ko: "다솜동 (주택가)", x: 1.4, y: 2.3, bias: { park_neighborhood: 2, clinic: 2, police_station: 1, elementary_school: 1, pediatric_clinic: 1, playground: 1 } },
  { id: "a4", name_ko: "라온동 (산자락)", x: 3.3, y: 2.4, bias: { park_large: 1, mountain_trail: 2, river_stream: 2, walking_trail: 2, greenery_ratio: 2, steep_slope: 1 } },
  { id: "a5", name_ko: "마루동 (공단 인접)", x: 0.7, y: 3.4, bias: { industrial_complex: 1, noise_major_road: 1, waste_incinerator: 1, bus_stop: 2, gas_station: 1 } },
  { id: "a6", name_ko: "보람동 (신도시)", x: 2.4, y: 3.5, bias: { large_mart: 1, general_hospital: 1, park_neighborhood: 2, cctv: 3, elementary_school: 2, subway_station: 1, supermarket: 2 } },
];

export const MOCK_AREAS: Area[] = AREA_DEFS.map((d, i) => {
  const r = rng(i + 7);
  const facilities: FacilityPoint[] = [];
  for (const t of RAW) {
    // 지역 단위 지표(metric)는 점 시설이 아니므로 생성하지 않음
    if (t.geometry && t.geometry !== "point") continue;
    const base = t.domain === "nuisance" || t.domain === "environment" ? 0.12 : 0.4;
    const n = d.bias[t.id] ?? (r() < base ? 1 : 0);
    const maxD = Math.min(t.radius_m, 2200);
    for (let k = 0; k < n; k++) {
      const ang = r() * Math.PI * 2;
      const distKm = (60 + r() * Math.max(maxD - 60, 40)) / 1000;
      const p = fromKm(d.x + Math.cos(ang) * distKm, d.y + Math.sin(ang) * distKm);
      facilities.push({ typeId: t.id, lat: p.lat, lng: p.lng });
    }
  }
  const c = fromKm(d.x, d.y);
  return { id: d.id, name_ko: d.name_ko, lat: c.lat, lng: c.lng, facilities };
});
