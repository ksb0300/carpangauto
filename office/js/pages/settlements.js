import { html, useState, useEffect, useMemo, won, go, Loading, Empty, Seg, run, today } from "../ui.js";
import { q } from "../db.js";

function csv(rows) {
  const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + rows.map(r => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `정산내역_${today()}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

export function Settlements({ app }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [only, setOnly] = useState("완료");
  const [data, setData] = useState(null);
  const dealerOf = id => app.dealers.find(d => d.id === id);

  useEffect(() => { run(async () => {
    const [st, cars, sales] = await Promise.all([
      q(app.db.from("settlements").select("*").gte("settle_date", month + "-01")
        .lte("settle_date", `${month}-${new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate()}`).order("settle_date")),
      q(app.db.from("cars").select("id,plate,car_name,dealer_id,purchase_date,purchase_amount")),
      q(app.db.from("car_sales").select("car_id,sale_date,sale_amount,dealer_id")),
    ]);
    const car = Object.fromEntries(cars.map(c => [c.id, c])), sale = Object.fromEntries(sales.map(s => [s.car_id, s]));
    setData(st.map(s => ({ ...s, car: car[s.car_id], sale: sale[s.car_id] })).filter(s => s.car));
  }); }, [month]);

  const rows = useMemo(() => (data || []).filter(s => only === "전체" || (only === "완료" ? s.finalized : !s.finalized)), [data, only]);
  const sum = k => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const byDealer = useMemo(() => {
    const m = {};
    for (const r of rows.filter(r => r.withholding)) {
      const id = r.sale?.dealer_id || r.car.dealer_id;
      const x = m[id] ||= { name: dealerOf(id)?.name || "-", n: 0, income: 0, tax: 0, ltax: 0, total: 0, payout: 0 };
      x.n++; x.income += +r.income_amount; x.tax += +r.income_tax; x.ltax += +r.local_tax; x.total += +r.tax_total; x.payout += +r.payout;
    }
    return Object.values(m);
  }, [rows]);

  const download = () => csv([
    ["정산일", "상태", "번호판", "차명", "딜러", "제시일", "매도일", "제시금액", "매도금액", "상품화비(반영)", "정산기준금액", "소득금액", "소득세/징수세액", "지방소득세", "상계", "실지급액", "원천징수", "방식"],
    ...rows.map(r => [r.settle_date, r.finalized ? "완료" : "임시", r.car.plate, r.car.car_name, dealerOf(r.sale?.dealer_id || r.car.dealer_id)?.name,
      r.car.purchase_date, r.sale?.sale_date, r.purchase_total, r.sale_total, r.cost_total, r.base_amount, r.income_amount,
      r.income_tax, r.local_tax, r.offset_total, r.payout, r.withholding ? "대상" : "미대상", r.method]),
  ]);

  return html`
    <div class="bar"><h2>정산내역</h2>
      <input type="month" value=${month} onInput=${e => e.target.value && setMonth(e.target.value)} />
      <${Seg} value=${only} onChange=${setOnly} options=${["완료", "임시", "전체"]} />
      <span class="grow"></span>
      <button class="btn" disabled=${!rows.length} onClick=${download}>엑셀(CSV) 다운로드</button></div>
    ${!data ? html`<${Loading} />` : !rows.length ? html`<${Empty}>${month} 정산 내역이 없습니다.<//>` : html`
    <div class="table-wrap"><table class="grid click">
      <thead><tr><th>정산일</th><th>번호판</th><th>차명</th><th>딜러</th><th class="r">제시금액</th><th class="r">매도금액</th>
        <th class="r">정산기준(D)</th><th class="r">징수세액</th><th class="r">상계</th><th class="r">실지급액</th><th>원천</th></tr></thead>
      <tbody>${rows.map(r => html`<tr onClick=${() => go(`/car/${r.car_id}/settle`)}>
        <td>${r.settle_date}${!r.finalized && html` <span class="badge amber">임시</span>`}</td><td><b>${r.car.plate}</b></td>
        <td class="ellipsis">${r.car.car_name}</td><td>${dealerOf(r.sale?.dealer_id || r.car.dealer_id)?.name || "-"}</td>
        <td class="r">${won(r.purchase_total)}</td><td class="r">${won(r.sale_total)}</td><td class="r">${won(r.base_amount)}</td>
        <td class="r">${won(r.tax_total)}</td><td class="r">${won(r.offset_total)}</td><td class="r"><b>${won(r.payout)}</b></td>
        <td>${r.withholding ? "대상" : html`<span class="muted">미대상</span>`}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">${rows.length}건</td><td class="r">${won(sum("purchase_total"))}</td><td class="r">${won(sum("sale_total"))}</td>
        <td class="r">${won(sum("base_amount"))}</td><td class="r">${won(sum("tax_total"))}</td><td class="r">${won(sum("offset_total"))}</td>
        <td class="r">${won(sum("payout"))}</td><td></td></tr></tfoot>
    </table></div>
    <div class="card"><h3>원천징수 (딜러별, ${month})</h3>
      ${!byDealer.length ? html`<p class="muted">원천징수 대상 정산이 없습니다.</p>` : html`
      <div class="table-wrap"><table class="grid"><thead><tr><th>딜러</th><th class="r">건수</th><th class="r">소득금액</th><th class="r">소득세(일괄은 13.3% 전체)</th><th class="r">지방소득세</th><th class="r">징수세액 합</th><th class="r">실지급액</th></tr></thead>
        <tbody>${byDealer.map(x => html`<tr><td>${x.name}</td><td class="r">${x.n}</td><td class="r">${won(x.income)}</td><td class="r">${won(x.tax)}</td><td class="r">${won(x.ltax)}</td><td class="r">${won(x.total)}</td><td class="r">${won(x.payout)}</td></tr>`)}</tbody></table></div>`}
    </div>`}`;
}
