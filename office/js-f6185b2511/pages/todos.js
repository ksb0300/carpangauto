// 할 일 — 웍스 '할 일' 따라 만듦 (2026-10-19). 사무실(대표·직원)만.
//   담당 할 일(나에게 온 것) / 요청 할 일(내가 남에게 맡긴 것) / 전체 / 완료
//   남에게 맡기면 그 사람 폰·PC 가 울리고(알림 종류 'todo'), 맡은 사람이 끝내면 맡긴 사람에게 알림.
//   기한이 지나면 빨강, 오늘이면 주황. 눌러서 오른쪽(폰은 아래)에서 제목·메모·기한·담당자를 고친다.
import { html, useState, useEffect, Loading, Empty, run, ask, today } from "../ui.js";
import { q } from "../db.js";
import { 보내기 as 알림 } from "../push.js";
import { 구성원, 이름표, Avatar, 언제, 날짜시각 } from "../people.js";

const 요일 = "일월화수목금토";
const 기한글 = d => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return `${x.getMonth() + 1}. ${x.getDate()}.(${요일[x.getDay()]})`; };
/** '언제' 글: 오늘 13:00 / 내일 / 10. 21.(수) 09:30 — 시각을 넣으면 10분 전에 알림 */
const 언제글 = (d, t) => { if (!d) return ""; const 날 = d === today() ? "오늘" : d === 내일() ? "내일" : 기한글(d); return t ? `${날} ${String(t).slice(0, 5)}` : 날; };
const 내일 = () => new Date(Date.now() + 33 * 3600e3).toISOString().slice(0, 10);
const 기한색 = (d, done) => !d || done ? "" : d < today() ? "red" : d === today() ? "amber" : "";
const 보기들 = [["담당", "담당 할 일", "📥"], ["요청", "요청 할 일", "📤"], ["전체", "전체 할 일", "🗂"], ["완료", "완료", "✔"]];

