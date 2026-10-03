// 정산내역 (똑순이 '정산내역'과 같은 칸): 검색기간(정산일·매도일·제시일), 정산금액 종합현황, 차주·알선딜러 지급액
import { html, useState, useEffect, useMemo, Select, Seg, Loading, Empty, run, won, go, Period, initPeriod, downloadCsv, W } from "../ui.js";
import { q } from "../db.js";

export function Settlements({ app }) {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState(initPeriod("월"));
  const [key, setKey] = useState("정산일");
  const [only, setOnly] = useState("완료");
  const [dealerF, setDealerF] = useState(null);
  const [text, setText] = useState("");
  const dealer = id => app.dealers.find(d => d.id === id)?.name || "-";

  useEffect(() => { run(async () => {
    const [st, cars, sales] = await Promise.all([
      q(app.db.from("settlements").select("*")),
      q(app.db.from("cars").select("id,plate,car_name,dealer_id,purchase_date,purchase_amount,consign")),
      q(app.db.from("car_sales").select("car_id,sale_date,sale_amount,dealer_id,broker_dealer_id")),
    ]);
    const car = Object.fromEntries(cars.map(c => [c.id, c])), sale = Object.fromEntries(sales.map(s => [s.car_id, s]));
    // 딜러 정산만 (공동대표 차의 손익확정은 종합업무현황 → 대표별 실적)
    setData(st.filter(s => s.mode !== "대표").map(s => ({ ...s, car: car[s.car_id], sale: sale[s.car_id] })).filter(s => s.car));
  }); }, []);

  const dateOf = r => ({ 정산일: r.settle_date, 매도일: r.sale?.sale_date, 제시일: r.car.purchase_date }[key]);
  const rows = useMemo(() => (data || []).filter(r => {
    const d = dateOf(r), owner = r.sale?.dealer_id || r.car.dealer_id;
    return d >= period.from && d <= period.to && (only === "전체" || (only === "완료" ? r.finalized : !r.finalized))
      && (!dealerF || owner === dealerF || r.broker_dealer_id === dealerF)
      && (!text || (r.car.plate + r.car.car_name).replace(/\s/g, "").includes(text.replace(/\s/g, "")));
  }).sort((a, b) => dateOf(b).localeCompare(dateOf(a))), [data, period.from, period.to, key, only, dealerF, text]);
  const sum = k => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

  const download = () => downloadCsv("정산내역", [
    ["제시일", "매도일", "정산일", "구분", "차량번호", "차명", "딜러명", "알선딜러", "제시금액", "매도금액", "상품화비(반영)", "정산과세금액", "소득금액", "징수세액", "정산금액(세후)", "상계", "딜러지급액", "알선딜러지급액", "원천징수", "방식"],
    ...rows.map(r => [r.car.purchase_date, r.sale?.sale_date, r.settle_date, r.finalized ? "완료" : "임시", r.car.plate, r.car.car_name,
      dealer(r.sale?.dealer_id || r.car.dealer_id), r.broker_dealer_id ? dealer(r.broker_dealer_id) : "", r.purchase_total, r.sale_total, r.cost_total,
      r.base_amount, r.income_amount, r.tax_total, r.net_income, r.offset_total, r.payout, r.broker_payout, r.withholding ? "대상" : "미대상", r.method]),
  ]);

  return html`
    <div class="bar"><h2>정산내역</h2><span class="muted small">딜러 차량 정산 자료입니다 · 공동대표 차 손익은 <a href="#/reports/partners">대표별 실적</a></span><span class="grow"></span>
      <button class="btn" disabled=${!rows.length} onClick=${download}>엑셀다운로드</button></div>
    <div class="bar">
      <input class="search" placeholder="차량번호·차명" value=${text} onInput=${e => setText(e.target.value)} />
      <${Select} value=${dealerF} onChange=${setDealerF} empty="매입담당 전체" options=${app.dealers.map(d => [d.id, d.name])} />
      <${Select} value=${key} onChange=${setKey} options=${["정산일", "매도일", "제시일"]} />
      <${Period} value=${period} onChange=${setPeriod} />
      <${Seg} value=${only} onChange=${setOnly} options=${["완료", "임시", "전체"]} />
    </div>
    ${!data ? html`<${Loading} />` : html`
    <div class="card"><h3>정산금액 종합현황 <span class="muted small">(선택조건 내 합계)</span></h3>
      <div class="table-wrap"><table class="grid sumtable"><thead><tr><th class="r">제시금액</th><th class="r">매도금액</th><th class="r">정산과세금액</th><th class="r">소득금액</th>
        <th class="r">정산금액(세후)</th><th class="r">딜러지급액</th><th class="r">알선딜러지급액</th><th class="r">건수</th></tr></thead>
        <tbody><tr>${W(sum("purchase_total"))}${W(sum("sale_total"))}${W(sum("base_amount"))}${W(sum("income_amount"))}${W(sum("net_income"))}${W(sum("payout"))}${W(sum("broker_payout"))}
          <td class="r"><b>${rows.length}건</b></td></tr></tbody></table></div></div>
    ${!rows.length ? html`<${Empty}>조건에 맞는 정산 내역이 없습니다.<//>` : html`
    <div class="table-wrap"><table class="grid click">
      <thead><tr><th>제시일</th><th>매도일</th><th>정산일</th><th>구분</th><th>차량번호</th><th>차명</th><th>딜러명</th><th class="r">제시금액</th><th class="r">매도금액</th>
        <th class="r">정산과세금액</th><th class="r">소득금액</th><th class="r">정산금액</th><th class="r">딜러지급액</th><th class="r">알선딜러지급액</th></tr></thead>
      <tbody>${rows.map(r => html`<tr onClick=${() => go(`/car/${r.car_id}/settle`)}>
        <td>${r.car.purchase_date}</td><td>${r.sale?.sale_date || ""}</td><td>${r.settle_date}</td>
        <td>${r.finalized ? html`<span class="badge green">완료</span>` : html`<span class="badge amber">임시</span>`}</td>
        <td><b>${r.car.plate}</b></td><td class="ellipsis">${r.car.car_name}</td>
        <td>${dealer(r.sale?.dealer_id || r.car.dealer_id)}${r.broker_dealer_id ? html`<br /><span class="muted small">알선 ${dealer(r.broker_dealer_id)}</span>` : ""}</td>
        ${W(r.purchase_total)}${W(r.sale_total)}${W(r.base_amount)}${W(r.income_amount)}${W(r.net_income)}<td class="r"><b>${won(r.payout)}</b></td>${W(r.broker_payout)}</tr>`)}</tbody>
    </table></div>`}`}
    <p class="note">원천징수 신고자료는 종합업무현황 → 딜러원천징수현황에서 봅니다.</p>`;
}
