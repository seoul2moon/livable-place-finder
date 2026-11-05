"use client";
import { useState } from "react";
import { ATTITUDE_LABELS, isMetric, loadDomains, loadFacilityTypes } from "@/lib/api/config";
import type { Attitude, DomainId } from "@/lib/api/types";

const ORDER: Attitude[] = ["must", "prefer", "neutral", "avoid", "never"];

/** 결과 화면에서 시설별 태도(override)를 수정. base = 온보딩에서 계산된 값, edits = 사용자가 여기서 바꾼 값. */
export default function OverrideEditor({ base, edits, onChange, onReset }: {
  base: Record<string, Attitude>;
  edits: Record<string, Attitude>;
  onChange: (id: string, att: Attitude) => void;
  onReset: () => void;
}) {
  const domains = loadDomains();
  const [dom, setDom] = useState<DomainId>("transport");
  const types = loadFacilityTypes().filter((t) => t.domain === dom && !isMetric(t));
  const editedCount = Object.keys(edits).length;
  return (
    <section className="card">
      <h3>시설별 설정</h3>
      <p className="muted">‘꼭 필요’는 반경 안에 없으면, ‘절대 불가’는 반경 안에 있으면 그 지역이 제외돼요. 바꾸면 바로 점수에 반영돼요.</p>
      <div className="chips" role="group" aria-label="영역 선택">
        {domains.map((d) => (
          <button key={d.id} type="button" className="chip" aria-pressed={d.id === dom} onClick={() => setDom(d.id)}>{d.name_ko}</button>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        {types.map((t) => {
          const cur = edits[t.id] ?? base[t.id] ?? "neutral";
          return (
            <div className="row" key={t.id}>
              <label className="rowlabel" htmlFor={"ov-" + t.id}>
                {t.name_ko} <small className="muted">(반경 {t.radius_m >= 1000 ? `${t.radius_m / 1000}km` : `${t.radius_m}m`})</small>
                {t.id in edits && <span className="edited"> · 수정됨</span>}
              </label>
              <select id={"ov-" + t.id} value={cur} onChange={(e) => onChange(t.id, e.target.value as Attitude)}>
                {ORDER.map((a) => <option key={a} value={a}>{ATTITUDE_LABELS[a]}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <button type="button" className="link" disabled={!editedCount} onClick={onReset}>이 화면에서 수정한 {editedCount}개 설정 되돌리기</button>
    </section>
  );
}
