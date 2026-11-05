# 시설 수집/적재 계획

| 원천 | 대상 시설(예) | 방식 | 환경변수 |
|---|---|---|---|
| 공공데이터포털 (data.go.kr) | 학교, 병원/약국, 어린이집, 공원, 지하철역 | REST/파일 데이터, 좌표 없으면 주소 지오코딩 | `DATA_GO_KR_KEY` |
| 서울 열린데이터광장 | CCTV, 공원, 도서관, 버스정류장, 소음/대기 | `openapi.seoul.go.kr:8088/{KEY}/json/{서비스}/{start}/{end}` | `SEOUL_OPEN_KEY` |
| 카카오 로컬 API | 편의점, 마트, 카페, 병원 등 카테고리 검색 | 격자 중심 반경 검색(최대 20km, 페이지 45 x 15건 한계 → 격자 분할) | `KAKAO_REST_KEY` |

## 절차
1. `facility_types.source_hint` 를 보고 type_id별 원천/카테고리 매핑을 정한다.
2. 원천별로 수집 -> (type_id, name, lng, lat, source, source_id) 로 정규화.
3. `facilities` 에 `ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL` upsert, `updated_at` 갱신.
   - `source` 는 `data_sources` 테이블에 먼저 등록돼 있어야 한다(FK). 새 출처는 INSERT 후 아래 체크리스트로 약관을 확인한다.
   - 데이터셋별 라이선스가 다르면 `facilities.license` 에 개별 기록(예: KOGL 유형). 비우면 `data_sources.license` 를 따른다.
   - `source_id` 가 없는 원천은 (source, type_id, name, 좌표 약 1m) 기준으로 중복이 거부된다(`facilities_nosrcid_uq`).
   - 한국 좌표 범위(경도 124~132, 위도 33~38.9) 밖이면 INSERT 가 거부된다. 경도/위도 순서(`ST_MakePoint(lng, lat)`)에 주의.
   - `facility_types.geometry='metric'` 타입은 사전 계산된 격자/구역 중심점이면 `facilities` 에, 측정값(value)이 필요한 정밀 지표(소음/대기/경사 등)는 `area_metrics`(value, geom) 에 적재한다.
4. 갱신 주기: 정적 시설 분기 1회, 카카오는 월 1회. 이후 `VACUUM ANALYZE facilities`.
   보관기한: `data_sources.max_retention_days` 가 설정되면 trigger 가 `expires_at` 을 채우고, 만료행은 `facilities_active` 뷰에서 제외된다. 만료행 삭제는 `queries.sql` 8번.
5. 원천 약관 확인 - 아래 "상용화 전 필수 확인" 을 모두 마치기 전에는 상용 서비스에 데이터를 사용하지 않는다.

## 상용화 전 필수 확인 체크리스트 (모두 '확인 필요' 상태. 아래는 확인할 항목이지 법률 판단이 아님)
각 출처마다 확인 결과와 일시를 `data_sources`(license, terms_url, commercial_use_ok, max_retention_days, terms_checked_at, notes)에 기록한다.
`terms_checked_at IS NULL` 인 출처의 데이터는 상용 배포 금지로 취급한다.

### 카카오 로컬 API (`source='kakao'`)
- [ ] 응답 데이터(장소명/좌표/카테고리)를 자체 DB 에 저장·캐싱해도 되는지, 허용 기간과 범위 (확인 필요)
- [ ] 저장 결과를 가공해 자체 서비스의 핵심 데이터로 쓰는 것(대량 수집 포함)이 허용되는지 (확인 필요)
- [ ] 호출 한도/쿼터와 상용 이용 시 정책·요금, 앱/도메인 등록 요건 (확인 필요)
- [ ] 카카오 지도/데이터 사용 시 출처 표기·로고·화면 노출 의무 (확인 필요)
- [ ] 허용 보관기간이 있다면 `max_retention_days` 에 반영, 없으면 카카오 데이터를 영구 저장하지 않고 실시간 조회 방식으로 전환할지 결정
- [ ] REST 키 노출 방지(서버측 보관), 계정 약관 변경 모니터링

### 공공데이터포털 및 공공기관 데이터 (`data.go.kr`, `seoul_open` 등)
- [ ] 데이터셋마다 이용허락범위가 다르다 - 사용하는 데이터셋별로 라이선스 유형 확인 (예: 공공누리 KOGL 1~4유형, 기타 자체 약관) (확인 필요)
- [ ] 상업적 이용 가능 여부 (KOGL 유형에 따라 다를 수 있음 - 유형별 허용 범위 확인 필요)
- [ ] 변경(가공·재배포) 허용 여부 (KOGL 유형별 확인 필요)
- [ ] 출처 표시 의무 및 표기 문구 -> `data_sources.attribution_text`, 서비스 화면 반영
- [ ] 제3자 권리(지도 원본, 민간 저작물 포함 여부) 및 개인정보 포함 여부 (확인 필요)
- [ ] API 활용신청 승인 조건·트래픽 한도, 키 발급 주체(개인/법인) (확인 필요)
- [ ] 데이터 갱신 주기와 폐기/정정 요구 시 대응 절차

### 지오코딩·지도 타일·기타 (네이버 지도, 에어코리아, 국토교통부 등을 추가할 경우)
- [ ] 주소 -> 좌표 변환 결과의 저장 허용 여부 (제공 업체별 약관 확인 필요)
- [ ] 에어코리아 등 실시간·측정 지표의 재배포/상업 이용 조건 (확인 필요)
- [ ] 새 출처 추가 시 `data_sources` 등록 + 이 체크리스트 전 항목 수행

### 사용자 개인정보 (`user_profiles`: 직장/가족 거주지 위치, 건강 상태, 가구 구성)
- [ ] 개인정보 처리방침, 수집·이용 동의 문구/절차 (동의 시각은 `consented_at` 에 기록; 법적 요건은 법무 확인 필요)
- [ ] 민감정보(건강)·위치정보 처리에 대한 별도 동의/신고 등 규제 해당 여부 (확인 필요)
- [ ] 보관 기간, 삭제 요청 처리 SLA (`deleted_at` + `queries.sql` 8b), 저장 시 암호화/접근통제
- [ ] 위치정보가 점수 계산에 꼭 필요한지(서버 저장 최소화) 재검토

### 기록
- [ ] 확인한 약관 URL/버전/캡처 보관, 확인자·확인일을 `data_sources.notes`/`terms_checked_at` 에 남김
- [ ] 약관 재확인 주기(예: 반기) 지정

## 스켈레톤
`ingest_example.py` — 카카오 카테고리 검색 1종을 수집해 upsert. API 키는 환경변수만 사용.

```bash
export DATABASE_URL=... KAKAO_REST_KEY=...
python db/ingest/ingest_example.py --type-id convenience_store --category CS2 --lng 127.0276 --lat 37.4979 --radius 2000 --dry-run
```
