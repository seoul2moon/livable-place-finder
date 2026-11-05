# DB 검증 기록

- 일시: 2026-11-05 (KST)
- 환경: PostgreSQL 16.15 + PostGIS 3 (Ubuntu 패키지), `/tmp/pgv` 임시 클러스터(소켓 전용). psycopg 3.
- 대상 데이터: `data/facility_types.json` 98개 타입(point 87 / metric 11, bell 12) x 5단계 = `data/weights.json` 490건.
  마지막 적재 시점의 sha256 앞 16자: facility_types `01b3eed05e8dad98`, weights `a8d1bd75abdcdf52` (기획팀 갱신 중이어서 최종 단계에서 한 번 더 적재해 변경 없음 확인).

## 절차와 결과
| # | 항목 | 결과 |
|---|---|---|
| 1 | 빈 DB 에 `schema.sql` 적용, 재적용(멱등) | OK, 오류 없음 |
| 2 | `load_seed.py --schema` -> 98 types / 490 weights 적재, 재실행 | OK (멱등, 건수 불변) |
| 3 | `load_seed.py --check` (DB 없이 JSON 검증) | OK |
| 4 | 검증 실패 시 미적재: kind/curve 불일치, geometry 값 오류, weights 값 3, 미정의 타입, 누락 | 5건 오류 출력, exit 1, DB 변화 없음 |
| 5 | `--prune`: 타입 2개 제거한 JSON 으로 적재 | 무옵션: 경고만 / `--prune`: 참조 데이터 있으면 건너뜀+경고 / `--prune --prune-data`: 타입·weights·참조 행·user_overrides CASCADE 삭제. 이후 원본 JSON 복원 적재 OK |
| 6 | `db/verify.sql` (트랜잭션 후 ROLLBACK) | **PASS 45 / FAIL 0** |
| 7 | `queries.sql` 1~8 실행 (verify.sql 안에서 샘플 시설 위에 `\ir`) | 정상. 쿼리 5: 후보 {1,2,3} 중 2번만 통과(1=never 소각장 반경 내, 3=must 지하철 없음). 쿼리 6: 후보 1만 통과(지하철 75m, 초등 245m, 종합병원 1994m) |

### verify.sql 에 포함된 거부 테스트 (모두 PASS)
- 잘못된 위도 `lat=137.5` -> 23514 (`facilities_korea_bounds_chk`; PostGIS 가 먼저 좌표를 보정하지만 범위 CHECK 에서 최종 거부)
- 위경도 뒤바뀜 `(lng=37.5, lat=127.0)`, 한국 밖 좌표(도쿄) -> 23514
- kind/curve 불일치 3종(positive+bell, bell+decay, negative+bell) -> 23514
- curve_params: bell 순서 위반 2종, bell 키 누락, decay 문자열/0/키 없음, step 키 없음 -> 23514
- time_modifiers 스칼라 -> 23514
- 없는 타입 / 미등록 source / `(source,source_id)` 중복 / source_id NULL 중복(같은 출처+유형+이름+~1m) -> 23503/23503/23505/23505
- area_metrics 에 point 타입 -> 23503, 한국 밖 좌표 -> 23514
- 도메인 override `must`/`never`/중복 -> 23514/23514/23505
- 프로필: noise 5, urban_pref 5, 동의 없는 직장 위치/건강 정보, 한국 밖 직장 좌표, household 배열, 잘못된 floor_pref enum 거부
- weights 범위(3) 거부
- 허용 확인: step 유형, metric 타입, 전 항목 프로필(동의 포함), user_overrides never, metric 타입 중심점을 facilities 에 적재(contract 기본 구현), area_metrics 폴리곤, expires_at 자동 설정(보관일 설정 시), `facilities_active` 의 만료행 제외

### 검증 중 발견·수정한 결함
- `curve_params_valid()` 가 키 누락 시 NULL 을 반환해 CHECK 가 통과하던 문제(decay/step 에 `{}` 허용) -> `IS DISTINCT FROM` + `COALESCE(..., false)` 로 수정, 회귀 테스트 추가.

## 재현
```bash
export DATABASE_URL=postgresql://user@host/db
python db/load_seed.py --schema
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify.sql
```

## 미검증 / 남은 위험
- 실제 대용량 데이터에서의 쿼리 성능(EXPLAIN, GiST/KNN 사용)은 시설 수만 건 이상 적재 후 확인 필요. 샘플 6건만으로 검증.
- `time_modifiers` 는 현재 object/array 여부만 검사(`{weekday,weekend,night}` 각 0..3 은 load_seed 에서도 미검사). 계약이 확정되면 CHECK 강화 가능.
- 공공/카카오 데이터 약관·개인정보 법적 요건은 DB 로 판단할 수 없음(`ingest/README.md` 체크리스트의 '확인 필요' 항목).
- 구버전 DB 에는 `schema.sql` 이 컬럼/제약을 추가하지 않는다(IF NOT EXISTS). 아직 운영 데이터가 없다는 전제로 재생성 필요.
