// 엔진(src/lib/scoring) 어댑터: UI 영역/프로필 -> scoreLocation -> UI 결과 타입.
import { scoreLocation } from "../scoring";
import { getEngineConfig, getFacilityType } from "./config";
import type { Area, AreaScore, ContractProfile, DomainId, Factor, TimeOfDay } from "./types";
import { ATTITUDE_LABELS } from "./config";

export type DomainMultipliers = Record<DomainId, number>;
export interface ScoreInput {
  profile: ContractProfile;
  multipliers: DomainMultipliers;
  timeOfDay: TimeOfDay;
}

/** 받침 여부에 따라 조사 선택. 한글이 아니면 '이(가)' 형태. */
export function josa(word: string, pair: "이/가" | "은/는" | "을/를"): string {
  const [a, b] = pair.split("/");
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${a}(${b})`;
  return word + (code % 28 === 0 ? b : a);
}
export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function nameOf(typeId: string): string { return getFacilityType(typeId)?.name_ko ?? typeId; }

function exclusionText(e: NonNullable<ReturnType<typeof scoreLocation>["exclusion"]>): string {
  const t = getFacilityType(e.typeId);
  const name = nameOf(e.typeId);
  if (e.code === "never_hit") {
    const d = e.distance_m !== undefined ? `${fmtDist(e.distance_m)} 거리에` : `반경 ${fmtDist(t?.radius_m ?? 0)} 안에`;
    return `${josa(name, "이/가")} ${d} 있어요 (절대 불가로 설정한 시설)`;
  }
  return `필수로 고른 ${josa(name, "이/가")} 반경 ${fmtDist(t?.radius_m ?? 0)} 안에 없어요`;
}

export function scoreArea(area: Area, input: ScoreInput): AreaScore {
  const { profile, multipliers, timeOfDay } = input;
  const res = scoreLocation(
    { lat: area.lat, lng: area.lng },
    area.facilities,
    {
      lifeStage: profile.life_stage,
      overrides: profile.overrides,
      domainOverrides: profile.domain_overrides,
      domainMultipliers: multipliers,
      timeOfDay,
    },
    getEngineConfig(),
  );
  const factors: Factor[] = res.reasons.map((r) => {
    const t = getFacilityType(r.typeId);
    const name = nameOf(r.typeId);
    const d = fmtDist(r.distance_m);
    const att = profile.overrides[r.typeId];
    const mine = att && att !== "neutral" ? ` (내 설정: ${ATTITUDE_LABELS[att]})` : "";
    let reason: string;
    if (r.tooClose) reason = `${name} ${d} — 너무 가까워서 감점${mine}`;
    else if (r.contribution >= 0) reason = `${name} ${d} — ${t?.kind === "negative" ? "충분히 떨어져 있어요" : "가까워서 가산"}${mine}`;
    else reason = `${name} ${d} — ${t?.kind === "negative" ? "가까워서 감점" : "내 기준에 맞지 않아 감점"}${mine}`;
    return {
      typeId: r.typeId, domain: (t?.domain ?? "nuisance") as DomainId, label: name,
      contribution: r.contribution, distance_m: r.distance_m, tooClose: !!r.tooClose, reason,
    };
  });
  return {
    areaId: area.id,
    total: Math.round(res.score),
    domainScores: res.domainScores as AreaScore["domainScores"],
    factors,
    excluded: res.excluded,
    excludedReason: res.excluded && res.exclusion ? exclusionText(res.exclusion) : res.excluded ? "조건에 맞지 않아 제외" : undefined,
    warnings: res.warnings ?? [],
  };
}

/** 제외 지역은 맨 아래로, 나머지는 점수 내림차순. */
export function rankAreas(scores: AreaScore[]): AreaScore[] {
  return [...scores].sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.total - a.total);
}
