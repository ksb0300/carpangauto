// 근태(웍스테스트) (2026-10-22) — 네이버웍스 근태(체험판) 화면을 그대로 옮겨 본 것. 사무실(대표·사무장)만.
//   기존 '근태 (시험)'과 같은 표(att_days·att_leaves·att_settings·att_people)를 쓰고, 웍스에만 있는 것은 20261022000001_att_works.sql
//   내 업무(근태 관리): 출퇴근(ON·PAUSE·OFF) / 나의 부재 일정 / 출퇴근 현황(+근무 결과 신청) / 근로 시간 현황(그래프·표)
//   관리자(대표): Dashboard·Timeline / 출퇴근 현황(달력형) / 근로 시간 현황 / 근무 결과 신청 현황 / 부재 일정 현황 / 연차 조회/수정
//                근무 대상자 관리 / 근무 방식 관리 / 부재 항목 관리
//   웍스에서 뺀 것: 출장비·경조금, 근로 시간 마감, 탄력·선택·교대 근무제, 출퇴근 버튼 명칭, 데이터 불러오기
import { html, useState, useEffect, Loading, run, ask, today, Field, Seg, Badge, downloadCsv } from "../ui.js";
import { q } from "../db.js";
import { 보내기 as 알림 } from "../push.js";
import { 구성원, 이름표, Avatar, 날짜시각 } from "../people.js";

const 주소 = "/office/#/att-works";
const 요일 = "일월화수목금토";
const 한국 = t => new Date(Date.parse(t) + 9 * 3600e3);
const 시각 = t => t ? 한국(t).toISOString().slice(11, 16) : "";
const hm = m => { m = Math.max(0, Math.round(m || 0)); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const 분of = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; };
const 자정 = d => Date.parse(d + "T00:00:00+09:00");
const 하루분 = (t, d) => (Date.parse(t) - 자정(d)) / 60000;            // 그날 0시부터 몇 분
const 겹침 = (a, b, x, y) => Math.max(0, Math.min(b, y) - Math.max(a, x));
const 더하기 = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const 요일of = d => new Date(d + "T00:00:00Z").getUTCDay();
const 날글 = d => `${+d.slice(5, 7)}.${d.slice(8, 10)} (${요일[요일of(d)]})`;   // 웍스처럼 10.18 (일)
const 날들 = (a, b) => { const out = []; for (let x = a; x <= b; x = 더하기(x, 1)) out.push(x); return out; };
const 기간글 = l => l.d_from === l.d_to ? 날글(l.d_from) : `${날글(l.d_from)} ~ ${날글(l.d_to)}`;
const 주범위 = d => { const s = 더하기(d, -요일of(d)); return { mode: "1주", from: s, to: 더하기(s, 6) }; };
const 월범위 = d => { const [y, m] = d.split("-").map(Number); return { mode: "월", from: d.slice(0, 7) + "-01", to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; };
const 달옮김 = (d, n) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); };
const 근무방식명 = "고정 근무제(출근/퇴근 체크)";

/** 부재 항목 (웍스 '부재 항목 관리' 기본 + 원래 근태의 반차·병가·기타)
 *  [이름, 휴가 구분, 시간 단위, 연차 차감, 근로 시간에 합산(기록이 없어도 기준 근로를 일반으로 셈, 반일은 절반)] */
const 부재항목 = [
  ["연차", "연차", "종일", true, true], ["오전반차", "연차", "반일", true, true], ["오후반차", "연차", "반일", true, true],
  ["출장", "출장", "종일", false, true], ["외근", "해당 없음", "종일", false, true], ["재택 근무", "해당 없음", "종일", false, false],
  ["경조 휴가", "경조 휴가", "종일", false, true], ["보건 휴가", "특별 휴가", "종일", false, true], ["포상 휴가", "특별 휴가", "종일", false, true],
  ["대체 휴무", "특별 휴가", "종일", false, true], ["병가", "해당 없음", "종일", false, false], ["기타", "해당 없음", "종일", false, false],
];
const 항목 = k => 부재항목.find(x => x[0] === k) || [k, "해당 없음", "종일", false, false];
const 반일 = k => 항목(k)[2] === "반일";

/* ───── 계산 ───── */
const 휴일 = (D, d) => [0, 6].includes(요일of(d)) || D.holidays.includes(d);
/** 그 사람 근무 방식 (사람마다 시간이 있으면 그것, 없으면 기본). 분 단위 */
function 기준of(D, uid) {
  const p = D.people.find(x => x.user_id === uid) || D.s, s = D.s;
  const start = 분of(p.start_time), end = 분of(p.end_time), bs = 분of(s.brk_start || "12:00"), be = 분of(s.brk_end || "13:00");
  return { start, end, bs, be, 기준: Math.max(0, end - start - 겹침(start, end, bs, be)), late: s.late_min || 0, early: s.early_min || 0, 개인: p !== s };
}
const 부재of = (D, uid, d) => D.leaves.find(l => l.user_id === uid && l.status === "승인" && l.d_from <= d && l.d_to >= d);
const 지금분 = () => (Date.now() - 자정(today())) / 60000;
/** 하루 — 웍스 '근로 시간 현황' 칸 그대로 (분). 주말·공휴일은 휴일 칸, 22~06시는 야간 */
function 하루(D, uid, d, now = Date.now()) {
  const r = D.days.find(x => x.user_id === uid && x.d === d), l = 부재of(D, uid, d), b = 기준of(D, uid), hol = 휴일(D, d);
  const o = { d, r, l, hol, b, 일반: 0, 연장: 0, 야간: 0, 휴일일반: 0, 휴일연장: 0, 휴일야간: 0, 합계: 0, 휴게: 0, 지각: false, 조퇴: false, 미퇴근: false, 미출근: false };
  if (r?.in_at) {
    const a = 하루분(r.in_at, d), 끝 = r.out_at ? Date.parse(r.out_at) : d === today() ? now : null;
    if (끝 != null) {
      const z = (끝 - 자정(d)) / 60000;
      o.휴게 = 겹침(a, z, b.bs, b.be) + (r.brk_min || 0) + (r.brk_at && !r.out_at ? Math.max(0, (now - Date.parse(r.brk_at)) / 60000) : 0);
      const 일 = Math.max(0, z - a - o.휴게), 밤 = Math.min(일, 겹침(a, z, 0, 360) + 겹침(a, z, 1320, 1800)), 낮 = 일 - 밤;
      if (hol) { o.휴일일반 = Math.min(낮, 480); o.휴일연장 = 낮 - o.휴일일반; o.휴일야간 = 밤; }
      else { o.일반 = Math.min(낮, b.기준); o.연장 = 낮 - o.일반; o.야간 = 밤; }
      o.합계 = 일;
    }
    // 오후반차가 아닌 부재(연차·오전반차·출장·외근…)면 지각 안 봄, 오전반차가 아닌 부재면 조퇴 안 봄
    o.지각 = !hol && !(l && l.kind !== "오후반차") && a > b.start + b.late;
    o.조퇴 = !hol && !(l && l.kind !== "오전반차") && !!r.out_at && 하루분(r.out_at, d) < b.end - b.early;
    o.미퇴근 = !r.out_at && d < today();
  } else o.미출근 = d === today() && !l && !hol && 지금분() > b.start + b.late;
  // 근로 시간에 합산되는 부재 (연차·출장·외근…): 종일이면 기록 없을 때 기준만큼, 반일이면 절반을 일반에 더한다
  if (l && !hol && 항목(l.kind)[4] && d <= today()) {
    const 더 = 반일(l.kind) ? b.기준 / 2 : r?.in_at ? 0 : b.기준, 새일반 = Math.min(b.기준, o.일반 + 더);
    o.합계 += 새일반 - o.일반; o.일반 = 새일반; o.인정 = 더 > 0;
  }
  return o;
}
const 일수 = (D, l) => 반일(l.kind) ? 0.5 : 날들(l.d_from, l.d_to).filter(d => !휴일(D, d)).length;
function 연차of(D, uid, yr) {
  const a = D.annual.find(x => x.user_id === uid && x.yr === yr) || {};
  const 발생 = Number(a.granted || 0), 조정 = Number(a.adjust || 0);
  const 사용 = D.leaves.filter(l => l.user_id === uid && l.status === "승인" && 항목(l.kind)[3] && l.d_from.startsWith(String(yr))).reduce((s, l) => s + 일수(D, l), 0);
  return { a, 발생, 조정, 총: 발생 + 조정, 사용, 잔여: 발생 + 조정 - 사용 };
}
const 상태표 = x => x.status === "승인" ? html`<${Badge} tone="green">승인<//>` : x.status === "반려" ? html`<${Badge} tone="red">반려<//>` : html`<${Badge} tone="amber">승인 대기<//>`;
const 표시 = o => [o.지각 && ["지각", "red"], o.조퇴 && ["조퇴", "red"], o.미퇴근 && ["퇴근 미체크", "red"], o.r?.brk_at && !o.r?.out_at && ["휴게 중", "amber"]].filter(Boolean)
  .map(([t, c]) => html`<${Badge} tone=${c}>${t}<//> `);
