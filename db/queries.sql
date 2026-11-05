-- 참고용 질의 모음 (psql 에서 실행: psql "$DATABASE_URL" -f db/queries.sql  -- 먼저 아래 \set 값을 확인)
-- 좌표계: WGS84 (lng=경도, lat=위도). 거리 단위 m (geography).
-- 앱 코드에서는 psql 변수(:lng 등) 대신 바인드 파라미터($1, $2 ...)로 치환한다.
-- 조회는 만료행을 제외하는 facilities_active / area_metrics_active 뷰를 사용한다.

\set lng 127.0276
\set lat 37.4979
\set type_id subway_station
\set metric_type_id air_quality
-- :profile_id 는 존재하는 user_profiles.id (uuid). 예) \set profile_id '00000000-0000-0000-0000-000000000000'
-- (쿼리 4~6 실행 전에 반드시 지정. 미지정이면 psql 이 구문오류를 낸다)

-- 1) 후보 지점 반경 내 점 시설 (시설 종류별 radius_m 사용) + 거리
SELECT f.id, f.type_id, f.name,
       ST_Distance(f.geom, p.pt) AS dist_m
FROM (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS pt) p
JOIN facility_types t ON true
JOIN facilities_active f ON f.type_id = t.id
                        AND ST_DWithin(f.geom, p.pt, t.radius_m)   -- GiST 인덱스 사용
ORDER BY f.type_id, dist_m;

-- 2) 종류별 최소 거리 (반경 내에 없으면 행 없음 = 시설 없음으로 처리)
SELECT f.type_id, MIN(ST_Distance(f.geom, p.pt)) AS min_dist_m, COUNT(*) AS cnt
FROM (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS pt) p
JOIN facility_types t ON true
JOIN facilities_active f ON f.type_id = t.id AND ST_DWithin(f.geom, p.pt, t.radius_m)
GROUP BY f.type_id;

-- 3) 특정 종류의 가장 가까운 시설 1건 (KNN; 반경 제한 없음, geography 는 <-> 지원)
SELECT f.id, f.name, ST_Distance(f.geom, p.pt) AS dist_m
FROM (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS pt) p,
     facilities_active f
WHERE f.type_id = :'type_id'
ORDER BY f.geom <-> p.pt
LIMIT 1;

-- 3b) 면/격자 지표(area_metrics) 값: 후보 지점에서 radius_m 내 가장 가까운 지표 1건 (metric 타입 전용)
SELECT m.id, m.value, ST_Distance(m.geom, p.pt) AS dist_m, m.updated_at
FROM (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS pt) p
JOIN facility_types t ON t.id = :'metric_type_id' AND t.geometry = 'metric'
JOIN area_metrics_active m ON m.metric_type_id = t.id AND ST_DWithin(m.geom, p.pt, t.radius_m)
ORDER BY m.geom <-> p.pt
LIMIT 1;

-- 4) 프로필에 적용할 유효 태도/가중치 (파라미터: :profile_id = user_profiles.id uuid)
--    태도 우선순위: 시설별 override > 도메인 override(prefer/neutral/avoid) > neutral
--    must/never 는 시설별 override 에서만 나올 수 있다(도메인 override 는 CHECK 로 금지).
SELECT t.id AS type_id, t.domain, t.geometry, w.weight,
       o.attitude  AS type_override,
       d.attitude  AS domain_override,
       COALESCE(o.attitude, d.attitude, 'neutral'::attitude) AS effective_attitude
FROM user_profiles up
JOIN facility_types t ON true
LEFT JOIN life_stage_weights w ON w.type_id = t.id AND w.life_stage = up.life_stage
LEFT JOIN user_overrides o ON o.profile_id = up.id AND o.type_id = t.id
LEFT JOIN user_domain_overrides d ON d.profile_id = up.id AND d.domain = t.domain
WHERE up.id = :'profile_id' AND up.deleted_at IS NULL;

