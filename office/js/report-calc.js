// 보고서 계산 — 장부 원천 데이터에서 상사매출·매입, 부가세, 딜러월별, 종합현황, 통장 매칭 후보를 만든다.
// 화면과 분리한 순수 함수라 테스트로 검증한다 (tests/report.test.mjs).
//
// data = { cars, costs, loans, payments, sales, settlements, brokerages, ledger, lenders, dealers }
// 날짜는 모두 'YYYY-MM-DD' 문자열, 기간은 [from, to] 양끝 포함.

import { 부가세분리, 기간이자, 원천징수분해, 대표손익, 차량캐피탈이자 } from "./calc.js";

const n = v => Math.round(Number(v) || 0);
const inP = (d, from, to) => !!d && d >= from && d <= to;
const idx = (arr, k = "id") => Object.fromEntries((arr || []).map(r => [r[k], r]));
const live = cars => (cars || []).filter(c => !c.deleted_at);

function row(일자, 항목, 금액, 과세, extra = {}) {
  const v = 부가세분리(금액, 과세);
  return { 일자, 항목, 금액: v.금액, 공급가: v.공급가, 부가세: v.부가세, 과세, ...extra };
}

/** 딜러에게 받은 재고금융 이자 = 이자납입 + 정산완료 때 상계한 미납이자 */
function 딜러이자행(data, from, to) {
  const loan = idx(data.loans), car = idx(live(data.cars));
  const out = [];
  for (const p of data.payments || []) {
    const l = loan[p.loan_id]; if (!l || !inP(p.paid_date, from, to)) continue;
    out.push({ 일자: p.paid_date, 금액: n(p.amount), car_id: l.car_id, dealer_id: car[l.car_id]?.dealer_id, 구분: "이자납입" });
  }
  for (const s of data.settlements || []) {
    if (!s.finalized || !inP(s.settle_date, from, to)) continue;
    const 미납 = (s.offsets || []).filter(o => o.항목 === "재고금융(미납)이자").reduce((t, o) => t + n(o.금액), 0);
    if (미납) out.push({ 일자: s.settle_date, 금액: 미납, car_id: s.car_id, dealer_id: car[s.car_id]?.dealer_id, 구분: "정산상계" });
  }
  return out;
}

/** 상사가 재고금융사에 내는 이자(캐피탈이율) — 기간에 걸친 날수만큼 */
function 캐피탈이자(data, from, to) {
  return (data.loans || []).filter(l => l.lender_rate).map(l => ({
    loan: l, 금액: 기간이자(l.amount, l.lender_rate, l.start_date, l.repaid_date, from, to),
  })).filter(x => x.금액 > 0);
}

/** 상사 매출자료: 자동(차량·매도비·보험료·매입비·이자·알선) + 장부 매출 */
export function 상사매출자료(data, from, to) {
  const out = [];
  const car = idx(live(data.cars));
  for (const s of data.sales || []) {
    const c = car[s.car_id]; if (!c || !inP(s.sale_date, from, to)) continue;
    const ex = { car_id: c.id, dealer_id: s.dealer_id || c.dealer_id, 출처: "자동" };
    if (c.consign === "상사매입") out.push(row(s.sale_date, "차량매도", s.sale_amount, true, ex));
    if (n(s.sale_fee)) out.push(row(s.sale_date, "상사매도비", s.sale_fee, true, ex));
    if (n(s.perf_insurance)) out.push(row(s.sale_date, "성능보험료", s.perf_insurance, false, ex));
    if (n(s.installment_income)) out.push(row(s.sale_date, "할부금융수익", s.installment_income, false, { ...ex, 비고: `할부 ${n(s.installment_amount).toLocaleString()} × ${Number(s.installment_rate)}% − 원천징수 ${n(s.installment_tax).toLocaleString()}` }));
  }
  for (const c of live(data.cars))
    if (n(c.purchase_fee) && inP(c.purchase_date, from, to))
      out.push(row(c.purchase_date, "상사매입비", c.purchase_fee, true, { car_id: c.id, dealer_id: c.dealer_id, 출처: "자동" }));
  for (const x of 딜러이자행(data, from, to))
    out.push(row(x.일자, "재고금융이자(딜러)", x.금액, false, { car_id: x.car_id, dealer_id: x.dealer_id, 출처: "자동", 비고: x.구분 }));
  for (const b of data.brokerages || [])
    if (inP(b.sale_date, from, to)) out.push(row(b.sale_date, b.item || "알선수수료", b.fee, true, { dealer_id: b.dealer_id, brokerage_id: b.id, 출처: "자동", 비고: [b.plate, b.car_name].filter(Boolean).join(" ") }));
  for (const e of data.ledger || [])
    if (e.kind === "매출" && inP(e.entry_date || e.ym + "-01", from, to))
      out.push(row(e.entry_date || e.ym + "-01", e.item, e.amount, e.taxable, { car_id: e.car_id, dealer_id: e.dealer_id, 출처: "장부", ledger_id: e.id, 증빙: e.evidence, 비고: e.memo }));
  return out.sort((a, b) => a.일자.localeCompare(b.일자));
}

