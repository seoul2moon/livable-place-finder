#!/usr/bin/env python3
"""data/facility_types.json, data/weights.json 을 DB에 적재 (멱등 upsert, 단일 트랜잭션).

사용:
  DATABASE_URL=postgresql://user:pw@host/db python db/load_seed.py [--schema] [--prune] [--check]

옵션:
  --schema   먼저 db/schema.sql 실행
  --check    JSON 검증만 수행(DB 접속 안 함)
  --prune    JSON 에서 사라진 facility_types 를 DB 에서도 삭제 (life_stage_weights/user_overrides 는 CASCADE).
             해당 타입을 참조하는 facilities/area_metrics 행이 있으면 건너뛰고 경고. 그 행까지 지우려면 --prune-data 추가.
             --prune 이 없으면 사라진 타입은 경고만 출력하고 그대로 둔다.
  --types PATH / --weights PATH   JSON 경로 변경

적재 전 검증(하나라도 실패하면 아무것도 적재하지 않음):
  - enum 값(domain/kind/geometry/curve type), id 형식/중복
  - kind='bell' <=> curve.type='bell', curve params 키/대소관계 (schema.sql 의 curve_params_valid 와 동일 규칙)
  - weights: 모든 타입 x 5개 생애단계가 정확히 1개씩 존재, 값 정수 -2..2, JSON 에 없는 타입 id 금지

허용 JSON 형태 (기획팀 스키마 변경에 관대):
  facility_types.json: [ {...} ] / {"facility_types": [...]} / {"types": [...]} / {id: {...}}
     항목: id, name_ko, domain, kind, [geometry="point"|"metric"], radius_m,
           curve{type,params} 또는 curve_type+curve_params, [time_modifiers], source_hint
  weights.json:
     {"<type_id>": {"infant": 2, ...}} / {"infant": {"<type_id>": 2}} / {"weights": ...} / [{"type_id","life_stage","weight"}]
"""
import argparse, json, os, sys
from pathlib import Path

STAGES = ["infant", "school", "young_single", "middle_aged", "senior"]
DOMAINS = {"transport", "education", "medical", "convenience", "nature", "safety", "environment", "nuisance"}
KINDS = {"positive", "negative", "bell"}
GEOMETRIES = {"point", "metric"}
CURVES = {"decay", "bell", "step"}
KNOWN_KEYS = {"id", "name_ko", "domain", "kind", "geometry", "radius_m", "curve", "curve_type",
              "curve_params", "time_modifiers", "source_hint"}
ROOT = Path(__file__).resolve().parent.parent


def unwrap(data, *keys):
    if isinstance(data, dict):
        for k in keys:
            if k in data:
                return data[k]
    return data


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def curve_params_errors(ctype, p):
    if not isinstance(p, dict):
        return ["curve params 가 객체가 아님"]
    if ctype == "decay":
        v = p.get("half_distance_m")
        return [] if num(v) and v > 0 else ["decay: half_distance_m (>0) 필요"]
    if ctype == "step":
        v = p.get("within_m")
        return [] if num(v) and v > 0 else ["step: within_m (>0) 필요"]
    if ctype == "bell":
        ks = ["min_m", "peak_from_m", "peak_to_m", "max_m"]
        if not all(num(p.get(k)) for k in ks):
            return ["bell: min_m, peak_from_m, peak_to_m, max_m 모두 숫자여야 함"]
        a, b, c, d = (p[k] for k in ks)
        return [] if 0 <= a <= b <= c <= d and d > 0 else ["bell: min_m<=peak_from_m<=peak_to_m<=max_m 위반"]
    return [f"알 수 없는 curve type {ctype!r}"]