export function TodosPage({ app }) {
  const me = app.user.id, 나 = app.profile.name;
  const [rows, setRows] = useState(null);
  const [members, setMembers] = useState([]);
  const [v, setV] = useState(() => { try { return sessionStorage.getItem("todo-view") || "담당"; } catch { return "담당"; } });
  const [sel, setSel] = useState(null);           // 상세로 연 할 일 id
  const [t, setT] = useState("");
  const [due, setDue] = useState("");
  const [tm, setTm] = useState("");
  const [who, setWho] = useState(me);
  const load = () => run(async () => {
    const [r, m] = await Promise.all([q(app.db.from("todos").select("*").order("done").order("due", { ascending: true, nullsFirst: false }).order("due_time", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500)), 구성원(app)]);
    setRows(r); setMembers(m);
  });
  useEffect(() => { load(); }, []);
  const 보기 = x => { setV(x); setSel(null); try { sessionStorage.setItem("todo-view", x); } catch {} };
  const 이름 = id => 이름표(members, id);

  const add = () => run(async () => {
    if (!t.trim()) return;
    const 담당 = who || null;
    if (tm && !due) throw new Error("시각을 넣으려면 날짜도 골라 주세요");
    const [r] = await q(app.db.from("todos").insert({ title: t.trim(), due: due || null, due_time: tm || null, assignee_id: 담당, assignee: 담당 ? 이름(담당) : null, author_name: 나 }).select("id"));
    if (담당 && 담당 !== me) await 알림(app, { title: `📋 할 일 요청: ${t.trim()}`, body: `${나}${due ? " · " + 언제글(due, tm) : ""}`, url: "/office/#/todos", tag: "todo-" + r.id, to_users: [담당], pref: "todo" });
    setT(""); setDue(""); setTm(""); load();
  }, who && who !== me ? "맡겼습니다 — 담당자에게 알림이 갑니다" : null);
  const 체크 = r => run(async () => {
    await q(app.db.from("todos").update(r.done ? { done: false, done_by: null, done_at: null } : { done: true, done_by: 나, done_at: new Date().toISOString() }).eq("id", r.id));
    if (!r.done && r.created_by && r.created_by !== me) await 알림(app, { title: `✔ 할 일 완료: ${r.title}`, body: 나, url: "/office/#/todos", tag: "todo-" + r.id, to_users: [r.created_by], pref: "todo" });
    load();
  });

  const all = rows || [];
  const 열린 = all.filter(r => !r.done);
  const 목록 = v === "담당" ? 열린.filter(r => r.assignee_id === me || (!r.assignee_id && r.created_by === me))
    : v === "요청" ? all.filter(r => r.created_by === me && r.assignee_id && r.assignee_id !== me && !r.done)
    : v === "완료" ? all.filter(r => r.done) : 열린;
  const n = { 담당: 열린.filter(r => r.assignee_id === me || (!r.assignee_id && r.created_by === me)).length,
    요청: all.filter(r => r.created_by === me && r.assignee_id && r.assignee_id !== me && !r.done).length, 전체: 열린.length, 완료: all.filter(r => r.done).length };
  const 지남 = 목록.filter(r => !r.done && r.due && r.due < today()).length;
  const 고른 = all.find(r => r.id === sel);

  return html`<div class="bd">
    <aside class="bd-side">
      <div class="bd-quick" style="grid-template-columns:repeat(4,1fr)">${보기들.map(([k, l]) => html`<button class=${v === k ? "on" : ""} onClick=${() => 보기(k)}><b>${n[k]}</b>${l.replace(" 할 일", "")}</button>`)}</div>
      <nav class="bd-tree">${보기들.map(([k, l, ic]) => html`<a href="#" class=${v === k ? "on" : ""} onClick=${e => { e.preventDefault(); 보기(k); }}><span>${ic}</span>${l}<span class="n">${n[k]}</span></a>`)}</nav>
      <p class="note small" style="margin-top:12px">남에게 맡기면 그 사람 폰·PC 로 알림이 가고, 끝내면 맡긴 사람에게 알림이 옵니다.</p>
    </aside>
    <section>
      <div class="bd-head"><h2>${보기들.find(x => x[0] === v)[2]} ${보기들.find(x => x[0] === v)[1]}</h2>${지남 > 0 && html`<span class="badge red">기한 지남 ${지남}</span>`}</div>
      <div class="card td-add">
        <input class="td-title" value=${t} placeholder="새로운 할 일 (예: 54다8079 탁송 예약)" onInput=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) add(); }} />
        <div class="td-opts">
          <label class="small muted">언제 <input type="date" value=${due} onInput=${e => setDue(e.target.value)} /></label>
          <label class="small muted" title="시각을 넣으면 10분 전에 담당자에게 알림이 가고 일정에도 보입니다">몇 시 <input type="time" value=${tm} onInput=${e => setTm(e.target.value)} /></label>
          <label class="small muted">담당 <select value=${who || ""} onChange=${e => setWho(e.target.value || null)}>
            <option value="">아무나</option>${members.map(m => html`<option value=${m.user_id}>${m.user_id === me ? `나 (${m.name})` : m.name}</option>`)}</select></label>
          <span class="grow"></span><button class="btn primary" onClick=${add}>${who && who !== me ? "📤 요청하기" : "저장"}</button></div>
      </div>
      <div class=${"td-wrap" + (고른 ? " open" : "")}>
        <div>${!rows ? html`<${Loading} />` : !목록.length ? html`<${Empty}>${v === "담당" ? "맡은 할 일이 없습니다 👍" : v === "요청" ? "남에게 맡긴 할 일이 없습니다." : v === "완료" ? "끝난 일이 없습니다." : "할 일이 없습니다."}<//>` : html`<div class="bd-rows">
          ${목록.map(r => html`<div key=${r.id} class=${"td-row" + (r.id === sel ? " on" : "") + (r.done ? " done" : "")} onClick=${() => setSel(r.id === sel ? null : r.id)}>
            <button class=${"td-chk" + (r.done ? " on" : "")} title=${r.done ? "다시 열기" : "완료"} onClick=${e => { e.stopPropagation(); 체크(r); }}>${r.done ? "✔" : ""}</button>
            <div class="bx"><div class="t">${r.title}</div>
              <div class="m">${r.due && html`<span class=${기한색(r.due, r.done)}>${r.due_time ? html`⏰ <b>${언제글(r.due, r.due_time)}</b>` : `기한 ${언제글(r.due)}`}</span> · `}담당 ${r.assignee_id ? 이름(r.assignee_id) || r.assignee : r.assignee || "아무나"}${r.created_by && r.created_by !== r.assignee_id ? ` · 요청 ${r.author_name}` : ""}${r.done ? ` · ✔ ${r.done_by} ${언제(r.done_at)}` : ""}</div></div>
            ${r.assignee_id && html`<${Avatar} name=${이름(r.assignee_id) || r.assignee} size=${28} />`}</div>`)}</div>`}</div>
        ${고른 && html`<${상세} app=${app} r=${고른} members=${members} onClose=${() => setSel(null)} onChange=${load} />`}
      </div>
    </section></div>`;
}

