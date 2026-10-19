// 근태 (2026-10-19, 웍스 근태 체험과 비교용). 사무실(대표·직원)만.
//   오늘: 출근·퇴근 버튼(서버 시각, 사무실 반경 안인지) + 오늘 우리 사무실 누가 왔나
//   내 기록: 달별 출퇴근·근무시간·지각·조퇴·휴가
//   휴가·외근: 신청 → 대표 승인·반려 (알림 종류 'att')
//   관리(대표): 승인 대기, 달별 사람별 집계·엑셀, 기록 고치기, 기준 시각·사무실 위치
import { html, useState, useEffect, Loading, Empty, run, ask, today, Field, Seg, Badge, downloadCsv } from "../ui.js";
import { q } from "../db.js";
import { 보내기 as 알림 } from "../push.js";
import { 구성원, 이름표, Avatar, 날짜시각 } from "../people.js";

const 요일 = "일월화수목금토";
const 한국 = t => new Date(Date.parse(t) + 9 * 3600e3);
const 시각 = t => t ? 한국(t).toISOString().slice(11, 16) : "";
const 분 = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : 0;
const 시간글 = m => m ? `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, "0")}분` : "-";
const 날글 = d => { const x = new Date(d + "T00:00:00Z"); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${요일[x.getUTCDay()]})`; };
const 주말 = d => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());
const 월날짜들 = ym => { const [y, m] = ym.split("-").map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`); };
const 휴가종류 = ["연차", "오전반차", "오후반차", "외근", "병가", "기타"];
const 휴가of = (leaves, uid, d) => leaves.find(l => l.user_id === uid && l.status === "승인" && l.d_from <= d && l.d_to >= d);
/** 그날 기록 → 표시할 표 (지각·조퇴는 반차·외근이면 빼고) */
function 판정(r, l, s) {
  const out = [];
  if (l) out.push(l.kind);
  const 늦음 = r?.in_at && 시각(r.in_at) > s.start_time.slice(0, 5) && !(l && /오전반차|외근/.test(l.kind));
  const 일찍 = r?.out_at && 시각(r.out_at) < s.end_time.slice(0, 5) && !(l && /오후반차|외근/.test(l.kind));
  if (늦음) out.push("지각");
  if (일찍) out.push("조퇴");
  if (r?.in_at && !r.out_at && r.d < today()) out.push("퇴근 안 찍음");
  return { tags: out, 늦음, 일찍 };
}
const 장소 = p => p === "사무실" ? html`<${Badge} tone="green">사무실<//>` : p === "외부" ? html`<${Badge} tone="amber">외부<//>` : p ? html`<${Badge}>위치 없음<//>` : "";
/** 폰 위치 (안 되면 null — 기록은 그대로 되고 '위치 없음') */
const 위치 = () => new Promise(ok => {
  if (!navigator.geolocation) return ok(null);
  navigator.geolocation.getCurrentPosition(p => ok(p.coords), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});

export function AttendancePage({ app }) {
  const me = app.user.id, admin = app.profile.role === "admin";
  const [tab, setTab0] = useState(() => { try { return sessionStorage.getItem("att-tab") || "오늘"; } catch { return "오늘"; } });
  const setTab = x => { setTab0(x); try { sessionStorage.setItem("att-tab", x); } catch {} };
  const [ym, setYm] = useState(today().slice(0, 7));
  const [d, setD] = useState(null);
  const load = () => run(async () => {
    const ds = 월날짜들(ym);
    const [[s], days, todayRows, leaves, members] = await Promise.all([
      q(app.db.from("att_settings").select("*")),
      q(app.db.from("att_days").select("*").gte("d", ds[0]).lte("d", ds[ds.length - 1])),
      q(app.db.from("att_days").select("*").eq("d", today())),
      q(app.db.from("att_leaves").select("*").order("d_from", { ascending: false }).limit(500)),
      구성원(app),
    ]);
    setD({ s, days, todayRows, leaves, members });
  });
  useEffect(() => { load(); }, [ym]);
  if (!d) return html`<${Loading} />`;
  const 탭들 = ["오늘", "내 기록", "휴가·외근", ...(admin ? ["관리"] : [])];
  const 대기 = d.leaves.filter(l => l.status === "신청").length;
  return html`<div class="bar"><h2>🕘 근태</h2><span class="grow"></span>
      <${Seg} value=${tab} onChange=${setTab} options=${탭들.map(t => [t, t === "관리" && 대기 ? `관리 (${대기})` : t])} /></div>
    ${tab === "오늘" ? html`<${오늘} app=${app} d=${d} load=${load} />`
      : tab === "내 기록" ? html`<${기록} app=${app} d=${d} ym=${ym} setYm=${setYm} uid=${me} />`
      : tab === "휴가·외근" ? html`<${휴가} app=${app} d=${d} load=${load} />`
      : html`<${관리} app=${app} d=${d} ym=${ym} setYm=${setYm} load=${load} />`}`;
}

/* ───────── 오늘 ───────── */
function 오늘({ app, d, load }) {
  const me = app.user.id, s = d.s;
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const h = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(h); }, []);
  const r = d.todayRows.find(x => x.user_id === me), l = 휴가of(d.leaves, me, today());
  const k = 한국(now.toISOString()), 지금 = k.toISOString().slice(11, 16);
  const 찍기 = kind => run(async () => {
    setBusy(true);
    try {
      const c = await 위치();
      const { data, error } = await app.db.rpc("att_clock", { p_kind: kind, p_lat: c?.latitude ?? null, p_lng: c?.longitude ?? null, p_acc: c?.accuracy ?? null });
      if (error) throw new Error(error.message);
      load();
      return data;
    } finally { setBusy(false); }
  }, kind === "출근" ? "출근했습니다" : "퇴근했습니다");
  const 근무 = r?.in_at ? 분(r.in_at, r.out_at || now.toISOString()) : 0;
  const p = r ? 판정(r, l, s) : { tags: l ? [l.kind] : [] };
  return html`<div class="card att-now">
      <div class="att-clock">${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 (${요일[k.getUTCDay()]}) <b>${지금}</b></div>
      <div class="att-btns">
        <button class="btn primary att-btn" disabled=${busy || !!r?.in_at} onClick=${() => 찍기("출근")}>${r?.in_at ? `출근 ${시각(r.in_at)}` : "🟢 출근하기"}</button>
        <button class="btn att-btn att-out" disabled=${busy || !r?.in_at} onClick=${() => (!r.out_at || ask("퇴근 시각을 지금으로 다시 찍을까요?")) && 찍기("퇴근")}>${r?.out_at ? `퇴근 ${시각(r.out_at)} · 다시 찍기` : "🔴 퇴근하기"}</button>
      </div>
      <div class="att-line">
        ${r?.in_at ? html`출근 <b>${시각(r.in_at)}</b> ${장소(r.in_place)}` : html`<span class="muted">아직 출근 전 · 기준 ${s.start_time.slice(0, 5)}</span>`}
        ${r?.out_at && html` · 퇴근 <b>${시각(r.out_at)}</b> ${장소(r.out_place)}`}
        ${r?.in_at && html` · 근무 <b>${시간글(근무)}</b>${r.out_at ? "" : " (지금까지)"}`}
        ${p.tags.map(t => html` <${Badge} tone=${/지각|조퇴|안 찍음/.test(t) ? "red" : "blue"}>${t}<//>`)}
      </div>
      ${s.office_lat == null && html`<p class="note small">사무실 위치가 아직 없어 '위치 없음'으로 찍힙니다. 대표가 사무실에서 근태 → 관리 → [지금 위치를 사무실로]를 한 번 눌러 주세요.</p>`}
    </div>
    <div class="card"><h3>오늘 우리 사무실</h3>
      <table class="grid"><tbody>${d.members.map(m => {
        const x = d.todayRows.find(t => t.user_id === m.user_id), lv = 휴가of(d.leaves, m.user_id, today());
        const 미출근 = !x?.in_at && !lv && !주말(today()) && 지금 > s.start_time.slice(0, 5);
        return html`<tr><td><span class="row" style="gap:8px;align-items:center"><${Avatar} name=${m.name} size=${26} />${m.name}</span></td>
          <td>${lv ? html`<${Badge} tone="blue">${lv.kind}<//>` : x?.out_at ? html`<${Badge}>퇴근<//>` : x?.in_at ? html`<${Badge} tone="green">근무 중<//>` : 미출근 ? html`<${Badge} tone="red">미출근<//>` : html`<span class="muted small">-</span>`}</td>
          <td class="small">${x?.in_at ? html`출근 ${시각(x.in_at)} ${장소(x.in_place)}` : ""}${x?.out_at ? html` · 퇴근 ${시각(x.out_at)}` : ""}</td></tr>`;
      })}</tbody></table></div>`;
}

/* ───────── 내 기록 (관리에서도 사람을 골라 씀) ───────── */
function 기록({ d, ym, setYm, uid, 고치기 }) {
  const s = d.s, rows = 월날짜들(ym).map(x => ({ d: x, r: d.days.find(t => t.user_id === uid && t.d === x), l: 휴가of(d.leaves, uid, x) }));
  let 일 = 0, 총 = 0, 지 = 0, 조 = 0, 휴 = 0;
  rows.forEach(({ r, l }) => { if (r?.in_at) { 일++; 총 += 분(r.in_at, r.out_at); } const p = 판정(r, l, s); if (p.늦음) 지++; if (p.일찍) 조++; if (l && l.kind !== "외근") 휴++; });
  return html`<div class="card">
    <div class="bar"><input type="month" value=${ym} onInput=${e => e.target.value && setYm(e.target.value)} /><span class="grow"></span>
      <span class="small">출근 <b>${일}</b>일 · 근무 <b>${시간글(총)}</b> · 지각 <b class=${지 ? "red" : ""}>${지}</b> · 조퇴 <b class=${조 ? "red" : ""}>${조}</b> · 휴가 <b>${휴}</b>일</span></div>
    <div class="table-wrap"><table class=${"grid" + (고치기 ? " click" : "")}><thead><tr><th>날짜</th><th>출근</th><th>퇴근</th><th class="r">근무</th><th>비고</th></tr></thead>
      <tbody>${rows.filter(x => x.d <= today()).reverse().map(({ d: x, r, l }) => { const p = 판정(r, l, s); return html`<tr onClick=${() => 고치기 && 고치기(x, r)} class=${주말(x) ? "muted" : ""}>
        <td>${날글(x)}</td><td>${r?.in_at ? html`${시각(r.in_at)} ${r.in_place === "외부" ? 장소("외부") : ""}` : ""}</td>
        <td>${r?.out_at ? html`${시각(r.out_at)} ${r.out_place === "외부" ? 장소("외부") : ""}` : ""}</td>
        <td class="r">${r?.in_at && r?.out_at ? 시간글(분(r.in_at, r.out_at)) : ""}</td>
        <td>${p.tags.map(t => html`<${Badge} tone=${/지각|조퇴|안 찍음/.test(t) ? "red" : "blue"}>${t}<//> `)}${r?.memo ? html`<span class="small muted">${r.memo}</span>` : ""}${r?.edited_by ? html` <span class="small muted" title=${날짜시각(r.edited_at)}>(${r.edited_by} 고침)</span>` : ""}</td></tr>`; })}</tbody></table></div></div>`;
}

/* ───────── 휴가·외근 신청 ───────── */
function 휴가({ app, d, load }) {
  const me = app.user.id;
  const [f, setF] = useState({ kind: "연차", d_from: today(), d_to: today(), memo: "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === "d_from" && x.d_to < v ? { d_to: v } : {}) }));
  const 반차 = /반차/.test(f.kind);
  const 신청 = () => run(async () => {
    const row = { ...f, d_to: 반차 ? f.d_from : f.d_to, memo: f.memo.trim() || null };
    await q(app.db.from("att_leaves").insert(row));
    const 대표 = d.members.filter(m => m.role === "admin" && m.user_id !== me).map(m => m.user_id);
    if (대표.length) await 알림(app, { title: `🕘 ${f.kind} 신청: ${app.profile.name}`, body: `${날글(row.d_from)}${row.d_to !== row.d_from ? " ~ " + 날글(row.d_to) : ""}${row.memo ? " · " + row.memo : ""}`,
      url: "/office/#/attendance", tag: "att-leave", to_users: 대표, pref: "att" });
    setF({ ...f, memo: "" }); load();
  }, "신청했습니다");
  const 취소 = l => ask("이 신청을 취소할까요?") && run(async () => { await q(app.db.from("att_leaves").delete().eq("id", l.id)); load(); }, "취소했습니다");
  const mine = d.leaves.filter(l => l.user_id === me);
  return html`<div class="card"><h3>휴가·외근 신청</h3>
      <div class="fgrid">
        <${Field} label="종류" wide><${Seg} value=${f.kind} onChange=${v => set("kind", v)} options=${휴가종류} /><//>
        <${Field} label=${반차 ? "날짜" : "시작"}><input type="date" value=${f.d_from} onInput=${e => set("d_from", e.target.value)} /><//>
        ${!반차 && html`<${Field} label="끝"><input type="date" value=${f.d_to} min=${f.d_from} onInput=${e => set("d_to", e.target.value)} /><//>`}
        <${Field} label="메모" wide><input value=${f.memo} placeholder="예: 병원 · 탁송 동행 (서울)" onInput=${e => set("memo", e.target.value)} /><//>
      </div>
      <div class="bar"><span class="muted small">대표가 승인하면 근태에 반영됩니다 (지각·조퇴에서 빠짐)</span><span class="grow"></span><button class="btn primary" onClick=${신청}>신청하기</button></div></div>
    <div class="card"><h3>내 신청</h3>
      ${!mine.length ? html`<p class="muted small">아직 없습니다.</p>` : html`<table class="grid"><tbody>${mine.map(l => html`<tr>
        <td>${l.kind}</td><td>${날글(l.d_from)}${l.d_to !== l.d_from ? " ~ " + 날글(l.d_to) : ""}</td><td class="small">${l.memo || ""}</td>
        <td>${상태표(l)}</td><td class="r">${l.status === "신청" && html`<button class="btn sm ghost" onClick=${() => 취소(l)}>취소</button>`}</td></tr>`)}</tbody></table>`}</div>`;
}
const 상태표 = l => l.status === "승인" ? html`<${Badge} tone="green">승인<//> <span class="small muted">${l.decided_by || ""}</span>`
  : l.status === "반려" ? html`<${Badge} tone="red">반려<//> <span class="small muted">${l.decided_by || ""}</span>` : html`<${Badge} tone="amber">승인 대기<//>`;

/* ───────── 관리 (대표) ───────── */
function 관리({ app, d, ym, setYm, load }) {
  const s = d.s;
  const [who, setWho] = useState(null);
  const [ed, setEd] = useState(null);       // { uid, d, in, out, memo }
  const [cfg, setCfg] = useState({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), radius: s.radius_m });
  const 이름 = id => 이름표(d.members, id);
  const 결정 = (l, ok) => run(async () => {
    await q(app.db.from("att_leaves").update({ status: ok ? "승인" : "반려", decided_by: app.profile.name, decided_at: new Date().toISOString() }).eq("id", l.id));
    if (l.user_id !== app.user.id) await 알림(app, { title: `🕘 ${l.kind} ${ok ? "승인" : "반려"}`, body: `${날글(l.d_from)}${l.d_to !== l.d_from ? " ~ " + 날글(l.d_to) : ""} · ${app.profile.name}`,
      url: "/office/#/attendance", tag: "att-leave-" + l.id, to_users: [l.user_id], pref: "att" });
    load();
  }, ok ? "승인했습니다" : "반려했습니다");
  const 고치기 = (x, r) => setEd({ uid: who, d: x, in: r?.in_at ? 시각(r.in_at) : "", out: r?.out_at ? 시각(r.out_at) : "", memo: r?.memo || "" });
  const iso = (x, t) => t ? new Date(`${x}T${t}:00+09:00`).toISOString() : null;
  const 저장 = () => run(async () => {
    const old = d.days.find(t => t.user_id === ed.uid && t.d === ed.d) || {};
    await q(app.db.from("att_days").upsert({ user_id: ed.uid, d: ed.d, in_at: iso(ed.d, ed.in), out_at: iso(ed.d, ed.out), memo: ed.memo.trim() || null,
      in_place: ed.in ? (old.in_at && 시각(old.in_at) === ed.in ? old.in_place : null) : null, out_place: ed.out ? (old.out_at && 시각(old.out_at) === ed.out ? old.out_place : null) : null,
      edited_by: app.profile.name, edited_at: new Date().toISOString() }, { onConflict: "user_id,d" }));
    setEd(null); load();
  }, "고쳤습니다");
  const 설정저장 = () => run(async () => {
    await q(app.db.from("att_settings").update({ start_time: cfg.start, end_time: cfg.end, radius_m: Number(cfg.radius) || 300 }).eq("id", 1)); load();
  }, "저장했습니다");
  const 여기사무실 = () => ask("지금 이 기기의 위치를 사무실로 정할까요? (사무실 안에서 누르세요)") && run(async () => {
    const c = await 위치();
    if (!c) throw new Error("위치를 못 받았습니다. 브라우저에서 위치 권한을 허용해 주세요.");
    await q(app.db.from("att_settings").update({ office_lat: c.latitude, office_lng: c.longitude }).eq("id", 1)); load();
  }, "사무실 위치를 정했습니다");
  const 대기 = d.leaves.filter(l => l.status === "신청");
  const ds = 월날짜들(ym).filter(x => x <= today());
  const 집계 = d.members.map(m => {
    let 일 = 0, 총 = 0, 지 = 0, 조 = 0, 휴 = 0, 안찍 = 0;
    ds.forEach(x => { const r = d.days.find(t => t.user_id === m.user_id && t.d === x), l = 휴가of(d.leaves, m.user_id, x), p = 판정(r, l, s);
      if (r?.in_at) { 일++; 총 += 분(r.in_at, r.out_at); } if (p.늦음) 지++; if (p.일찍) 조++; if (l && l.kind !== "외근") 휴++; if (p.tags.includes("퇴근 안 찍음")) 안찍++; });
    return { m, 일, 총, 지, 조, 휴, 안찍 };
  });
  const 엑셀 = () => downloadCsv(`근태_${ym}`, [["이름", "날짜", "출근", "퇴근", "근무(분)", "출근 위치", "퇴근 위치", "비고", "메모", "고친 사람"],
    ...d.members.flatMap(m => ds.map(x => { const r = d.days.find(t => t.user_id === m.user_id && t.d === x), l = 휴가of(d.leaves, m.user_id, x);
      return r || l ? [m.name, x, 시각(r?.in_at), 시각(r?.out_at), r?.in_at && r?.out_at ? 분(r.in_at, r.out_at) : "", r?.in_place || "", r?.out_place || "", 판정(r, l, s).tags.join(" "), r?.memo || "", r?.edited_by || ""] : null; }).filter(Boolean))]);
  return html`
    ${대기.length > 0 && html`<div class="card"><h3>승인 대기 ${대기.length}</h3><table class="grid"><tbody>${대기.map(l => html`<tr>
      <td>${이름(l.user_id)}</td><td>${l.kind}</td><td>${날글(l.d_from)}${l.d_to !== l.d_from ? " ~ " + 날글(l.d_to) : ""}</td><td class="small">${l.memo || ""}</td>
      <td class="r nowrap"><button class="btn sm primary" onClick=${() => 결정(l, true)}>승인</button> <button class="btn sm ghost" onClick=${() => 결정(l, false)}>반려</button></td></tr>`)}</tbody></table></div>`}
    <div class="card"><div class="bar"><h3>${ym.replace("-", "년 ")}월 집계</h3><span class="grow"></span>
        <input type="month" value=${ym} onInput=${e => e.target.value && setYm(e.target.value)} /><button class="btn sm" onClick=${엑셀}>엑셀(CSV)</button></div>
      <table class="grid click"><thead><tr><th>이름</th><th class="r">출근일</th><th class="r">총 근무</th><th class="r">지각</th><th class="r">조퇴</th><th class="r">휴가</th><th class="r">퇴근 안 찍음</th></tr></thead>
        <tbody>${집계.map(x => html`<tr class=${who === x.m.user_id ? "on" : ""} onClick=${() => { setWho(x.m.user_id); setEd(null); }}>
          <td><span class="row" style="gap:8px;align-items:center"><${Avatar} name=${x.m.name} size=${24} />${x.m.name}</span></td><td class="r">${x.일}</td><td class="r">${시간글(x.총)}</td>
          <td class=${"r" + (x.지 ? " red" : "")}>${x.지}</td><td class=${"r" + (x.조 ? " red" : "")}>${x.조}</td><td class="r">${x.휴}</td><td class=${"r" + (x.안찍 ? " red" : "")}>${x.안찍}</td></tr>`)}</tbody></table>
      <p class="muted small">이름을 누르면 아래에 그 사람 기록이 나오고, 날짜를 누르면 출퇴근 시각을 고칠 수 있습니다.</p></div>
    ${ed && html`<div class="card"><h3>${이름(ed.uid)} · ${날글(ed.d)} 고치기</h3><div class="fgrid">
        <${Field} label="출근"><input type="time" value=${ed.in} onInput=${e => setEd({ ...ed, in: e.target.value })} /><//>
        <${Field} label="퇴근"><input type="time" value=${ed.out} onInput=${e => setEd({ ...ed, out: e.target.value })} /><//>
        <${Field} label="메모 (고친 이유)" wide><input value=${ed.memo} placeholder="예: 퇴근 안 찍음 — 18:30 퇴근 확인" onInput=${e => setEd({ ...ed, memo: e.target.value })} /><//>
      </div><div class="bar"><span class="muted small">고친 사람·시각이 기록에 남습니다</span><span class="grow"></span><button class="btn ghost" onClick=${() => setEd(null)}>닫기</button><button class="btn primary" onClick=${저장}>저장</button></div></div>`}
    ${who && html`<h3 style="margin:14px 0 6px">${이름(who)} 기록</h3><${기록} d=${d} ym=${ym} setYm=${setYm} uid=${who} 고치기=${고치기} />`}
    <div class="card"><h3>설정</h3><div class="fgrid">
        <${Field} label="출근 기준 (넘으면 지각)"><input type="time" value=${cfg.start} onInput=${e => setCfg({ ...cfg, start: e.target.value })} /><//>
        <${Field} label="퇴근 기준 (전이면 조퇴)"><input type="time" value=${cfg.end} onInput=${e => setCfg({ ...cfg, end: e.target.value })} /><//>
        <${Field} label="사무실 반경 (m)" hint="이 안에서 찍으면 '사무실', 밖이면 '외부'"><input inputmode="numeric" value=${cfg.radius} onInput=${e => setCfg({ ...cfg, radius: e.target.value.replace(/[^\d]/g, "") })} /><//>
        <${Field} label="사무실 위치"><button class="btn" onClick=${여기사무실}>📍 지금 위치를 사무실로</button>
          <small class="hint">${s.office_lat != null ? `정해져 있음 (${s.office_lat.toFixed(4)}, ${s.office_lng.toFixed(4)})` : "아직 없음 — 사무실에서 눌러 주세요"}</small><//>
      </div><div class="bar"><span class="grow"></span><button class="btn primary" onClick=${설정저장}>설정 저장</button></div></div>`;
}
