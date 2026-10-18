// 할 일 — 공용 체크리스트. 누구나 추가·체크, '누가' 맡았는지 적어 두면 '내 할 일'로 거를 수 있다. 사무실(대표·직원)만.
// '누가' 이름 추천은 지금까지 적힌 이름들에서 (직원은 남의 profiles 를 못 읽어서 계정 목록을 쓰지 않는다).
import { html, useState, useEffect, Loading, Empty, Seg, run, ask } from "../ui.js";
import { q } from "../db.js";

const 때 = t => { const d = new Date(new Date(t).getTime() + 9 * 3600e3).toISOString(); return d.slice(5, 10).replace("-", "/") + " " + d.slice(11, 16); };

export function TodosPage({ app }) {
  const me = app.profile.name;
  const [rows, setRows] = useState(null);
  const [view, setView] = useState("전체");
  const [t, setT] = useState("");
  const [who, setWho] = useState("");
  const [showDone, setShowDone] = useState(false);
  const load = () => run(async () => setRows(await q(app.db.from("todos").select("*").order("done").order("created_at", { ascending: false }).limit(300))));
  useEffect(() => { load(); }, []);
  const add = () => run(async () => {
    if (!t.trim()) return;
    await q(app.db.from("todos").insert({ title: t.trim(), assignee: who.trim() || null, author_name: me }));
    setT(""); load();
  });
  const toggle = r => run(async () => {
    await q(app.db.from("todos").update(r.done ? { done: false, done_by: null, done_at: null }
      : { done: true, done_by: me, done_at: new Date().toISOString() }).eq("id", r.id));
    load();
  });
  const del = r => ask(`'${r.title}' 을(를) 지울까요?`) && run(async () => { await q(app.db.from("todos").delete().eq("id", r.id)); load(); });
  const clearDone = () => ask("끝난 일을 모두 지울까요?") && run(async () => { await q(app.db.from("todos").delete().eq("done", true)); load(); }, "정리했습니다");

  const names = [...new Set([me, ...(rows || []).flatMap(r => [r.assignee, r.author_name])].filter(Boolean))];
  const mine = r => r.assignee === me || (!r.assignee && r.author_name === me);
  const open = (rows || []).filter(r => !r.done && (view === "전체" || (view === "내 할 일" ? mine(r) : !r.assignee)));
  const done = (rows || []).filter(r => r.done);
  const Item = r => html`<li key=${r.id}>
    <input type="checkbox" style="width:auto;transform:scale(1.3)" checked=${r.done} onChange=${() => toggle(r)} />
    <div style="flex:1"><span style=${r.done ? "text-decoration:line-through;color:var(--sub)" : ""}>${r.title}</span>
      <div class="muted small">${r.assignee ? html`<b>${r.assignee}</b> 담당 · ` : "누구든 · "}${r.author_name} ${때(r.created_at)}${r.done ? ` · ✔ ${r.done_by} ${때(r.done_at)}` : ""}</div></div>
    <button class="btn sm ghost" onClick=${() => del(r)}>✕</button></li>`;

  return html`<div class="bar"><h2>할 일</h2><span class="muted small">누구나 추가·체크</span></div>
    <div class="card">
      <div class="row"><input value=${t} placeholder="할 일 (예: 54다8079 탁송 예약)" onInput=${e => setT(e.target.value)}
          onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) add(); }} />
        <input class="w80" style="max-width:110px" list="todo-who" value=${who} placeholder="누가 (선택)" onInput=${e => setWho(e.target.value)} />
        <button class="btn primary" onClick=${add}>추가</button></div>
      <datalist id="todo-who">${names.map(n => html`<option value=${n} />`)}</datalist>
    </div>
    <div class="bar" style="margin:6px 0 10px"><${Seg} value=${view} onChange=${setView} options=${["전체", "내 할 일", "담당 없음"]} /></div>
    ${!rows ? html`<${Loading} />` : html`<div class="card">
      ${open.length ? html`<ul class="todo">${open.map(Item)}</ul>` : html`<${Empty}>남은 할 일이 없습니다 👍<//>`}</div>
      ${done.length > 0 && html`<div class="bar" style="margin-top:6px"><button class="btn sm ghost" onClick=${() => setShowDone(!showDone)}>${showDone ? "▾" : "▸"} 끝난 일 ${done.length}</button>
        <span class="grow"></span>${showDone && html`<button class="btn sm ghost" onClick=${clearDone}>끝난 일 비우기</button>`}</div>
        ${showDone && html`<div class="card"><ul class="todo">${done.map(Item)}</ul></div>`}`}`}`;
}