def norm_types(data, errors, warnings):
    data = unwrap(data, "facility_types", "types")
    if isinstance(data, dict):
        data = [{"id": k, **v} for k, v in data.items()]
    rows, seen = [], set()
    for i, t in enumerate(data):
        tid = t.get("id", f"#{i}")
        e = lambda m: errors.append(f"types[{tid}]: {m}")
        for k in ("id", "name_ko", "domain", "kind", "radius_m"):
            if k not in t:
                e(f"필수 필드 {k} 없음")
        if tid in seen:
            e("id 중복")
        seen.add(tid)
        extra = set(t) - KNOWN_KEYS
        if extra:
            warnings.append(f"types[{tid}]: 알 수 없는 필드 무시됨 {sorted(extra)}")
        curve = t.get("curve") or {}
        ctype = t.get("curve_type") or curve.get("type")
        cparams = t.get("curve_params", curve.get("params", {}))
        geometry = t.get("geometry", "point")
        kind = t.get("kind")
        if t.get("domain") not in DOMAINS: e(f"domain {t.get('domain')!r} 불가")
        if kind not in KINDS: e(f"kind {kind!r} 불가")
        if geometry not in GEOMETRIES: e(f"geometry {geometry!r} 불가 (point|metric)")
        if ctype not in CURVES: e(f"curve type {ctype!r} 불가")
        if kind in KINDS and ctype in CURVES and (kind == "bell") != (ctype == "bell"):
            e(f"kind={kind} 와 curve type={ctype} 불일치")
        if ctype in CURVES:
            for m in curve_params_errors(ctype, cparams):
                e(m)
        r = t.get("radius_m")
        if not (isinstance(r, int) and not isinstance(r, bool) and r > 0):
            e("radius_m 은 양의 정수여야 함")
        elif ctype == "bell" and isinstance(cparams, dict) and num(cparams.get("max_m")) and cparams["max_m"] > r:
            warnings.append(f"types[{tid}]: bell max_m({cparams['max_m']}) > radius_m({r})")
        tm = t.get("time_modifiers")
        if tm is not None and not isinstance(tm, (dict, list)):
            e("time_modifiers 는 객체/배열/null 이어야 함")
        rows.append({"id": tid, "name_ko": t.get("name_ko"), "domain": t.get("domain"), "kind": kind,
                     "geometry": geometry, "radius_m": r, "curve_type": ctype,
                     "curve_params": cparams or {}, "time_modifiers": tm, "source_hint": t.get("source_hint")})
    return rows