const 세금계산서증빙 = new Set(["전자세금계산서", "종이세금계산서", "세금계산서"]);
const 카드현금증빙 = new Set(["카드영수증", "현금영수증", "카드", "카드결제"]);

/** 상사 매입(지출)자료: 차량매입·상품화비·딜러정산·원천징수·캐피탈이자·알선지급 + 장부 지출·운영비 */
export function 상사매입자료(data, from, to) {
  const out = [];
  for (const c of live(data.cars))
    if (c.consign === "상사매입" && inP(c.purchase_date, from, to))
      out.push(row(c.purchase_date, "차량매입", c.purchase_amount, c.evidence !== "계산서",
        { car_id: c.id, dealer_id: c.dealer_id, 출처: "자동", 증빙: c.evidence, 비고: c.seller_name }));
  const car = idx(live(data.cars));
  for (const k of data.costs || []) {
    if (k.auto_source === "상사매입비" || !car[k.car_id]) continue;     // 상사매입비는 상사 매출 쪽
    const d = k.paid_date || car[k.car_id].purchase_date;
    if (inP(d, from, to)) out.push(row(d, "상품화비·" + k.item, k.amount, k.taxable,
      { car_id: k.car_id, dealer_id: car[k.car_id].dealer_id, 출처: "자동", 증빙: k.evidence, 지출: k.paid_by, 비고: k.memo }));
  }
  for (const s of data.settlements || []) {
    if (!s.finalized || s.mode === "대표" || !inP(s.settle_date, from, to)) continue;
    const ex = { car_id: s.car_id, dealer_id: car[s.car_id]?.dealer_id, 출처: "자동" };
    if (n(s.tax_total)) out.push(row(s.settle_date, "원천징수(딜러정산)", s.tax_total, false, ex));
    out.push(row(s.settle_date, "딜러정산 실지급", s.payout, false, ex));
  }
  for (const x of 캐피탈이자(data, from, to))
    out.push(row(to, "재고금융이자(캐피탈)", x.금액, false, { car_id: x.loan.car_id, 출처: "자동", 비고: `${from}~${to} 일할` }));
  for (const b of data.brokerages || []) {
    if (!inP(b.sale_date, from, to)) continue;
    if (n(b.tax_total)) out.push(row(b.sale_date, "원천징수(알선)", b.tax_total, false, { dealer_id: b.dealer_id, 출처: "자동" }));
    out.push(row(b.sale_date, "알선 딜러지급", b.payout, false, { dealer_id: b.dealer_id, 출처: "자동" }));
  }
  for (const e of data.ledger || [])
    if ((e.kind === "지출" || e.kind === "운영비") && inP(e.entry_date || e.ym + "-01", from, to))
      out.push(row(e.entry_date || e.ym + "-01", e.item, e.amount, e.taxable,
        { car_id: e.car_id, dealer_id: e.dealer_id, 출처: "장부", ledger_id: e.id, 증빙: e.evidence, 구분: e.kind, 비고: e.memo }));
  return out.sort((a, b) => a.일자.localeCompare(b.일자));
}

/**
 * 부가세 신고 참고자료.
 * 매출세액: 과세 매출의 부가세. 매입세액: 세금계산서 수취분 + 카드·현금영수증 + 중고차 의제매입(취득가 × 10/110).
 * 공제 요건·한도는 세무사 확인 전제 (화면에 문구로 표시).
 */
export function 부가세자료(data, from, to) {
  const 매출 = 상사매출자료(data, from, to);
  const 과세매출 = 매출.filter(r => r.과세), 면세매출 = 매출.filter(r => !r.과세);
  const sum = (rs, k = "금액") => rs.reduce((t, r) => t + r[k], 0);
  const 매출항목 = {};
  for (const r of 과세매출) { const x = 매출항목[r.항목] ||= { 항목: r.항목, 건수: 0, 공급가: 0, 부가세: 0 }; x.건수++; x.공급가 += r.공급가; x.부가세 += r.부가세; }

  const car = idx(live(data.cars));
  const 세금계산서 = [], 카드현금 = [], 의제 = [];
  for (const c of live(data.cars)) {
    if (c.consign !== "상사매입" || !inP(c.purchase_date, from, to)) continue;
    const v = 부가세분리(c.purchase_amount);
    if (c.evidence === "세금계산서") 세금계산서.push({ 일자: c.purchase_date, 항목: "차량매입", car_id: c.id, ...v });
    else if (c.evidence === "의제매입") 의제.push({ 일자: c.purchase_date, 항목: "차량매입(의제)", car_id: c.id, 금액: v.금액, 공제세액: Math.round(v.금액 * 10 / 110) });
  }
  for (const k of data.costs || []) {
    if (!k.taxable || k.auto_source || !car[k.car_id]) continue;
    const d = k.paid_date || car[k.car_id].purchase_date; if (!inP(d, from, to)) continue;
    const v = { 일자: d, 항목: "상품화비·" + k.item, car_id: k.car_id, ...부가세분리(k.amount) };
    if (세금계산서증빙.has(k.evidence)) 세금계산서.push(v); else if (카드현금증빙.has(k.evidence)) 카드현금.push(v);
  }
  for (const e of data.ledger || []) {
    if (e.kind === "매출" || !e.taxable) continue;
    const d = e.entry_date || e.ym + "-01"; if (!inP(d, from, to)) continue;
    const v = { 일자: d, 항목: e.item, ...부가세분리(e.amount) };
    if (세금계산서증빙.has(e.evidence)) 세금계산서.push(v); else if (카드현금증빙.has(e.evidence)) 카드현금.push(v);
  }
  const 매출세액 = sum(과세매출, "부가세");
  const 매입세액 = { 세금계산서: sum(세금계산서, "부가세"), 카드현금: sum(카드현금, "부가세"), 의제매입: sum(의제, "공제세액") };
  const 공제합계 = 매입세액.세금계산서 + 매입세액.카드현금 + 매입세액.의제매입;
  return {
    기간: { from, to },
    매출: { 과세공급가: sum(과세매출, "공급가"), 매출세액, 면세: sum(면세매출), 항목별: Object.values(매출항목) },
    매입: { 세금계산서, 카드현금, 의제, 세액: 매입세액, 공제합계 },
    예상납부세액: 매출세액 - 공제합계,
  };
}

