// 현금영수증·세금계산서 공용 화면 조각: 문서 표, 작성 폼, 발행·취소 동작.
// 발행은 팝빌(서버 함수)로, 홈택스에서 직접 발행했다면 '수기 발행 표시'로 승인번호만 적는다.
import { html, useState, Money, Field, Select, Seg, Badge, run, won, today, toast, ask } from "../ui.js";
import { q } from "../db.js";
import { popbill } from "../pb.js";
import { 부가세분리 } from "../calc.js";

export const SOURCES = ["차량대금", "상사매도비", "성능보험료", "상사매입비", "알선수수료", "기타"];
const TONE = { 대기: "amber", 발행: "green", 취소: "gray", 실패: "red" };

export const StatusBadge = ({ d }) => html`<${Badge} tone=${TONE[d.status]}>${d.status}${d.status === "발행" && d.issued_via === "수기" ? "(수기)" : ""}${d.issued_via === "데모" ? "(데모)" : ""}<//>`;

/** 한 건 발행 (팝빌) */
export async function issueOne(app, d) {
  return run(() => popbill(app.db, "doc.issue", { id: d.id }), `${d.doc_type} 발행 완료`);
}

/** 여러 건 차례로 발행 — 실패한 건은 건너뛰고 끝에 요약 */
export async function issueMany(app, docs) {
  let ok = 0; const fails = [];
  for (const d of docs) {
    try { await popbill(app.db, "doc.issue", { id: d.id }); ok++; }
    catch (e) { fails.push(`${d.item_name} ${won(d.amount)}: ${e.message}`); }
  }
  toast(`발행 ${ok}건${fails.length ? ` · 실패 ${fails.length}건` : ""}`, fails.length ? "err" : "ok");
  if (fails.length) console.warn(fails.join("\n"));
  return { ok, fails };
}