def norm_weights(data, type_ids, errors):
    data = unwrap(data, "weights", "life_stage_weights")
    triples = []
    if isinstance(data, list):
        triples = [(d["type_id"], d["life_stage"], d["weight"]) for d in data]
    else:
        for a, inner in data.items():
            for b, w in inner.items():
                stage, tid = (a, b) if a in STAGES else (b, a)
                triples.append((tid, stage, w))
    got = {}
    for tid, stage, w in triples:
        if stage not in STAGES:
            errors.append(f"weights[{tid}/{stage}]: 알 수 없는 생애단계")
            continue
        if tid not in type_ids:
            errors.append(f"weights[{tid}]: facility_types.json 에 없는 타입")
            continue
        if not (isinstance(w, int) and not isinstance(w, bool) and -2 <= w <= 2):
            errors.append(f"weights[{tid}/{stage}]: 정수 -2..2 아님 ({w!r})")
            continue
        if (tid, stage) in got:
            errors.append(f"weights[{tid}/{stage}]: 중복")
        got[(tid, stage)] = w
    missing = [f"{t}/{s}" for t in sorted(type_ids) for s in STAGES if (t, s) not in got]
    if missing:
        errors.append(f"weights 누락 {len(missing)}건: " + ", ".join(missing[:20]) + (" ..." if len(missing) > 20 else ""))
    return [(t, s, w) for (t, s), w in sorted(got.items())]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--types", default=str(ROOT / "data" / "facility_types.json"))
    ap.add_argument("--weights", default=str(ROOT / "data" / "weights.json"))
    ap.add_argument("--schema", action="store_true", help="먼저 db/schema.sql 실행")
    ap.add_argument("--prune", action="store_true", help="JSON 에서 사라진 타입 삭제")
    ap.add_argument("--prune-data", action="store_true", help="--prune 시 해당 타입의 facilities/area_metrics 행도 삭제")
    ap.add_argument("--check", action="store_true", help="JSON 검증만 (DB 접속 없음)")
    a = ap.parse_args()
    if a.prune_data and not a.prune:
        sys.exit("--prune-data 는 --prune 과 함께만 사용")

    errors, warnings = [], []
    types = norm_types(json.loads(Path(a.types).read_text(encoding="utf-8")), errors, warnings)
    ids = {t["id"] for t in types}
    weights = norm_weights(json.loads(Path(a.weights).read_text(encoding="utf-8")), ids, errors)
    for w in warnings:
        print("WARN:", w, file=sys.stderr)
    if errors:
        for e in errors:
            print("ERROR:", e, file=sys.stderr)
        sys.exit(f"검증 실패 ({len(errors)}건) - 적재하지 않음")
    if a.check:
        print(f"OK: {len(types)} types, {len(weights)} weights (DB 미접속)")
        return

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL 환경변수가 필요합니다")
    import psycopg
    from psycopg.types.json import Jsonb

    type_rows = [(t["id"], t["name_ko"], t["domain"], t["kind"], t["geometry"], t["radius_m"], t["curve_type"],
                  Jsonb(t["curve_params"]), Jsonb(t["time_modifiers"]) if t["time_modifiers"] is not None else None,
                  t["source_hint"]) for t in types]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if a.schema:
            cur.execute((Path(__file__).parent / "schema.sql").read_text(encoding="utf-8"))
        cur.executemany(
            """INSERT INTO facility_types
                 (id,name_ko,domain,kind,geometry,radius_m,curve_type,curve_params,time_modifiers,source_hint)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO UPDATE SET name_ko=EXCLUDED.name_ko, domain=EXCLUDED.domain,
                 kind=EXCLUDED.kind, geometry=EXCLUDED.geometry, radius_m=EXCLUDED.radius_m,
                 curve_type=EXCLUDED.curve_type, curve_params=EXCLUDED.curve_params,
                 time_modifiers=EXCLUDED.time_modifiers, source_hint=EXCLUDED.source_hint""", type_rows)
        cur.executemany(
            """INSERT INTO life_stage_weights (type_id,life_stage,weight) VALUES (%s,%s,%s)
               ON CONFLICT (type_id,life_stage) DO UPDATE SET weight=EXCLUDED.weight""", weights)

        # JSON 에서 사라진 타입
        cur.execute("SELECT id FROM facility_types WHERE NOT (id = ANY(%s))", (sorted(ids),))
        gone = [r[0] for r in cur.fetchall()]
        pruned = []
        if gone and not a.prune:
            print(f"WARN: JSON 에 없는 타입 {len(gone)}개가 DB에 남아 있음 (--prune 으로 삭제): {gone}", file=sys.stderr)
        elif gone:
            for tid in gone:
                cur.execute("SELECT (SELECT count(*) FROM facilities WHERE type_id=%s),"
                            "(SELECT count(*) FROM area_metrics WHERE metric_type_id=%s)", (tid, tid))
                nf, nm = cur.fetchone()
                if (nf or nm) and not a.prune_data:
                    print(f"WARN: {tid} 는 facilities {nf}건/area_metrics {nm}건이 참조 중이라 삭제 건너뜀 (--prune-data 로 함께 삭제)",
                          file=sys.stderr)
                    continue
                if nf: cur.execute("DELETE FROM facilities WHERE type_id=%s", (tid,))
                if nm: cur.execute("DELETE FROM area_metrics WHERE metric_type_id=%s", (tid,))
                cur.execute("SELECT count(*) FROM user_overrides WHERE type_id=%s", (tid,))
                no = cur.fetchone()[0]
                cur.execute("DELETE FROM facility_types WHERE id=%s", (tid,))  # weights/user_overrides CASCADE
                pruned.append(f"{tid}(facilities={nf},metrics={nm},user_overrides={no})")
    msg = f"loaded {len(type_rows)} facility_types, {len(weights)} weights"
    if pruned:
        msg += f"; pruned {len(pruned)}: {', '.join(pruned)}"
    print(msg)


if __name__ == "__main__":
    main()