/** 원천징수 신고자료: 정산완료(원천징수 대상) + 알선, 딜러별 합계 */
export function 원천징수자료(data, from, to) {
  const car = idx(live(data.cars)), sale = idx(data.sales, "car_id"), dealer = idx(data.dealers);
  const rows = [];
  for (const s of data.settlements || []) {
    if (!s.finalized || !s.withholding || !inP(s.settle_date, from, to)) continue;
    const c = car[s.car_id]; if (!c) continue;
    const did = sale[s.car_id]?.dealer_id || c.dealer_id;
    rows.push({ 일자: s.settle_date, 구분: "차량정산", dealer_id: did, 딜러: dealer[did]?.name, car_id: c.id, 차량: `${c.plate} ${c.car_name}`, 방식: s.method,
      ...원천징수분해({ 방식: s.method, 소득금액: s.income_amount, 소득세: s.income_tax, 지방세: s.local_tax, 징수세액: s.tax_total }), 징수세액: n(s.tax_total) });
  }
  for (const s of data.settlements || []) {             // 차량정산 중 알선딜러 몫
    if (!s.finalized || !n(s.broker_amount) || !s.broker_withholding || !inP(s.settle_date, from, to)) continue;
    const c = car[s.car_id]; if (!c) continue;
    const 분 = s.method === "분할"
      ? { 지급액: n(s.broker_income), 소득세: n(s.broker_income_tax), 지방세: n(s.broker_local_tax), 예수부가세: n(s.broker_tax_total) - n(s.broker_income_tax) - n(s.broker_local_tax) }
      : 원천징수분해({ 방식: "일괄", 소득금액: s.broker_income, 징수세액: s.broker_tax_total });
    rows.push({ 일자: s.settle_date, 구분: "차량정산(알선)", dealer_id: s.broker_dealer_id, 딜러: dealer[s.broker_dealer_id]?.name,
      차주딜러: dealer[sale[s.car_id]?.dealer_id || c.dealer_id]?.name, car_id: c.id, 차량: `${c.plate} ${c.car_name}`, 방식: s.method, ...분, 징수세액: n(s.broker_tax_total) });
  }
  for (const b of data.brokerages || []) {
    if (!b.withholding || !inP(b.sale_date, from, to)) continue;
    const 분 = b.method === "분할"
      ? { 지급액: n(b.supply), 소득세: n(b.income_tax), 지방세: n(b.local_tax), 예수부가세: n(b.vat) }
      : 원천징수분해({ 방식: "일괄", 소득금액: b.base_amount, 징수세액: b.tax_total });
    rows.push({ 일자: b.sale_date, 구분: "알선", dealer_id: b.dealer_id, 딜러: dealer[b.dealer_id]?.name, 차량: [b.plate, b.car_name].filter(Boolean).join(" "), 방식: b.method, ...분, 징수세액: n(b.tax_total) });
  }
  const by = {};
  for (const r of rows) {
    const x = by[r.dealer_id] ||= { dealer_id: r.dealer_id, 딜러: r.딜러, 건수: 0, 지급액: 0, 소득세: 0, 지방세: 0, 예수부가세: 0, 징수세액: 0 };
    x.건수++; for (const k of ["지급액", "소득세", "지방세", "예수부가세", "징수세액"]) x[k] += r[k];
  }
  return { rows: rows.sort((a, b) => a.일자.localeCompare(b.일자)), 딜러별: Object.values(by) };
}

