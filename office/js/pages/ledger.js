// 상사 장부: 차량과 무관한 매출(잡수입 등)·지출(임대료·인건비 등)·운영비를 직접 적는다.
// 차량매입·매도·상품화비·정산·알선은 각 화면에서 자동으로 보고서에 잡히므로 여기 다시 적지 않는다.
import { html, useState, useEffect, Money, Field, Select, Seg, Loading, Empty, run, won, today, toast, ask, Period, initPeriod, SubTabs, downloadCsv } from "../ui.js";
import { q } from "../db.js";

const KINDS = [["매출", "상사매출"], ["지출", "상사지출"], ["운영비", "운영비"]];
const PAY = ["계좌이체", "카드", "자동이체", "지로", "현금"];
const EVID = { 매출: ["미발행", "현금영수증", "전자세금계산서", "카드결제"], 지출: ["전자세금계산서", "종이세금계산서", "카드", "현금영수증", "간이영수증", "자료없음"] };

export function LedgerPage({ app, tab = "지출" }) {
  const kind = KINDS.some(([k]) => k === tab) ? tab : "지출";
  const [rows, setRows] = useState(null);
  const [period, setPeriod] = useState(initPeriod("월"));
  const [edit, setEdit] = useState(null);
  const load = () => run(async () => setRows(await q(app.db.from("ledger_entries").select("*").eq("kind", kind)
    .gte("entry_date", period.from).lte("entry_date", period.to).order("entry_date"))));
  useEffect(() => { load(); setEdit(null); }, [kind, period.from, period.to]);
  const sum = k => (rows || []).reduce((t, r) => t + Number(r[k] || 0), 0);
  const items = kind === "매출" ? app.settings.revenue_items : app.settings.expense_items;

  return html`<div class="bar"><h2>상사 장부</h2></div>
    <${SubTabs} base="/ledger" tabs=${KINDS} cur=${kind} />
    <div class="bar"><${Period} value=${period} onChange=${setPeriod} /><span class="grow"></span>
      ${rows?.length > 0 && html`<button class="btn" onClick=${() => downloadCsv("상사" + kind, [["일자", "귀속월", "항목", "금액", "공급가", "부가세", "과세", "방식", "증빙", "계산서발행일", "메모"],
        ...rows.map(r => [r.entry_date, r.ym, r.item, r.amount, r.supply, r.vat, r.taxable ? "과세" : "면세", r.pay_method, r.evidence, r.invoice_date, r.memo])])}>엑셀(CSV)</button>`}
      <button class="btn primary" onClick=${() => setEdit({})}>+ ${kind} 입력</button></div>
    ${edit && html`<${EntryForm} app=${app} kind=${kind} items=${items} init=${edit} onDone=${() => { setEdit(null); load(); }} />`}
    ${!rows ? html`<${Loading} />` : !rows.length ? html`<${Empty}>이 기간 ${kind} 기록이 없습니다.<//>` : html`
    <div class="table-wrap"><table class="grid click">
      <thead><tr><th>일자</th><th>항목</th><th class="r">금액</th><th class="r">공급가</th><th class="r">부가세</th><th>방식</th><th>증빙</th><th>메모</th></tr></thead>
      <tbody>${rows.map(r => html`<tr onClick=${() => setEdit(r)}><td>${r.entry_date || r.ym}</td><td>${r.item}</td>
        <td class="r">${won(r.amount)}</td><td class="r">${won(r.supply)}</td><td class="r muted">${r.taxable ? won(r.vat) : "면세"}</td>
        <td>${r.pay_method || "-"}</td><td>${r.evidence || "-"}</td><td class="ellipsis">${r.memo || ""}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">${rows.length}건</td><td class="r">${won(sum("amount"))}</td><td class="r">${won(sum("supply"))}</td><td class="r">${won(sum("vat"))}</td><td colspan="3"></td></tr></tfoot>
    </table></div>`}
    <p class="note">차량매입·매도·상사매도비·성능보험료·상사매입비·상품화비·딜러정산·원천징수·재고금융 이자·알선은 <b>자동으로</b> 보고서(상사매출·매입자료, 부가세)에 들어갑니다.
      여기에는 그 밖의 것만 적으세요. 항목 목록은 설정 → 항목에서 바꿉니다.</p>`;
}

function EntryForm({ app, kind, items, init, onDone }) {
  const [f, setF] = useState({ item: items[0], amount: 0, taxable: true, entry_date: today(), pay_method: kind === "매출" ? "계좌이체" : "카드",
    evidence: (EVID[kind] || EVID.지출)[0], invoice_date: "", memo: "", ...init });
  const set = k => v => setF(p => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const save = async e => {
    e.preventDefault();
    if (!f.item || !f.amount) return toast("항목과 금액을 입력하세요.", "err");
    const row = { kind, item: f.item, amount: f.amount, taxable: f.taxable, entry_date: f.entry_date, ym: f.entry_date.slice(0, 7),
      pay_method: f.pay_method, evidence: f.evidence, invoice_date: f.invoice_date || null, memo: f.memo || null };
    const ok = await run(() => q(f.id ? app.db.from("ledger_entries").update(row).eq("id", f.id) : app.db.from("ledger_entries").insert(row)), "저장했습니다");
    if (ok) onDone();
  };
  const remove = async () => { if (ask("지울까요?") && await run(() => q(app.db.from("ledger_entries").delete().eq("id", f.id)), "지웠습니다")) onDone(); };
  const opts = items.includes(f.item) ? items : [f.item, ...items];
  return html`<form class="subform" onSubmit=${save}><div class="fgrid">
    <${Field} label="일자"><input type="date" value=${f.entry_date} onInput=${set("entry_date")} /><//>
    <${Field} label="항목"><${Select} value=${f.item} onChange=${set("item")} options=${opts} /><//>
    <${Field} label="금액(부가세 포함)" req><${Money} value=${f.amount} onInput=${set("amount")} /><//>
    <${Field} label="과세"><${Seg} value=${f.taxable ? "과세" : "면세"} onChange=${v => set("taxable")(v === "과세")} options=${["과세", "면세"]} /><//>
    <${Field} label=${kind === "매출" ? "입금방식" : "지출방식"}><${Select} value=${f.pay_method} onChange=${set("pay_method")} options=${PAY} /><//>
    <${Field} label="증빙"><${Select} value=${f.evidence} onChange=${set("evidence")} options=${EVID[kind] || EVID.지출} /><//>
    <${Field} label="계산서 발행일"><input type="date" value=${f.invoice_date || ""} onInput=${set("invoice_date")} /><//>
    <${Field} label="메모" wide><input value=${f.memo || ""} onInput=${set("memo")} /><//>
  </div><div class="actions">${f.id && html`<button type="button" class="btn danger" onClick=${remove}>삭제</button>`}
    <button type="button" class="btn ghost" onClick=${onDone}>닫기</button><button class="btn primary">저장</button></div></form>`;
}
