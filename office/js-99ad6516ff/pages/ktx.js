// KTX 취소표 감시 — 폰에서 요청하면 사무실 PC 의 감시 프로그램(ktx_worker.py)이 각자의 코레일 계정으로 감시한다.
// 매진 열차에 빈자리가 나오는 순간 예약(결제 전 홀드)까지 잡고 웍스 'TierONE 알림' 방으로 알림 → 코레일+ 앱에서 본인이 결제.
// 코레일 계정·요청은 사람마다 따로 (대표 3명·사무장 각자, 사용자 2026-10-16).
import { html, useState, useEffect, Loading, Badge, Seg, Field, run, today } from "../ui.js";
import { q } from "../db.js";

const STATIONS = ["서울", "용산", "수서", "영등포", "수원", "광명", "동탄", "평택지제", "천안아산", "오송", "대전", "김천구미", "동대구",
  "서대구", "경주", "울산(통도사)", "부산", "포항", "구포", "밀양", "마산", "창원중앙", "진주", "익산", "전주", "광주송정", "목포",
  "순천", "여수EXPO", "청량리", "강릉", "행신"];
const TONE = { 대기: "gray", 감시중: "blue", 확보: "green", 대기접수: "amber", 실패: "red", 정지: "gray" };
const load = k => { try { return localStorage.getItem("ktx-" + k) || ""; } catch { return ""; } };
const keep = (k, v) => { try { localStorage.setItem("ktx-" + k, v); } catch {} };
const 요일 = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
const 지금시각 = () => new Date().toTimeString().slice(0, 5);

