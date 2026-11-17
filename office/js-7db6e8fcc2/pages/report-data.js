// 보고서·통장 매칭에 필요한 장부 전체를 한 번에 읽는다 (수백 대 규모라 화면에서 계산해도 충분하다).
import { q } from "../db.js";

export async function loadAll(db, { office = true } = {}) {
  const sel = (t, cols = "*") => q(db.from(t).select(cols));
  const [cars, costs, loans, payments, sales, buyers, settlements, brokerages, ledger, dealers, lenders] = await Promise.all([
    sel("cars"), sel("car_costs"), sel("car_loans"), sel("loan_payments"), sel("car_sales"), sel("car_buyers"),
    sel("settlements"), sel("brokerages"), office ? sel("ledger_entries") : [], sel("dealers"), sel("lenders"),
  ]);
  // 계약중(계약금만 받음) 매도는 실적·매출·손익에서 뺀다 — 차는 재고 그대로 (2026-11-01). 표시용으로 contracts 에 따로
  return { cars, costs, loans, payments, sales: sales.filter(s => !s.contract), contracts: sales.filter(s => s.contract), buyers, settlements, brokerages, ledger, dealers, lenders };
}
