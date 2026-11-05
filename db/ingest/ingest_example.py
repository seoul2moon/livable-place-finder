#!/usr/bin/env python3
"""카카오 로컬 카테고리 검색 -> facilities upsert 스켈레톤. 키는 환경변수 KAKAO_REST_KEY."""
import argparse, json, os, sys, urllib.parse, urllib.request
import psycopg

API = "https://dapi.kakao.com/v2/local/search/category.json"


def fetch(key, category, lng, lat, radius):
    page = 1
    while page <= 45:
        q = urllib.parse.urlencode({"category_group_code": category, "x": lng, "y": lat,
                                    "radius": radius, "page": page, "size": 15})
        req = urllib.request.Request(f"{API}?{q}", headers={"Authorization": f"KakaoAK {key}"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.load(r)
        yield from body["documents"]
        if body["meta"]["is_end"]:
            break
        page += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type-id", required=True)
    ap.add_argument("--category", required=True, help="카카오 category_group_code (예: CS2, HP8, SC4)")
    ap.add_argument("--lng", type=float, required=True)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--radius", type=int, default=2000)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("KAKAO_REST_KEY") or sys.exit("KAKAO_REST_KEY 환경변수가 필요합니다")
    rows = [(a.type_id, d["place_name"], float(d["x"]), float(d["y"]), "kakao", d["id"])
            for d in fetch(key, a.category, a.lng, a.lat, a.radius)]
    print(f"fetched {len(rows)}")
    if a.dry_run:
        return
    url = os.environ.get("DATABASE_URL") or sys.exit("DATABASE_URL 환경변수가 필요합니다")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO facilities (type_id,name,geom,source,source_id)
               VALUES (%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,%s,%s)
               ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
               DO UPDATE SET name=EXCLUDED.name, geom=EXCLUDED.geom, type_id=EXCLUDED.type_id,
                             updated_at=now()""", rows)
    print("upserted")


if __name__ == "__main__":
    main()
