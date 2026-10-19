// 캘린더 — 웍스 캘린더 따라 만듦 (2026-10-19). 사무실(대표·직원)만.
//   구성원 주간(사람마다 한 줄, 웍스에서 실제로 쓰던 보기) · 월간 · 목록. 왼쪽 작은 달력으로 날짜 이동.
//   맨 위 '자동' 줄: 재고금융 만기(대출상태()와 같은 계산) · 광고장 예약 확보일.
//   빈 칸을 누르면 그 사람·그날 일정 쓰기, 일정을 누르면 고치기. 남에게 일정을 넣으면 그 사람 폰·PC 로 알림('calendar').
import { html, useState, useEffect, Loading, Seg, run, ask, today, toast } from "../ui.js";
import { q } from "../db.js";
import { 대출상태 } from "../calc.js";
import { 보내기 as 알림 } from "../push.js";
import { 구성원, 이름표, Avatar, 언제 } from "../people.js";

const 요일 = ["일", "월", "화", "수", "목", "금", "토"];
const COLORS = [["blue", "#2563eb"], ["green", "#16a34a"], ["amber", "#d97706"], ["red", "#dc2626"], ["purple", "#7c3aed"]];
const 색값 = Object.fromEntries(COLORS);
const D = s => new Date(s + "T00:00:00Z");
const ymd = d => d.toISOString().slice(0, 10);
const 더하기 = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const 주시작 = s => 더하기(s, -D(s).getUTCDay());
const 월시작 = s => s.slice(0, 8) + "01";
const 월끝 = s => { const d = D(월시작(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return ymd(d); };
const 시간 = t => t ? String(t).slice(0, 5) : "";
const 짧은날 = s => `${+s.slice(5, 7)}. ${+s.slice(8, 10)}.(${요일[D(s).getUTCDay()]})`;
const 걸침 = (e, day) => e.d <= day && (e.d_end || e.d) >= day;
const 번호 = s => String(s || "").replace(/\s/g, "");

export function CalendarPage({ app }) {
  const me = app.user.id;
  const [view, setView0] = useState(() => { try { return localStorage.getItem("cal-view") || "주간"; } catch { return "주간"; } });
  const setView = v => { setView0(v); try { localStorage.setItem("cal-view", v); } catch {} };
  const [at, setAt] = useState(today());
  const [ev, setEv] = useState(null);
  const [auto, setAuto] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(null);       // 쓰기·고치기 중인 일정
  const [동기, set동기] = useState(null);         // 광고장 예약 내역 마지막으로 가져온 때 (사무실 PC)
  const [가져오는중, set가져오는중] = useState(false);
  const 범위 = view === "주간" ? [주시작(at), 더하기(주시작(at), 6)] : view === "월간" ? [주시작(월시작(at)), 더하기(주시작(월끝(at)), 6)] : [at, 더하기(at, 30)];

  const load = () => run(async () => {
    const [from, to] = 범위;
    const [e, loans, res, m, w] = await Promise.all([
      q(app.db.from("calendar_events").select("*").lte("d", to).or(`d_end.gte.${from},and(d_end.is.null,d.gte.${from})`).order("d").order("start_time", { nullsFirst: true })),
      q(app.db.from("car_loans").select("*, cars(plate, car_name)").eq("status", "진행중")),
      // 엔카 광고장 예약 내역 (직접 한 예약 포함 — 사무실 PC 가 엔카 '예약조회'를 10분마다 읽어 넣는다)
      q(app.db.from("encar_reservations").select("*").is("gone_at", null).gte("res_date", from).lte("res_date", to).order("res_time")),
      구성원(app),
      q(app.db.from("encar_reserve_worker").select("sync_at, sync_msg, seen_at")),
    ]);
    setEv(e); setMembers(m); set동기(w[0] || null);
    const a = [];
    for (const l of loans) {
      const 만기 = 대출상태(l, today()).만기;
      if (만기 >= from && 만기 <= to) a.push({ d: 만기, title: `만기 ${l.cars?.plate || ""}`, color: "red", auto: "재고금융", href: "#/car/" + l.car_id + "/loans" });
    }
    for (const r of res) a.push({ d: r.res_date, start_time: r.res_time, title: `${r.plate || ""} ${(r.car_name || "").split(" ").slice(-2).join(" ")}`.trim(),
      color: "green", auto: "광고장 예약", href: r.car_id ? "#/car/" + r.car_id : "#/reserve" });
    setAuto(a);
  });
  // [광고장 가져오기]: 사무실 PC 에 요청 → PC 가 엔카를 읽고 끝나면(마지막 가져온 때가 바뀌면) 다시 그린다
  const 가져오기 = () => run(async () => {
    const 전 = 동기?.sync_at || "";
    await q(app.db.rpc("encar_reserve_sync_request"));
    set가져오는중(true);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const [w] = await q(app.db.from("encar_reserve_worker").select("sync_at, sync_msg, seen_at"));
      if (w?.sync_at && w.sync_at !== 전) { set가져오는중(false); toast(`광고장 예약 ${w.sync_msg || ""} 가져왔습니다`); return load(); }
    }
    set가져오는중(false);
    throw new Error("사무실 PC 가 응답하지 않습니다 (감시 프로그램이 켜져 있는지 확인)");
  });
  useEffect(() => { load(); }, [view, 범위[0], 범위[1]]);

  const 새일정 = (d, owner = me) => setForm({ d, d_end: "", start_time: "", end_time: "", 종일: true, title: "", memo: "", color: "blue", owner_id: owner, plate: "" });
  const 열기 = e => e.auto ? (location.hash = e.href) : setForm({ ...e, d_end: e.d_end || "", 종일: !e.start_time, start_time: 시간(e.start_time), end_time: 시간(e.end_time), plate: "" });
  const 이동 = n => setAt(view === "주간" ? 더하기(at, 7 * n) : view === "월간" ? (() => { const d = D(월시작(at)); d.setUTCMonth(d.getUTCMonth() + n); return ymd(d); })() : 더하기(at, 30 * n));
  const 제목 = view === "월간" ? `${at.slice(0, 4)}. ${+at.slice(5, 7)}` : `${+범위[0].slice(5, 7)}.${+범위[0].slice(8)} - ${+범위[1].slice(5, 7)}.${+범위[1].slice(8)}`;
  const 모두 = [...(ev || []), ...auto];
  const Chip = (e, 이름도) => html`<div class="cal-ev" style=${`border-left-color:${색값[e.color] || 색값.blue}`} title=${e.title} onClick=${x => { x.stopPropagation(); 열기(e); }}>
    ${e.start_time && html`<b>${시간(e.start_time)}${e.end_time ? "~" + 시간(e.end_time) : ""}</b>`}${이름도 && e.owner_id ? `${이름표(members, e.owner_id).slice(0, 3)} · ` : ""}${e.auto ? (e.auto === "재고금융" ? "🏦 " : "📣 ") : ""}${e.title}</div>`;

  return html`<div class="bd">
    <aside class="bd-side">
      <button class="btn primary bd-write" onClick=${() => 새일정(at)}>📅 일정쓰기</button>
      <${작은달력} at=${at} setAt=${setAt} 모두=${모두} />
      <div class="card" style="padding:10px 12px;margin:12px 0">
        <div class="small"><b>📣 엔카 광고장 예약</b></div>
        <div class="muted small" style="margin:2px 0 8px">${동기?.sync_at ? `${언제(동기.sync_at)} 가져옴 · ${동기.sync_msg || ""}` : "아직 안 가져옴"} · 10분마다 자동</div>
        <button class="btn sm" style="width:100%" disabled=${가져오는중} onClick=${가져오기}>${가져오는중 ? "사무실 PC 가 가져오는 중…" : "🔄 지금 가져오기"}</button>
      </div>
      <p class="note small"><span class="badge red">🏦 만기</span> <span class="badge green">📣 광고장</span>은 자동으로 보입니다(엔카에서 직접 한 예약 포함). 빈 칸을 누르면 그 사람·그날 일정을 씁니다.</p>
    </aside>
    <section>
      <div class="bd-head">
        <button class="btn sm" onClick=${() => setAt(today())}>오늘</button>
        <button class="btn sm ghost" onClick=${() => 이동(-1)}>◀</button><button class="btn sm ghost" onClick=${() => 이동(1)}>▶</button>
        <h2 style="font-size:20px">${제목}</h2><span class="grow"></span>
        <${Seg} value=${view} onChange=${setView} options=${[["주간", "구성원 주간"], ["월간", "월간"], ["목록", "목록"]]} /></div>
      ${form && html`<${일정폼} app=${app} f=${form} setF=${setForm} members=${members} onDone=${() => { setForm(null); load(); }} />`}
      ${!ev ? html`<${Loading} />` : view === "주간" ? html`<${주간} 범위=${범위} ev=${ev} auto=${auto} members=${members} Chip=${Chip} 새일정=${새일정} me=${me} />`
        : view === "월간" ? html`<${월간} at=${at} 범위=${범위} 모두=${모두} Chip=${Chip} 새일정=${새일정} />`
        : html`<${목록} 범위=${범위} 모두=${모두} Chip=${Chip} />`}
    </section></div>`;
}

function 작은달력({ at, setAt, 모두 }) {
  const [m, setM] = useState(월시작(at));
  useEffect(() => { setM(월시작(at)); }, [at.slice(0, 7)]);
  const 첫 = 주시작(m), 날들 = Array.from({ length: 42 }, (_, i) => 더하기(첫, i)).filter((d, i) => i < 35 || d.slice(0, 7) === m.slice(0, 7));
  const 다음 = n => { const d = D(m); d.setUTCMonth(d.getUTCMonth() + n); setM(ymd(d)); };
  return html`<div class="mini-cal">
    <div class="bar"><b>${m.slice(0, 4)}. ${+m.slice(5, 7)}</b><span class="grow"></span><button class="btn sm ghost" onClick=${() => 다음(-1)}>‹</button><button class="btn sm ghost" onClick=${() => 다음(1)}>›</button></div>
    <div class="mc-grid">${요일.map((w, i) => html`<span class=${"mc-w" + (i === 0 ? " sun" : "")}>${w}</span>`)}
      ${날들.map(d => html`<button class=${"mc-d" + (d.slice(0, 7) !== m.slice(0, 7) ? " other" : "") + (d === today() ? " today" : "") + (d === at ? " on" : "") + (D(d).getUTCDay() === 0 ? " sun" : "")}
        onClick=${() => setAt(d)}>${+d.slice(8)}${모두.some(e => 걸침(e, d)) && html`<i></i>`}</button>`)}</div></div>`;
}

function 주간({ 범위, ev, auto, members, Chip, 새일정, me }) {
  const 날들 = Array.from({ length: 7 }, (_, i) => 더하기(범위[0], i));
  const 줄 = [...members].sort((a, b) => (a.user_id === me ? -1 : b.user_id === me ? 1 : 0));
  const 주인없음 = ev.filter(e => !e.owner_id || !members.some(m => m.user_id === e.owner_id));
  return html`<div class="cal-week"><table><thead><tr><th class="who">구성원</th>${날들.map(d => html`<th class=${(d === today() ? "today " : "") + (D(d).getUTCDay() === 0 ? "sun" : D(d).getUTCDay() === 6 ? "sat" : "")}>
      ${d === today() ? html`<span class="tdy">${+d.slice(8)}</span>` : +d.slice(8)} ${요일[D(d).getUTCDay()]}</th>`)}</tr></thead>
    <tbody>
      ${auto.length > 0 && html`<tr class="auto"><td class="who"><span class="muted small">📌 자동</span></td>${날들.map(d => html`<td>${auto.filter(e => e.d === d).map(e => Chip(e))}</td>`)}</tr>`}
      ${줄.map(m => html`<tr><td class="who"><${Avatar} name=${m.name} size=${34} /><div>${m.name}${m.user_id === me ? html`<span class="muted small"> (나)</span>` : ""}</div></td>
        ${날들.map(d => html`<td onClick=${() => 새일정(d, m.user_id)}>${ev.filter(e => e.owner_id === m.user_id && 걸침(e, d)).map(e => Chip(e))}</td>`)}</tr>`)}
      ${주인없음.length > 0 && html`<tr><td class="who"><span class="muted small">공용</span></td>${날들.map(d => html`<td onClick=${() => 새일정(d, null)}>${주인없음.filter(e => 걸침(e, d)).map(e => Chip(e))}</td>`)}</tr>`}
    </tbody></table></div>`;
}

function 월간({ at, 범위, 모두, Chip, 새일정 }) {
  const 날들 = []; for (let d = 범위[0]; d <= 범위[1]; d = 더하기(d, 1)) 날들.push(d);
  return html`<div class="cal-month">${요일.map((w, i) => html`<div class=${"cm-w" + (i === 0 ? " sun" : i === 6 ? " sat" : "")}>${w}</div>`)}
    ${날들.map(d => { const 그날 = 모두.filter(e => 걸침(e, d)); return html`<div class=${"cm-d" + (d.slice(0, 7) !== at.slice(0, 7) ? " other" : "") + (d === today() ? " today" : "")} onClick=${() => 새일정(d)}>
      <span class="n">${+d.slice(8)}</span>${그날.slice(0, 4).map(e => Chip(e, true))}${그날.length > 4 ? html`<div class="muted" style="font-size:11px">+${그날.length - 4}</div>` : ""}</div>`; })}</div>`;
}

function 목록({ 범위, 모두, Chip }) {
  const 날들 = []; for (let d = 범위[0]; d <= 범위[1]; d = 더하기(d, 1)) if (모두.some(e => 걸침(e, d))) 날들.push(d);
  if (!날들.length) return html`<div class="card empty">앞으로 30일 동안 일정이 없습니다.</div>`;
  return html`<div class="bd-rows">${날들.map(d => html`<div class="cal-list-d"><div class=${"dt" + (d === today() ? " today" : "")}>${짧은날(d)}${d === today() ? " · 오늘" : ""}</div>
    <div class="evs">${모두.filter(e => 걸침(e, d)).map(e => Chip(e, true))}</div></div>`)}</div>`;
}

function 일정폼({ app, f, setF, members, onDone }) {
  const me = app.user.id;
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    if (!f.title.trim()) throw new Error("일정 내용을 입력하세요");
    if (f.d_end && f.d_end < f.d) throw new Error("끝 날이 시작 날보다 빠릅니다");
    let car_id = f.car_id || null;
    if (f.plate.trim()) {
      const p = 번호(f.plate), tail = p.slice(-4);
      const cars = /^\d{4}$/.test(tail) ? await q(app.db.from("cars").select("id, plate").is("deleted_at", null).ilike("plate", `%${tail}%`)) : [];
      car_id = cars.find(c => 번호(c.plate) === p)?.id || car_id;
    }
    const row = { d: f.d, d_end: f.d_end || null, start_time: f.종일 ? null : f.start_time || null, end_time: f.종일 ? null : f.end_time || null,
      title: f.title.trim(), memo: f.memo?.trim() || null, color: f.color, owner_id: f.owner_id || null, car_id };
    const 주인바뀜 = !f.id || (f.owner_id || null) !== (f._owner0 ?? f.owner_id);
    if (f.id) await q(app.db.from("calendar_events").update(row).eq("id", f.id));
    else await q(app.db.from("calendar_events").insert({ ...row, author_name: app.profile.name }));
    if (row.owner_id && row.owner_id !== me && 주인바뀜)
      await 알림(app, { title: `📅 일정: ${row.title}`, body: `${짧은날(row.d)}${row.start_time ? " " + 시간(row.start_time) : ""} · ${app.profile.name}`, url: "/office/#/calendar", tag: "cal-" + row.d, to_users: [row.owner_id], pref: "calendar" });
    onDone();
  }, f.id ? "고쳤습니다" : "넣었습니다");
  const del = () => ask(`'${f.title}' 일정을 지울까요?`) && run(async () => { await q(app.db.from("calendar_events").delete().eq("id", f.id)); onDone(); }, "지웠습니다");
  useEffect(() => { if (f.id && f._owner0 === undefined) setF(x => ({ ...x, _owner0: x.owner_id || null })); }, [f.id]);
  return html`<div class="card cal-form">
    <div class="bar"><b>${f.id ? "일정 고치기" : "📅 새 일정"}</b><span class="grow"></span><button class="btn sm ghost" onClick=${() => setF(null)}>닫기 ✕</button></div>
    <label class="field wide"><span class="lab">일정</span><input value=${f.title} placeholder="예: 18러4132 byd 매입 3892만원 / 탁송 10시" onInput=${e => set("title", e.target.value)}
      onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) save(); }} /></label>
    <div class="fgrid">
      <label class="field"><span class="lab">날짜</span><input type="date" value=${f.d} onInput=${e => set("d", e.target.value)} /></label>
      <label class="field"><span class="lab">끝 날 (여러 날이면)</span><input type="date" value=${f.d_end || ""} onInput=${e => set("d_end", e.target.value)} /></label>
      <label class="field"><span class="lab">하루 종일</span><input type="checkbox" style="width:auto" checked=${f.종일} onChange=${e => set("종일", e.target.checked)} /></label>
      ${!f.종일 && html`<label class="field"><span class="lab">시작</span><input type="time" value=${f.start_time} onInput=${e => set("start_time", e.target.value)} /></label>
        <label class="field"><span class="lab">끝</span><input type="time" value=${f.end_time} onInput=${e => set("end_time", e.target.value)} /></label>`}
      <label class="field"><span class="lab">담당</span><select value=${f.owner_id || ""} onChange=${e => set("owner_id", e.target.value || null)}>
        <option value="">공용</option>${members.map(m => html`<option value=${m.user_id}>${m.user_id === me ? `나 (${m.name})` : m.name}</option>`)}</select></label>
      <label class="field"><span class="lab">차량번호 (선택)</span><input value=${f.plate} placeholder="54다8079" onInput=${e => set("plate", e.target.value)} /></label>
      <label class="field"><span class="lab">색</span><div class="row" style="gap:6px">${COLORS.map(([k, c]) => html`<button type="button" title=${k} onClick=${() => set("color", k)}
        style=${`width:26px;height:26px;border-radius:50%;border:${f.color === k ? "3px solid #111" : "1px solid #ddd"};background:${c};cursor:pointer;flex:0 0 auto`}></button>`)}</div></label>
    </div>
    <label class="field wide"><span class="lab">메모</span><input value=${f.memo || ""} onInput=${e => set("memo", e.target.value)} /></label>
    <div class="bar">${f.id && html`<button class="btn danger sm" onClick=${del}>삭제</button>`}<span class="muted small">${f.author_name ? "쓴 사람 " + f.author_name : ""}</span><span class="grow"></span>
      <button class="btn primary" onClick=${save}>${f.id ? "저장" : "넣기"}</button></div>
  </div>`;
}
