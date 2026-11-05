"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getFacilityType, isMetric, loadDomains, loadFacilityTypes, loadLifeStages } from "@/lib/api/config";
import {
  ASKABLE_DOMAINS, COMMUTES, DEFAULT_ANSWERS, FLOORS, HEALTHS, HOUSEHOLDS, MAX_DOMAIN_PREFS, NOISES, PLANS,
  QUICK_MUST, RECOMMENDED_MAX_MUST, STYLES, TRANSPORTS, buildProfile, dislikeGroups, mustNeverConflicts,
  type Answers, type Dislike,
} from "@/lib/api/profile";
import { loadStored, saveStored } from "@/lib/api/profile-store";

// ---------- 공통 입력 컴포넌트 ----------
function Single<T extends string>({ label, items, value, onChange }: {
  label: string; items: [T, string][]; value: T | null; onChange: (v: T | null) => void;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map(([k, text]) => (
        <button type="button" key={k} className="chip" aria-pressed={k === value} onClick={() => onChange(k === value ? null : k)}>{text}</button>
      ))}
    </div>
  );
}
function Multi<T extends string>({ label, items, value, onChange }: {
  label: string; items: [T, string][]; value: T[]; onChange: (v: T[]) => void;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map(([k, text]) => {
        const on = value.includes(k);
        return (
          <button type="button" key={k} className="chip" aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}>{text}</button>
        );
      })}
    </div>
  );
}
function YesNo({ label, value, onChange, noLabel }: {
  label: string; value: boolean | null; onChange: (v: boolean | null) => void; noLabel?: string;
}) {
  return (
    <div className="row">
      <span className="rowlabel" id={"q-" + label}>{label}</span>
      <div className="chips" role="group" aria-labelledby={"q-" + label}>
        <button type="button" className="chip" aria-pressed={value === true} onClick={() => onChange(value === true ? null : true)}>예</button>
        {noLabel !== undefined && (
          <button type="button" className="chip" aria-pressed={value === false} onClick={() => onChange(value === false ? null : false)}>{noLabel}</button>
        )}
      </div>
    </div>
  );
}
function Q({ children }: { children: ReactNode }) { return <p className="q">{children}</p>; }

const DISLIKE_OPTS: [Dislike | "none", string][] = [["none", "상관없음"], ["avoid", "피하고 싶음"], ["never", "절대 불가"]];