function 상세({ app, r, members, onClose, onChange }) {
  const me = app.user.id, 나 = app.profile.name;
  const [f, setF] = useState(r);
  useEffect(() => { setF(r); }, [r.id, r.done]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    const 바뀐담당 = (f.assignee_id || null) !== (r.assignee_id || null);
    if (f.due_time && !f.due) throw new Error("시각을 넣으려면 날짜도 골라 주세요");
    await q(app.db.from("todos").update({ title: f.title.trim() || r.title, memo: f.memo || null, due: f.due || null, due_time: f.due_time || null,
      assignee_id: f.assignee_id || null, assignee: f.assignee_id ? 이름표(members, f.assignee_id) : null }).eq("id", r.id));
    if (바뀐담당 && f.assignee_id && f.assignee_id !== me)
      await 알림(app, { title: `📋 할 일 요청: ${f.title}`, body: `${나}${f.due ? " · " + 언제글(f.due, f.due_time) : ""}`, url: "/office/#/todos", tag: "todo-" + r.id, to_users: [f.assignee_id], pref: "todo" });
    onChange();
  }, "저장했습니다");
  const del = () => ask(`'${r.title}' 을(를) 지울까요?`) && run(async () => { await q(app.db.from("todos").delete().eq("id", r.id)); onClose(); onChange(); }, "지웠습니다");
  return html`<div class="card td-detail">
    <div class="bar"><b>상세</b><span class="grow"></span><button class="btn sm ghost" onClick=${onClose}>닫기 ✕</button></div>
    <label class="field wide"><span class="lab">할 일</span><input value=${f.title} onInput=${e => set("title", e.target.value)} /></label>
    <div class="fgrid">
      <label class="field"><span class="lab">언제</span><input type="date" value=${f.due || ""} onInput=${e => set("due", e.target.value)} /></label>
      <label class="field"><span class="lab">몇 시 (선택)</span><input type="time" value=${(f.due_time || "").slice(0, 5)} onInput=${e => set("due_time", e.target.value)} />
        <small class="hint">넣으면 10분 전에 담당자 폰으로 알림 · 일정에도 보임</small></label>
      <label class="field"><span class="lab">담당</span><select value=${f.assignee_id || ""} onChange=${e => set("assignee_id", e.target.value || null)}>
        <option value="">아무나</option>${members.map(m => html`<option value=${m.user_id}>${m.user_id === me ? `나 (${m.name})` : m.name}</option>`)}</select></label>
    </div>
    <label class="field wide"><span class="lab">메모</span><textarea rows="4" value=${f.memo || ""} onInput=${e => set("memo", e.target.value)}></textarea></label>
    <p class="small muted">요청 ${r.author_name} · ${날짜시각(r.created_at)}${r.done ? ` · ✔ ${r.done_by} ${날짜시각(r.done_at)}` : ""}</p>
    <div class="bar"><button class="btn danger sm" onClick=${del}>삭제</button><span class="grow"></span><button class="btn primary" onClick=${save}>저장</button></div>
  </div>`;
}
