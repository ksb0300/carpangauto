// 엔카 광고장 예약 저격 — 폰에서 요청하면 사무실 PC 의 감시 프로그램(encar_reserve_worker.py)이 받아 감시한다.
// 원하는 날짜·시간대가 마감이어도 취소분이 열리는 순간 잡아(15분) 알림 → 엔카 앱에서 마무리.
// 마무리 '자동'(미리 적은 차량·연락처로 확정까지)은 엔카 3단계 화면 조사 뒤 붙인다.
import { html, useState, useEffect, Loading, Badge, Seg, Field, run, toast, today } from "../ui.js";
import { q } from "../db.js";

const CENTERS = [["부산경동오토필드", "경동오토필드 1"], ["부산경동오토필드2", "경동오토필드 2"]];
const TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"];
const TONE = { 대기: "gray", 감시중: "blue", 확보: "green", 완료: "green", 실패: "red", 정지: "gray" };
const load = k => { try { return localStorage.getItem("reserve-" + k) || ""; } catch { return ""; } };
const keep = (k, v) => { try { localStorage.setItem("reserve-" + k, v); } catch {} };
const 요일 = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
const 주말 = d => [0, 6].includes(new Date(d + "T00:00:00").getDay());

export function ReservePage({ app }) {
  const [jobs, setJobs] = useState(null);
  const [worker, setWorker] = useState(undefined);
  const [f, setF] = useState(() => ({ center: load("center") || CENTERS[0][0], date: "", times: [], interval: 7, finish: "앱" }));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const refresh = () => run(async () => {
    setJobs(await q(app.db.from("encar_reserve_jobs").select("*").order("created_at", { ascending: false }).limit(20)));
    setWorker((await q(app.db.from("encar_reserve_worker").select("*")))[0] || null);
  });
  // 감시 중엔 몇 초마다 새로 (폰에서 진행 상황을 본다)
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);
  const 연결초 = worker?.seen_at ? Math.round((Date.now() - Date.parse(worker.seen_at)) / 1000) : null;
  const 살아있음 = 연결초 !== null && 연결초 < 90;
  const toggle = t => set("times", f.times.includes(t) ? f.times.filter(x => x !== t) : [...f.times, t].sort());
  const start = () => run(async () => {
    if (!f.date) throw new Error("날짜를 고르세요");
    if (주말(f.date)) throw new Error("토·일요일은 엔카 광고장 예약이 안 됩니다");
    if (!f.times.length) throw new Error("노리는 시간대를 하나 이상 고르세요");
    keep("center", f.center);
    await q(app.db.from("encar_reserve_jobs").insert({ center: f.center, res_date: f.date, times: f.times,
      interval_s: Math.max(3, Number(f.interval) || 7), finish: f.finish }));
    set("times", []); refresh();
  }, "감시를 요청했습니다 — 사무실 PC 가 곧 시작합니다");
  const stop = j => run(async () => { await q(app.db.from("encar_reserve_jobs").update({ stop: true }).eq("id", j.id)); refresh(); }, "정지를 요청했습니다");
  const again = j => setF(x => ({ ...x, center: j.center, date: j.res_date >= today() ? j.res_date : "", times: j.times, interval: Number(j.interval_s), finish: j.finish }));

  return html`<div class="bar"><h2>광고장 예약</h2>
      <span class="muted small">마감된 시간대에 취소분이 나오면 사무실 PC 가 바로 잡고(15분) 웍스 'TierONE 알림' 방으로 직원 모두에게 알립니다</span><span class="grow"></span>
      ${worker === undefined ? "" : 살아있음 ? html`<${Badge} tone="green">감시 PC 연결됨<//>`
        : html`<${Badge} tone="red">감시 PC 꺼짐${연결초 !== null ? ` (${Math.round(연결초 / 60)}분 전)` : ""}<//>`}</div>
    ${worker !== undefined && !살아있음 && html`<p class="note bad">사무실 PC 의 감시 프로그램이 응답하지 않습니다. PC 가 켜져 있는지, 작업 스케줄러 '엔카 광고장 예약 감시'가 돌고 있는지 확인하세요. 요청은 그대로 두면 PC 가 켜질 때 시작합니다.</p>`}

    <div class="card reserve-new">
      <h3>새 감시</h3>
      <div class="fgrid">
        <${Field} label="지점"><${Seg} value=${f.center} onChange=${v => set("center", v)} options=${CENTERS} /><//>
        <${Field} label="날짜" hint=${f.date ? (주말(f.date) ? "토·일요일은 예약이 안 됩니다" : `${요일(f.date)}요일`) : "평일만 예약됩니다"}>
          <input type="date" min=${today()} value=${f.date} onInput=${e => set("date", e.target.value)} /><//>
      </div>
      <div class="lab small" style="margin:4px 0 6px"><b>노리는 시간대</b> (여러 개)
        <button class="btn sm ghost" onClick=${() => set("times", [...TIMES])}>전체</button><button class="btn sm ghost" onClick=${() => set("times", [])}>해제</button></div>
      <div class="chips">${TIMES.map(t => html`<button type="button" class=${"chip" + (f.times.includes(t) ? " on" : "")} onClick=${() => toggle(t)}>${t}</button>`)}</div>
      <div class="fgrid" style="margin-top:12px">
        <${Field} label="마무리" hint=${f.finish === "자동" ? "준비 중 — 엔카 예약 3단계(차량·정보 입력) 화면을 평일에 조사한 뒤 켭니다. 지금 고르면 확보까지만 하고 알립니다." : "잡으면 알림 → 15분 안에 엔카 앱에서 차량·정보 입력하고 확정"}>
          <${Seg} value=${f.finish} onChange=${v => set("finish", v)} options=${[["앱", "엔카 앱에서 마무리"], ["자동", "자동 확정 (준비 중)"]]} /><//>
        <${Field} label="확인 간격 (초)" hint="3초 이상 · 기본 7초"><input inputmode="numeric" value=${f.interval} onInput=${e => set("interval", e.target.value.replace(/[^\d]/g, ""))} /><//>
      </div>
      <div class="bar"><span class="grow"></span><button class="btn primary" onClick=${start}>▶ 감시 시작</button></div>
    </div>

    ${!jobs ? html`<${Loading} />` : !jobs.length ? html`<p class="muted">아직 요청이 없습니다.</p>` : jobs.map(j => html`<div class="card reserve-job" key=${j.id}>
      <div class="bar"><b>${CENTERS.find(c => c[0] === j.center)?.[1] || j.center} · ${j.res_date}(${요일(j.res_date)})</b>
        <${Badge} tone=${TONE[j.status]}>${j.status}${j.stop && ["대기", "감시중"].includes(j.status) ? " (정지 요청)" : ""}<//>
        ${j.finish === "자동" && html`<${Badge}>자동 확정<//>`}<span class="grow"></span>
        ${["대기", "감시중"].includes(j.status) && !j.stop ? html`<button class="btn sm danger" onClick=${() => stop(j)}>■ 정지</button>`
          : html`<button class="btn sm ghost" onClick=${() => again(j)}>같은 조건으로</button>`}</div>
      <div class="small">${j.times.join(" · ")} <span class="muted">· ${Number(j.interval_s)}초마다</span></div>
      ${j.result && html`<div class=${"small " + (j.status === "확보" ? "green" : j.status === "실패" ? "red" : "")} style="margin-top:4px"><b>${j.result}</b></div>`}
      ${j.log?.length > 0 && html`<details open=${j.status === "감시중"}><summary class="small muted">기록 ${j.log.length}줄</summary>
        <pre class="reserve-log">${j.log.slice(-12).join("\n")}</pre></details>`}
    </div>`)}
    <p class="note">사무실 PC 의 감시 프로그램이 엔카(끌어올리기와 같은 계정)로 접속해 감시합니다. 한 번에 한 요청씩, 엔카 웹예약이 되는 평일 08~23시에만 돌고 그 밖의 시간엔 기다렸다 이어서 합니다.
      잡히면 엔카 앱에서 같은 계정으로 '예약 진행 중'을 열어 마무리하세요.</p>`;
}
