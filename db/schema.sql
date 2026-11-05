-- livable-place-finder DB schema (PostgreSQL 14+ / PostGIS 3+)
-- 계약: 생애단계/태도/도메인/kind/곡선 type 값은 기획팀(docs/data-contract.md, data/*.json)과 공유되는 고정값이다.
-- 개인화 항목(user_profiles)은 docs/design-draft.md 5번 전 항목 기준.
--
-- 재실행 안전: 모든 객체는 IF NOT EXISTS / OR REPLACE. 단, 이미 존재하는 테이블의 컬럼/제약 변경은
-- 반영되지 않는다(아직 운영 데이터가 없으므로 구버전 DB 는 DROP 후 재생성할 것. 운영 후에는 별도 마이그레이션 필요).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() (PG13 미만 호환용; 13+ 는 내장)

-- ---------- enums ----------
DO $$ BEGIN
  CREATE TYPE life_stage AS ENUM ('infant','school','young_single','middle_aged','senior');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 개별 시설 태도 5단계. 도메인 override 는 prefer/neutral/avoid 만 허용(user_domain_overrides CHECK).
DO $$ BEGIN
  CREATE TYPE attitude AS ENUM ('must','prefer','neutral','avoid','never');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE facility_domain AS ENUM
    ('transport','education','medical','convenience','nature','safety','environment','nuisance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE facility_kind AS ENUM ('positive','negative','bell');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE curve_type AS ENUM ('decay','bell','step');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'point': 점 시설 거리 곡선. 'metric': 점이 아닌 지표형(소음/대기/경사 등) - 중심점은 facilities, 값 모델은 area_metrics.
DO $$ BEGIN
  CREATE TYPE type_geometry AS ENUM ('point','metric');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transport_mode AS ENUM ('walk','transit','car','bicycle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE floor_pref AS ENUM ('high','low','any');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- curve_params 검증 ----------
-- decay: half_distance_m > 0
-- bell : 0 <= min_m <= peak_from_m <= peak_to_m <= max_m (max_m > 0)
-- step : within_m > 0
-- 숫자가 아니거나 키가 없으면 false (CHECK 가 NULL 로 통과하지 않도록 항상 boolean 반환).
CREATE OR REPLACE FUNCTION curve_params_valid(ct curve_type, p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v numeric; a numeric; b numeric; c numeric; d numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF ct = 'decay' THEN
    IF jsonb_typeof(p->'half_distance_m') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    RETURN COALESCE((p->>'half_distance_m')::numeric > 0, false);
  ELSIF ct = 'step' THEN
    IF jsonb_typeof(p->'within_m') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    RETURN COALESCE((p->>'within_m')::numeric > 0, false);
  ELSIF ct = 'bell' THEN
    FOREACH k IN ARRAY ARRAY['min_m','peak_from_m','peak_to_m','max_m'] LOOP
      IF jsonb_typeof(p->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    END LOOP;
    a := (p->>'min_m')::numeric; b := (p->>'peak_from_m')::numeric;
    c := (p->>'peak_to_m')::numeric; d := (p->>'max_m')::numeric;
    RETURN COALESCE(a >= 0 AND a <= b AND b <= c AND c <= d AND d > 0, false);
  END IF;
  RETURN false;
END $$;

-- ---------- data_sources (출처별 라이선스/약관 상태) ----------
-- 법적 판단을 담지 않는다. 기본값은 'UNVERIFIED' 이며 상용화 전 담당자가 약관 확인 후 채운다(db/ingest/README.md).
-- NULL = '확인 필요'.
CREATE TABLE IF NOT EXISTS data_sources (
  source              text PRIMARY KEY CHECK (source ~ '^[a-z][a-z0-9_.]*$'),
  name_ko             text NOT NULL,
  license             text NOT NULL DEFAULT 'UNVERIFIED',  -- 예: 'KOGL-1','KOGL-2','CC-BY-4.0','kakao-terms','UNVERIFIED'
  terms_url           text,
  commercial_use_ok   boolean,            -- NULL = 확인 필요
  attribution_text    text,               -- 출처표시 문구(필요 시)
  max_retention_days  integer CHECK (max_retention_days IS NULL OR max_retention_days > 0),  -- NULL = 제한 미확인/없음
  terms_checked_at    timestamptz,        -- NULL = 아직 약관 확인 안 함
  notes               text
);
INSERT INTO data_sources (source, name_ko, notes) VALUES
  ('kakao',      '카카오 로컬 API',      '저장/캐싱/상용 이용 범위 확인 필요'),
  ('data.go.kr', '공공데이터포털',        '데이터셋별 이용허락범위(KOGL 유형 등) 상이 - facilities.license 로 개별 기록'),
  ('seoul_open', '서울 열린데이터광장',   '서비스별 이용조건 확인 필요'),
  ('airkorea',   '에어코리아',            '대기질 지표 (area_metrics)')
ON CONFLICT (source) DO NOTHING;

-- ---------- facility_types ----------
CREATE TABLE IF NOT EXISTS facility_types (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*$'),
  name_ko        text NOT NULL,
  domain         facility_domain NOT NULL,
  kind           facility_kind   NOT NULL,
  geometry       type_geometry   NOT NULL DEFAULT 'point',   -- data/*.json 의 "geometry": "point"|"metric"
  radius_m       integer NOT NULL CHECK (radius_m > 0),
  curve_type     curve_type NOT NULL,
  curve_params   jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_modifiers jsonb,                                        -- 평일/주말/야간 보정. 구조는 기획팀 계약(NULL=보정 없음)
  source_hint    text,
  UNIQUE (id, geometry),                                  -- facilities/area_metrics 복합 FK 대상
  CONSTRAINT facility_types_kind_curve_chk CHECK ((kind = 'bell') = (curve_type = 'bell')),
  CONSTRAINT facility_types_curve_params_chk CHECK (curve_params_valid(curve_type, curve_params)),
  CONSTRAINT facility_types_time_modifiers_chk
    CHECK (time_modifiers IS NULL OR jsonb_typeof(time_modifiers) IN ('object','array'))
);
CREATE INDEX IF NOT EXISTS facility_types_domain_idx ON facility_types (domain);

-- ---------- facilities (점 시설) ----------
-- geometry='metric' 타입도 사전 계산된 격자/구역 중심점이면 여기에 점으로 적재할 수 있다(data-contract 기본 구현).
-- 값(value)을 가진 정밀 지표는 area_metrics 를 사용.
CREATE TABLE IF NOT EXISTS facilities (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type_id       text NOT NULL REFERENCES facility_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name          text,
  geom          geography(Point,4326) NOT NULL,
  source        text NOT NULL REFERENCES data_sources(source) ON UPDATE CASCADE,
  source_id     text,                                  -- 원천 시스템의 식별자 (upsert 키)
  license       text,                                  -- 데이터셋 단위 라이선스 override (NULL 이면 data_sources.license)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,                           -- 보관기한. NULL=무기한. trigger 가 data_sources.max_retention_days 로 채움
  -- 한국 영역(제주/마라도~DMZ/독도). 위경도 순서 뒤바뀜(lat,lng) 입력 방지.
  CONSTRAINT facilities_korea_bounds_chk CHECK (
    ST_X(geom::geometry) BETWEEN 124.0 AND 132.0 AND ST_Y(geom::geometry) BETWEEN 33.0 AND 38.9)
);
CREATE INDEX IF NOT EXISTS facilities_geom_gix ON facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS facilities_type_idx ON facilities (type_id);
CREATE INDEX IF NOT EXISTS facilities_expires_idx ON facilities (expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS facilities_source_uq
  ON facilities (source, source_id) WHERE source_id IS NOT NULL;
-- source_id 가 없는 행의 중복 방지: 같은 출처+유형+이름+약 1m 격자(geohash 10자)면 중복으로 본다.
CREATE UNIQUE INDEX IF NOT EXISTS facilities_nosrcid_uq
  ON facilities (source, type_id, COALESCE(name,''), ST_GeoHash(geom::geometry, 10)) WHERE source_id IS NULL;

-- ---------- area_metrics (점이 아닌 지표: 소음/미세먼지/경사/일조 등, facility_types.geometry='metric') ----------
CREATE TABLE IF NOT EXISTS area_metrics (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_type_id text NOT NULL,
  type_geometry  type_geometry NOT NULL DEFAULT 'metric' CHECK (type_geometry = 'metric'),
  geom           geography(Geometry,4326) NOT NULL,     -- 격자 중심점/폴리곤/측정소 점 등
  value          numeric NOT NULL,                      -- 단위는 metric 별 계약(기획팀)에 따름
  source         text NOT NULL REFERENCES data_sources(source) ON UPDATE CASCADE,
  source_id      text,
  license        text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  FOREIGN KEY (metric_type_id, type_geometry) REFERENCES facility_types (id, geometry) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT area_metrics_valid_geom_chk CHECK (ST_IsValid(geom::geometry)),
  CONSTRAINT area_metrics_korea_bounds_chk CHECK (
    ST_XMin(geom::geometry) >= 124.0 AND ST_XMax(geom::geometry) <= 132.0
    AND ST_YMin(geom::geometry) >= 33.0 AND ST_YMax(geom::geometry) <= 38.9)
);
CREATE INDEX IF NOT EXISTS area_metrics_geom_gix ON area_metrics USING GIST (geom);
CREATE INDEX IF NOT EXISTS area_metrics_type_idx ON area_metrics (metric_type_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS area_metrics_source_uq
  ON area_metrics (source, source_id) WHERE source_id IS NOT NULL;

-- 보관기한 자동 설정: expires_at 이 비어 있고 출처에 max_retention_days 가 있으면 updated_at + 보관일.
CREATE OR REPLACE FUNCTION set_expires_at() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d integer;
BEGIN
  IF NEW.expires_at IS NULL THEN
    SELECT max_retention_days INTO d FROM data_sources WHERE source = NEW.source;
    IF d IS NOT NULL THEN NEW.expires_at := COALESCE(NEW.updated_at, now()) + make_interval(days => d); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS facilities_expires_trg ON facilities;
CREATE TRIGGER facilities_expires_trg BEFORE INSERT OR UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION set_expires_at();
DROP TRIGGER IF EXISTS area_metrics_expires_trg ON area_metrics;
CREATE TRIGGER area_metrics_expires_trg BEFORE INSERT OR UPDATE ON area_metrics
  FOR EACH ROW EXECUTE FUNCTION set_expires_at();

-- 조회용: 만료되지 않은 행만 (질의는 이 뷰를 사용)
CREATE OR REPLACE VIEW facilities_active AS
  SELECT * FROM facilities WHERE expires_at IS NULL OR expires_at > now();
CREATE OR REPLACE VIEW area_metrics_active AS
  SELECT * FROM area_metrics WHERE expires_at IS NULL OR expires_at > now();

-- ---------- life_stage_weights ----------
-- weight: -2(강한 기피) .. +2(강한 선호), 0=무관. 모든 타입 x 5단계가 존재해야 함(load_seed.py 가 적재 전 검증).
CREATE TABLE IF NOT EXISTS life_stage_weights (
  type_id    text       NOT NULL REFERENCES facility_types(id) ON UPDATE CASCADE ON DELETE CASCADE,
  life_stage life_stage NOT NULL,
  weight     smallint   NOT NULL CHECK (weight BETWEEN -2 AND 2),
  PRIMARY KEY (type_id, life_stage)
);

-- ---------- user_profiles ----------
-- !! 개인정보 주의 !!
--  * workplace / family_home 는 개인 위치정보, health_notes 는 건강 관련 민감정보일 수 있다.
--    수집 동의(consented_at) 없이는 저장하지 못하도록 CHECK 로 막는다. 저장 시 암호화/접근통제/보관기간 정책 필요(법적 요건은 확인 필요).
--  * 삭제 요청: deleted_at 설정(소프트 삭제) 후 purge 쿼리(queries.sql)로 하드 삭제. 자식 테이블은 ON DELETE CASCADE.
--  * 점수 계산에는 좌표 원본이 필요하지 않다면 서버에 저장하지 말고 요청 시에만 전달하는 방식도 검토.
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid,                                   -- 로그인 사용자 식별자(익명 프로필이면 NULL)
  life_stage          life_stage NOT NULL,
  transport_mode      transport_mode NOT NULL DEFAULT 'transit',
  noise_sensitivity   smallint NOT NULL DEFAULT 2 CHECK (noise_sensitivity BETWEEN 0 AND 4),  -- 0 둔감 .. 4 매우 민감
  night_active        boolean  NOT NULL DEFAULT false,        -- 야간 활동 여부
  commute_max_min     smallint CHECK (commute_max_min IS NULL OR commute_max_min BETWEEN 1 AND 240),  -- 통근 허용 시간(분)
  workplace           geography(Point,4326),                  -- 개인 위치정보 (nullable)
  family_home         geography(Point,4326),                  -- 개인 위치정보 (nullable)
  urban_pref          smallint NOT NULL DEFAULT 2 CHECK (urban_pref BETWEEN 0 AND 4),            -- 0 한적/조용 .. 4 도심/활기
  floor_pref          floor_pref NOT NULL DEFAULT 'any',
  view_importance     smallint NOT NULL DEFAULT 2 CHECK (view_importance BETWEEN 0 AND 4),       -- 조망 중요도
  sunlight_importance smallint NOT NULL DEFAULT 2 CHECK (sunlight_importance BETWEEN 0 AND 4),   -- 일조 중요도
  has_pet             boolean  NOT NULL DEFAULT false,        -- 반려동물 유무
  household           jsonb,                                  -- 가구 구성 (예: {"adults":2,"children":[5],"seniors":0})
  health_notes        jsonb,                                  -- 건강 상태 (민감정보)
  life_plan           jsonb,                                  -- 향후 5~10년 생애 계획
  consented_at        timestamptz,                            -- 개인정보 수집·이용 동의 시각
  deleted_at          timestamptz,                            -- 삭제 요청 시각(소프트 삭제)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_json_obj_chk CHECK (
    (household    IS NULL OR jsonb_typeof(household)    = 'object') AND
    (health_notes IS NULL OR jsonb_typeof(health_notes) = 'object') AND
    (life_plan    IS NULL OR jsonb_typeof(life_plan)    = 'object')),
  CONSTRAINT user_profiles_consent_chk CHECK (
    consented_at IS NOT NULL OR
    (workplace IS NULL AND family_home IS NULL AND health_notes IS NULL)),
  CONSTRAINT user_profiles_korea_bounds_chk CHECK (
    (workplace   IS NULL OR (ST_X(workplace::geometry)   BETWEEN 124.0 AND 132.0 AND ST_Y(workplace::geometry)   BETWEEN 33.0 AND 38.9)) AND
    (family_home IS NULL OR (ST_X(family_home::geometry) BETWEEN 124.0 AND 132.0 AND ST_Y(family_home::geometry) BETWEEN 33.0 AND 38.9)))
);
CREATE INDEX IF NOT EXISTS user_profiles_owner_idx ON user_profiles (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_profiles_deleted_idx ON user_profiles (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS user_profiles_touch_trg ON user_profiles;
CREATE TRIGGER user_profiles_touch_trg BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- user_overrides (시설별 태도: must/prefer/neutral/avoid/never 전부 허용) ----------
CREATE TABLE IF NOT EXISTS user_overrides (
  profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  type_id    text NOT NULL REFERENCES facility_types(id) ON UPDATE CASCADE ON DELETE CASCADE,
  attitude   attitude NOT NULL,
  PRIMARY KEY (profile_id, type_id)
);

-- ---------- user_domain_overrides (도메인 일괄 태도: must/never 금지) ----------
CREATE TABLE IF NOT EXISTS user_domain_overrides (
  profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  domain     facility_domain NOT NULL,
  attitude   attitude NOT NULL,
  PRIMARY KEY (profile_id, domain),
  CONSTRAINT user_domain_overrides_attitude_chk CHECK (attitude IN ('prefer','neutral','avoid'))
);