-- 5) must/never 하드 필터: 후보 지점 목록 중 통과한 지점만 + 탈락 사유
--    - never: 해당 타입 시설이 radius_m 안에 하나라도 있으면 탈락 (never_hit)
--    - must : radius_m 안에 하나도 없으면 탈락 (must_missing)
--    - metric 타입은 중심점이 facilities 에 적재된 경우에만 판정된다(area_metrics 값 기반 판정은 임계값 정의 후 별도)
--    파라미터: cand 의 VALUES 목록(후보 지점 id,lng,lat)과 :profile_id. 앱에서는 unnest($1::int[], $2::float8[], $3::float8[]) 권장.
WITH cand(cid, lng, lat) AS (
  VALUES (1, 127.0276, 37.4979), (2, 126.9780, 37.5665), (3, 129.0756, 35.1796)
),
req AS (
  SELECT o.type_id, o.attitude, t.radius_m
  FROM user_overrides o
  JOIN facility_types t ON t.id = o.type_id
  WHERE o.profile_id = :'profile_id' AND o.attitude IN ('must','never')
),
chk AS (
  SELECT c.cid, r.type_id, r.attitude,
         EXISTS (SELECT 1 FROM facilities_active f
                 WHERE f.type_id = r.type_id
                   AND ST_DWithin(f.geom, ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography, r.radius_m)) AS has_fac
  FROM cand c CROSS JOIN req r
)
SELECT c.cid, c.lng, c.lat,
       COALESCE(array_agg(k.type_id) FILTER (WHERE k.attitude = 'never' AND k.has_fac),     '{}') AS never_hit,
       COALESCE(array_agg(k.type_id) FILTER (WHERE k.attitude = 'must'  AND NOT k.has_fac), '{}') AS must_missing
FROM cand c LEFT JOIN chk k USING (cid)
GROUP BY c.cid, c.lng, c.lat
HAVING COUNT(*) FILTER (WHERE (k.attitude = 'never' AND k.has_fac) OR (k.attitude = 'must' AND NOT k.has_fac)) = 0
ORDER BY c.cid;
-- 탈락 사유까지 보려면 마지막 HAVING 절을 제거하면 전 후보의 never_hit/must_missing 이 나온다.

-- 6) 시설유형별 "최소 거리" 조건으로 후보 지점 필터링
--    예: 지하철역 800m 이내 AND 초등학교 600m 이내 AND 종합병원 3km 이내 인 지점만 남김.
--    각 (후보, 조건타입)마다 KNN 최근접 1건만 조회하므로 GiST 인덱스를 탄다. 시설이 아예 없는 타입은 거리 NULL = 탈락.
--    파라미터: cand(후보 지점) 와 want(type_id, max_m) 를 앱에서 VALUES/unnest 로 전달.
--    (프로필의 must 타입을 want 로 쓰려면 max_m = facility_types.radius_m 사용)
WITH cand(cid, lng, lat) AS (
  VALUES (1, 127.0276, 37.4979), (2, 126.9780, 37.5665), (3, 129.0756, 35.1796)
),
want(type_id, max_m) AS (
  VALUES ('subway_station', 800), ('elementary_school', 600), ('general_hospital', 3000)
),
nearest AS (
  SELECT c.cid, w.type_id, w.max_m, n.dist_m
  FROM cand c CROSS JOIN want w
  LEFT JOIN LATERAL (
    SELECT ST_Distance(f.geom, p.pt) AS dist_m
    FROM (SELECT ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography AS pt) p, facilities_active f
    WHERE f.type_id = w.type_id
    ORDER BY f.geom <-> p.pt
    LIMIT 1
  ) n ON true
)
SELECT cid,
       jsonb_object_agg(type_id, round(dist_m::numeric, 1)) AS nearest_m
FROM nearest
GROUP BY cid
HAVING bool_and(dist_m IS NOT NULL AND dist_m <= max_m)
ORDER BY cid;

-- 7) 데이터 점검: 가중치가 모든 타입 x 5단계에 있는지 (결과 0행이어야 정상)
SELECT t.id AS type_id, s.life_stage
FROM facility_types t CROSS JOIN unnest(enum_range(NULL::life_stage)) AS s(life_stage)
LEFT JOIN life_stage_weights w ON w.type_id = t.id AND w.life_stage = s.life_stage
WHERE w.type_id IS NULL;

-- 8) 운영 정리 (주기 작업; 보관기한/삭제요청 정책은 법무 확인 후 기간 확정)
-- 8a) 보관기한 만료 시설/지표 삭제
--   DELETE FROM facilities   WHERE expires_at IS NOT NULL AND expires_at <= now();
--   DELETE FROM area_metrics WHERE expires_at IS NOT NULL AND expires_at <= now();
-- 8b) 삭제 요청된 프로필 하드 삭제 (user_overrides/user_domain_overrides 는 CASCADE). 유예기간 예: 30일
--   DELETE FROM user_profiles WHERE deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days';