const 장소 = p => p === "외부" ? html` <${Badge} tone="amber">외부<//>` : "";
/** 폰 위치 (안 되면 null — 기록은 그대로 되고 '위치 없음'). 위치 권한 창에 답이 없으면 10초 뒤 포기 */
const 위치 = () => new Promise(ok => {
  if (!navigator.geolocation) return ok(null);
  const t = setTimeout(() => ok(null), 10000);
  navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); ok(p.coords); }, () => { clearTimeout(t); ok(null); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});
const 대표들 = (D, me) => D.members.filter(m => m.role === "admin" && m.user_id !== me).map(m => m.user_id);

/* ───── 페이지 ───── */
const 내메뉴 = ["근태 관리", [["clock", "출퇴근"], ["absence", "나의 부재 일정"], ["commute", "출퇴근 현황"], ["time", "근로 시간 현황"]]];
const 관리메뉴 = [
  ["근태 현황 (관리자)", [["dash", "Dashboard"], ["m-commute", "출퇴근 현황"], ["m-time", "근로 시간 현황"], ["m-fix", "근무 결과 신청 현황"], ["m-absence", "부재 일정 현황"], ["m-annual", "연차 조회/수정"]]],
  ["근무", [["m-person", "근무 대상자 관리"], ["m-work", "근무 방식 관리"]]],
  ["부재", [["m-item", "부재 항목 관리"]]],
];

export function AttWorksPage({ app, tab }) {
  const admin = app.profile.role === "admin";
  const 메뉴 = admin ? [내메뉴, ...관리메뉴] : [내메뉴];
  const 모든 = 메뉴.flatMap(([, xs]) => xs);
  const cur = 모든.some(([k]) => k === tab) ? tab : "clock";
  const 제목 = 모든.find(([k]) => k === cur)[1];
  const [rng, setRng] = useState(() => 주범위(today()));
  const [D, setD] = useState(null);
  const load = () => run(async () => {
    const t = today(), from = rng.from < t ? rng.from : t, to = rng.to > t ? rng.to : t;
    const [[s], days, leaves, members, hol, people, fixes, annual] = await Promise.all([
      q(app.db.from("att_settings").select("*")),
      q(app.db.from("att_days").select("*").gte("d", 더하기(from, -1)).lte("d", to)),
      q(app.db.from("att_leaves").select("*").order("d_from", { ascending: false }).limit(2000)),
      구성원(app),
      app.db.rpc("office_holidays"),
      q(app.db.from("att_people").select("*")),
      q(app.db.from("att_fixes").select("*").order("created_at", { ascending: false }).limit(500)),
      q(app.db.from("att_annual").select("*")),
    ]);
    setD({ s, days, leaves, members: members.filter(m => m.role !== "dealer"), holidays: hol.data || [], people, fixes, annual });
  });
  useEffect(() => { load(); }, [rng.from, rng.to]);
  const 대기 = D ? { "m-absence": D.leaves.filter(l => l.status === "신청").length, "m-fix": D.fixes.filter(f => f.status === "신청").length } : {};
  const P = { app, D, load, rng, setRng, admin };
  const 화면 = {
    clock: 출퇴근, absence: 나의부재, commute: 내출퇴근, time: 내근로,
    dash: 대시보드, "m-commute": 관리출퇴근, "m-time": 관리근로, "m-fix": 결과신청현황, "m-absence": 부재현황, "m-annual": 연차관리,
    "m-person": 대상자관리, "m-work": 근무방식관리, "m-item": 부재항목관리,
  }[cur];
  return html`<div class="aw">
    <aside class="aw-lnb">
      <div class="aw-logo">🕘 근태 <span class="muted small">웍스테스트</span></div>
      ${메뉴.map(([g, xs]) => html`<div class="aw-grp">${g}</div>
        ${xs.map(([k, l]) => html`<a href=${"#/att-works/" + k} class=${k === cur ? "on" : ""}>${l}${대기[k] ? html` <b class="aw-n">${대기[k]}</b>` : ""}</a>`)}`)}
    </aside>
    <section class="aw-main">
      <div class="bar"><h2>${제목}</h2>${cur === "commute" && html`<span class="badge">근무 일정</span>`}<span class="grow"></span>
        <span class="muted small">${admin ? "관리자" : "사용자"} · <a href="#/attendance">근태 (시험)</a>과 같은 기록</span></div>
      ${!D ? html`<${Loading} />` : html`<${화면} ...${P} />`}
    </section>
  </div>`;
}

/** 기간 고르기 (웍스: 기간 1주/월 + 날짜 + 휴일 제외) */
function 기간({ rng, setRng, 제외, set제외, 월만 }) {
  const 옮김 = n => setRng(rng.mode === "월" ? 월범위(달옮김(rng.from, n)) : 주범위(더하기(rng.from, 7 * n)));
  return html`<div class="aw-filter">
    <span class="aw-lab">기간</span>
    ${!월만 && html`<select value=${rng.mode} onChange=${e => setRng(e.target.value === "월" ? 월범위(rng.from) : 주범위(rng.from))}><option selected=${rng.mode === "1주"}>1주</option><option selected=${rng.mode === "월"}>월</option></select>`}
    <button class="btn sm ghost" title="이전" onClick=${() => 옮김(-1)}>◀</button>
    <b class="aw-range">${rng.mode === "월" ? `${rng.from.slice(0, 4)}년 ${+rng.from.slice(5, 7)}월` : `${rng.from.replace(/-/g, ".")} ~ ${rng.to.replace(/-/g, ".")}`}</b>
    <button class="btn sm ghost" title="다음" onClick=${() => 옮김(1)}>▶</button>
    <button class="btn sm" onClick=${() => setRng(rng.mode === "월" ? 월범위(today()) : 주범위(today()))}>오늘</button>
    ${set제외 && html`<label class="aw-chk"><input type="checkbox" checked=${제외} onChange=${e => set제외(e.target.checked)} /> 휴일 제외</label>`}
  </div>`;
}
/** 월 화면은 들어올 때 월 기간으로 */
const use월 = (rng, setRng) => useEffect(() => { if (rng.mode !== "월") setRng(월범위(rng.from > today() ? today() : rng.to > today() ? today() : rng.from)); }, []);

