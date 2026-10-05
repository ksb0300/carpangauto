import { html, useState, useEffect, useMemo, won, go, Badge, Loading, Empty, Seg, Select, run, 검색맞음 } from "../ui.js";
import { q } from "../db.js";

/** 차량 목록 + 합계에 필요한 걸 한 번에 모은다 (수십~수백 대 규모라 화면에서 합친다) */
export async function loadCarRows(db) {
  const [cars, costs, loans, sales, settles] = await Promise.all([
    q(db.from("cars").select("*").is("deleted_at", null).order("purchase_date", { ascending: false })),
    q(db.from("car_costs").select("car_id,amount")),
    q(db.from("car_loans").select("car_id,amount,status")),
    q(db.from("car_sales").select("car_id,sale_amount,sale_date")),
    q(db.from("settlements").select("car_id,finalized,payout,settle_date")),
  ]);
  const by = (arr, f) => arr.reduce((m, r) => (m[r.car_id] = f(m[r.car_id], r), m), {});
  const costSum = by(costs, (s = 0, r) => s + Number(r.amount));
  const loanSum = by(loans.filter(l => l.status === "진행중"), (s = 0, r) => s + Number(r.amount));
  const sale = Object.fromEntries(sales.map(s => [s.car_id, s]));
  const settle = Object.fromEntries(settles.map(s => [s.car_id, s]));
  return cars.map(c => ({ ...c, cost: costSum[c.id] || 0, loan: loanSum[c.id] || 0, sale: sale[c.id], settle: settle[c.id] }));
}

export function settleBadge(r) {
  if (!r.sale) return html`<span class="muted">—</span>`;
  if (!r.settle) return html`<${Badge} tone="red">미정산<//>`;
  if (r.settle.mode === "대표") return r.settle.finalized ? html`<${Badge} tone="green">손익확정<//>` : html`<${Badge} tone="amber">임시<//>`;
  return r.settle.finalized ? html`<${Badge} tone="green">정산완료<//>` : html`<${Badge} tone="amber">임시<//>`;
}

export function CarList({ app, query }) {
  const params = new URLSearchParams(query);
  const [tab, setTab] = useState(params.get("tab") || "재고");
  const [text, setText] = useState("");
  const [dealer, setDealer] = useState(null);
  const [rows, setRows] = useState(null);
  const office = app.profile.role !== "dealer";
  const dealerName = Object.fromEntries(app.dealers.map(d => [d.id, d.name]));

  useEffect(() => { run(async () => setRows(await loadCarRows(app.db))); }, []);

  const shown = useMemo(() => (rows || []).filter(r =>
    (tab === "전체" || r.status === tab) &&
    (!dealer || r.dealer_id === dealer) &&
    검색맞음(text, r.plate, r.plate_before, r.car_name, r.brand, r.model, r.grade, r.fskey)), [rows, tab, text, dealer]);

  if (!rows) return html`<${Loading} />`;
  const cnt = s => rows.filter(r => s === "전체" || r.status === s).length;
  const sum = k => shown.reduce((s, r) => s + (typeof k === "function" ? k(r) : Number(r[k]) || 0), 0);

  return html`
    <div class="bar">
      <h2>차량</h2>
      <${Seg} value=${tab} onChange=${setTab} options=${[["재고", `재고 ${cnt("재고")}`], ["매도", `매도 ${cnt("매도")}`], ["전체", `전체 ${cnt("전체")}`]]} />
      <input class="search" placeholder="번호판·차명 검색" value=${text} onInput=${e => setText(e.target.value)} />
      ${office && html`<${Select} value=${dealer} onChange=${setDealer} empty="딜러 전체" options=${app.dealers.map(d => [d.id, d.name])} />`}
      <span class="grow"></span>
      ${office && html`<button class="btn primary" onClick=${() => go("/cars/new")}>+ 차량 등록</button>`}
    </div>
    ${!shown.length ? html`<${Empty}>${rows.length ? "조건에 맞는 차량이 없습니다." : "등록된 차량이 없습니다."}<//>` : html`
    <div class="table-wrap"><table class="grid click">
      <thead><tr>
        <th>매입일</th><th>번호판</th><th>차명</th><th>매입담당</th><th class="r">매입가</th><th class="r">상품화비</th>
        <th class="r">재고금융</th><th class="r">매도금액</th><th>매도일</th><th>정산</th>
      </tr></thead>
      <tbody>${shown.map(r => html`<tr onClick=${() => go("/car/" + r.id)}>
        <td>${r.purchase_date}</td>
        <td><b>${r.plate}</b>${r.consign === "고객위탁" && html` <${Badge}>위탁<//>`}</td>
        <td class="ellipsis">${r.car_name}</td>
        <td>${dealerName[r.dealer_id] || "-"}</td>
        <td class="r">${won(r.purchase_amount)}</td>
        <td class="r">${won(r.cost)}</td>
        <td class="r">${r.loan ? won(r.loan) : html`<span class="muted">0</span>`}</td>
        <td class="r">${r.sale ? won(r.sale.sale_amount) : ""}</td>
        <td>${r.sale?.sale_date || ""}</td>
        <td>${settleBadge(r)}</td>
      </tr>`)}</tbody>
      <tfoot><tr>
        <td colspan="4">${shown.length}대</td>
        <td class="r">${won(sum("purchase_amount"))}</td><td class="r">${won(sum("cost"))}</td><td class="r">${won(sum("loan"))}</td>
        <td class="r">${won(sum(r => r.sale?.sale_amount || 0))}</td><td colspan="2"></td>
      </tr></tfoot>
    </table></div>`}`;
}
