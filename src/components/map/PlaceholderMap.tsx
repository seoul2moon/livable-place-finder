"use client";
import { loadDomains, mapExtent } from "@/lib/api/config";
import { toKm } from "@/lib/api/geo";
import type { MapViewProps } from "./MapView";

const S = 130; // px per km
/** 흰 글자 대비 4.5:1 이상 확보를 위해 어두운 명도 사용. 제외 지역은 회색. */
function markColor(v: number, excluded: boolean) {
  if (excluded) return "#4b5563";
  const h = Math.round((v / 100) * 120); // 빨강 -> 초록
  return `hsl(${h} 70% 28%)`;
}

export default function PlaceholderMap({
  areas, scores, selectedId, onSelect, visibleDomains, facilityTypes, highlightRadiusM,
}: MapViewProps) {
  const domColor = Object.fromEntries(loadDomains().map((d) => [d.id, d.color]));
  const typeDomain = Object.fromEntries(facilityTypes.map((t) => [t.id, t.domain]));
  const W = mapExtent.w * S, H = mapExtent.h * S;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="map" role="group" aria-label="지역 지도 (임시 격자 지도). 지역을 선택하면 상세가 바뀝니다.">
      <rect width={W} height={H} fill="#f3f4f6" />
      {Array.from({ length: Math.ceil(mapExtent.w) + 1 }, (_, i) => (
        <line key={"v" + i} x1={i * S} x2={i * S} y1={0} y2={H} stroke="#e5e7eb" />
      ))}
      {Array.from({ length: Math.ceil(mapExtent.h) + 1 }, (_, i) => (
        <line key={"h" + i} y1={i * S} y2={i * S} x1={0} x2={W} stroke="#e5e7eb" />
      ))}
      {areas.flatMap((a) =>
        a.facilities
          .filter((f) => visibleDomains.includes(typeDomain[f.typeId]))
          .map((f, i) => {
            const p = toKm(f.lat, f.lng);
            return <circle key={a.id + i} cx={p.x * S} cy={p.y * S} r={3} fill={domColor[typeDomain[f.typeId]]} opacity={0.75} aria-hidden="true" />;
          }),
      )}
      {areas.map((a) => {
        const sel = a.id === selectedId;
        const m = scores[a.id] ?? { total: 0, excluded: false };
        const p = toKm(a.lat, a.lng);
        const cx = p.x * S, cy = p.y * S;
        const label = `${a.name_ko}, ${m.excluded ? "제외된 지역" : `${m.total}점`}${sel ? ", 선택됨" : ""}`;
        return (
          <g
            key={a.id} className="map-area" role="button" tabIndex={0} aria-label={label} aria-pressed={sel}
            onClick={() => onSelect(a.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(a.id); } }}
          >
            {sel && highlightRadiusM !== null && (
              <circle cx={cx} cy={cy} r={(highlightRadiusM / 1000) * S} fill="#1d4ed8" fillOpacity={0.08} stroke="#1d4ed8" strokeDasharray="4 3" />
            )}
            <circle className="map-ring" cx={cx} cy={cy} r={sel ? 18 : 15} fill={markColor(m.total, m.excluded)} stroke="#fff" strokeWidth={sel ? 3 : 2} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={m.excluded ? 10 : 12} fontWeight={700} fill="#fff">{m.excluded ? "제외" : m.total}</text>
            <text x={cx} y={cy + 33} textAnchor="middle" fontSize={11} fill="#1f2937">{a.name_ko.split(" ")[0]}</text>
          </g>
        );
      })}
      <text x={8} y={H - 8} fontSize={10} fill="#4b5563">지도 API 키 없음 – 임시 격자 지도 (1칸 = 1km)</text>
    </svg>
  );
}