/* ───────── 출퇴근 (웍스 홈·앱의 ON / PAUSE / OFF 버튼) ───────── */
function 출퇴근({ app, D, load }) {
  const me = app.user.id;
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(h); }, []);
  const o = 하루(D, me, today(), now), r = o.r, b = o.b;
  const rpc = async (f, a) => { const { data, error } = await app.db.rpc(f, a); if (error) throw new Error(error.message); return data; };
  const 찍기 = kind => run(async () => {
    setBusy(true);
    try {
      if (kind === "PAUSE") await rpc("att_pause");
      else {
        if (kind === "퇴근" && r?.brk_at) await rpc("att_pause");             // 휴게 중에 퇴근하면 휴게부터 끝낸다
        const c = await 위치();
        await rpc("att_clock", { p_kind: kind, p_lat: c?.latitude ?? null, p_lng: c?.longitude ?? null, p_acc: c?.accuracy ?? null });
      }
      await load();
    } finally { setBusy(false); }
  }, kind === "출근" ? "출근했습니다" : kind === "퇴근" ? "퇴근했습니다" : r?.brk_at ? "휴게를 마쳤습니다" : "휴게를 시작했습니다");
  const k = 한국(new Date(now).toISOString());
  return html`<div class="card aw-clock">
      <div class="muted">${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(k.getUTCDate()).padStart(2, "0")} (${요일[k.getUTCDay()]})</div>
      <div class="aw-time">${k.toISOString().slice(11, 16)}</div>
      <div class="small muted">${근무방식명} · ${hm(b.start)} ~ ${hm(b.end)} · 휴게 ${hm(b.bs)} ~ ${hm(b.be)}</div>
      <div class="aw-btns">
        <button class="aw-b on" disabled=${busy || !!r?.in_at} onClick=${() => 찍기("출근")}><b>ON</b><span>${r?.in_at ? `출근 ${시각(r.in_at)}` : "출근"}</span></button>
        <button class="aw-b pause" disabled=${busy || !r?.in_at || !!r?.out_at} onClick=${() => 찍기("PAUSE")}><b>PAUSE</b><span>${r?.brk_at && !r?.out_at ? "휴게 종료" : "휴게 시작"}</span></button>
        <button class="aw-b off" disabled=${busy || !r?.in_at} onClick=${() => (!r.out_at || ask("퇴근 시각을 지금으로 다시 찍을까요?")) && 찍기("퇴근")}><b>OFF</b><span>${r?.out_at ? `퇴근 ${시각(r.out_at)}` : "퇴근"}</span></button>
      </div>
      <div class="aw-today">
        <div><span>출근</span><b>${r?.in_at ? 시각(r.in_at) : "--:--"}</b>${장소(r?.in_place)}</div>
        <div><span>휴게</span><b>${hm(o.휴게)}</b>${r?.brk_at && !r?.out_at ? html` <${Badge} tone="amber">${시각(r.brk_at)}부터 휴게 중<//>` : ""}</div>
        <div><span>퇴근</span><b>${r?.out_at ? 시각(r.out_at) : "--:--"}</b>${장소(r?.out_place)}</div>
        <div><span>근로</span><b>${hm(o.합계)}</b><small class="muted"> / 기준 ${hm(b.기준)}</small></div>
      </div>
      <div>${o.l ? html`<${Badge} tone="blue">${o.l.kind}<//> ` : ""}${표시(o)}${o.미출근 ? html`<${Badge} tone="red">미출근<//>` : ""}</div>
      ${D.s.office_lat == null && html`<p class="note small">사무실 위치가 아직 없어 '위치 없음'으로 찍힙니다 (관리자 → 근무 방식 관리에서 정함).</p>`}
    </div>
    <p class="muted small">점심 휴게(${hm(b.bs)}~${hm(b.be)})는 자동으로 빠지고, 그 밖에 쉬는 시간은 PAUSE로 찍습니다. 잘못 찍었으면 출퇴근 현황 → 근무 결과 신청.</p>`;
}

/* ───────── 나의 부재 일정 ───────── */
function 나의부재({ app, D, load }) {
  const me = app.user.id;
  const [yr, setYr] = useState(+today().slice(0, 4)), [kind, setKind] = useState(""), [만연차, set만연차] = useState(false);
  const [접기, set접기] = useState(false), [쓰기, set쓰기] = useState(false);
  const a = 연차of(D, me, yr);
  const rows = D.leaves.filter(l => l.user_id === me && (l.d_from.startsWith(String(yr)) || l.d_to.startsWith(String(yr))) && (!kind || l.kind === kind) && (!만연차 || 항목(l.kind)[1] === "연차"));
  const 취소 = l => ask("이 신청을 취소할까요?") && run(async () => { await q(app.db.from("att_leaves").delete().eq("id", l.id)); load(); }, "취소했습니다");
  return html`<div class="aw-box">
      <button class="aw-boxhead" onClick=${() => set접기(!접기)}>남은 연차 <b class="blue">${a.잔여}일</b> / 총 연차 <b class="blue">${a.총}일</b><span class="grow"></span>${접기 ? "▾" : "▴"}</button>
      ${!접기 && html`<div class="aw-boxbody"><div class="muted small" style="margin-bottom:6px">사용 기간 ${yr}.01.01 ~ ${yr}.12.31</div>
        <div class="aw-kv"><span>연도별 연차</span><b class="blue">${a.발생}일</b><span>조정 연차</span><b class="blue">${a.조정}일</b>
          <span>사용 일수</span><b class="blue">${a.사용}일</b><span>남은 연차</span><b class="blue">${a.잔여}일</b></div>
        ${a.a.memo ? html`<div class="small muted">${a.a.memo}</div>` : ""}</div>`}
    </div>
    <div class="bar" style="margin-top:16px"><h3 style="margin:0">전체 부재 일정</h3><span class="grow"></span><button class="btn primary" onClick=${() => set쓰기(true)}>부재 일정 신청</button></div>
    ${쓰기 && html`<${부재쓰기} app=${app} D=${D} load=${load} onClose=${() => set쓰기(false)} />`}
    <div class="aw-filter">
      <span class="aw-lab">연도</span><select value=${yr} onChange=${e => setYr(+e.target.value)}>${[1, 0, -1].map(n => +today().slice(0, 4) + n).map(y => html`<option value=${y} selected=${y === yr}>${y}</option>`)}</select>
      <span class="aw-lab">부재 항목</span><select value=${kind} onChange=${e => setKind(e.target.value)}><option value="">전체</option>${부재항목.map(([k]) => html`<option selected=${k === kind}>${k}</option>`)}</select>
      <label class="aw-chk"><input type="checkbox" checked=${만연차} onChange=${e => set만연차(e.target.checked)} /> 연차 내역만 보기</label>
    </div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>부재 항목</th><th class="r">일수</th><th>기간</th><th>사유</th><th>상태</th><th></th></tr></thead>
      <tbody>${!rows.length ? html`<tr><td colspan="6" class="c muted aw-empty">나타낼 내용이 없습니다.</td></tr>` : rows.map(l => html`<tr>
        <td>${l.kind}</td><td class="r">${일수(D, l)}</td><td>${기간글(l)}</td><td class="small">${l.memo || ""}</td>
        <td>${상태표(l)} <span class="small muted">${l.decided_by || ""}</span></td>
        <td class="r">${l.status === "신청" && html`<button class="btn sm ghost" onClick=${() => 취소(l)}>취소</button>`}</td></tr>`)}</tbody></table></div>`;
}

/** 부재 일정 신청(본인) / 작성(관리자: 사람 골라 바로 승인으로) */
function 부재쓰기({ app, D, load, onClose, 대리 }) {
  const me = app.user.id;
  const [f, setF] = useState({ user_id: me, kind: "연차", d_from: today(), d_to: today(), memo: "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === "d_from" && x.d_to < v ? { d_to: v } : {}) }));
  const 저장 = () => run(async () => {
    const row = { user_id: f.user_id, kind: f.kind, d_from: f.d_from, d_to: 반일(f.kind) ? f.d_from : f.d_to, memo: f.memo.trim() || null };
    if (대리) Object.assign(row, { status: "승인", decided_by: app.profile.name, decided_at: new Date().toISOString() });
    await q(app.db.from("att_leaves").insert(row));
    const 받는이 = 대리 ? (row.user_id !== me ? [row.user_id] : []) : 대표들(D, me);
    if (받는이.length) await 알림(app, { title: 대리 ? `🕘 부재 일정 등록: ${row.kind}` : `🕘 부재 일정 신청: ${app.profile.name} ${row.kind}`, body: `${기간글(row)}${row.memo ? " · " + row.memo : ""}`,
      url: 주소 + (대리 ? "/absence" : "/m-absence"), tag: "att-leave", to_users: 받는이, pref: "att" });
    onClose(); load();
  }, 대리 ? "등록했습니다" : "신청했습니다");
  return html`<div class="card"><h3>${대리 ? "부재 일정 작성" : "부재 일정 신청"}</h3><div class="fgrid">
      ${대리 && html`<${Field} label="사원"><select value=${f.user_id} onChange=${e => set("user_id", e.target.value)}>${D.members.map(m => html`<option value=${m.user_id} selected=${m.user_id === f.user_id}>${m.name}</option>`)}</select><//>`}
      <${Field} label="부재 항목"><select value=${f.kind} onChange=${e => set("kind", e.target.value)}>${부재항목.map(([k]) => html`<option selected=${k === f.kind}>${k}</option>`)}</select><//>
      <${Field} label=${반일(f.kind) ? "날짜 (반일)" : "시작일"}><input type="date" value=${f.d_from} onInput=${e => set("d_from", e.target.value)} /><//>
      ${!반일(f.kind) && html`<${Field} label="종료일"><input type="date" value=${f.d_to} min=${f.d_from} onInput=${e => set("d_to", e.target.value)} /><//>`}
      <${Field} label="사유" wide><input value=${f.memo} placeholder="예: 병원 · 탁송 동행 (서울)" onInput=${e => set("memo", e.target.value)} /><//>
    </div><div class="bar"><span class="muted small">${대리 ? "관리자가 쓰면 바로 승인으로 들어갑니다" : `대표가 승인하면 반영됩니다 · ${일수(D, { ...f, d_to: 반일(f.kind) ? f.d_from : f.d_to })}일${항목(f.kind)[3] ? " (연차 차감)" : ""}`}</span><span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>취소</button><button class="btn primary" onClick=${저장}>${대리 ? "등록" : "신청"}</button></div></div>`;
}

/* ───────── 출퇴근 현황 (내 것) + 근무 결과 신청 ───────── */
function 내출퇴근({ app, D, load, rng, setRng }) {
  const me = app.user.id;
  const [제외, set제외] = useState(false), [신청, set신청] = useState(null);
  const xs = 날들(rng.from, rng.to).filter(d => d <= today() && !(제외 && 휴일(D, d))).reverse().map(d => 하루(D, me, d)).filter(o => o.r || o.l);
  const mine = D.fixes.filter(f => f.user_id === me);
  const 대기중 = d => mine.find(f => f.d === d && f.status === "신청");
  const 취소 = f => ask("근무 결과 신청을 취소할까요?") && run(async () => { await q(app.db.from("att_fixes").delete().eq("id", f.id)); load(); }, "취소했습니다");
  const 열기 = (d, r) => set신청({ d, in_t: r?.in_at ? 시각(r.in_at) : "", out_t: r?.out_at ? 시각(r.out_at) : "", brk: r ? String(r.brk_min || 0) : "", memo: "" });
  return html`<${기간} rng=${rng} setRng=${setRng} 제외=${제외} set제외=${set제외} />
    <div class="bar"><span class="muted small">기록이 틀렸거나 안 찍힌 날은 '근무 결과 신청' → 대표 승인 후 반영됩니다.</span><span class="grow"></span>
      <button class="btn" onClick=${() => 열기(today(), null)}>근무 결과 신청</button></div>
    ${신청 && html`<${결과쓰기} app=${app} D=${D} load=${load} f0=${신청} onClose=${() => set신청(null)} />`}
    <div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>출근</th><th>퇴근</th><th class="r">휴게</th><th>부재</th><th>상세</th></tr></thead>
      <tbody>${!xs.length ? html`<tr><td colspan="6" class="c muted aw-empty">나타낼 내용이 없습니다.</td></tr>` : xs.map(o => html`<tr class=${o.hol ? "aw-hol" : ""}>
        <td>${날글(o.d)}</td><td>${o.r?.in_at ? 시각(o.r.in_at) : ""}${장소(o.r?.in_place)}</td><td>${o.r?.out_at ? 시각(o.r.out_at) : ""}${장소(o.r?.out_place)}</td>
        <td class="r">${o.r?.in_at ? hm(o.휴게) : ""}</td><td>${o.l ? html`<${Badge} tone="blue">${o.l.kind}<//>` : ""}</td>
        <td>${표시(o)}${o.r?.edited_by ? html`<span class="small muted" title=${날짜시각(o.r.edited_at)}>(${o.r.edited_by} 고침) </span>` : ""}
          ${대기중(o.d) ? html`<${Badge} tone="amber">정정 승인 대기<//>` : html`<button class="btn sm ghost" onClick=${() => 열기(o.d, o.r)}>근무 결과 신청</button>`}</td></tr>`)}</tbody></table></div>
    ${mine.length > 0 && html`<h3>근무 결과 신청 내역</h3><div class="table-wrap"><table class="grid"><thead><tr><th>기준일</th><th>출근</th><th>퇴근</th><th class="r">휴게(분)</th><th>사유</th><th>작성일</th><th>상태</th><th></th></tr></thead>
      <tbody>${mine.map(f => html`<tr><td>${날글(f.d)}</td><td>${f.in_t?.slice(0, 5) || ""}</td><td>${f.out_t?.slice(0, 5) || ""}</td><td class="r">${f.brk_min ?? ""}</td>
        <td class="small">${f.memo}</td><td class="small">${날짜시각(f.created_at)}</td><td>${상태표(f)} <span class="small muted">${f.decided_by || ""}</span></td>
        <td class="r">${f.status === "신청" && html`<button class="btn sm ghost" onClick=${() => 취소(f)}>취소</button>`}</td></tr>`)}</tbody></table></div>`}`;
}

/** 근무 결과 신청서 (웍스: 기준일·출근·퇴근·휴게·사유) */
function 결과쓰기({ app, D, load, f0, onClose }) {
  const [f, setF] = useState(f0);
  const 저장 = () => run(async () => {
    if (!f.memo.trim()) throw new Error("사유를 적어 주세요");
    if (!f.in_t && !f.out_t && f.brk === "") throw new Error("출근·퇴근·휴게 중 하나는 넣어 주세요");
    if (f.in_t && f.out_t && f.out_t <= f.in_t) throw new Error("퇴근이 출근보다 늦어야 합니다");
    await q(app.db.from("att_fixes").insert({ d: f.d, in_t: f.in_t || null, out_t: f.out_t || null, brk_min: f.brk === "" ? null : Number(f.brk), memo: f.memo.trim() }));
    const 받는이 = 대표들(D, app.user.id);
    if (받는이.length) await 알림(app, { title: `🕘 근무 결과 신청: ${app.profile.name}`, body: `${날글(f.d)} 출근 ${f.in_t || "-"} · 퇴근 ${f.out_t || "-"} · ${f.memo.trim()}`,
      url: 주소 + "/m-fix", tag: "att-fix", to_users: 받는이, pref: "att" });
    onClose(); load();
  }, "신청했습니다");
  return html`<div class="card"><h3>근무 결과 신청</h3><div class="fgrid">
      <${Field} label="기준일"><input type="date" value=${f.d} max=${today()} onInput=${e => setF({ ...f, d: e.target.value })} /><//>
      <${Field} label="출근"><input type="time" value=${f.in_t} onInput=${e => setF({ ...f, in_t: e.target.value })} /><//>
      <${Field} label="퇴근"><input type="time" value=${f.out_t} onInput=${e => setF({ ...f, out_t: e.target.value })} /><//>
      <${Field} label="개인 휴게 (분)" hint="점심 휴게 말고 따로 쉰 시간"><input inputmode="numeric" value=${f.brk} onInput=${e => setF({ ...f, brk: e.target.value.replace(/[^\d]/g, "") })} /><//>
      <${Field} label="사유" req wide><input value=${f.memo} placeholder="예: 퇴근 안 찍음 — 18:30 퇴근" onInput=${e => setF({ ...f, memo: e.target.value })} /><//>
    </div><div class="bar"><span class="muted small">대표가 승인하면 그날 기록이 이대로 바뀝니다</span><span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>취소</button><button class="btn primary" onClick=${저장}>신청</button></div></div>`;
}

/* ───────── 근로 시간 현황 (내 것): 일별·누적 그래프 + 표 ───────── */
const 칸들 = [["일반", "일반"], ["연장", "연장"], ["야간", "야간"], ["휴일일반", "휴일 일반"], ["휴일연장", "휴일 연장"], ["휴일야간", "휴일 야간"], ["합계", "합계"]];
const 더함 = xs => Object.fromEntries(칸들.map(([k]) => [k, xs.reduce((s, o) => s + o[k], 0)]));
function 내근로({ app, D, rng, setRng }) {
  const [제외, set제외] = useState(false), [g, setG] = useState("일별 그래프");
  const xs = 날들(rng.from, rng.to).filter(d => !(제외 && 휴일(D, d))).map(d => 하루(D, app.user.id, d));
  let 누합 = 0, 누기 = 0;
  const bars = xs.map(o => {
    const 기준 = o.hol ? 0 : o.b.기준, 일반 = o.일반 + o.휴일일반, 연장 = o.합계 - 일반;
    누합 += o.합계; 누기 += 기준;
    return g === "누적 그래프" ? { o, 일반: 누합, 연장: 0, 기준: 누기 } : { o, 일반, 연장, 기준 };
  });
  const top = Math.max(60, ...bars.map(x => Math.max(x.일반 + x.연장, x.기준))) * 1.1, pct = m => `${(m / top) * 100}%`;
  const 눈금 = top > 3000 ? 600 : top > 900 ? 120 : 60;
  const sum = 더함(xs);
  return html`<${기간} rng=${rng} setRng=${setRng} 제외=${제외} set제외=${set제외} />
    <div class="tabs"><${Seg} value=${g} onChange=${setG} options=${["일별 그래프", "누적 그래프"]} /></div>
    <div class="card aw-chart">
      <div class="aw-legend"><span><i class="c1"></i>${g === "누적 그래프" ? "누적 근로" : "일반"}</span>${g === "일별 그래프" && html`<span><i class="c2"></i>연장</span>`}<span><i class="cl"></i>기준 근로 시간</span></div>
      <div class="aw-plot">
        ${Array.from({ length: Math.floor(top / 눈금) + 1 }, (_, i) => html`<div class="aw-gl" style=${`bottom:${pct(i * 눈금)}`}><span>${Math.round(i * 눈금 / 60)}</span></div>`)}
        <div class="aw-cols">${bars.map(x => html`<div class="aw-col" title=${`${날글(x.o.d)}\n${g === "누적 그래프" ? "누적 " + hm(x.일반) : `일반 ${hm(x.일반)} · 연장 ${hm(x.연장)}`}\n기준 ${hm(x.기준)}`}>
          <div class="aw-stack">${x.연장 > 0 && html`<i class="c2" style=${`height:${pct(x.연장)}`}></i>`}${x.일반 > 0 && html`<i class="c1" style=${`height:${pct(x.일반)}`}></i>`}</div>
          ${x.기준 > 0 && html`<b class="aw-ref" style=${`bottom:${pct(x.기준)}`}></b>`}
          <span class=${"aw-x" + (x.o.hol ? " red" : "")}>${날글(x.o.d)}</span></div>`)}</div>
      </div>
      <div class="muted small">시간(h) · 막대에 손을 대면 값이 나옵니다</div>
    </div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th>${칸들.map(([, l]) => html`<th class="r">${l}</th>`)}</tr></thead>
      <tbody>${xs.map(o => html`<tr class=${o.hol ? "aw-hol" : ""}><td>${날글(o.d)}</td>${칸들.map(([k]) => html`<td class="r">${o.r?.in_at || o.인정 ? hm(o[k]) : ""}</td>`)}</tr>`)}</tbody>
      <tfoot><tr><td>합계</td>${칸들.map(([k]) => html`<td class="r">${hm(sum[k])}</td>`)}</tr></tfoot></table></div>`;
}

/* ───────── 관리자: Dashboard · Timeline ───────── */
function 대시보드({ D }) {
  const [t, setT] = useState("Dashboard"), [열림, set열림] = useState(null);
  const xs = D.members.map(m => ({ m, ...하루(D, m.user_id, today()) }));
  const 안찍음 = D.days.filter(r => r.in_at && !r.out_at && r.d < today() && r.d >= 더하기(today(), -7));
  const 카드 = [
    ["오늘의 부재자", xs.filter(x => x.l), x => x.l.kind],
    ["오늘의 지각", xs.filter(x => x.지각), x => `출근 ${시각(x.r.in_at)}`],
    ["오늘의 조퇴", xs.filter(x => x.조퇴), x => `퇴근 ${시각(x.r.out_at)}`],
    ["오늘의 미출근", xs.filter(x => x.미출근), x => `기준 ${hm(x.b.start)}`],
    ["지금 근무 중", xs.filter(x => x.r?.in_at && !x.r?.out_at), x => `출근 ${시각(x.r.in_at)}${x.r.brk_at ? " · 휴게 중" : ""}`],
    ["퇴근 미체크 (7일)", 안찍음.map(r => ({ m: D.members.find(m => m.user_id === r.user_id) || { name: "?" }, r })), x => 날글(x.r.d)],
  ];
  const 대기 = [["부재 일정 승인 대기", D.leaves.filter(l => l.status === "신청").length, "m-absence"], ["근무 결과 신청 대기", D.fixes.filter(f => f.status === "신청").length, "m-fix"]];
  const 사건 = D.days.filter(r => r.d === today()).flatMap(r => [[r.in_at, r.user_id, "출근", r.in_place], [r.brk_at && !r.out_at ? r.brk_at : null, r.user_id, "휴게 시작"], [r.out_at, r.user_id, "퇴근", r.out_place]])
    .filter(e => e[0]).sort((a, b) => b[0].localeCompare(a[0]));
  return html`<div class="bar"><${Seg} value=${t} onChange=${setT} options=${["Dashboard", "Timeline"]} /><span class="grow"></span><b>📅 ${today().replace(/-/g, ".")}</b></div>
    ${t === "Dashboard" ? html`<div class="aw-cards">
        ${카드.map(([이름, 목록, 설명]) => html`<button class=${"aw-card" + (열림 === 이름 ? " on" : "")} onClick=${() => set열림(열림 === 이름 ? null : 이름)}>
          <span>${이름} ›</span><b class=${목록.length && /지각|조퇴|미출근|미체크/.test(이름) ? "red" : "blue"}>${목록.length} <small>명</small></b>
          ${열림 === 이름 && html`<div class="aw-names">${목록.length ? 목록.map(x => html`<div><${Avatar} name=${x.m.name} id=${x.m.user_id} size=${20} /> ${x.m.name} <span class="muted small">${설명(x)}</span></div>`) : html`<span class="muted small">없습니다</span>`}</div>`}</button>`)}
        ${대기.map(([이름, n, k]) => html`<a class="aw-card" href=${"#/att-works/" + k}><span>${이름} ›</span><b class=${n ? "red" : "blue"}>${n} <small>건</small></b></a>`)}
      </div>`
    : html`<div class="card">${!사건.length ? html`<p class="muted c">나타낼 내용이 없습니다.</p>` : html`<ul class="aw-tl">${사건.map(([at, uid, k, p]) => html`<li>
        <b>${시각(at)}</b><${Avatar} name=${이름표(D.members, uid)} id=${uid} size=${22} /> ${이름표(D.members, uid)} <${Badge} tone=${k === "출근" ? "green" : k === "퇴근" ? "gray" : "amber"}>${k}<//>${장소(p)}</li>`)}</ul>`}</div>`}`;
}

/* ───────── 관리자: 출퇴근 현황 (달력형) + 기록 고치기 ───────── */
function 관리출퇴근({ app, D, load, rng, setRng }) {
  use월(rng, setRng);
  const [찾기, set찾기] = useState(""), [ed, setEd] = useState(null);
  useEffect(() => { const t = document.querySelector(".aw-cal td.today"), w = t?.closest(".table-wrap"); if (t && w) w.scrollLeft = Math.max(0, t.offsetLeft - w.clientWidth / 2); }, [rng.from, D]);
  const ds = 날들(rng.from, rng.to), ms = D.members.filter(m => !찾기 || m.name.includes(찾기.trim()));
  const iso = (d, t) => t ? new Date(`${d}T${t}:00+09:00`).toISOString() : null;
  const 저장 = () => run(async () => {
    if (ed.in && ed.out && ed.out <= ed.in) throw new Error("퇴근이 출근보다 늦어야 합니다");
    const old = D.days.find(t => t.user_id === ed.uid && t.d === ed.d) || {};
    await q(app.db.from("att_days").upsert({ user_id: ed.uid, d: ed.d, in_at: iso(ed.d, ed.in), out_at: iso(ed.d, ed.out), brk_min: Number(ed.brk) || 0, brk_at: ed.out ? null : old.brk_at || null,
      in_place: ed.in && old.in_at && 시각(old.in_at) === ed.in ? old.in_place : null, out_place: ed.out && old.out_at && 시각(old.out_at) === ed.out ? old.out_place : null,
      memo: ed.memo.trim() || null, edited_by: app.profile.name, edited_at: new Date().toISOString() }, { onConflict: "user_id,d" }));
    setEd(null); load();
  }, "고쳤습니다");
  const 엑셀 = () => downloadCsv(`출퇴근현황_${rng.from.slice(0, 7)}`, [["이름", "날짜", "출근", "퇴근", "휴게", "근로", "부재", "비고"],
    ...ms.flatMap(m => ds.map(d => 하루(D, m.user_id, d)).filter(o => o.r || o.l).map(o => [m.name, o.d, 시각(o.r?.in_at), 시각(o.r?.out_at),
      o.r?.in_at ? hm(o.휴게) : "", o.r?.in_at ? hm(o.합계) : "", o.l?.kind || "", [o.지각 && "지각", o.조퇴 && "조퇴", o.미퇴근 && "퇴근 미체크"].filter(Boolean).join(" ")]))]);
  return html`<div class="aw-filter"><${기간} rng=${rng} setRng=${setRng} 월만 />
      <span class="aw-lab">사원명</span><input class="search" style="max-width:160px" value=${찾기} placeholder="사원명 검색" onInput=${e => set찾기(e.target.value)} />
      <span class="grow"></span><button class="btn sm" onClick=${엑셀}>다운로드</button></div>
    ${ed && html`<div class="card"><h3>${이름표(D.members, ed.uid)} · ${날글(ed.d)} 기록 고치기</h3><div class="fgrid">
        <${Field} label="출근"><input type="time" value=${ed.in} onInput=${e => setEd({ ...ed, in: e.target.value })} /><//>
        <${Field} label="퇴근"><input type="time" value=${ed.out} onInput=${e => setEd({ ...ed, out: e.target.value })} /><//>
        <${Field} label="개인 휴게 (분)"><input inputmode="numeric" value=${ed.brk} onInput=${e => setEd({ ...ed, brk: e.target.value.replace(/[^\d]/g, "") })} /><//>
        <${Field} label="메모 (고친 이유)" wide><input value=${ed.memo} onInput=${e => setEd({ ...ed, memo: e.target.value })} /><//>
      </div><div class="bar"><span class="muted small">고친 사람·시각이 남습니다</span><span class="grow"></span><button class="btn ghost" onClick=${() => setEd(null)}>닫기</button><button class="btn primary" onClick=${저장}>저장</button></div></div>`}
    <div class="table-wrap"><table class="grid aw-cal"><thead><tr><th class="aw-name">이름</th>${ds.map(d => html`<th class=${"c" + (휴일(D, d) ? " red" : "")}>${+d.slice(8)} ${요일[요일of(d)]}</th>`)}</tr></thead>
      <tbody>${ms.map(m => html`<tr><td class="aw-name"><span class="row" style="gap:6px"><${Avatar} name=${m.name} id=${m.user_id} size=${22} />${m.name}</span></td>
        ${ds.map(d => { const o = 하루(D, m.user_id, d), r = o.r;
          return html`<td class=${"aw-cell" + (o.hol ? " hol" : "") + (d === today() ? " today" : "")} title="눌러서 고치기"
            onClick=${() => d <= today() && setEd({ uid: m.user_id, d, in: r?.in_at ? 시각(r.in_at) : "", out: r?.out_at ? 시각(r.out_at) : "", brk: String(r?.brk_min || 0), memo: r?.memo || "" })}>
            ${o.l ? html`<div class="aw-lv">${o.l.kind}</div>` : ""}
            ${r?.in_at ? html`<div class=${o.지각 ? "red" : ""}>${시각(r.in_at)}</div><div class=${o.조퇴 || o.미퇴근 ? "red" : "muted"}>${r.out_at ? 시각(r.out_at) : o.미퇴근 ? "미체크" : "-"}</div>` : ""}</td>`; })}</tr>`)}</tbody></table></div>
    <p class="muted small">빨간 시각 = 지각·조퇴·퇴근 미체크. 칸을 누르면 그날 기록을 고칩니다.</p>`;
}

/* ───────── 관리자: 근로 시간 현황 ───────── */
function 관리근로({ D, rng, setRng }) {
  const ds = 날들(rng.from, rng.to).filter(d => d <= today());
  const rows = D.members.map(m => { const xs = ds.map(d => 하루(D, m.user_id, d)); return { m, b: 기준of(D, m.user_id), ...더함(xs), 출근: xs.filter(o => o.r?.in_at).length, 지각: xs.filter(o => o.지각).length, 조퇴: xs.filter(o => o.조퇴).length }; });
  const 엑셀 = () => downloadCsv(`근로시간현황_${rng.from}_${rng.to}`, [["이름", "근무 방식", "출근일", ...칸들.map(([, l]) => l), "지각", "조퇴"],
    ...rows.map(x => [x.m.name, `${hm(x.b.start)}~${hm(x.b.end)}`, x.출근, ...칸들.map(([k]) => hm(x[k])), x.지각, x.조퇴])]);
  return html`<div class="aw-filter"><${기간} rng=${rng} setRng=${setRng} /><span class="grow"></span><button class="btn sm" onClick=${엑셀}>다운로드</button></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>근무 방식</th><th class="r">출근일</th>${칸들.map(([, l]) => html`<th class="r">${l}</th>`)}<th class="r">지각</th><th class="r">조퇴</th></tr></thead>
      <tbody>${rows.map(x => html`<tr><td><span class="row" style="gap:6px"><${Avatar} name=${x.m.name} id=${x.m.user_id} size=${22} />${x.m.name}</span></td>
        <td class="small">${hm(x.b.start)}~${hm(x.b.end)}${x.b.개인 ? " (개인)" : ""}</td><td class="r">${x.출근}</td>
        ${칸들.map(([k]) => html`<td class="r">${hm(x[k])}</td>`)}<td class=${"r" + (x.지각 ? " red" : "")}>${x.지각}</td><td class=${"r" + (x.조퇴 ? " red" : "")}>${x.조퇴}</td></tr>`)}</tbody></table></div>
    <p class="muted small">일반 = 하루 기준 근로 시간까지, 연장 = 그 넘는 것, 야간 = 22시~06시, 휴일 = 주말·공휴일. 점심 휴게와 PAUSE 휴게는 빼고 셉니다.</p>`;
}

/* ───────── 관리자: 근무 결과 신청 현황 ───────── */
function 결과신청현황({ app, D, load }) {
  const [보기, set보기] = useState("승인 대기");
  const rows = D.fixes.filter(f => 보기 === "전체" || f.status === "신청");
  const 결정 = (f, ok) => run(async () => {
    const { error } = await app.db.rpc("att_fix_decide", { p_id: f.id, p_ok: ok }); if (error) throw new Error(error.message);
    if (f.user_id !== app.user.id) await 알림(app, { title: `🕘 근무 결과 신청 ${ok ? "승인" : "반려"}`, body: `${날글(f.d)} · ${app.profile.name}`, url: 주소 + "/commute", tag: "att-fix-" + f.id, to_users: [f.user_id], pref: "att" });
    load();
  }, ok ? "승인했습니다 — 기록에 반영됨" : "반려했습니다");
  const 지금 = f => { const r = D.days.find(x => x.user_id === f.user_id && x.d === f.d); return r ? `${시각(r.in_at) || "-"} ~ ${시각(r.out_at) || "-"}` : "기록 없음"; };
  return html`<div class="bar"><${Seg} value=${보기} onChange=${set보기} options=${["승인 대기", "전체"]} /></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>기준일</th><th>출근</th><th>퇴근</th><th class="r">휴게(분)</th><th>지금 기록</th><th>사유</th><th>작성일</th><th>상태</th><th></th></tr></thead>
      <tbody>${!rows.length ? html`<tr><td colspan="10" class="c muted aw-empty">나타낼 내용이 없습니다.</td></tr>` : rows.map(f => html`<tr>
        <td>${이름표(D.members, f.user_id)}</td><td>${날글(f.d)}</td><td>${f.in_t?.slice(0, 5) || ""}</td><td>${f.out_t?.slice(0, 5) || ""}</td><td class="r">${f.brk_min ?? ""}</td>
        <td class="small muted">${지금(f)}</td><td class="small wrap">${f.memo}</td><td class="small">${날짜시각(f.created_at)}</td><td>${상태표(f)} <span class="small muted">${f.decided_by || ""}</span></td>
        <td class="r nowrap">${f.status === "신청" && html`<button class="btn sm primary" onClick=${() => 결정(f, true)}>승인</button> <button class="btn sm ghost" onClick=${() => 결정(f, false)}>반려</button>`}</td></tr>`)}</tbody></table></div>`;
}

/* ───────── 관리자: 부재 일정 현황 ───────── */
function 부재현황({ app, D, load }) {
  const [kind, setKind] = useState(""), [찾기, set찾기] = useState(""), [보기, set보기] = useState("전체"), [쓰기, set쓰기] = useState(false);
  const rows = D.leaves.filter(l => (!kind || l.kind === kind) && (!찾기 || 이름표(D.members, l.user_id).includes(찾기.trim())) && (보기 === "전체" || l.status === "신청"));
  const 결정 = (l, ok) => run(async () => {
    await q(app.db.from("att_leaves").update({ status: ok ? "승인" : "반려", decided_by: app.profile.name, decided_at: new Date().toISOString() }).eq("id", l.id));
    if (l.user_id !== app.user.id) await 알림(app, { title: `🕘 ${l.kind} ${ok ? "승인" : "반려"}`, body: `${기간글(l)} · ${app.profile.name}`, url: 주소 + "/absence", tag: "att-leave-" + l.id, to_users: [l.user_id], pref: "att" });
    load();
  }, ok ? "승인했습니다" : "반려했습니다");
  const 취소 = l => ask(`${이름표(D.members, l.user_id)} ${l.kind} (${기간글(l)})를 취소(삭제)할까요?`) && run(async () => { await q(app.db.from("att_leaves").delete().eq("id", l.id)); load(); }, "취소했습니다");
  const 엑셀 = () => downloadCsv("부재일정현황", [["이름", "부재 항목", "일수", "시작", "끝", "사유", "작성일", "상태", "처리"], ...rows.map(l => [이름표(D.members, l.user_id), l.kind, 일수(D, l), l.d_from, l.d_to, l.memo || "", 날짜시각(l.created_at), l.status, l.decided_by || ""])]);
  return html`<div class="aw-filter">
      <span class="aw-lab">부재 항목</span><select value=${kind} onChange=${e => setKind(e.target.value)}><option value="">전체</option>${부재항목.map(([k]) => html`<option selected=${k === kind}>${k}</option>`)}</select>
      <span class="aw-lab">사원명</span><input class="search" style="max-width:140px" value=${찾기} placeholder="사원명" onInput=${e => set찾기(e.target.value)} />
      <${Seg} value=${보기} onChange=${set보기} options=${["전체", "승인 대기"]} />
      <span class="grow"></span><button class="btn primary sm" onClick=${() => set쓰기(true)}>부재 일정 작성</button><button class="btn sm" onClick=${엑셀}>다운로드</button></div>
    ${쓰기 && html`<${부재쓰기} app=${app} D=${D} load=${load} 대리 onClose=${() => set쓰기(false)} />`}
    <div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>부재 항목</th><th class="r">일수</th><th>기간</th><th>사유</th><th>작성일</th><th>상태</th><th></th></tr></thead>
      <tbody>${!rows.length ? html`<tr><td colspan="8" class="c muted aw-empty">나타낼 내용이 없습니다.</td></tr>` : rows.map(l => html`<tr>
        <td>${이름표(D.members, l.user_id)}</td><td>${l.kind}</td><td class="r">${일수(D, l)}</td><td>${기간글(l)}</td><td class="small wrap">${l.memo || ""}</td>
        <td class="small">${날짜시각(l.created_at)}</td><td>${상태표(l)} <span class="small muted">${l.decided_by || ""}</span></td>
        <td class="r nowrap">${l.status === "신청" ? html`<button class="btn sm primary" onClick=${() => 결정(l, true)}>승인</button> <button class="btn sm ghost" onClick=${() => 결정(l, false)}>반려</button>`
          : html`<button class="btn sm ghost" onClick=${() => 취소(l)}>취소</button>`}</td></tr>`)}</tbody></table></div>`;
}

/* ───────── 관리자: 연차 조회/수정 ───────── */
function 연차관리({ app, D, load }) {
  const [yr, setYr] = useState(+today().slice(0, 4)), [t, setT] = useState("연차 정보");
  const [ed, setEd] = useState({});              // { uid: { granted, adjust, memo } } 고치는 중인 값
  const val = (uid, k, a) => ed[uid]?.[k] ?? String(k === "memo" ? a.a.memo || "" : k === "granted" ? a.발생 : a.조정);
  const set = (uid, k, v) => setEd(x => ({ ...x, [uid]: { ...(x[uid] || {}), [k]: v } }));
  const 저장 = uid => run(async () => {
    const a = 연차of(D, uid, yr), n = s => { const x = Number(s); if (!isFinite(x)) throw new Error("숫자로 넣어 주세요"); return Math.round(x * 2) / 2; };
    await q(app.db.from("att_annual").upsert({ user_id: uid, yr, granted: n(val(uid, "granted", a)), adjust: n(val(uid, "adjust", a)), memo: val(uid, "memo", a).trim() || null }, { onConflict: "user_id,yr" }));
    setEd(x => { const y = { ...x }; delete y[uid]; return y; }); load();
  }, "저장했습니다");
  const 이력 = D.leaves.filter(l => l.status === "승인" && 항목(l.kind)[3] && l.d_from.startsWith(String(yr)));
  return html`<div class="aw-filter"><span class="aw-lab">기준 연도</span><select value=${yr} onChange=${e => { setYr(+e.target.value); setEd({}); }}>${[0, 1, -1].map(n => +today().slice(0, 4) + n).sort().map(y => html`<option value=${y} selected=${y === yr}>${y}</option>`)}</select>
      <${Seg} value=${t} onChange=${setT} options=${["연차 정보", "연차 이력"]} /></div>
    ${t === "연차 정보" ? html`<div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>연차 시작일</th><th>연차 종료일</th><th class="r">연차 발생</th><th class="r">연차 조정</th><th class="r">사용 일수</th><th class="r">잔여 일수</th><th>메모</th><th></th></tr></thead>
      <tbody>${D.members.map(m => { const a = 연차of(D, m.user_id, yr); return html`<tr>
        <td><span class="row" style="gap:6px"><${Avatar} name=${m.name} id=${m.user_id} size=${22} />${m.name}</span></td><td>${yr}.01.01</td><td>${yr}.12.31</td>
        <td class="r"><input class="w80" inputmode="decimal" value=${val(m.user_id, "granted", a)} onInput=${e => set(m.user_id, "granted", e.target.value)} /></td>
        <td class="r"><input class="w80" inputmode="decimal" value=${val(m.user_id, "adjust", a)} onInput=${e => set(m.user_id, "adjust", e.target.value)} /></td>
        <td class="r">${a.사용}</td><td class=${"r" + (a.잔여 < 0 ? " red" : " blue")}><b>${a.잔여}</b></td>
        <td><input value=${val(m.user_id, "memo", a)} placeholder="예: 입사 2년차 15일" onInput=${e => set(m.user_id, "memo", e.target.value)} /></td>
        <td class="r"><button class="btn sm" disabled=${!ed[m.user_id]} onClick=${() => 저장(m.user_id)}>저장</button></td></tr>`; })}</tbody></table></div>
      <p class="muted small">사용 일수 = 승인된 연차(평일 하루 1일)·반차(0.5일). 잔여 = 발생 + 조정 − 사용.</p>`
    : html`<div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>부재 항목</th><th class="r">일수</th><th>기간</th><th>사유</th><th>승인</th></tr></thead>
      <tbody>${!이력.length ? html`<tr><td colspan="6" class="c muted aw-empty">나타낼 내용이 없습니다.</td></tr>` : 이력.map(l => html`<tr><td>${이름표(D.members, l.user_id)}</td><td>${l.kind}</td><td class="r">${일수(D, l)}</td><td>${기간글(l)}</td><td class="small">${l.memo || ""}</td><td class="small muted">${l.decided_by || ""}</td></tr>`)}</tbody></table></div>`}`;
}

/* ───────── 관리자: 근무 대상자 관리 (사람마다 근무시간 = att_people) ───────── */
function 대상자관리({ app, D, load }) {
  const s = D.s;
  const [p, setP] = useState(() => Object.fromEntries(D.people.map(x => [x.user_id, { start: x.start_time.slice(0, 5), end: x.end_time.slice(0, 5) }])));
  const 고침 = (uid, k, v) => setP(c => ({ ...c, [uid]: { ...(c[uid] || {}), [k]: v } }));
  const 저장 = () => run(async () => {
    for (const m of D.members) {
      const x = p[m.user_id] || {};
      if (x.start && x.end) {
        if (x.end <= x.start) throw new Error(`${m.name}: 퇴근 시각이 출근보다 늦어야 합니다`);
        await q(app.db.from("att_people").upsert({ user_id: m.user_id, start_time: x.start, end_time: x.end }, { onConflict: "user_id" }));
      } else if (D.people.some(y => y.user_id === m.user_id)) await q(app.db.from("att_people").delete().eq("user_id", m.user_id));
    }
    load();
  }, "저장했습니다");
  return html`<div class="table-wrap"><table class="grid"><thead><tr><th>대상자</th><th>근무 방식</th><th>근로 시간 (비우면 기본)</th><th></th></tr></thead>
      <tbody>${D.members.map(m => { const x = p[m.user_id] || {}; return html`<tr>
        <td><span class="row" style="gap:6px"><${Avatar} name=${m.name} id=${m.user_id} size=${22} />${m.name} <span class="muted small">${m.role === "admin" ? "공동대표" : "사무장"}</span></span></td>
        <td>${근무방식명}</td>
        <td class="nowrap"><input type="time" style="width:auto" value=${x.start || ""} onInput=${e => 고침(m.user_id, "start", e.target.value)} /> ~ <input type="time" style="width:auto" value=${x.end || ""} onInput=${e => 고침(m.user_id, "end", e.target.value)} /></td>
        <td class="small muted">${x.start && x.end ? "개인 시간" : `기본 ${s.start_time.slice(0, 5)} ~ ${s.end_time.slice(0, 5)}`}</td></tr>`; })}</tbody></table></div>
    <div class="bar"><span class="muted small">근태 (시험)의 '사람마다 근무시간'과 같은 값입니다 (차대금 재촉 알림 시간도 이걸 봄).</span><span class="grow"></span><button class="btn primary" onClick=${저장}>저장</button></div>`;
}

/* ───────── 관리자: 근무 방식 관리 ───────── */
function 근무방식관리({ app, D, load }) {
  const s = D.s;
  const [f, setF] = useState({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), bs: (s.brk_start || "12:00").slice(0, 5), be: (s.brk_end || "13:00").slice(0, 5),
    late: s.late_min || 0, early: s.early_min || 0, radius: s.radius_m });
  const 기준 = Math.max(0, 분of(f.end) - 분of(f.start) - 겹침(분of(f.start), 분of(f.end), 분of(f.bs), 분of(f.be)));
  const 저장 = () => run(async () => {
    if (f.end <= f.start) throw new Error("근로 종료가 시작보다 늦어야 합니다");
    if (f.be <= f.bs) throw new Error("휴게 종료가 시작보다 늦어야 합니다");
    await q(app.db.from("att_settings").update({ start_time: f.start, end_time: f.end, brk_start: f.bs, brk_end: f.be, late_min: +f.late, early_min: +f.early, radius_m: Number(f.radius) || 300 }).eq("id", 1));
    load();
  }, "저장했습니다");
  const 여기사무실 = () => ask("지금 이 기기의 위치를 사무실로 정할까요? (사무실 안에서 누르세요)") && run(async () => {
    const c = await 위치(); if (!c) throw new Error("위치를 못 받았습니다. 브라우저에서 위치 권한을 허용해 주세요.");
    await q(app.db.from("att_settings").update({ office_lat: c.latitude, office_lng: c.longitude }).eq("id", 1)); load();
  }, "사무실 위치를 정했습니다");
  const 분고르기 = (k, opts) => html`<select style="width:auto" value=${f[k]} onChange=${e => setF({ ...f, [k]: +e.target.value })}>${opts.map(([v, l]) => html`<option value=${v} selected=${v === f[k]}>${l}</option>`)}</select>`;
  return html`<div class="table-wrap"><table class="grid"><thead><tr><th>순번</th><th>근무 방식</th></tr></thead>
      <tbody><tr class="on"><td>1</td><td><span class="badge">고정 근무제</span> ${근무방식명}</td></tr></tbody></table></div>
    <div class="card"><h3>근무 방식 수정 — ${근무방식명}</h3>
      <div class="aw-form">
        <div class="aw-fl">일반 근로 시간</div><div><input type="time" style="width:auto" value=${f.start} onInput=${e => setF({ ...f, start: e.target.value })} /> ~ <input type="time" style="width:auto" value=${f.end} onInput=${e => setF({ ...f, end: e.target.value })} /></div>
        <div class="aw-fl">휴게 시간</div><div>당일 <input type="time" style="width:auto" value=${f.bs} onInput=${e => setF({ ...f, bs: e.target.value })} /> ~ <input type="time" style="width:auto" value=${f.be} onInput=${e => setF({ ...f, be: e.target.value })} /></div>
        <div class="aw-fl">기준 근로 시간</div><div>하루 <b>${hm(기준)}</b> <span class="muted small">(근로 − 휴게. 넘으면 연장)</span></div>
        <div class="aw-fl">야간 근로 시간</div><div>22:00 ~ 06:00</div>
        <div class="aw-fl">공휴일 및 약정 휴일</div><div>근무 안 함 <span class="muted small">(공휴일 목록은 <a href="#/attendance">근태 (시험)</a> → 관리 → 설정)</span></div>
        <div class="aw-fl">출퇴근 체크</div><div>하루 2회(출근/퇴근) · PC·모바일</div>
        <div class="aw-fl">지각</div><div>근로 시작 시간 ${분고르기("late", [[0, "0분"], [10, "10분"], [30, "30분"], [60, "1시간"]])} 후까지 출근하지 않으면 지각 처리</div>
        <div class="aw-fl">조퇴</div><div>근로 종료 시간 ${분고르기("early", [[0, "0분"], [30, "30분"], [60, "1시간"]])} 전에 퇴근하면 조퇴 처리</div>
        <div class="aw-fl">출퇴근 위치 관리</div><div>사무실 반경 <input class="w80" inputmode="numeric" value=${f.radius} onInput=${e => setF({ ...f, radius: e.target.value.replace(/[^\d]/g, "") })} /> m 안이면 '사무실', 밖이면 '외부' (막지는 않음)
          <div style="margin-top:6px"><button class="btn sm" onClick=${여기사무실}>📍 지금 위치를 사무실로</button> <span class="small muted">${s.office_lat != null ? `정해져 있음 (${s.office_lat.toFixed(4)}, ${s.office_lng.toFixed(4)})` : "아직 없음"}</span></div></div>
        <div class="aw-fl">사용자 기능</div><div>휴게(PAUSE) 추가 허용 · 시간 변경은 근무 결과 신청(대표 승인)</div>
      </div>
      <div class="bar"><span class="muted small">근태 (시험)과 같은 설정입니다. 사람마다 다른 시간은 근무 대상자 관리에서.</span><span class="grow"></span><button class="btn primary" onClick=${저장}>저장</button></div></div>`;
}

/* ───────── 관리자: 부재 항목 관리 (보기만) ───────── */
function 부재항목관리() {
  const yn = b => b ? "Y" : "N";
  return html`<div class="table-wrap"><table class="grid"><thead><tr><th>부재 항목</th><th>사용 여부</th><th>휴가 구분</th><th>시간 단위</th><th>연차 차감</th><th>근로 시간에 합산</th></tr></thead>
      <tbody>${부재항목.map(([k, 구분, 단위, 차감, 합산]) => html`<tr><td>${k}</td><td>Y</td><td>${구분}</td><td>${단위}</td><td>${yn(차감)}</td><td>${yn(합산)}</td></tr>`)}</tbody></table></div>
    <p class="muted small">부재가 승인된 날은 지각·조퇴를 보지 않습니다 (오전반차는 지각만, 오후반차는 조퇴만 뺌). 근로 시간에 합산 = 출퇴근 기록이 없어도 기준 근로 시간을 일반 근로로 셈(반일은 절반).
      항목을 더하거나 바꾸려면 말씀해 주세요 (DB 항목 목록과 같이 바꿔야 함).</p>`;
}