function AccountCard({ app, masked, onSaved }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(""), [pw, setPw] = useState("");
  const save = () => run(async () => {
    if (!id.trim() || !pw) throw new Error("코레일 아이디와 비밀번호를 모두 넣으세요");
    await q(app.db.rpc("set_ktx_account", { p_login: id.trim(), p_pw: pw }));
    setId(""); setPw(""); setOpen(false); onSaved();
  }, "코레일 계정을 저장했습니다");
  const remove = () => run(async () => {
    if (!confirm("저장한 코레일 계정을 지울까요?")) return;
    await q(app.db.rpc("set_ktx_account", { p_login: "", p_pw: "" })); onSaved();
  }, "코레일 계정을 지웠습니다");
  return html`<div class="card">
    <div class="bar"><b>내 코레일 계정</b>
      ${masked ? html`<${Badge} tone="green">${masked}<//>` : html`<${Badge} tone="red">미등록<//>`}<span class="grow"></span>
      ${!open && html`<button class="btn sm ghost" onClick=${() => setOpen(true)}>${masked ? "바꾸기" : "등록"}</button>`}
      ${!open && masked && html`<button class="btn sm ghost" onClick=${remove}>지우기</button>`}</div>
    ${open && html`<div class="fgrid" style="margin-top:8px">
        <${Field} label="아이디" hint="회원번호·휴대폰번호(하이픈 없이)·이메일"><input autocomplete="off" value=${id} onInput=${e => setId(e.target.value)} /><//>
        <${Field} label="비밀번호" hint="암호화해서 저장 — 화면에 다시 보이지 않습니다"><input type="password" autocomplete="new-password" value=${pw} onInput=${e => setPw(e.target.value)} /><//>
      </div>
      <div class="bar"><span class="grow"></span><button class="btn ghost" onClick=${() => setOpen(false)}>취소</button><button class="btn primary" onClick=${save}>저장</button></div>
      <p class="note">비밀번호가 틀리면 감시를 바로 멈춥니다 (코레일은 로그인 실패가 쌓이면 계정을 잠급니다). 카카오·네이버 간편로그인 계정은 코레일 홈페이지에서 비밀번호를 먼저 만들어야 합니다.</p>`}
  </div>`;
}

export function KtxPage({ app }) {
  const [jobs, setJobs] = useState(null);
  const [worker, setWorker] = useState(undefined);
  const [masked, setMasked] = useState(undefined);
  const [f, setF] = useState(() => ({ dep: load("dep") || "서울", arr: load("arr") || "부산", date: "", from: "18:00", to: "21:00",
    adults: Number(load("adults")) || 1, seat: load("seat") || "일반실", standby: false, ktxOnly: true, interval: 5 }));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const [끊김, set끊김] = useState(0);
  const refresh = async () => {
    try {
      setJobs(await q(app.db.from("ktx_jobs").select("*").order("created_at", { ascending: false }).limit(20)));
      setWorker((await q(app.db.from("ktx_worker").select("*")))[0] || null);
      set끊김(0);
    } catch { set끊김(x => x + 1); }
  };
  const loadAccount = async () => { try { setMasked(await q(app.db.rpc("my_ktx_account"))); } catch { setMasked(null); } };
  useEffect(() => {
    refresh(); loadAccount();
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 5000);
    const back = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, []);
  const 연결초 = worker?.seen_at ? Math.round((Date.now() - Date.parse(worker.seen_at)) / 1000) : null;
  const 살아있음 = 연결초 !== null && 연결초 < 90;
  const start = () => run(async () => {
    if (!masked) throw new Error("먼저 내 코레일 계정을 등록하세요");
    if (!f.dep.trim() || !f.arr.trim()) throw new Error("출발역·도착역을 넣으세요");
    if (f.dep.trim() === f.arr.trim()) throw new Error("출발역과 도착역이 같습니다");
    if (!f.date) throw new Error("날짜를 고르세요");
    if (!f.from || !f.to || f.from > f.to) throw new Error("출발 시간대를 확인하세요 (앞 시각이 뒤 시각보다 늦습니다)");
    if (f.date === today() && f.to <= 지금시각()) throw new Error("이미 지난 시간대입니다");
    keep("dep", f.dep.trim()); keep("arr", f.arr.trim()); keep("adults", String(f.adults)); keep("seat", f.seat);
    await q(app.db.from("ktx_jobs").insert({ dep: f.dep.trim(), arr: f.arr.trim(), dep_date: f.date, time_from: f.from, time_to: f.to,
      adults: Number(f.adults), seat: f.seat, standby: f.standby, ktx_only: f.ktxOnly, interval_s: Math.max(3, Number(f.interval) || 5) }));
    refresh();
  }, "감시를 요청했습니다 — 사무실 PC 가 곧 시작합니다");
  const stop = j => run(async () => { await q(app.db.from("ktx_jobs").update({ stop: true }).eq("id", j.id)); refresh(); }, "정지를 요청했습니다");
  const again = j => setF(x => ({ ...x, dep: j.dep, arr: j.arr, date: j.dep_date >= today() ? j.dep_date : "", from: j.time_from, to: j.time_to,
    adults: j.adults, seat: j.seat, standby: j.standby, ktxOnly: j.ktx_only, interval: Number(j.interval_s) }));

  return html`<div class="bar"><h2>KTX 예매</h2>
      <span class="muted small">매진 열차에 빈자리가 나오면 사무실 PC 가 내 코레일 계정으로 바로 예약하고 웍스 'TierONE 알림' 방으로 알립니다 — 결제는 코레일+ 앱에서</span><span class="grow"></span>
      ${worker === undefined ? "" : 살아있음 ? html`<${Badge} tone="green">감시 PC 연결됨<//>`
        : html`<${Badge} tone="red">감시 PC 꺼짐${연결초 !== null ? ` (${Math.round(연결초 / 60)}분 전)` : ""}<//>`}
      ${끊김 >= 2 && html`<${Badge} tone="amber" title="폰 인터넷이 잠깐 끊겼습니다. 감시는 사무실 PC 에서 계속됩니다.">새로고침 다시 시도 중<//>`}</div>
    <p class="note bad"><b>⚠ 주변인에게 링크 공유 금지.</b> 이 기능은 <b>예매 잡아주기만</b> 합니다 — 결제는 본인이 코레일+ 앱에서. 잡은 표를 되팔면 철도사업법 위반(과태료)입니다.</p>
    ${worker !== undefined && !살아있음 && html`<p class="note bad">사무실 PC 의 감시 프로그램이 응답하지 않습니다. PC 가 켜져 있는지, 작업 스케줄러 'KTX 예매 감시'가 돌고 있는지 확인하세요. 요청은 그대로 두면 PC 가 켜질 때 시작합니다.</p>`}

    ${masked !== undefined && html`<${AccountCard} app=${app} masked=${masked} onSaved=${loadAccount} />`}

    <div class="card reserve-new">
      <h3>새 감시</h3>
      <datalist id="ktx-stations">${STATIONS.map(s => html`<option value=${s} />`)}</datalist>
      <div class="fgrid">
        <${Field} label="출발역"><input list="ktx-stations" value=${f.dep} onInput=${e => set("dep", e.target.value)} /><//>
        <${Field} label="도착역"><input list="ktx-stations" value=${f.arr} onInput=${e => set("arr", e.target.value)} />
          <button type="button" class="btn sm ghost" style="margin-top:4px" onClick=${() => setF(x => ({ ...x, dep: x.arr, arr: x.dep }))}>⇄ 바꾸기</button><//>
        <${Field} label="날짜" hint=${f.date ? `${요일(f.date)}요일` : ""}><input type="date" min=${today()} value=${f.date} onInput=${e => set("date", e.target.value)} /><//>
        <${Field} label="출발 시간대" hint="이 사이에 출발하는 열차를 모두 봅니다">
          <div class="bar" style="gap:6px"><input type="time" value=${f.from} onInput=${e => set("from", e.target.value)} /> ~
            <input type="time" value=${f.to} onInput=${e => set("to", e.target.value)} /></div><//>
        <${Field} label="인원 (어른)"><select value=${f.adults} onChange=${e => set("adults", Number(e.target.value))}>
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => html`<option value=${n}>${n}명</option>`)}</select><//>
        <${Field} label="좌석"><${Seg} value=${f.seat} onChange=${v => set("seat", v)} options=${[["일반실", "일반실"], ["특실", "특실"], ["아무거나", "아무거나"]]} /><//>
        <${Field} label="예약대기" hint=${f.standby ? "빈자리가 없으면 예약대기를 걸고 멈춥니다. 좌석 확보는 아니고, 배정되면 코레일이 따로 알려 줍니다." : "빈자리가 날 때까지 계속 봅니다"}>
          <${Seg} value=${f.standby ? "y" : "n"} onChange=${v => set("standby", v === "y")} options=${[["n", "안 함"], ["y", "빈자리 없으면 신청"]]} /><//>
        <${Field} label="열차" hint=${f.ktxOnly ? "KTX·KTX-산천·KTX-이음" : "무궁화·ITX 도 포함"}>
          <${Seg} value=${f.ktxOnly ? "y" : "n"} onChange=${v => set("ktxOnly", v === "y")} options=${[["y", "KTX만"], ["n", "전체"]]} /><//>
        <${Field} label="확인 간격 (초)" hint="3초 이상 · 기본 5초 (너무 잦으면 코레일이 막습니다)"><input inputmode="numeric" value=${f.interval} onInput=${e => set("interval", e.target.value.replace(/[^\d]/g, ""))} /><//>
      </div>
      <div class="bar"><span class="grow"></span><button class="btn primary" onClick=${start}>▶ 감시 시작</button></div>
    </div>

    ${!jobs ? html`<${Loading} />` : !jobs.length ? html`<p class="muted">아직 요청이 없습니다.</p>` : jobs.map(j => html`<div class="card reserve-job" key=${j.id}>
      <div class="bar"><b>${j.dep} → ${j.arr} · ${j.dep_date}(${요일(j.dep_date)}) ${j.time_from}~${j.time_to}</b>
        <${Badge} tone=${TONE[j.status]}>${j.status}${j.stop && ["대기", "감시중"].includes(j.status) ? " (정지 요청)" : ""}<//><span class="grow"></span>
        ${["대기", "감시중"].includes(j.status) && !j.stop ? html`<button class="btn sm danger" onClick=${() => stop(j)}>■ 정지</button>`
          : html`<button class="btn sm ghost" onClick=${() => again(j)}>같은 조건으로</button>`}</div>
      <div class="small">어른 ${j.adults}명 · ${j.seat}${j.standby ? " · 예약대기" : ""}${j.ktx_only ? "" : " · 전체 열차"} <span class="muted">· ${Number(j.interval_s)}초마다</span></div>
      ${j.result && html`<div class=${"small " + (["확보", "대기접수"].includes(j.status) ? "green" : j.status === "실패" ? "red" : "")} style="margin-top:4px"><b>${j.result}</b></div>`}
      ${j.log?.length > 0 && html`<details open=${j.status === "감시중"}><summary class="small muted">기록 ${j.log.length}줄</summary>
        <pre class="reserve-log">${j.log.slice(-12).join("\n")}</pre></details>`}
    </div>`)}
    <p class="note">사무실 PC 의 감시 프로그램이 코레일+ 앱과 같은 방식으로 내 계정에 접속해 감시합니다. 잡히면 예약(결제 전)까지만 하니,
      알림을 받으면 코레일+ 앱 → 승차권 확인에서 결제 기한 안에 결제하세요. 기한이 지나면 자동 취소됩니다.</p>`;
}
