# 온보딩 설문 설계 (프론트 구현 명세)

목표: 8개 화면, 2~3분 이내. 결과는 `data-contract.md` 5.1 프로필 JSON 으로 직렬화하고, 5.2 규칙으로 엔진 입력(`overrides`/`domainOverrides`/`domainMultipliers`)에 전개한다.
시설 id 는 모두 `data/facility_types.json` 의 id. 거부감 그룹은 `data/aversion_groups.json`. 필수 화면은 1번뿐, 나머지는 "건너뛰기" 가능(건너뛰면 기본값/미지정).

## 0. 구현 규칙
- 상태는 5.1 프로필 JSON 한 객체로 유지. 화면 이동 시마다 로컬 저장(자동 복원). 서버 저장은 완료 시 1회.
- `health_notes` 는 민감정보: 8번 화면에서 "서버에 저장" 체크(기본 해제)를 켠 경우에만 서버로 전송.
- 파생 규칙 적용 순서: (1) 기본값 → (2) 아래 자동 파생 규칙(prefer/avoid) → (3) 사용자가 명시한 6·7번 선택(must/never/avoid)이 덮어씀. 파생 규칙끼리 충돌하면 `never > must > avoid > prefer > neutral`.
- `never` 와 `must` 를 같은 id 에 동시 지정 불가(UI 차단). `must` 는 합계 3개 초과 시 "결과가 0건일 수 있음" 경고. `must`/`never` 는 도메인 단위 불가.
- 결과 화면에서 모든 항목을 언제든 수정(재계산)할 수 있어야 하고, 필터로 제외된 이유(`exclusion.code`: `never_hit`/`must_missing` + 시설명 + `distance_m`)를 표시.

## 1. 화면 구성

### 화면 1. 생애 단계 (필수, 단일 선택) -> `life_stage`, `household`
| 선택지 | 값 |
|---|---|
| 영유아(0~7세) 자녀가 있다 | `infant` |
| 초·중·고 자녀가 있다 | `school` |
| 혼자 또는 부부 (자녀 없음, 20~30대) | `young_single` |
| 40~50대 가구 (자녀 독립·진학 준비 등) | `middle_aged` |
| 60세 이상 (노년 중심) | `senior` |
추가 입력(선택): 성인 수, 자녀 나이(칩 입력), 함께 사는 65세 이상 가족 수 -> `household {adults, children_ages[], seniors}`. 자녀 나이가 입력되었고 선택값과 모순이면(예: 자녀 5세인데 `middle_aged`) 확인 문구만 표시(강제 변경 없음).

### 화면 2. 이동·통근 -> `transport_mode`, `commute_max_min`, `work_location`, `family_location`
- 주 이동수단 (단일): 자차 `car` / 대중교통 `transit`(기본) / 도보 `walk` / 자전거 `bicycle`.
- 통근 허용 시간 슬라이더 0~120분(5분 단위) + "상관없음"(null) -> `commute_max_min`.
- 직장 위치, 가족(부모·자녀 학교 등) 거주지 위치: 주소 검색(선택) -> 좌표. 후보지 필터/통근 시간 표시에만 사용(엔진 점수에 직접 반영하지 않음).

### 화면 3. 생활 스타일 -> `urban_pref`, `night_active`, `noise_sensitivity`, `works_from_home`, `pet`
- 도시형(활기) vs 한적형(조용): 2택 카드 -> `urban`/`quiet`.
- 밤 생활(외식·카페·술자리)을 즐긴다: 예/아니오 -> `night_active`.
- 소음 민감도 0~4 슬라이더(0 둔감, 2 보통, 4 매우 민감) -> `noise_sensitivity`.
- 재택근무가 많다 -> `works_from_home`. 반려동물을 키운다 -> `pet`.

### 화면 4. 주거 선호 -> `floor_pref`, `view_importance`, `sunlight_importance`
- 층: 저층 `low` / 중층 `mid` / 고층 `high` / 상관없음 `any`.
- 조망 중요도, 일조 중요도: 각각 0~4 슬라이더(기본 2).

### 화면 5. 중요한 생활 영역 -> `domain_overrides`
7개 도메인(교통 `transport`, 교육·육아 `education`, 의료 `medical`, 생활편의 `convenience`, 자연·여가 `nature`, 안전 `safety`, 환경·쾌적 `environment`) 각각 3택: 중요(`prefer`) / 보통(`neutral`, 기본) / 덜 중요(`avoid`). "중요"는 최대 3개까지. `nuisance` 도메인은 7번 화면에서 처리하므로 이 화면에 두지 않는다.