/** 딜러별 집계 (기간) */
export function 딜러별집계(data, from, to) {
  const car = idx(live(data.cars)), sale = idx(data.sales, "car_id");
  const out = {};
  const get = id => out[id || "-"] ||= { dealer_id: id || null, 제시대수: 0, 제시금액: 0, 매도대수: 0, 매도금액: 0, 정산건수: 0,
    차량마진: 0, 반영비용: 0, 정산기준: 0, 세액: 0, 상계: 0, 실지급: 0, 이자수취: 0, 알선건수: 0, 알선지급: 0 };
  for (const c of live(data.cars)) if (inP(c.purchase_date, from, to)) { const x = get(c.dealer_id); x.제시대수++; x.제시금액 += n(c.purchase_amount); }
  for (const s of data.sales || []) {
    const c = car[s.car_id]; if (!c || !inP(s.sale_date, from, to)) continue;
    const x = get(s.dealer_id || c.dealer_id); x.매도대수++; x.매도금액 += n(s.sale_amount);
  }
  for (const s of data.settlements || []) {
    const c = car[s.car_id]; if (!c || !s.finalized || !inP(s.settle_date, from, to)) continue;
    const x = get(sale[s.car_id]?.dealer_id || c.dealer_id);
    x.정산건수++; x.차량마진 += n(s.sale_total) - n(s.purchase_total); x.반영비용 += n(s.cost_total);
    x.정산기준 += n(s.base_amount); x.세액 += n(s.tax_total); x.상계 += n(s.offset_total); x.실지급 += n(s.payout);
  }
  for (const r of 딜러이자행(data, from, to)) get(r.dealer_id).이자수취 += r.금액;
  for (const b of data.brokerages || []) if (inP(b.sale_date, from, to)) { const x = get(b.dealer_id); x.알선건수++; x.알선지급 += n(b.payout); }
  return Object.values(out);
}

/** 종합현황 (기간) — 운영보고서는 이걸 월마다 부른다 */
export function 종합현황(data, from, to, 오늘 = to) {
  const 매출 = 상사매출자료(data, from, to), 매입 = 상사매입자료(data, from, to);
  const pick = (rs, 항목) => rs.filter(r => r.항목 === 항목).reduce((t, r) => t + r.금액, 0);
  const 알선수수료 = (data.brokerages || []).filter(b => inP(b.sale_date, from, to)).reduce((t, b) => t + n(b.fee), 0);
  const 알선지급 = pick(매입, "알선 딜러지급") + pick(매입, "원천징수(알선)");
  // 대표 차는 매도비·보험료·캐피탈이자가 차량 손익 안에 들어가 있으니 여기선 딜러 차 몫만 센다
  const 대표차 = 대표차량(data);
  const 딜러차 = rs => rs.filter(r => !r.car_id || !대표차.has(r.car_id));
  const 대표 = 대표차량손익(data, from, to);
  const 상사수익 = {
    대표차량손익: 대표.reduce((t, r) => t + r.손익, 0),
    상사매도비: pick(딜러차(매출), "상사매도비"), 성능보험료: pick(딜러차(매출), "성능보험료"), 상사매입비: pick(딜러차(매출), "상사매입비"),
    할부금융수익: pick(딜러차(매출), "할부금융수익"),
    딜러이자: pick(딜러차(매출), "재고금융이자(딜러)"), 캐피탈이자: 0 - pick(딜러차(매입), "재고금융이자(캐피탈)"),
    알선몫: 알선수수료 - 알선지급,
    기타매출: 매출.filter(r => r.출처 === "장부").reduce((t, r) => t + r.금액, 0),
  };
  const 수익합계 = Object.values(상사수익).reduce((a, b) => a + b, 0);
  const 운영비 = 매입.filter(r => r.출처 === "장부").reduce((t, r) => t + r.금액, 0);
  const 재고 = live(data.cars).filter(c => c.status === "재고" && c.purchase_date <= 오늘);
  const 재고일수 = 재고.map(c => Math.round((Date.parse(오늘) - Date.parse(c.purchase_date)) / 86_400_000));
  const sold = (data.sales || []).filter(s => inP(s.sale_date, from, to));
  const car = idx(live(data.cars));
  const st = (data.settlements || []).filter(s => s.finalized && s.mode !== "대표" && inP(s.settle_date, from, to));
  return {
    매입: { 대수: live(data.cars).filter(c => inP(c.purchase_date, from, to)).length, 금액: live(data.cars).filter(c => inP(c.purchase_date, from, to)).reduce((t, c) => t + n(c.purchase_amount), 0) },
    매도: { 대수: sold.length, 금액: sold.reduce((t, s) => t + n(s.sale_amount), 0),
            마진: sold.reduce((t, s) => t + n(s.sale_amount) - n(car[s.car_id]?.purchase_amount), 0) },
    정산: { 건수: st.length, 정산기준: st.reduce((t, s) => t + n(s.base_amount), 0), 세액: st.reduce((t, s) => t + n(s.tax_total), 0), 실지급: st.reduce((t, s) => t + n(s.payout), 0) },
    상사수익, 수익합계, 운영비, 운영이익: 수익합계 - 운영비,
    재고: { 대수: 재고.length, 금액: 재고.reduce((t, c) => t + n(c.purchase_amount), 0),
            평균일수: 재고.length ? Math.round(재고일수.reduce((a, b) => a + b, 0) / 재고.length) : 0,
            장기90일: 재고일수.filter(d => d >= 90).length,
            재고금융: (data.loans || []).filter(l => l.status === "진행중").reduce((t, l) => t + n(l.amount), 0) },
  };
}

