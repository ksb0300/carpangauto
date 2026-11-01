// 거래처 연락처 — 웍스 주소록 대신. 탁송·정비·공업사·캐피탈·수출 등 공용 주소록 (나무위키처럼 누구나 추가·수정).
// 폰에서는 번호를 누르면 바로 전화. 사무실(대표·직원)만.
import { html, useState, useEffect, Loading, Empty, Badge, Seg, Field, Select, run, ask, 검색맞음 } from "../ui.js";
import { q } from "../db.js";

const CATS = ["탁송", "정비", "공업사", "캐피탈", "수출", "매입", "관공서", "기타"];
const TONE = { 탁송: "blue", 정비: "amber", 공업사: "amber", 캐피탈: "green", 수출: "blue", 매입: "green", 관공서: "gray", 기타: "gray" };
const 빈 = { category: "탁송", name: "", phone: "", phone2: "", memo: "" };
const tel = s => String(s || "").replace(/[^\d+]/g, "");

export function ContactsPage({ app }) {
  const [rows, setRows] = useState(null);
  const [cat, setCat] = useState("전체");
  const [s, setS] = useState("");
  const [f, setF] = useState(null);          // 추가·수정 중인 값 (null 이면 닫힘)
  const load = () => run(async () => setRows(await q(app.db.from("contacts").select("*").order("category").order("name"))));
  useEffect(() => { load(); }, []);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    if (!f.name.trim()) throw new Error("이름(상호)을 입력하세요");
    const v = { category: f.category, name: f.name.trim(), phone: f.phone.trim() || null, phone2: f.phone2.trim() || null, memo: f.memo.trim() || null };
    if (f.id) await q(app.db.from("contacts").update({ ...v, updated_at: new Date().toISOString() }).eq("id", f.id));
    else await q(app.db.from("contacts").insert({ ...v, author_name: app.profile.name }));
    setF(null); load();
  }, "저장했습니다");
  const del = r => ask(`${r.name} 연락처를 지울까요?`) && run(async () => { await q(app.db.from("contacts").delete().eq("id", r.id)); setF(null); load(); }, "지웠습니다");
  const shown = (rows || []).filter(r => (cat === "전체" || r.category === cat) && 검색맞음(s, r.name, r.phone, r.phone2, r.memo));
  const n = c => (rows || []).filter(r => r.category === c).length;

  return html`<div class="bar"><h2>거래처 연락처</h2><span class="muted small">누구나 추가·수정 · 번호를 누르면 전화</span><span class="grow"></span>
      <button class="btn primary" onClick=${() => setF(f ? null : { ...빈, category: cat === "전체" ? "탁송" : cat })}>${f && !f.id ? "닫기" : "＋ 연락처 추가"}</button></div>
    ${f && html`<div class="card"><h3>${f.id ? "연락처 수정" : "새 연락처"}</h3>
      <div class="fgrid">
        <${Field} label="분류"><${Select} value=${f.category} onChange=${v => set("category", v)} options=${CATS} /><//>
        <${Field} label="이름·상호" req><input value=${f.name} placeholder="예: 부산탁송 김기사" onInput=${e => set("name", e.target.value)} /><//>
        <${Field} label="전화"><input inputmode="tel" value=${f.phone} placeholder="010-0000-0000" onInput=${e => set("phone", e.target.value)} /><//>
        <${Field} label="전화 2"><input inputmode="tel" value=${f.phone2} onInput=${e => set("phone2", e.target.value)} /><//>
      </div>
      <${Field} label="메모" wide hint="단가·계좌·영업시간·담당자 등"><textarea rows="2" value=${f.memo} onInput=${e => set("memo", e.target.value)}></textarea><//>
      <div class="bar">${f.id && html`<button class="btn danger" onClick=${() => del(f)}>삭제</button>`}<span class="grow"></span>
        <button class="btn ghost" onClick=${() => setF(null)}>취소</button><button class="btn primary" onClick=${save}>저장</button></div></div>`}
    <div class="bar" style="margin:6px 0 10px;flex-wrap:wrap">
      <${Seg} value=${cat} onChange=${setCat} options=${[["전체", "전체"], ...CATS.filter(c => n(c)).map(c => [c, `${c} ${n(c)}`])]} />
      <input class="search" style="max-width:220px" placeholder="이름·번호·메모 검색" value=${s} onInput=${e => setS(e.target.value)} /></div>
    ${!rows ? html`<${Loading} />` : !shown.length ? html`<${Empty}>${rows.length ? "찾는 연락처가 없습니다." : "아직 연락처가 없습니다. ＋ 연락처 추가로 시작하세요."}<//>` : html`<div class="card" style="padding:0">
      <table class="grid"><tbody>${shown.map(r => html`<tr key=${r.id}>
        <td style="width:1%"><${Badge} tone=${TONE[r.category]}>${r.category}<//></td>
        <td style="white-space:normal"><b>${r.name}</b>${r.memo && html`<div class="muted small" style="white-space:pre-wrap">${r.memo}</div>`}</td>
        <td style="width:1%">${[r.phone, r.phone2].filter(Boolean).map(p => html`<div><a href=${"tel:" + tel(p)}>📞 ${p}</a></div>`)}</td>
        <td class="r" style="width:1%"><button class="btn sm ghost" onClick=${() => setF({ ...빈, ...r, phone: r.phone || "", phone2: r.phone2 || "", memo: r.memo || "" })}>수정</button></td>
      </tr>`)}</tbody></table></div>`}`;
}