export function DocTable({ app, docs, reload, showCar = false, cars = {}, select, selectAll = false }) {
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const office = app.profile.role !== "dealer";
  const [sel, setSel] = select || [null, null];
  const act = async (fn) => { await fn(); reload(); };

  const manualIssue = d => act(async () => {
    const num = window.prompt(`홈택스에서 발행한 ${d.doc_type}의 승인번호를 입력하세요`, "");
    if (!num) return;
    await run(() => q(app.db.from("issue_docs").update({ status: "발행", issued_via: "수기", confirm_num: num.trim(), error: null }).eq("id", d.id)), "수기 발행으로 표시했습니다");
  });
  const cancel = d => act(async () => {
    if (d.issued_via === "수기") {
      if (!ask(`홈택스에서 이미 취소하셨나요?\n취소로 표시하면 되돌릴 수 없습니다.`)) return;
      await run(() => q(app.db.from("issue_docs").update({ status: "취소" }).eq("id", d.id)), "취소로 표시했습니다");
      return;
    }
    const reason = window.prompt(`${d.doc_type}을 취소합니다 (${won(d.amount)}원).\n${d.doc_type === "현금영수증" ? "취소거래가 새로 발행됩니다." : "국세청 전송 전에만 취소됩니다."}\n취소 사유:`, "");
    if (reason === null) return;
    await run(() => popbill(app.db, "doc.cancel", { id: d.id, reason }), "취소했습니다");
  });
  const remove = d => act(async () => {
    if (!ask("이 발행대기 문서를 지울까요?")) return;
    await run(() => q(app.db.from("issue_docs").delete().eq("id", d.id)), "지웠습니다");
  });

  if (!docs.length) return html`<div class="empty">문서가 없습니다.</div>`;
  const pending = selectAll ? docs : docs.filter(d => ["대기", "실패"].includes(d.status));
  return html`<div class="table-wrap"><table class="grid">
    <thead><tr>
      ${sel && html`<th><input type="checkbox" checked=${pending.length && pending.every(d => sel.has(d.id))}
        onChange=${e => setSel(new Set(e.target.checked ? pending.map(d => d.id) : []))} /></th>`}
      <th>거래일</th><th>종류</th>${showCar && html`<th>차량</th>`}<th>항목</th><th>상대방</th><th class="r">금액</th><th class="r">부가세</th>
      <th>상태</th><th>승인번호</th><th></th></tr></thead>
    <tbody>${docs.map(d => html`<tr>
      ${sel && html`<td>${(selectAll || ["대기", "실패"].includes(d.status)) && html`<input type="checkbox" checked=${sel.has(d.id)}
        onChange=${e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(d.id) : n.delete(d.id); return n; })} />`}</td>`}
      <td>${d.trade_date}</td>
      <td>${d.doc_type === "현금영수증" ? `현금영수증·${d.usage === "지출증빙용" ? "지출" : "소득"}` : `세금계산서·${d.purpose}`}</td>
      ${showCar && html`<td>${d.car_id ? html`<a href=${`#/car/${d.car_id}/docs`}>${cars[d.car_id]?.plate || "차량"}</a>` : "-"}</td>`}
      <td>${d.item_name}${!d.taxable && html` <span class="muted small">면세</span>`}</td>
      <td>${d.corp_name || d.customer_name || "-"} <span class="muted small">${d.doc_type === "현금영수증" ? (d.identity || "") : (d.biz_no || "")}</span></td>
      <td class="r">${won(d.amount)}</td><td class="r muted">${won(d.vat)}</td>
      <td><${StatusBadge} d=${d} />${d.status === "실패" && html` <a class="small red" onClick=${() => setOpen(open === d.id ? null : d.id)}>사유</a>`}</td>
      <td class="small">${d.confirm_num || ""}${d.cancel_confirm_num ? html`<br /><span class="muted">취소 ${d.cancel_confirm_num}</span>` : ""}</td>
      <td class="nowrap">${office && html`
        ${["대기", "실패"].includes(d.status) && html`<button class="btn sm primary" onClick=${() => act(() => issueOne(app, d))}>발행</button>
          <button class="btn sm" onClick=${() => setEdit(edit === d.id ? null : d.id)}>수정</button>
          <button class="btn sm" title="홈택스에서 직접 발행한 경우" onClick=${() => manualIssue(d)}>수기</button>
          <button class="btn sm ghost" onClick=${() => remove(d)}>✕</button>`}
        ${d.status === "발행" && html`<button class="btn sm danger" onClick=${() => cancel(d)}>취소</button>`}`}
      </td></tr>
      ${open === d.id && html`<tr><td colspan="11" class="red small">${d.error}</td></tr>`}
      ${edit === d.id && html`<tr><td colspan="11"><${DocForm} app=${app} init=${d} onDone=${() => { setEdit(null); reload(); }} /></td></tr>`}`)}</tbody>
  </table></div>`;
}

