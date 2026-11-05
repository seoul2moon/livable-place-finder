"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MapView from "@/components/map/MapView";
import OverrideEditor from "./OverrideEditor";
import { haversine } from "@/lib/scoring";
import { TIME_LABELS, isMetric, loadAreas, loadDomains, loadFacilityTypes, loadLifeStages } from "@/lib/api/config";
import { rankAreas, scoreArea } from "@/lib/api/engine";
import { DEFAULT_ANSWERS, buildProfile, mustNeverConflicts } from "@/lib/api/profile";
import { defaultMultipliers, emptyStored, loadStored, saveStored, type DomainMultipliers } from "@/lib/api/profile-store";
import type { Attitude, DomainId, TimeOfDay } from "@/lib/api/types";
import type { Answers } from "@/lib/api/profile";

const TIMES: TimeOfDay[] = ["weekday", "weekend", "night"];
const fmtR = (m: number) => (m >= 1000 ? `${m / 1000}km` : `${m}m`);

export default function ResultView() {
  const domains = loadDomains();
  const types = useMemo(() => loadFacilityTypes(), []);
  const areas = useMemo(() => loadAreas(), []);
  const validIds = useMemo(() => new Set(types.map((t) => t.id)), [types]);

  const [ready, setReady] = useState(false);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [edits, setEdits] = useState<Record<string, Attitude>>({});
  const [mult, setMult] = useState<DomainMultipliers>(defaultMultipliers);
  const [tod, setTod] = useState<TimeOfDay>("weekday");
  const [visible, setVisible] = useState<DomainId[]>(domains.map((d) => d.id));
  const [selected, setSelected] = useState<string | null>(null);
  const [hl, setHl] = useState<string | null>(null); // 지도에 반경을 그릴 시설유형 id

  useEffect(() => {
    const s = loadStored();
    setAnswers(s.answers); setEdits(s.edits); setMult(s.multipliers); setTod(s.timeOfDay); setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    saveStored({ ...emptyStored(), ...loadStored(), answers, edits, multipliers: mult, timeOfDay: tod });
  }, [ready, answers, edits, mult, tod]);

  const base = useMemo(() => buildProfile(answers ?? { ...DEFAULT_ANSWERS, lifeStage: "young_single" }, validIds), [answers, validIds]);
  const profile = useMemo(() => ({ ...base, overrides: { ...base.overrides, ...edits } }), [base, edits]);

  const results = useMemo(
    () => rankAreas(areas.map((a) => scoreArea(a, { profile, multipliers: mult, timeOfDay: tod }))),
    [areas, profile, mult, tod],
  );
  const marks = Object.fromEntries(results.map((r) => [r.areaId, { total: r.total, excluded: r.excluded }]));
  const selId = selected ?? results[0]?.areaId ?? null;
  const sel = results.find((r) => r.areaId === selId);
  const selArea = areas.find((a) => a.id === selId);
  const stage = loadLifeStages().find((s) => s.id === profile.life_stage);
  const allExcluded = results.length > 0 && results.every((r) => r.excluded);

  // 반경 요약: 시설유형별 radius_m 안의 시설 수
  const counts = useMemo(() => {
    if (!selArea) return [];
    return types.filter((t) => !isMetric(t)).map((t) => ({
      t,
      n: selArea.facilities.filter((f) => f.typeId === t.id && haversine(selArea, f) <= t.radius_m).length,
    }));
  }, [selArea, types]);
  const hlType = types.find((t) => t.id === hl);

  if (!ready) return <p>불러오는 중…</p>;

  const toggle = (id: DomainId) => setVisible((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const pos = sel?.factors.filter((f) => f.contribution > 0).slice(0, 5) ?? [];
  const neg = sel?.factors.filter((f) => f.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 5) ?? [];
  const warnings = Array.from(new Set(sel?.warnings ?? []));
  const setEdit = (id: string, att: Attitude) =>
    setEdits((e) => {
      const next = { ...e };
      if ((base.overrides[id] ?? "neutral") === att) delete next[id]; else next[id] = att;
      return next;
    });

  return (
    <div className="layout">
      <aside className="stack">
        <section className="card">
          <h3>내 조건</h3>
          <p className="muted">
            {stage?.name_ko} · 필수 {Object.values(profile.overrides).filter((v) => v === "must").length} · 절대 불가 {Object.values(profile.overrides).filter((v) => v === "never").length}
          </p>
          {!answers && <p className="notice">설문 없이 기본값으로 보는 중이에요.</p>}
          {answers && mustNeverConflicts(answers).length > 0 && <p className="notice">필수와 절대 불가가 겹친 시설은 절대 불가가 우선돼요.</p>}
          <Link href="/">조건 다시 설정</Link>
        </section>
        <section className="card">
          <h3>시간대</h3>
          <div className="chips" role="group" aria-label="시간대 보정">
            {TIMES.map((t) => <button key={t} type="button" className="chip" aria-pressed={t === tod} onClick={() => setTod(t)}>{TIME_LABELS[t]}</button>)}
          </div>
          <p className="muted">시간대별 혼잡 보정이 점수에 반영돼요.</p>
        </section>
        <section className="card">
          <h3>지도 레이어</h3>
          <p className="muted"><b>레이어 토글은 지도 표시만 바꾸고 점수에는 영향을 주지 않아요.</b></p>
          {domains.map((d) => (
            <label key={d.id} className="check">
              <input type="checkbox" checked={visible.includes(d.id)} onChange={() => toggle(d.id)} />
              <i className="dot" style={{ background: d.color }} aria-hidden="true" />{d.name_ko}
            </label>
          ))}
        </section>
        <section className="card">
          <h3>영역별 중요도</h3>
          <p className="muted">0이면 그 영역을 점수에서 빼고, 2.0이면 두 배로 반영해요.</p>
          {domains.map((d) => (
            <label key={d.id} className="slider">
              <span>{d.name_ko} <b>×{mult[d.id].toFixed(1)}</b></span>
              <input type="range" min={0} max={2} step={0.1} value={mult[d.id]}
                onChange={(e) => setMult({ ...mult, [d.id]: Number(e.target.value) })} />
            </label>
          ))}
          <button type="button" className="link" onClick={() => setMult(defaultMultipliers())}>모두 ×1.0 으로</button>
        </section>
      </aside>

      <main className="stack">
        <section className="card">
          {allExcluded && <p className="notice" role="alert">조건에 맞는 지역이 없어요. 필수·절대 불가 조건을 줄여보세요.</p>}
          <MapView areas={areas} scores={marks} selectedId={selId} onSelect={setSelected}
            visibleDomains={visible} facilityTypes={types} highlightRadiusM={hlType?.radius_m ?? null} />
          <div className="ranking" role="group" aria-label="순위">
            {results.map((r, i) => (
              <button key={r.areaId} type="button" className={"rank" + (r.excluded ? " ex" : "")} aria-pressed={r.areaId === selId} onClick={() => setSelected(r.areaId)}>
                {i + 1}. {areas.find((a) => a.id === r.areaId)?.name_ko} {r.excluded ? <span className="badge">제외</span> : <b>{r.total}점</b>}
              </button>
            ))}
          </div>
        </section>

        {sel && selArea && (
          <>
            <section className="card" aria-live="polite">
              <h3>{selArea.name_ko} — {sel.excluded ? "제외된 지역" : `점수가 나온 이유 (${sel.total}점)`}</h3>
              {sel.excluded && <p className="warn">제외 사유: {sel.excludedReason}</p>}
              <div className="cols">
                <div>
                  <h4 className="good">가산 요인 TOP</h4>
                  {pos.length === 0 && <p className="muted">가산 요인이 없어요</p>}
                  {pos.map((f) => <div key={f.typeId} className="factor good"><b>+{f.contribution.toFixed(1)}</b> {f.reason}</div>)}
                </div>
                <div>
                  <h4 className="bad">감점 요인 TOP</h4>
                  {neg.length === 0 && <p className="muted">감점 요인이 없어요</p>}
                  {neg.map((f) => <div key={f.typeId} className="factor bad"><b>{f.contribution.toFixed(1)}</b> {f.reason}</div>)}
                </div>
              </div>
              {warnings.length > 0 && (
                <details><summary className="muted">참고 {warnings.length}건</summary>
                  <ul>{warnings.map((w) => <li key={w} className="muted">{w}</li>)}</ul>
                </details>
              )}
            </section>
            <section className="card">
              <h3>반경 요약</h3>
              <p className="muted">시설 종류마다 정해진 영향 반경 안의 시설 수예요. 시설을 누르면 지도에 그 반경이 표시돼요.</p>
              <div className="summary">
                {domains.map((d) => {
                  const list = counts.filter((c) => c.t.domain === d.id && c.n > 0);
                  const ds = sel.domainScores[d.id];
                  return (
                    <div key={d.id} className="sumcard">
                      <b style={{ color: d.color }}>{d.name_ko} {ds === undefined ? "-" : `${Math.round(ds)}점`}</b>
                      <div>
                        {list.length === 0 && <small>반경 안에 시설이 없어요</small>}
                        {list.map((c) => (
                          <button key={c.t.id} type="button" className="cnt" aria-pressed={hl === c.t.id}
                            onClick={() => setHl(hl === c.t.id ? null : c.t.id)}>
                            {c.t.name_ko} {c.n} <small>({fmtR(c.t.radius_m)})</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
        <OverrideEditor base={base.overrides} edits={edits} onChange={setEdit} onReset={() => setEdits({})} />
      </main>
    </div>
  );
}