export default function OnboardingForm() {
  const router = useRouter();
  const [a, setA] = useState<Answers>(DEFAULT_ANSWERS);
  const [step, setStep] = useState(0);
  const [custom, setCustom] = useState("");
  const upd = (patch: Partial<Answers>) => setA((q) => ({ ...q, ...patch }));

  useEffect(() => { const s = loadStored(); if (s.answers) setA(s.answers); }, []);

  const types = loadFacilityTypes();
  const groups = useMemo(() => dislikeGroups(types), [types]);
  const validIds = useMemo(() => new Set(types.map((t) => t.id)), [types]);
  const domainName = Object.fromEntries(loadDomains().map((d) => [d.id, d.name_ko]));
  const mustName = (id: string) => getFacilityType(id)?.name_ko ?? id;
  const religiousKnown = validIds.has("religious_facility");

  const setDislike = (ids: string[], v: Dislike | "none") =>
    setA((q) => {
      const next = { ...q.dislike };
      let must = q.must;
      for (const id of ids) {
        if (v === "none") delete next[id];
        else next[id] = v;
        if (v === "never") must = must.filter((m) => m !== id); // must + never 동시선택 차단
      }
      return { ...q, dislike: next, must };
    });
  const toggleMust = (id: string) =>
    setA((q) => (q.must.includes(id) ? { ...q, must: q.must.filter((m) => m !== id) } : q.dislike[id] === "never" ? q : { ...q, must: [...q.must, id] }));

  const steps: { title: string; required?: boolean; body: ReactNode }[] = [
    {
      title: "1. 지금 생활은 어떤가요?", required: true,
      body: (
        <div className="grid">
          {loadLifeStages().map((s) => (
            <button type="button" key={s.id} className="tile" aria-pressed={a.lifeStage === s.id} onClick={() => upd({ lifeStage: s.id })}>
              <b>{s.name_ko}</b><span>{s.desc_ko}</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "2. 가구·건강·앞으로의 계획",
      body: (
        <>
          <Q>가구 구성 (복수 선택)</Q>
          <Multi label="가구 구성" items={HOUSEHOLDS} value={a.household} onChange={(v) => upd({ household: v })} />
          <Q>건강 상태 (해당되는 것)</Q>
          <Multi label="건강 상태" items={HEALTHS} value={a.health} onChange={(v) => upd({ health: v })} />
          <Q>향후 5~10년 생애 계획</Q>
          <Multi label="생애 계획" items={PLANS} value={a.plans} onChange={(v) => upd({ plans: v })} />
        </>
      ),
    },
    {
      title: "3. 특히 중요한 영역은?",
      body: (
        <>
          <p className="muted">최대 {MAX_DOMAIN_PREFS}개까지 고를 수 있어요. 고르지 않은 영역은 보통으로 봐요. ({a.domainPrefs.length}/{MAX_DOMAIN_PREFS})</p>
          <div className="chips" role="group" aria-label="중요한 영역">
            {ASKABLE_DOMAINS.map((d) => {
              const on = a.domainPrefs.includes(d);
              return (
                <button type="button" key={d} className="chip" aria-pressed={on} disabled={!on && a.domainPrefs.length >= MAX_DOMAIN_PREFS}
                  onClick={() => upd({ domainPrefs: on ? a.domainPrefs.filter((x) => x !== d) : [...a.domainPrefs, d] })}>
                  {domainName[d]}
                </button>
              );
            })}
          </div>
        </>
      ),
    },
    {
      title: "4. 이동과 통근",
      body: (
        <>
          <Q>주로 이동하는 방법</Q>
          <Single label="이동 수단" items={TRANSPORTS} value={a.transport} onChange={(v) => upd({ transport: v })} />
          <Q>통근·통학 허용 시간</Q>
          <Single label="통근 시간" items={COMMUTES} value={a.commute} onChange={(v) => upd({ commute: v })} />
        </>
      ),
    },
    {
      title: "5. 주거 환경 취향",
      body: (
        <>
          <Q>소음 민감도</Q>
          <Single label="소음 민감도" items={NOISES} value={a.noise} onChange={(v) => upd({ noise: v })} />
          <Q>어떤 동네가 좋으세요?</Q>
          <Single label="동네 분위기" items={STYLES} value={a.style} onChange={(v) => upd({ style: v })} />
          <Q>선호하는 층</Q>
          <Single label="고층·저층" items={FLOORS} value={a.floor} onChange={(v) => upd({ floor: v })} />
          <YesNo label="조망·일조가 중요해요" value={a.sunView} onChange={(v) => upd({ sunView: v })} />
        </>
      ),
    },
    {
      title: "6. 생활 습관",
      body: (
        <>
          <YesNo label="야간 외식·카페 등 밤 생활을 즐겨요" value={a.nightLife} noLabel="아니요(밤엔 조용했으면)" onChange={(v) => upd({ nightLife: v })} />
          <YesNo label="반려동물을 키워요" value={a.pet} onChange={(v) => upd({ pet: v })} />
          <YesNo label="운동·산책·자연 활동을 자주 해요" value={a.outdoor} onChange={(v) => upd({ outdoor: v })} />
          <YesNo label="재택근무가 많아요" value={a.remote} onChange={(v) => upd({ remote: v })} />
          <YesNo label="고령 부모님을 모시거나 돌봐요" value={a.eldercare} onChange={(v) => upd({ eldercare: v })} />
        </>
      ),
    },
    {
      title: "7. 이게 없으면 안 돼요 (필수 조건)",
      body: (
        <>
          <p className="muted">반경 안에 없으면 그 지역은 제외돼요. 권장 최대 {RECOMMENDED_MAX_MUST}개.</p>
          <div className="chips" role="group" aria-label="필수 조건">
            {QUICK_MUST.filter((id) => validIds.has(id)).map((id) => (
              <button type="button" key={id} className="chip" aria-pressed={a.must.includes(id)} disabled={a.dislike[id] === "never"} onClick={() => toggleMust(id)}>{mustName(id)}</button>
            ))}
          </div>
          <Q>그 밖의 시설에서 직접 고르기</Q>
          <div className="seg">
            <label htmlFor="must-custom" className="muted">시설 선택</label>
            <select id="must-custom" value={custom} onChange={(e) => { const id = e.target.value; setCustom(""); if (id) toggleMust(id); }}>
              <option value="">선택하세요</option>
              {types.filter((t) => t.domain !== "nuisance" && !isMetric(t) && !QUICK_MUST.includes(t.id) && !a.must.includes(t.id) && a.dislike[t.id] !== "never")
                .map((t) => <option key={t.id} value={t.id}>{domainName[t.domain]} · {t.name_ko}</option>)}
            </select>
          </div>
          {a.must.filter((id) => !QUICK_MUST.includes(id)).length > 0 && (
            <div className="chips" aria-label="직접 고른 필수 조건">
              {a.must.filter((id) => !QUICK_MUST.includes(id)).map((id) => (
                <button type="button" key={id} className="chip" aria-pressed={true} onClick={() => toggleMust(id)} aria-label={`${mustName(id)} 선택 해제`}>{mustName(id)} ✕</button>
              ))}
            </div>
          )}
          {a.must.length > RECOMMENDED_MAX_MUST && (
            <p className="notice" role="status">필수 조건이 {a.must.length}개예요. 많을수록 조건에 맞는 지역이 0곳이 될 수 있어요.</p>
          )}
        </>
      ),
    },
    {
      title: "8. 피하고 싶은 시설",
      body: (
        <>
          <p className="muted">‘절대 불가’는 반경 안에 하나라도 있으면 그 지역을 제외하고, ‘피하고 싶음’은 감점만 해요. 필수 조건으로 고른 시설은 절대 불가로 지정할 수 없어요.</p>
          {groups.map((g) => {
            const cur = (a.dislike[g.ids[0]] ?? "none") as Dislike | "none";
            const blocked = g.ids.some((i) => a.must.includes(i));
            return (
              <div className="row" key={g.label}>
                <span className="rowlabel" id={"d-" + g.label}>{g.label}</span>
                <div className="chips" role="group" aria-labelledby={"d-" + g.label}>
                  {DISLIKE_OPTS.map(([k, text]) => (
                    <button type="button" key={k} className={"chip" + (k === "never" ? " never" : "")} aria-pressed={cur === k}
                      disabled={k === "never" && blocked} onClick={() => setDislike(g.ids, k)}>{text}</button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="row">
            <span className="rowlabel" id="d-religious">종교시설 인접</span>
            <div className="chips" role="group" aria-labelledby="d-religious">
              {DISLIKE_OPTS.map(([k, text]) => (
                <button type="button" key={k} className={"chip" + (k === "never" ? " never" : "")} aria-pressed={(a.religious ?? "none") === k}
                  onClick={() => upd({ religious: k === "none" ? null : k })}>{text}</button>
              ))}
            </div>
            {!religiousKnown && <span className="muted">시설 데이터가 준비되면 점수에 반영돼요.</span>}
          </div>
        </>
      ),
    },
    {
      title: "9. 확인",
      body: <Summary a={a} validIds={validIds} />,
    },
  ];

  const last = steps.length - 1;
  const cur = steps[step];
  const conflicts = mustNeverConflicts(a);
  const canNext = !cur.required || a.lifeStage !== null;
  const finish = () => {
    if (a.lifeStage === null || conflicts.length) return;
    const s = loadStored();
    saveStored({ ...s, answers: a, edits: {} });
    router.push("/result");
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (step === last) finish(); }} className="stack" aria-labelledby="step-title">
      <div>
        <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-label="설문 진행도">
          <div style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <p className="muted">{step + 1} / {steps.length} 단계 · 건너뛰어도 괜찮아요(미응답은 상관없음으로 처리)</p>
      </div>
      <section className="card" aria-live="polite">
        <h2 id="step-title">{cur.title}</h2>
        {cur.body}
      </section>
      {step === 0 && a.lifeStage === null && <p className="notice" role="status">생애 단계는 꼭 골라주세요.</p>}
      <div className="navbar">
        <button type="button" className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>이전</button>
        {step < last ? (
          <>
            {!cur.required && <button type="button" className="secondary" onClick={() => setStep(step + 1)}>건너뛰기</button>}
            <button type="button" className="primary grow" disabled={!canNext} onClick={() => setStep(step + 1)}>다음</button>
          </>
        ) : (
          <button type="submit" className="primary grow" disabled={a.lifeStage === null || conflicts.length > 0}>살기 좋은 곳 보기</button>
        )}
      </div>
      {step < last && a.lifeStage !== null && (
        <button type="button" className="link" onClick={() => setStep(last)}>나머지 건너뛰고 확인 단계로</button>
      )}
    </form>
  );
}

function Summary({ a, validIds }: { a: Answers; validIds: Set<string> }) {
  const p = buildProfile(a, validIds);
  const count = (att: string) => Object.values(p.overrides).filter((v) => v === att).length;
  const stage = loadLifeStages().find((s) => s.id === a.lifeStage);
  return (
    <>
      <p>{stage ? <b>{stage.name_ko}</b> : <b className="warn">생애 단계를 골라주세요</b>} 기준으로 찾아드려요.</p>
      <ul>
        <li>필수 조건 {count("must")}개 · 절대 불가 {count("never")}개</li>
        <li>피하고 싶음 {count("avoid")}개 · 있으면 좋음 {count("prefer")}개</li>
        <li>중요 영역 {Object.keys(p.domain_overrides).length}개</li>
      </ul>
      <p className="muted">결과 화면에서 언제든 시설별 설정을 바꿀 수 있어요.</p>
      <details>
        <summary>프로필 JSON 보기</summary>
        <pre>{JSON.stringify(p, null, 2)}</pre>
      </details>
    </>
  );
}
