export type LifeStage = "infant" | "school" | "young_single" | "middle_aged" | "senior";
export type Attitude = "must" | "prefer" | "neutral" | "avoid" | "never";
export type DomainAttitude = "prefer" | "neutral" | "avoid";
export type TimeOfDay = "weekday" | "weekend" | "night";
export type FacilityKind = "positive" | "negative" | "bell";

export const LIFE_STAGES: readonly LifeStage[] = ["infant", "school", "young_single", "middle_aged", "senior"];
export const ATTITUDES: readonly Attitude[] = ["must", "prefer", "neutral", "avoid", "never"];
export const DOMAIN_ATTITUDES: readonly DomainAttitude[] = ["prefer", "neutral", "avoid"];
export const TIMES_OF_DAY: readonly TimeOfDay[] = ["weekday", "weekend", "night"];
export const FACILITY_KINDS: readonly FacilityKind[] = ["positive", "negative", "bell"];

export interface DecayParams { half_distance_m: number }
export interface BellParams { min_m: number; peak_from_m: number; peak_to_m: number; max_m: number }
/** `within_m` wins; `threshold_m` is read for backward compatibility. Default: radius_m. */
export interface StepParams { within_m?: number; threshold_m?: number }

export type Curve =
  | { type: "decay"; params: DecayParams }
  | { type: "bell"; params: BellParams }
  | { type: "step"; params?: StepParams };

export interface FacilityType {
  id: string;
  name_ko?: string;
  domain: string;
  kind: FacilityKind;
  radius_m: number;
  curve: Curve;
  /** "metric" = area-level metric, not a point facility: ignored by this engine. Default "point". */
  geometry?: string;
  /** Optional congestion/time-of-day multiplier (default 1). */
  time_modifiers?: Partial<Record<TimeOfDay, number>>;
}

/** { type_id: { stage: -2..2 } } */
export type WeightsTable = Record<string, Partial<Record<LifeStage, number>>>;

export interface LatLng { lat: number; lng: number }
export interface Facility extends LatLng { typeId: string }

export interface Profile {
  lifeStage: LifeStage;
  /** facility typeId -> attitude (takes precedence over domainOverrides). */
  overrides?: Record<string, Attitude>;
  /** domain -> prefer|neutral|avoid; same rule as facility prefer/avoid applied to every facility of that domain. */
  domainOverrides?: Record<string, DomainAttitude>;
  /** domain -> multiplier 0..2 (default 1) applied to that domain's contributions. */
  domainMultipliers?: Record<string, number>;
  timeOfDay?: TimeOfDay;
}

export interface ScoreConfig {
  types: FacilityType[] | Record<string, FacilityType>;
  weights: WeightsTable;
  /** Fraction of total positive weight regarded as "full score" (default 0.5). */
  saturation?: number;
  /** Multiplier for negative contributions (default 1.75). */
  penalty_scale?: number;
  /** true: invalid profile input (unknown override id, ...) throws instead of producing `warnings`. */
  strict?: boolean;
}

export interface Reason {
  typeId: string;
  /** score points (after penalty_scale and domain multiplier) */
  contribution: number;
  /** nearest facility of this type, metres (rounded) */
  distance_m: number;
  /** bell type with nearest facility closer than min_m */
  tooClose?: boolean;
}

export interface Exclusion {
  code: "never_hit" | "must_missing";
  typeId: string;
  /** nearest facility of that type (omitted if none exist) */
  distance_m?: number;
}

export interface ScoreResult {
  score: number; // 0..100, 50 = neutral
  excluded: boolean;
  exclusion?: Exclusion;
  reasons: Reason[]; // sorted by |contribution| desc
  domainScores: Record<string, number>; // 0..100, 50 = neutral / no facilities
  warnings: string[];
}
