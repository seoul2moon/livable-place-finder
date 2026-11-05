# 시드 적재

기획팀 산출물 `data/facility_types.json`, `data/weights.json` 을 DB에 넣는다.

```bash
pip install "psycopg[binary]"
createdb livable                      # PostGIS 설치된 PostgreSQL 필요
export DATABASE_URL=postgresql://user:pw@localhost:5432/livable
python db/load_seed.py --schema       # schema.sql 실행 + 시드 적재
python db/load_seed.py                # 이후 재실행 (upsert, 멱등)
python db/load_seed.py --check        # JSON 검증만 (DB 접속 없음)
python db/load_seed.py --prune        # JSON 에서 사라진 타입도 DB에서 삭제
```

- 경로 변경: `--types PATH --weights PATH`
- 적재 전 검증: enum 값, `kind='bell' <=> curve.type='bell'`, curve params 규칙, weights 가 **모든 타입 x 5개 생애단계**에 존재하고 -2..2 정수인지. 하나라도 실패하면 아무것도 적재하지 않는다.
- `geometry`("point"|"metric", 생략 시 point), `time_modifiers`(없으면 NULL) 를 그대로 적재한다.
- `--prune`: JSON 에서 사라진 타입 삭제(weights/user_overrides 는 CASCADE). `facilities`/`area_metrics` 가 참조 중이면 건너뛰고 경고하며, 그 데이터까지 지우려면 `--prune-data` 를 추가한다. `--prune` 없이 실행하면 경고만 한다.
- 타입 id 가 바뀌는 경우(rename)는 prune 이 아니라 새 타입 추가 + 구 타입 삭제로 처리되어 사용자 override 가 사라진다. 변경 전에 영향 확인.
- 연결문자열은 `DATABASE_URL` 환경변수로만 받는다.
- 검증: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify.sql` (트랜잭션 후 ROLLBACK, 결과는 `db/VERIFY.md`).