### 화면 6. 꼭 있어야 하는 것 -> `overrides = must`
| 선택지 | facility_id |
|---|---|
| 지하철역 | `subway_station` |
| 초등학교 | `elementary_school` |
| 종합병원 | `general_hospital` |
| 대형마트 | `large_mart` |
| 공원 | `park_neighborhood` |
| 소아과 | `pediatric_clinic` |
| 도서관 | `library` |
| 경로당·노인복지관 | `senior_center` |
| 기타(전체 목록 검색, 도메인별 접기) | 임의 `id` |
`geometry=metric` 인 지표형(`air_quality` 등)은 `must` 후보에서 제외(필터 의미가 모호).

### 화면 7. 싫은 것 (거부감) -> `never` / `avoid` (`aversions` 에도 기록)
그룹 카드마다 3택: 괜찮음(미지정) / 가능하면 피함(`avoid`) / 절대 안 됨(`never`). 선택한 그룹의 모든 id 에 같은 태도를 전개한다(상세 보기에서 id 단위로 개별 조정 가능).
| 그룹 키 | 표시명 | 포함 id |
|---|---|---|
| `funeral_grave` | 장례·묘지 | `crematorium_funeral` `cemetery_charnel` |
| `gambling_nightlife` | 사행·유흥 | `horse_racing` `cycle_boat_racing` `offtrack_betting` `casino` `gambling_arcade` `adult_entertainment` `red_light_district` `love_hotel` `nightlife_street` |
| `religious` | 종교시설 인접 | `religious_facility` |
| `welfare_adjacent` | 복지시설 인접 | `homeless_welfare_facility` |
| `waste_odor` | 악취·폐기물 | `waste_incinerator` `landfill` `sewage_plant` `livestock_farm` `recycling_sorting` `asphalt_concrete_plant` |
| `noise_vibration` | 소음·진동 | `noise_major_road` `noise_railway` `noise_aircraft` `military_base` `construction_redevelopment` |
| `hazard` | 위험·유해 | `gas_station` `hazardous_facility` `thermal_power_plant` `high_voltage_substation` `overhead_power_line` |
| `prison` | 교정시설 | `prison_detention` |
| `traffic_inducing` | 교통 유발 | `logistics_center` `bus_truck_depot` `express_bus_terminal` |
공장·산업단지(`industrial_complex`)는 그룹 외 개별 항목으로 "상세 보기"에서 제공. 주의: `nightlife_street` 는 청년 1인에게는 선호 요소이므로 `gambling_nightlife` 그룹을 `never` 로 고르면 확인 문구("번화가·술집도 함께 제외됩니다")를 표시.

### 화면 8. 건강·향후 계획 (선택) -> `health_notes`, `life_plan`
- 건강 태그(복수): 거동 불편 `mobility_limited`, 휠체어 `wheelchair`, 호흡기 질환 `respiratory`, 알레르기 `allergy`, 만성질환 통원 `chronic_care`, 임신·출산 준비 `pregnancy`, 잠귀 예민 `light_sleeper`. 서버 저장 동의 체크박스(기본 해제).
- 향후 5~10년: 기간 `horizon_years` 5/10 + 예정 사건 복수 선택 `events`: 출산 `child_birth`, 자녀 입학 `child_school`, 자녀 독립 `child_independent`, 은퇴 `retirement`, 부모 돌봄 `parent_care`, 이직·근무지 변경 `job_change`. 선택적으로 "그때의 생애 단계" `next_stage`.

## 2. 설문 -> 엔진 입력 전개 규칙
아래는 모두 "파생 규칙"(위 0절 순서 2번). `prefer`/`avoid` 는 4절 유효가중치 표(`prefer=+clamp(|w|+1,1,3)`)를 따른다.

