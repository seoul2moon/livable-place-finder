-- DB 검증 스크립트. 전체가 하나의 트랜잭션이며 마지막에 ROLLBACK 하므로 DB 에 흔적을 남기지 않는다.
-- 전제: schema.sql 적용 + load_seed.py 로 data/*.json 적재 완료.
-- 실행: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify.sql
-- 각 부정 테스트는 'PASS'/'FAIL' NOTICE 로 출력된다. FAIL 이 하나라도 있으면 마지막에 예외를 던진다.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _results (label text, ok boolean, detail text);

-- stmt 실행이 want(SQLSTATE)로 실패해야 PASS
CREATE FUNCTION pg_temp.expect_fail(label text, stmt text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO _results VALUES (label, false, '오류가 발생하지 않음');
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = want THEN INSERT INTO _results VALUES (label, true, SQLSTATE || ' ' || SQLERRM);
  ELSE INSERT INTO _results VALUES (label, false, '다른 오류 ' || SQLSTATE || ' ' || SQLERRM); END IF;
END $$;

-- stmt 실행이 성공해야 PASS
CREATE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO _results VALUES (label, true, 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _results VALUES (label, false, SQLSTATE || ' ' || SQLERRM);
END $$;

-- ===== 1. facility_types 제약 =====
SELECT pg_temp.expect_fail('types: kind=positive 인데 curve=bell 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad1','x','transport','positive',500,'bell','{"min_m":1,"peak_from_m":2,"peak_to_m":3,"max_m":4}')$q$, '23514');
SELECT pg_temp.expect_fail('types: kind=bell 인데 curve=decay 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad2','x','transport','bell',500,'decay','{"half_distance_m":100}')$q$, '23514');
SELECT pg_temp.expect_fail('types: kind=negative 인데 curve=bell 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad3','x','nuisance','negative',500,'bell','{"min_m":1,"peak_from_m":2,"peak_to_m":3,"max_m":4}')$q$, '23514');
SELECT pg_temp.expect_fail('types: bell min_m>peak_from_m 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad4','x','transport','bell',500,'bell','{"min_m":300,"peak_from_m":100,"peak_to_m":200,"max_m":400}')$q$, '23514');
SELECT pg_temp.expect_fail('types: bell peak_to_m>max_m 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad5','x','transport','bell',500,'bell','{"min_m":1,"peak_from_m":2,"peak_to_m":9,"max_m":4}')$q$, '23514');
SELECT pg_temp.expect_fail('types: bell 키 누락 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad6','x','transport','bell',500,'bell','{"min_m":1,"peak_from_m":2,"max_m":4}')$q$, '23514');
SELECT pg_temp.expect_fail('types: decay half_distance_m 누락/문자열 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad7','x','transport','positive',500,'decay','{"half_distance_m":"abc"}')$q$, '23514');
SELECT pg_temp.expect_fail('types: decay half_distance_m<=0 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad8','x','transport','positive',500,'decay','{"half_distance_m":0}')$q$, '23514');
SELECT pg_temp.expect_fail('types: decay half_distance_m 키 자체가 없으면 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad11','x','transport','positive',500,'decay','{}')$q$, '23514');
SELECT pg_temp.expect_fail('types: step within_m 누락 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_bad9','x','transport','positive',500,'step','{}')$q$, '23514');
SELECT pg_temp.expect_fail('types: time_modifiers 가 스칼라면 거부',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params,time_modifiers)
     VALUES ('t_bad10','x','transport','positive',500,'decay','{"half_distance_m":100}','5')$q$, '23514');
SELECT pg_temp.expect_ok('types: step 유형 정상 삽입(positive)',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,radius_m,curve_type,curve_params)
     VALUES ('t_step','x','transport','positive',500,'step','{"within_m":300}')$q$);
SELECT pg_temp.expect_ok('types: metric geometry 정상 삽입',
  $q$INSERT INTO facility_types (id,name_ko,domain,kind,geometry,radius_m,curve_type,curve_params)
     VALUES ('t_metric','x','environment','negative','metric',500,'decay','{"half_distance_m":100}')$q$);

-- ===== 2. facilities 제약 =====
SELECT pg_temp.expect_fail('facilities: 잘못된 위도(lat=137.5) 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('subway_station','bad-lat',ST_SetSRID(ST_MakePoint(127.0,137.5),4326)::geography,'kakao','bad1')$q$, '23514');
SELECT pg_temp.expect_fail('facilities: lat/lng 뒤바뀜 (lng=37.5,lat=127.0) 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('subway_station','swapped',ST_SetSRID(ST_MakePoint(37.5,127.0),4326)::geography,'kakao','bad2')$q$, '23514');
SELECT pg_temp.expect_fail('facilities: 한국 밖 좌표(도쿄) 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('subway_station','tokyo',ST_SetSRID(ST_MakePoint(139.69,35.69),4326)::geography,'kakao','bad3')$q$, '23514');
SELECT pg_temp.expect_ok('facilities: metric 타입(cctv) 중심점 적재 허용(contract 기본 구현)',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('cctv','x',ST_SetSRID(ST_MakePoint(127.0,37.5),4326)::geography,'seoul_open','ok4')$q$);
SELECT pg_temp.expect_fail('facilities: 없는 타입 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('no_such_type','x',ST_SetSRID(ST_MakePoint(127.0,37.5),4326)::geography,'kakao','bad5')$q$, '23503');
SELECT pg_temp.expect_fail('facilities: 미등록 source 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('subway_station','x',ST_SetSRID(ST_MakePoint(127.0,37.5),4326)::geography,'unknown_src','bad6')$q$, '23503');

-- source_id 중복 / NULL 중복
SELECT pg_temp.expect_ok('facilities: 최초 삽입(source_id 있음)',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('park_neighborhood','p1',ST_SetSRID(ST_MakePoint(127.1,37.5),4326)::geography,'kakao','dup1')$q$);
SELECT pg_temp.expect_fail('facilities: (source,source_id) 중복 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source,source_id)
     VALUES ('park_neighborhood','p1',ST_SetSRID(ST_MakePoint(127.1,37.5),4326)::geography,'kakao','dup1')$q$, '23505');
SELECT pg_temp.expect_ok('facilities: 최초 삽입(source_id NULL)',
  $q$INSERT INTO facilities (type_id,name,geom,source)
     VALUES ('park_neighborhood','p2',ST_SetSRID(ST_MakePoint(127.2,37.5),4326)::geography,'data.go.kr')$q$);
SELECT pg_temp.expect_fail('facilities: source_id NULL 동일 출처+유형+이름+좌표 중복 거부',
  $q$INSERT INTO facilities (type_id,name,geom,source)
     VALUES ('park_neighborhood','p2',ST_SetSRID(ST_MakePoint(127.2,37.5),4326)::geography,'data.go.kr')$q$, '23505');
SELECT pg_temp.expect_ok('facilities: source_id NULL 이라도 좌표가 다르면 허용',
  $q$INSERT INTO facilities (type_id,name,geom,source)
     VALUES ('park_neighborhood','p2',ST_SetSRID(ST_MakePoint(127.3,37.5),4326)::geography,'data.go.kr')$q$);

-- ===== 3. area_metrics =====
SELECT pg_temp.expect_ok('area_metrics: metric 타입(air_quality) 정상 삽입',
  $q$INSERT INTO area_metrics (metric_type_id,geom,value,source,source_id)
     VALUES ('air_quality',ST_SetSRID(ST_MakePoint(127.03,37.50),4326)::geography,32.5,'airkorea','st1')$q$);
SELECT pg_temp.expect_ok('area_metrics: 폴리곤 geometry 허용',
  $q$INSERT INTO area_metrics (metric_type_id,geom,value,source,source_id)
     VALUES ('air_quality',ST_GeomFromText('POLYGON((127.0 37.4,127.1 37.4,127.1 37.5,127.0 37.5,127.0 37.4))',4326)::geography,40,'airkorea','poly1')$q$);
SELECT pg_temp.expect_fail('area_metrics: point 타입(subway_station) 거부',
  $q$INSERT INTO area_metrics (metric_type_id,geom,value,source)
     VALUES ('subway_station',ST_SetSRID(ST_MakePoint(127.0,37.5),4326)::geography,1,'airkorea')$q$, '23503');
SELECT pg_temp.expect_fail('area_metrics: 한국 밖 좌표 거부',
  $q$INSERT INTO area_metrics (metric_type_id,geom,value,source)
     VALUES ('air_quality',ST_SetSRID(ST_MakePoint(139.69,35.69),4326)::geography,1,'airkorea')$q$, '23514');

-- ===== 4. 보관기한(expires_at) / 뷰 =====
UPDATE data_sources SET max_retention_days = 30 WHERE source = 'kakao';
INSERT INTO facilities (type_id,name,geom,source,source_id)
  VALUES ('park_neighborhood','ttl',ST_SetSRID(ST_MakePoint(127.4,37.5),4326)::geography,'kakao','ttl1');
INSERT INTO _results SELECT 'expires_at: kakao 보관일 설정 시 trigger 가 자동 채움',
  expires_at IS NOT NULL AND expires_at > now() + interval '29 days', expires_at::text
  FROM facilities WHERE source_id = 'ttl1';
INSERT INTO facilities (type_id,name,geom,source,source_id,expires_at)
  VALUES ('park_neighborhood','expired',ST_SetSRID(ST_MakePoint(127.5,37.5),4326)::geography,'kakao','ttl2', now() - interval '1 day');
INSERT INTO _results SELECT 'facilities_active 뷰: 만료행 제외', count(*) = 0, count(*)::text
  FROM facilities_active WHERE source_id = 'ttl2';

-- ===== 5. life_stage_weights =====
SELECT pg_temp.expect_fail('weights: 범위 밖(3) 거부',
  $q$UPDATE life_stage_weights SET weight = 3 WHERE type_id='subway_station' AND life_stage='infant'$q$, '23514');
INSERT INTO _results SELECT 'weights: 모든 타입 x 5단계 존재', count(*) = 0, count(*)::text
  FROM facility_types t CROSS JOIN unnest(enum_range(NULL::life_stage)) s(ls)
  LEFT JOIN life_stage_weights w ON w.type_id=t.id AND w.life_stage=s.ls
  WHERE w.type_id IS NULL AND t.id NOT LIKE 't\_%';   -- 위에서 만든 임시 t_* 타입 제외

-- ===== 6. user_profiles / overrides =====
SELECT pg_temp.expect_fail('profiles: noise_sensitivity=5 거부',
  $q$INSERT INTO user_profiles (life_stage,noise_sensitivity) VALUES ('school',5)$q$, '23514');
SELECT pg_temp.expect_fail('profiles: urban_pref=5 거부',
  $q$INSERT INTO user_profiles (life_stage,urban_pref) VALUES ('school',5)$q$, '23514');
SELECT pg_temp.expect_fail('profiles: 동의 없이 직장 위치 저장 거부',
  $q$INSERT INTO user_profiles (life_stage,workplace) VALUES ('school',ST_SetSRID(ST_MakePoint(127.0,37.5),4326)::geography)$q$, '23514');
SELECT pg_temp.expect_fail('profiles: 동의 없이 health_notes 저장 거부',
  $q$INSERT INTO user_profiles (life_stage,health_notes) VALUES ('senior','{"mobility":"limited"}')$q$, '23514');
SELECT pg_temp.expect_fail('profiles: 한국 밖 직장 좌표 거부',
  $q$INSERT INTO user_profiles (life_stage,workplace,consented_at) VALUES ('school',ST_SetSRID(ST_MakePoint(139.69,35.69),4326)::geography, now())$q$, '23514');
SELECT pg_temp.expect_fail('profiles: household 가 배열이면 거부',
  $q$INSERT INTO user_profiles (life_stage,household) VALUES ('school','[1,2]')$q$, '23514');
SELECT pg_temp.expect_fail('profiles: floor_pref 잘못된 enum 거부',
  $q$INSERT INTO user_profiles (life_stage,floor_pref) VALUES ('school','middle')$q$, '22P02');
SELECT pg_temp.expect_ok('profiles: 전 항목 채운 정상 프로필(동의 포함)',
  $q$INSERT INTO user_profiles (life_stage,transport_mode,noise_sensitivity,night_active,commute_max_min,workplace,family_home,
       urban_pref,floor_pref,view_importance,sunlight_importance,household,health_notes,life_plan,has_pet,consented_at,owner_id)
     VALUES ('school','walk',4,true,45,ST_SetSRID(ST_MakePoint(127.03,37.50),4326)::geography,
       ST_SetSRID(ST_MakePoint(126.9,37.55),4326)::geography,1,'high',3,4,'{"adults":2,"children":[9]}',
       '{"mobility":"ok"}','{"move_in_years":5}',true,now(),gen_random_uuid())$q$);

-- 질의 테스트용 프로필 (school): subway_station=must, waste_incinerator=never, 도메인 nuisance=avoid
INSERT INTO user_profiles (life_stage) VALUES ('school');
SELECT id AS profile_id FROM user_profiles WHERE consented_at IS NULL ORDER BY created_at DESC, id LIMIT 1 \gset
INSERT INTO user_overrides (profile_id,type_id,attitude) VALUES
  (:'profile_id','subway_station','must'), (:'profile_id','waste_incinerator','never'), (:'profile_id','landfill','prefer');
INSERT INTO user_domain_overrides (profile_id,domain,attitude) VALUES (:'profile_id','nuisance','avoid');
SELECT pg_temp.expect_fail('domain_overrides: must 거부',
  format($q$INSERT INTO user_domain_overrides (profile_id,domain,attitude) VALUES (%L,'transport','must')$q$, :'profile_id'), '23514');
SELECT pg_temp.expect_fail('domain_overrides: never 거부',
  format($q$INSERT INTO user_domain_overrides (profile_id,domain,attitude) VALUES (%L,'transport','never')$q$, :'profile_id'), '23514');
SELECT pg_temp.expect_fail('domain_overrides: 같은 도메인 중복 거부',
  format($q$INSERT INTO user_domain_overrides (profile_id,domain,attitude) VALUES (%L,'nuisance','prefer')$q$, :'profile_id'), '23505');
SELECT pg_temp.expect_ok('user_overrides: never 허용',
  format($q$INSERT INTO user_overrides (profile_id,type_id,attitude) VALUES (%L,'prison_detention','never')$q$, :'profile_id'));

-- ===== 7. 질의 테스트용 샘플 시설 (후보1=강남 127.0276,37.4979 / 후보2=시청 126.9780,37.5665 / 후보3=부산) =====
INSERT INTO facilities (type_id,name,geom,source,source_id)
SELECT v.t, v.n, ST_SetSRID(ST_MakePoint(v.lng,v.lat),4326)::geography, 'data.go.kr', 'vq_'||v.n FROM (VALUES
  ('subway_station',   'sub_gangnam',  127.0280, 37.4985),
  ('elementary_school','sch_gangnam',  127.0300, 37.4990),
  ('general_hospital', 'hos_gangnam',  127.0500, 37.5000),
  ('waste_incinerator','inc_gangnam',  127.0290, 37.4990),
  ('subway_station',   'sub_cityhall', 126.9770, 37.5640)
) v(t,n,lng,lat);

-- 위 결과를 요약
INSERT INTO _results SELECT 'query5(must/never): 통과 후보가 2번뿐',
  (SELECT array_agg(cid ORDER BY cid) FROM (
     WITH cand(cid,lng,lat) AS (VALUES (1,127.0276,37.4979),(2,126.9780,37.5665),(3,129.0756,35.1796)),
     req AS (SELECT o.type_id,o.attitude,t.radius_m FROM user_overrides o JOIN facility_types t ON t.id=o.type_id 
             WHERE o.profile_id=:'profile_id' AND o.attitude IN ('must','never')),
     chk AS (SELECT c.cid,r.type_id,r.attitude,EXISTS (SELECT 1 FROM facilities_active f WHERE f.type_id=r.type_id
             AND ST_DWithin(f.geom,ST_SetSRID(ST_MakePoint(c.lng,c.lat),4326)::geography,r.radius_m)) has_fac FROM cand c CROSS JOIN req r)
     SELECT c.cid FROM cand c LEFT JOIN chk k USING (cid) GROUP BY c.cid
     HAVING COUNT(*) FILTER (WHERE (k.attitude='never' AND k.has_fac) OR (k.attitude='must' AND NOT k.has_fac))=0) q) = ARRAY[2],
  'expected {2}';

\echo
\echo '===== queries.sql 실행 (샘플 데이터 위) ====='
\ir queries.sql

\echo
\echo '===== 검증 결과 ====='
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label, left(detail, 90) AS detail FROM _results ORDER BY ok, label;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM _results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM _results WHERE NOT ok) THEN RAISE EXCEPTION 'verify.sql: FAIL 항목 있음'; END IF; END $$;

ROLLBACK;