/** 문서 한 건 작성 (발행대기로 저장 → 바로 발행 선택) */
export function DocForm({ app, init = {}, onDone }) {
  const [f, setF] = useState({ doc_type: "현금영수증", trade_date: today(), source: "기타", item_name: "", taxable: true, amount: 0,
    usage: "소득공제용", purpose: "영수", customer_name: "", identity: "", biz_no: "", corp_name: "", ceo_name: "", addr: "",
    biz_type: "", biz_item: "", email: "", phone: "", memo: "", ...init });
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const v = 부가세분리(f.amount, f.taxable);
  const cash = f.doc_type === "현금영수증";

  const save = async now => {
    if (!f.item_name.trim() || !f.amount) return toast("품목과 금액을 입력하세요.", "err");
    const id = String(f.identity || "").replace(/\D/g, "");
    if (cash && !id) return toast("식별번호(휴대폰·사업자번호)를 입력하세요.", "err");
    if (cash && id.length === 13) return toast("주민등록번호는 받지 않습니다. 휴대폰 번호나 사업자번호를 쓰세요.", "err");
    if (!cash && String(f.biz_no).replace(/\D/g, "").length !== 10) return toast("공급받는자 사업자번호 10자리를 입력하세요.", "err");
    setBusy(true);
    const row = Object.fromEntries(Object.entries(f).filter(([k]) => !["id", "supply", "vat", "status", "mgt_key", "created_at", "created_by", "issued_at", "issued_via", "confirm_num",
      "cancel_mgt_key", "cancel_confirm_num", "cancelled_at", "error", "result", "car_plate"].includes(k))
      .map(([k, x]) => [k, x === "" ? null : x]));
    const saved = await run(() => q(f.id ? app.db.from("issue_docs").update({ ...row, status: "대기", error: null }).eq("id", f.id).select("*").single()
                                         : app.db.from("issue_docs").insert(row).select("*").single()), now ? null : "발행대기로 저장했습니다");
    if (saved && now) await issueOne(app, saved);
    setBusy(false);
    if (saved) onDone(saved);
  };

  return html`<div class="subform">
    <div class="fgrid">
      <${Field} label="종류"><${Seg} value=${f.doc_type} onChange=${set("doc_type")} options=${["현금영수증", "세금계산서"]} /><//>
      <${Field} label="거래일"><input type="date" value=${f.trade_date} onInput=${set("trade_date")} /><//>
      <${Field} label="구분"><${Select} value=${f.source} onChange=${set("source")} options=${SOURCES} /><//>
      <${Field} label="품목" req><input value=${f.item_name} placeholder="예) 상사매도비" onInput=${set("item_name")} /><//>
      <${Field} label="금액(부가세 포함)" req hint=${f.amount ? `공급가 ${won(v.공급가)} / 부가세 ${won(v.부가세)}` : ""}><${Money} value=${f.amount} onInput=${set("amount")} /><//>
      <${Field} label="과세"><${Seg} value=${f.taxable ? "과세" : "면세"} onChange=${x => set("taxable")(x === "과세")} options=${["과세", "면세"]} /><//>
      ${cash ? html`
        <${Field} label="용도"><${Seg} value=${f.usage} onChange=${set("usage")} options=${["소득공제용", "지출증빙용"]} /><//>
        <${Field} label="식별번호" req hint="휴대폰·사업자번호·현금영수증카드 (주민번호 불가)"><input value=${f.identity} onInput=${set("identity")} /><//>
        <${Field} label="고객명"><input value=${f.customer_name} onInput=${set("customer_name")} /><//>` : html`
        <${Field} label="영수/청구"><${Seg} value=${f.purpose} onChange=${set("purpose")} options=${["영수", "청구"]} /><//>
        <${Field} label="공급받는자 사업자번호" req><input value=${f.biz_no} onInput=${set("biz_no")} /><//>
        <${Field} label="상호" req><input value=${f.corp_name} onInput=${set("corp_name")} /><//>
        <${Field} label="대표자"><input value=${f.ceo_name} onInput=${set("ceo_name")} /><//>
        <${Field} label="업태"><input value=${f.biz_type} onInput=${set("biz_type")} /><//>
        <${Field} label="종목"><input value=${f.biz_item} onInput=${set("biz_item")} /><//>
        <${Field} label="주소" wide><input value=${f.addr} onInput=${set("addr")} /><//>
        <${Field} label="받는 이메일"><input type="email" value=${f.email} onInput=${set("email")} /><//>`}
      <${Field} label="메모" wide><input value=${f.memo} onInput=${set("memo")} /><//>
    </div>
    <div class="actions"><button class="btn ghost" onClick=${() => onDone(null)}>닫기</button>
      <button class="btn" disabled=${busy} onClick=${() => save(false)}>발행대기로 저장</button>
      <button class="btn primary" disabled=${busy} onClick=${() => save(true)}>저장하고 바로 발행</button></div>
  </div>`;
}