// ───────────────────────── 공동대표 실적 ─────────────────────────
/** 매입담당이 대표인 차 id 집합 */
export function 대표차량(data) {
  const partner = new Set((data.dealers || []).filter(d => d.partner).map(d => d.id));
  return new Set(live(data.cars).filter(c => partner.has(c.dealer_id)).map(c => c.id));
}

/** 차 한 대의 대표 손익 (매도된 차). 정산탭·보고서가 같은 값을 쓴다 */
export function 대표차량계산(data, c, s) {
  const st = (data.settlements || []).find(x => x.car_id === c.id);
  return 대표손익({
    매도금액: n(s.sale_amount), 기타매출: (st?.other_revenue || []).map(x => ({ 금액: n(x.금액), 과세: x.과세 !== false })),
    상사매도비: n(s.sale_fee), 성능보험료: n(s.perf_insurance), 할부수익: n(s.installment_income), 제시금액: n(c.purchase_amount), 제시증빙: c.evidence,
    비용: (data.costs || []).filter(k => k.car_id === c.id).map(k => ({ 금액: n(k.amount), 과세: k.taxable, 정산반영: k.include_in_settlement })),
    캐피탈이자: 차량캐피탈이자((data.loans || []).filter(l => l.car_id === c.id), s.sale_date),
  });
}

/** 기간 안에 매도된 대표 차의 손익 (매도일 기준) */
export function 대표차량손익(data, from, to) {
  const ids = 대표차량(data), car = idx(live(data.cars));
  return (data.sales || []).filter(s => ids.has(s.car_id) && inP(s.sale_date, from, to)).map(s => {
    const c = car[s.car_id];
    return { car: c, sale: s, dealer_id: c.dealer_id, 재고일: dayDiff(c.purchase_date, s.sale_date), ...대표차량계산(data, c, s) };
  }).sort((a, b) => a.sale.sale_date.localeCompare(b.sale.sale_date));
}

/** 대표별 실적 — 매입은 제시일, 매도·손익은 매도일 기준. 재고는 기준일 현재 */
export function 대표별실적(data, from, to, 오늘 = to) {
  const partners = (data.dealers || []).filter(d => d.partner);
  const cars = live(data.cars), sold = 대표차량손익(data, from, to);
  const rows = partners.map(d => {
    const mine = cars.filter(c => c.dealer_id === d.id);
    const 매입 = mine.filter(c => inP(c.purchase_date, from, to));
    const 매도 = sold.filter(r => r.dealer_id === d.id);
    const 재고 = mine.filter(c => c.status === "재고" && c.purchase_date <= 오늘);
    const 재고일 = 재고.map(c => dayDiff(c.purchase_date, 오늘));
    const 알선 = (data.brokerages || []).filter(b => b.dealer_id === d.id && inP(b.sale_date, from, to));
    const 알선수익 = 알선.reduce((t, b) => t + n(b.supply) - n(b.payout), 0);   // 대표 알선은 지급 0 → 공급가(부가세 뺀) 전액
    const 차량손익 = 매도.reduce((t, r) => t + r.손익, 0);
    const 손익 = 차량손익 + 알선수익;
    return { dealer_id: d.id, 이름: d.name, 차량손익, 알선건수: 알선.length, 알선수익,
      매입대수: 매입.length, 매입금액: 매입.reduce((t, c) => t + n(c.purchase_amount), 0),
      매도대수: 매도.length, 매도금액: 매도.reduce((t, r) => t + n(r.sale.sale_amount), 0),
      세전손익: 매도.reduce((t, r) => t + r.세전손익, 0), 손익, 대당손익: 매도.length ? Math.round(차량손익 / 매도.length) : 0,
      손실대수: 매도.filter(r => r.손익 < 0).length, 평균판매일: avg(매도.map(r => r.재고일)),
      재고대수: 재고.length, 재고금액: 재고.reduce((t, c) => t + n(c.purchase_amount), 0),
      평균재고일: avg(재고일), 장기재고: 재고일.filter(x => x >= 90).length };
  });
  const 합계손익 = rows.reduce((t, r) => t + r.손익, 0);
  return rows.map(r => ({ ...r, 비중: 합계손익 > 0 ? Math.round(r.손익 / 합계손익 * 1000) / 10 : null }));
}

/** 수익 배분: 회사 순이익(대표 손익 + 딜러 관련 상사 수익 + 기타 − 운영비)을 대표 수로 똑같이 나눈다 */
export function 수익배분(data, from, to, 오늘 = to) {
  const s = 종합현황(data, from, to, 오늘);
  const 대표수 = (data.dealers || []).filter(d => d.partner && d.active !== false).length;
  return { 상사수익: s.상사수익, 수익합계: s.수익합계, 운영비: s.운영비, 순이익: s.운영이익, 대표수,
    인당: 대표수 ? Math.floor(s.운영이익 / 대표수) : 0 };
}

// ───────────────────────── 통장 입출금 ↔ 장부 매칭 ─────────────────────────
const norm = s => String(s || "").replace(/\s|\(주\)|㈜|주식회사|\(유\)/g, "").toLowerCase();
const nameIn = (name, text) => { const a = norm(name); return a.length >= 2 && norm(text).includes(a); };
const near = (a, b, days) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;