| 입력 | 조건 | 전개 |
|---|---|---|
| `transport_mode` | `car` | `public_parking` `ic_highway` = prefer |
| | `transit` | `subway_station` `bus_stop` `gtx_express_bus` = prefer |
| | `walk` | `subway_station` `bus_stop` `convenience_store` `supermarket` `car_free_living` = prefer |
| | `bicycle` | `bike_lane` `river_stream` = prefer |
| `noise_sensitivity` n | 항상 | `domainMultipliers.environment = [0.6, 0.8, 1.0, 1.3, 1.6][n]` |
| | n >= 3 | `noise_major_road` `noise_railway` = avoid |
| | n = 4 | + `noise_aircraft` `nightlife_street` = avoid |
| `night_active` | true | `nightlife_street` `cafe_restaurant_street` `cinema_culture` = prefer |
| `urban_pref` | `urban` | `cafe_restaurant_street` `department_store` `cinema_culture` = prefer, `domain_overrides.convenience = prefer` |
| | `quiet` | `nightlife_street` = avoid, `park_large` `mountain_trail` `river_stream` = prefer, `domain_overrides.nature = prefer` |
| `floor_pref` | `high` | `sunlight_view` `stairs_elevator` = prefer |
| | `low` | `noise_major_road` = avoid |
| `view_importance` | >= 3 | `sunlight_view` `sea_lake_view` `mountain_trail` = prefer |
| | = 0 | `sea_lake_view` = neutral |
| `sunlight_importance` | >= 3 | `sunlight_view` = prefer |
| | = 0 | `sunlight_view` = neutral |
| `pet` | true | `pet_facility` `park_neighborhood` `walking_trail` = prefer |
| `works_from_home` | true | `coworking_cafe` `sunlight_view` = prefer, `noise_major_road` = avoid |
| `household.seniors` | >= 1 | `clinic` `general_hospital` `senior_center` `flat_terrain` `stairs_elevator` = prefer |
| `health_notes` | `mobility_limited` / `wheelchair` | `flat_terrain` `stairs_elevator` = prefer, `steep_slope` = avoid |
| | `respiratory` / `allergy` | `air_quality` `industrial_complex` `asphalt_concrete_plant` = avoid, `greenery_ratio` = prefer (알레르기만 해당 시 greenery 제외) |
| | `chronic_care` / `pregnancy` | `general_hospital` `clinic` `pharmacy` = prefer |
| | `light_sleeper` | 소음 민감도에 +1(최대 4) 반영 후 위 noise 규칙 적용, `nightlife_street` = avoid |
| `life_plan.events` (horizon <= 5년) | `child_birth` | `daycare` `pediatric_clinic` `park_neighborhood` = prefer |
| | `child_school` | `elementary_school` `academy_cluster` `school_zone` = prefer |
| | `retirement` / `parent_care` | `general_hospital` `senior_center` `flat_terrain` = prefer |
| | `child_independent` / `job_change` | 전개 없음(표시용) |
| `life_plan.next_stage` | 값 있음 | 결과 화면에 "N년 후(`next_stage`)" 보기 토글 제공: 엔진을 `lifeStage=next_stage` 로 한 번 더 호출. 종합 점수 표시는 `0.7*현재 + 0.3*미래` 를 권장 기본값(임의 값, 토글로 해제 가능). horizon 10년이면 events 전개는 생략하고 이 토글만 사용 |

`respiratory`/`allergy` 처럼 한 입력에 여러 시설이 걸리면 모두 같은 태도를 부여. 이미 사용자가 6·7번에서 명시한 id 는 덮어쓰지 않는다. 최종 `overrides` 가 비어도 정상(전부 기본 가중치).

## 3. 결과 JSON 예
```json
{
  "life_stage": "infant",
  "transport_mode": "transit",
  "noise_sensitivity": 3,
  "night_active": false,
  "urban_pref": "quiet",
  "commute_max_min": 50,
  "work_location": {"lat": 37.4979, "lng": 127.0276},
  "family_location": null,
  "floor_pref": "high",
  "view_importance": 2,
  "sunlight_importance": 3,
  "pet": false,
  "works_from_home": false,
  "household": {"adults": 2, "children_ages": [3], "seniors": 0},
  "health_notes": [],
  "life_plan": {"horizon_years": 5, "events": ["child_school"], "next_stage": "school"},
  "overrides": {"pediatric_clinic": "must", "waste_incinerator": "never", "sewage_plant": "never",
                "noise_major_road": "avoid", "subway_station": "prefer", "sunlight_view": "prefer"},
  "domain_overrides": {"education": "prefer", "nature": "prefer"},
  "aversions": {"never": ["waste_odor"], "avoid": []}
}
```
`overrides` 는 발췌(실제로는 `waste_odor` 그룹 6개 id 가 모두 `never`). 엔진 호출 시: `{lifeStage:"infant", overrides, domainOverrides:{education:"prefer",nature:"prefer"}, domainMultipliers:{environment:1.3}, timeOfDay}`.
