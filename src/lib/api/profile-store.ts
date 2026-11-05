// localStorage 저장소. 모든 접근은 try/catch, 로드 시 enum·시설 id 검증, 버전 키 마이그레이션.
import { ATTITUDE_LABELS, DOMAINS, getFacilityType, LIFE_STAGES } from "./config";
import {
  DEFAULT_ANSWERS, MAX_DOMAIN_PREFS,
  type Answers, type Commute, type Dislike, type Floor, type Health, type Household,
  type Noise, type Plan, type Style, type TransportMode,
} from "./profile";
import type { Attitude, DomainId, LifeStageId, TimeOfDay } from "./types";

export const STORE_VERSION = 2;
const KEY = `lpf.profile.v${STORE_VERSION}`;
const LEGACY_KEYS = ["lpf.profile.v1"];

export type DomainMultipliers = Record<DomainId, number>;
export const defaultMultipliers = (): DomainMultipliers =>
  Object.fromEntries(DOMAINS.map((d) => [d.id, 1])) as DomainMultipliers;

export interface Stored {
  v: number;
  answers: Answers | null;
  /** 결과 화면에서 수정한 시설별 태도 (온보딩 결과 위에 덮어씀) */
  edits: Record<string, Attitude>;
  multipliers: DomainMultipliers;
  timeOfDay: TimeOfDay;
}
export const emptyStored = (): Stored => ({ v: STORE_VERSION, answers: null, edits: {}, multipliers: defaultMultipliers(), timeOfDay: "weekday" });

// ---- 검증 유틸 ----
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);
const listOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is T => allowed.includes(x as T)))) : [];
const yn = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const ATT = Object.keys(ATTITUDE_LABELS) as Attitude[];
const DOM = DOMAINS.map((d) => d.id);
const STAGES = LIFE_STAGES.map((s) => s.id) as LifeStageId[];
const known = (id: unknown): id is string => typeof id === "string" && !!getFacilityType(id);

export function sanitizeAnswers(raw: unknown): Answers {
  const a: Answers = { ...DEFAULT_ANSWERS, household: [], health: [], plans: [], domainPrefs: [], must: [], dislike: {} };
  if (!isObj(raw)) return a;
  a.lifeStage = oneOf<LifeStageId>(raw.lifeStage, STAGES);
  a.household = listOf<Household>(raw.household, ["single", "couple", "kids", "parents"]);
  a.health = listOf<Health>(raw.health, ["mobility", "chronic", "respiratory"]);
  a.plans = listOf<Plan>(raw.plans, ["childbirth", "schooling", "retire", "mobile"]);
  a.domainPrefs = listOf<DomainId>(raw.domainPrefs, DOM).filter((d) => d !== "nuisance").slice(0, MAX_DOMAIN_PREFS);
  a.transport = oneOf<TransportMode>(raw.transport, ["walk", "transit", "car", "bike"]);
  a.commute = oneOf<Commute>(raw.commute, ["short", "medium", "any"]);
  a.noise = oneOf<Noise>(raw.noise, ["low", "mid", "high"]);
  a.style = oneOf<Style>(raw.style, ["urban", "quiet"]);
  a.floor = oneOf<Floor>(raw.floor, ["high", "low"]);
  a.sunView = yn(raw.sunView); a.nightLife = yn(raw.nightLife); a.pet = yn(raw.pet);
  a.outdoor = yn(raw.outdoor); a.remote = yn(raw.remote); a.eldercare = yn(raw.eldercare);
  a.religious = oneOf<Dislike>(raw.religious, ["avoid", "never"]);
  if (isObj(raw.dislike)) for (const [id, v] of Object.entries(raw.dislike)) {
    const d = oneOf<Dislike>(v, ["avoid", "never"]);
    if (known(id) && d) a.dislike[id] = d;
  }
  a.must = Array.isArray(raw.must) ? Array.from(new Set(raw.must.filter(known))) : [];
  a.must = a.must.filter((id) => a.dislike[id] !== "never"); // must + never 동시 지정 차단 (never 우선)
  return a;
}

function sanitizeStored(raw: unknown): Stored {
  const s = emptyStored();
  if (!isObj(raw)) return s;
  s.answers = raw.answers ? sanitizeAnswers(raw.answers) : null;
  if (isObj(raw.edits)) for (const [id, v] of Object.entries(raw.edits)) {
    const att = oneOf<Attitude>(v, ATT);
    if (known(id) && att) s.edits[id] = att;
  }
  if (isObj(raw.multipliers)) for (const d of DOM) {
    const n = raw.multipliers[d];
    if (typeof n === "number" && Number.isFinite(n)) s.multipliers[d] = Math.min(2, Math.max(0, n));
  }
  s.timeOfDay = oneOf<TimeOfDay>(raw.timeOfDay, ["weekday", "weekend", "night"]) ?? "weekday";
  return s;
}

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** 구버전(v1: lifeStage + 옛 시설 id) -> v2. 시설 id 체계가 달라 생애단계만 승계한다. */
function migrateLegacy(ls: Storage): Stored | null {
  for (const k of LEGACY_KEYS) {
    try {
      const txt = ls.getItem(k);
      if (!txt) continue;
      const old = JSON.parse(txt) as unknown;
      ls.removeItem(k);
      const s = emptyStored();
      const stage = isObj(old) ? oneOf<LifeStageId>(old.lifeStage, STAGES) : null;
      if (stage) s.answers = { ...DEFAULT_ANSWERS, lifeStage: stage };
      return s;
    } catch { try { ls.removeItem(k); } catch { /* ignore */ } }
  }
  return null;
}

export function loadStored(): Stored {
  const ls = storage();
  if (!ls) return emptyStored();
  try {
    const txt = ls.getItem(KEY);
    if (txt) return sanitizeStored(JSON.parse(txt));
    const migrated = migrateLegacy(ls);
    if (migrated) { saveStored(migrated); return migrated; }
  } catch { /* 손상된 데이터는 무시하고 초기화 */ }
  return emptyStored();
}
export function saveStored(s: Stored): boolean {
  const ls = storage();
  if (!ls) return false;
  try { ls.setItem(KEY, JSON.stringify({ ...s, v: STORE_VERSION })); return true; } catch { return false; }
}
export function updateStored(patch: Partial<Stored>): boolean { return saveStored({ ...loadStored(), ...patch }); }
