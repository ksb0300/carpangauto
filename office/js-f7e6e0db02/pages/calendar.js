// 공용 일정 — 달력. 사람이 넣는 일정 + 업무관리에 이미 있는 날짜를 자동으로 겹쳐 보여 준다
//   자동: 재고금융 만기(진행 중 대출, 대출상태() 와 같은 계산) · 광고장 예약 확보일
// 날짜 칸을 누르면 그날 일정 추가. 사무실(대표·직원)만.
import { html, useState, useEffect, Loading, Field, Seg, run, ask, today } from "../ui.js";
import { q } from "../db.js";
import { 대출상태 } from "../calc.js";

const 요일 = ["일", "월", "화", "수", "목", "금", "토"];
const COLORS = [["blue", "파랑"], ["green", "초록"], ["amber", "노랑"], ["red", "빨강"]];
const ym = d => d.slice(0, 7);
const 더하기 = (m, n) => { const [y, mm] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const 끝날 = m => { const [y, mm] = m.split("-").map(Number); return new Date(Date.UTC(y, mm, 0)).getUTCDate(); };

export function CalendarPage({ app }) {
  const [m, setM] = useState(ym(today()));
  const [ev, setEv] = useState(null);
  const [auto, setAuto] = useState([]);
  const [pick, setPick] = useState(null);       // 고른 날짜
  const [f, setF] = useState({ title: "", memo: "", color: "blue" });
  const from = m + "-01", to = m + "-" + String(끝날(m)).padStart(2, "0");

  const load = () => run(async () => {
    const [e, loans, res] = await Promise.all([
      q(app.db.from("calendar_events").select("*").gte("d", from).lte("d", to).order("d")),
      q(app.db.from("car_loans").select("*, cars(plate, car_name)").eq("status", "진행중")),
      q(app.db.from("encar_reserve_jobs").select("center, res_date, result").eq("status", "확보").gte("res_date", from).lte("res_date", to)),
    ]);
    setEv(e);
    const a = [];
    for (const l of loans) {
      const 만기 = 대출상태(l, today()).만기;
      if (만기 >= from && 만기 <= to) a.push({ d: 만기, title: `만기 ${l.cars?.plate || ""}`, color: "red", auto: "재고금융", href: "#/car/" + l.car_id + "/loans" });
    }
    for (const r of res) a.push({ d: r.res_date, title: `광고장 ${String(r.result || "").split(" 확보")[0]}`, color: "green", auto: "광고장 예약", href: "#/reserve" });
    setAuto(a);
  });
  useEffect(() => { load(); }, [m]);

  const add = () => run(async () => {
    if (!f.title.trim()) throw new Error("일정 내용을 입력하세요");
    await q(app.db.from("calendar_events").insert({ d: pick, title: f.title.trim(), memo: f.memo.trim() || null, color: f.color, author_name: app.profile.name }));
    setF({ title: "", memo: "", color: f.color }); load();
  }, "넣었습니다");
  const del = x => ask(`'${x.title}' 일정을 지울까요?`) && run(async () => { await q(app.db.from("calendar_events").delete().eq("id", x.id)); load(); });

  const all = [...(ev || []), ...auto];
  const of = d => all.filter(x => x.d === d);
  const 첫요일 = new Date(from + "T00:00:00Z").getUTCDay();
  const cells = [...Array(첫요일).fill(null), ...Array.from({ length: 끝날(m) }, (_, i) => m + "-" + String(i + 1).padStart(2, "0"))];
  const 오늘 = today();
  const Chip = x => html`<div class=${"badge " + x.color} style="display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title=${x.title}>${x.title}</div>`;

  return html`<div class="bar"><h2>일정</h2><span class="grow"></span>
      <button class="btn sm ghost" onClick=${() => setM(더하기(m, -1))}>◀</button>
      <b style="min-width:84px;text-align:center">${m.replace("-", "년 ")}월</b>
      <button class="btn sm ghost" onClick=${() => setM(더하기(m, 1))}>▶</button>
      <button class="btn sm ghost" onClick=${() => { setM(ym(오늘)); setPick(오늘); }}>오늘</button></div>
    ${!ev ? html`<${Loading} />` : html`<div class="card" style="padding:6px">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">
        ${요일.map((w, i) => html`<div class="small muted" style=${"text-align:center;padding:4px 0;" + (i === 0 ? "color:var(--red,#d33)" : "")}>${w}</div>`)}
        ${cells.map(d => !d ? html`<div></div>` : html`<div onClick=${() => setPick(d)} style=${"min-height:64px;padding:3px;border-radius:6px;cursor:pointer;border:1px solid " +
            (d === pick ? "var(--accent,#2563eb)" : "var(--line2,#eee)") + (d === 오늘 ? ";background:#f0f6ff" : "")}>
          <div class="small" style=${"font-weight:" + (d === 오늘 ? 700 : 400)}>${Number(d.slice(8))}</div>
          ${of(d).slice(0, 3).map(Chip)}${of(d).length > 3 ? html`<div class="muted" style="font-size:11px">+${of(d).length - 3}</div>` : ""}</div>`)}
      </div></div>`}
    ${pick && html`<div class="card"><div class="bar"><h3>${pick.slice(5).replace("-", "/")}(${요일[new Date(pick + "T00:00:00Z").getUTCDay()]}) 일정</h3><span class="grow"></span>
        <button class="btn sm ghost" onClick=${() => setPick(null)}>닫기</button></div>
      ${of(pick).length > 0 && html`<ul class="todo">${of(pick).map(x => html`<li><span class=${"badge " + x.color}>${x.auto || "일정"}</span>
        <div style="flex:1">${x.href ? html`<a href=${x.href}>${x.title}</a>` : x.title}${x.memo && html`<div class="muted small" style="white-space:pre-wrap">${x.memo}</div>`}
          ${x.author_name && html`<div class="muted small">${x.author_name}</div>`}</div>
        ${!x.auto && html`<button class="btn sm ghost" onClick=${() => del(x)}>✕</button>`}</li>`)}</ul>`}
      <div class="fgrid" style="margin-top:8px">
        <${Field} label="일정" req><input value=${f.title} placeholder="예: 54다8079 출고 / 탁송 10시" onInput=${e => setF({ ...f, title: e.target.value })}
          onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) add(); }} /><//>
        <${Field} label="색"><${Seg} value=${f.color} onChange=${v => setF({ ...f, color: v })} options=${COLORS} /><//>
      </div>
      <${Field} label="메모" wide><input value=${f.memo} onInput=${e => setF({ ...f, memo: e.target.value })} /><//>
      <div class="bar"><span class="grow"></span><button class="btn primary" onClick=${add}>일정 넣기</button></div></div>`}
    ${!pick && html`<p class="note">날짜를 누르면 그날 일정을 보고 넣을 수 있습니다. <span class="badge red">빨강</span> 재고금융 만기 · <span class="badge green">초록</span> 광고장 예약은 자동으로 보입니다.</p>`}`;
}