/**
 * 입출금 한 건에 대한 매칭 후보 (점수 높은 순, 40점 이상).
 * 금액 일치 60, 이름(매수자·매도자·딜러·금융사) 적요 포함 30~40, 날짜 근접 10.
 * 90점 이상이고 2등과 20점 넘게 차이 나면 자동 확정 대상.
 */
export function 매칭후보(tx, data) {
  const out = [];
  const amt = n(tx.deposit) || n(tx.withdraw), 입금 = n(tx.deposit) > 0, text = tx.remark || "";
  const car = idx(live(data.cars)), dealer = idx(data.dealers), lender = idx(data.lenders);
  const buyersOf = id => (data.buyers || []).filter(b => b.car_id === id);
  const add = (kind, score, label, extra) => score >= 40 && out.push({ kind, score, label, ...extra });
  if (입금) {
    for (const s of data.sales || []) {
      const c = car[s.car_id]; if (!c) continue;
      const 총액 = n(s.sale_amount) + n(s.sale_fee) + n(s.perf_insurance);
      let sc = 0;
      if (amt === n(s.sale_amount) || amt === 총액) sc += 60;
      const who = buyersOf(c.id).find(b => nameIn(b.name, text));
      if (who) sc += 40;
      if (near(tx.tx_date, s.sale_date, 30)) sc += 10;
      if (sc && (amt <= 총액)) add("차량매도대금", sc, `${c.plate} ${c.car_name} 매도대금${who ? ` (${who.name})` : ""}`, { car_id: c.id, dealer_id: s.dealer_id || c.dealer_id });
    }
    for (const b of data.brokerages || []) {
      let sc = (amt === n(b.fee) ? 60 : 0) + (nameIn(b.customer_name, text) ? 30 : 0) + (near(tx.tx_date, b.sale_date, 30) ? 10 : 0);
      add("알선", sc, `알선 ${b.plate || ""} ${b.customer_name || ""}`.trim(), { dealer_id: b.dealer_id });
    }
  } else {
    for (const c of live(data.cars)) {
      let sc = (amt === n(c.purchase_amount) ? 60 : 0) + (nameIn(c.seller_name, text) ? 40 : 0) + (near(tx.tx_date, c.purchase_date, 15) ? 10 : 0);
      if (c.consign === "상사매입") add("차량매입대금", sc, `${c.plate} ${c.car_name} 매입대금${c.seller_name ? ` (${c.seller_name})` : ""}`, { car_id: c.id, dealer_id: c.dealer_id });
    }
    for (const s of data.settlements || []) {
      const c = car[s.car_id]; if (!c || !s.finalized) continue;
      const d = dealer[c.dealer_id];
      let sc = (amt === n(s.payout) ? 60 : 0) + (d && nameIn(d.name, text) ? 30 : 0) + (near(tx.tx_date, s.settle_date, 15) ? 10 : 0);
      add("딜러정산지급", sc, `${c.plate} 딜러정산 ${d?.name || ""}`.trim(), { car_id: c.id, dealer_id: c.dealer_id });
    }
    for (const l of data.loans || []) {
      const c = car[l.car_id]; if (!c) continue;
      let sc = (amt === n(l.amount) ? 50 : 0) + (nameIn(lender[l.lender_id]?.name?.replace(/캐피탈$/, ""), text) ? 30 : 0);
      add("재고금융", sc, `${c.plate} 재고금융 상환 (${lender[l.lender_id]?.name || ""})`, { car_id: c.id, dealer_id: c.dealer_id });
    }
    for (const k of data.costs || []) {
      const c = car[k.car_id]; if (!c || k.paid_by !== "상사" || k.auto_source) continue;
      let sc = (amt === n(k.amount) ? 50 : 0) + (k.memo && nameIn(k.memo, text) ? 30 : 0) + (near(tx.tx_date, k.paid_date, 10) ? 10 : 0);
      add("상품화비", sc, `${c.plate} ${k.item}${k.memo ? ` (${k.memo})` : ""}`, { car_id: c.id, dealer_id: c.dealer_id });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function 자동확정(후보) {
  if (!후보.length || 후보[0].score < 90) return null;
  if (후보[1] && 후보[0].score - 후보[1].score <= 20) return null;
  return 후보[0];
}

/** 엑셀/CSV 거래내역 행들을 공통 모양으로. 은행마다 머리글이 달라 이름으로 찾는다. */
export function 거래내역정리(rows) {
  if (!rows.length) return [];
  // 머리글 줄 찾기: '입금'·'출금' 류가 들어 있는 첫 줄
  // 칸 이름은 앞의 것부터 찾는다 ('보낸분/받는분' 같은 이름 칸을 금액 칸으로 잡지 않게)
  const H = { 날짜: [/거래일시|거래일자|거래일/, /일자|날짜/], 시간: [/시간|시각/], 입금: [/입금/, /맡기신/, /받은금액/],
              출금: [/출금/, /찾으신/, /지급금액|보낸금액/], 잔액: [/잔액/], 적요: [/적요|내용|기재|보낸분|받는분|메모|거래점|비고|의뢰인|수취인/] };
  const has = (k, h) => H[k].some(re => re.test(String(h)));
  const hi = rows.findIndex(r => r.some(c => has("입금", c)) && r.some(c => has("출금", c)));
  if (hi < 0) throw new Error("머리글(입금·출금 칸)을 찾지 못했습니다.");
  const head = rows[hi].map(String);
  const col = k => { for (const re of H[k]) { const i = head.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const c = { 날짜: col("날짜"), 시간: col("시간"), 입금: col("입금"), 출금: col("출금"), 잔액: col("잔액") };
  const 적요칸 = head.map((h, i) => has("적요", h) && !Object.values(c).includes(i) ? i : -1).filter(i => i >= 0);
  const num = v => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
  const date = v => {
    if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);   // 엑셀 일련번호
    const m = String(v).match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  };
  const time = v => { const m = String(v ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}` : null; };
  return rows.slice(hi + 1).map(r => ({
    tx_date: date(r[c.날짜]), tx_time: c.시간 >= 0 ? time(r[c.시간]) : time(r[c.날짜]),
    deposit: num(r[c.입금]), withdraw: num(r[c.출금]), balance: c.잔액 >= 0 ? num(r[c.잔액]) : null,
    remark: 적요칸.map(i => String(r[i] ?? "").trim()).filter(Boolean).join(" / "),
  })).filter(t => t.tx_date && (t.deposit || t.withdraw));
}

/** 엑셀 거래의 고유키 — 같은 파일을 두 번 올려도 중복되지 않게 */
export function 거래키(t, i = 0) {
  const s = [t.tx_date, t.tx_time, t.deposit, t.withdraw, t.balance, t.remark].join("|");
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
  return "X" + h.toString(16).padStart(8, "0") + (t.balance == null ? "-" + i : "");
}

// ───────────────────────── 똑순이 종합업무현황과 같은 집계 (2026-10-01 추가) ─────────────────────────
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const avg = arr => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : 0;

/** 딜러가 낸 이자 (기간) = 이자납입 + 정산 미납이자 상계 — 딜러별 */
function 딜러입금이자(data, from, to) {
  const m = {};
  for (const r of 딜러이자행(data, from, to)) m[r.dealer_id || "-"] = (m[r.dealer_id || "-"] || 0) + r.금액;
  return m;
}

/**
 * 딜러별 종합업무현황 (똑순이 '딜러별 종합업무현황'과 같은 칸).
 * 현 제시현황은 오늘 기준 재고, 나머지는 [from, to] 기간.
 */
export function 딜러별종합현황(data, from, to, 오늘 = to) {
  const cars = live(data.cars), car = idx(cars);
  const 입금이자 = 딜러입금이자(data, from, to);
  const out = {};
  const get = id => out[id || "-"] ||= { dealer_id: id || null,
    재고건수: 0, 재고금액: 0, 재고일수: [],
    매입건수: 0, 매입금액: 0, 과표금액: 0, 매입공제세액: 0, 공제건: 0, 미공제건: 0,
    상품화금액: 0, 상품화세액: 0,
    대출금액: 0, 캐피탈이자: 0, 딜러청구이자: 0, 딜러입금이자: 0, 미납이자: 0,
    매도건수: 0, 매도금액: 0, 매도이익금: 0, 매도비: 0, 매도일수: [] };
  for (const c of cars) {
    if (c.status === "재고" && c.purchase_date <= 오늘) { const x = get(c.dealer_id); x.재고건수++; x.재고금액 += n(c.purchase_amount); x.재고일수.push(dayDiff(c.purchase_date, 오늘)); }
    if (inP(c.purchase_date, from, to)) {
      const v = 부가세분리(c.purchase_amount);           // DB 의 purchase_supply/vat 와 같은 값
      const x = get(c.dealer_id); x.매입건수++; x.매입금액 += n(c.purchase_amount); x.과표금액 += v.공급가;
      if (c.evidence === "계산서") x.미공제건++; else { x.공제건++; x.매입공제세액 += v.부가세; }
    }
  }
  for (const k of data.costs || []) {
    const c = car[k.car_id]; if (!c) continue;
    if (inP(k.paid_date || c.purchase_date, from, to)) { const x = get(c.dealer_id); x.상품화금액 += n(k.amount); x.상품화세액 += 부가세분리(k.amount, k.taxable).부가세; }
  }
  const pay = id => (data.payments || []).filter(p => p.loan_id === id).reduce((s, p) => s + n(p.amount), 0);
  for (const l of data.loans || []) {
    const c = car[l.car_id]; if (!c) continue;
    const x = get(c.dealer_id);
    if (l.status === "진행중") x.대출금액 += n(l.amount);
    x.캐피탈이자 += 기간이자(l.amount, l.lender_rate, l.start_date, l.repaid_date, from, to);
    x.딜러청구이자 += 기간이자(l.amount, l.dealer_rate, l.start_date, l.repaid_date, from, to);
    if (l.status === "진행중") {
      const 일 = Math.round(n(l.amount) * (Number(l.dealer_rate) || 0) / 100 / 365);
      x.미납이자 += Math.max(0, 일 * Math.max(1, dayDiff(l.start_date, 오늘) + 1) - pay(l.id));
    }
  }
  for (const s of data.sales || []) {
    const c = car[s.car_id]; if (!c || !inP(s.sale_date, from, to)) continue;
    const x = get(s.dealer_id || c.dealer_id);
    const cost = (data.costs || []).filter(k => k.car_id === c.id).reduce((t, k) => t + n(k.amount), 0);
    x.매도건수++; x.매도금액 += n(s.sale_amount); x.매도비 += n(s.sale_fee);
    x.매도이익금 += n(s.sale_amount) - n(c.purchase_amount) - cost;
    x.매도일수.push(dayDiff(c.purchase_date, s.sale_date));
  }
  for (const [id, v] of Object.entries(입금이자)) get(id === "-" ? null : id).딜러입금이자 += v;
  return Object.values(out).map(({ 재고일수, 매도일수, ...x }) => ({ ...x, 평균재고일: avg(재고일수), 평균매도일: avg(매도일수) }));
}

/** 딜러 월별 수익 (똑순이 '딜러 월별 수익 내역'): 정산월 × 딜러. 알선 몫은 알선딜러 줄로 따로 */
export function 딜러월별(data, from, to) {
  const car = idx(live(data.cars)), sale = idx(data.sales, "car_id");
  const loanCar = {}; for (const l of data.loans || []) (loanCar[l.car_id] ||= []).push(l);
  const out = {};
  const add = (ym, dealer, f) => { const k = ym + "|" + (dealer || "-");
    const x = out[k] ||= { 정산월: ym, dealer_id: dealer || null, 건수: 0, 제시금액: 0, 매도금액: 0, 상품화비: 0, 재고금융이자: 0, 소득금액: 0, 세금: 0, 실지급액: 0 };
    f(x); };
  for (const s of data.settlements || []) {
    const c = car[s.car_id]; if (!c || !s.finalized || !inP(s.settle_date, from, to)) continue;
    const ym = s.settle_date.slice(0, 7), owner = sale[s.car_id]?.dealer_id || c.dealer_id;
    const 이자 = (s.offsets || []).filter(o => o.항목 === "재고금융(미납)이자").reduce((t, o) => t + n(o.금액), 0)
      + (loanCar[c.id] || []).reduce((t, l) => t + (data.payments || []).filter(p => p.loan_id === l.id).reduce((u, p) => u + n(p.amount), 0), 0);
    add(ym, owner, x => { x.건수++; x.제시금액 += n(s.purchase_total); x.매도금액 += n(s.sale_total); x.상품화비 += n(s.cost_total);
      x.재고금융이자 += 이자; x.소득금액 += n(s.income_amount); x.세금 += n(s.tax_total); x.실지급액 += n(s.payout); });
    if (n(s.broker_amount) > 0) add(ym, s.broker_dealer_id, x => { x.건수++; x.소득금액 += n(s.broker_income);
      x.세금 += n(s.broker_tax_total); x.실지급액 += n(s.broker_payout); });
  }
  return Object.values(out).sort((a, b) => a.정산월.localeCompare(b.정산월));
}

/** 이번에 낼 재고금융 이자 (상사 → 금융사): 금융사 이자지급일 기준 다음 납입일과 월이자 */
export function 이자납부예정(data, 오늘) {
  const lender = idx(data.lenders), car = idx(live(data.cars));
  const next = day => {
    const [y, m] = 오늘.split("-").map(Number);
    const mk = (yy, mm) => { const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`; };
    const 이번 = mk(y, m);
    return 이번 >= 오늘 ? 이번 : (m === 12 ? mk(y + 1, 1) : mk(y, m + 1));
  };
  return (data.loans || []).filter(l => l.status === "진행중" && car[l.car_id]).map(l => {
    const day = Number(lender[l.lender_id]?.interest_day) || Number(l.start_date.slice(8, 10));
    return { loan: l, car: car[l.car_id], 금융사: lender[l.lender_id]?.name, 대출금액: n(l.amount),
      월이자: Math.round(n(l.amount) * (Number(l.lender_rate) || 0) / 100 / 12), 납입예정일: next(day) };
  }).sort((a, b) => a.납입예정일.localeCompare(b.납입예정일));
}

/** 최근 N개월 제시·매도 추이 (대시보드·운영보고서 그래프) */
export function 월별추이(data, 끝월, 개월 = 12) {
  const [y, m] = 끝월.split("-").map(Number);
  const months = Array.from({ length: 개월 }, (_, i) => new Date(Date.UTC(y, m - 1 - (개월 - 1 - i), 1)).toISOString().slice(0, 7));
  const cars = live(data.cars), car = idx(cars);
  return months.map(ym => ({
    월: ym,
    제시: cars.filter(c => c.purchase_date?.startsWith(ym)).length,
    매도: (data.sales || []).filter(s => car[s.car_id] && s.sale_date?.startsWith(ym)).length,
    제시금액: cars.filter(c => c.purchase_date?.startsWith(ym)).reduce((t, c) => t + n(c.purchase_amount), 0),
    매도금액: (data.sales || []).filter(s => car[s.car_id] && s.sale_date?.startsWith(ym)).reduce((t, s) => t + n(s.sale_amount), 0),
  }));
}
