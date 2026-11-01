// 보고서·통장 매칭에 필요한 장부 전체를 한 번에 읽는다 (수백 대 규모라 화면에서 계산해도 충분하다).
import { q } from "../db.js";

export async function loadAll(db, { office = true } = {}) {
  const sel = (t, cols = "*") => q(db.from(t).select(cols));
  const [cars, costs, loans, payments, sales, buyers, settlements, brokerages, ledger, dealers, lenders] = await Promise.all([
    sel("cars"), sel("car_costs"), sel("car_loans"), sel("loan_payments"), sel("car_sales"), sel("car_buyers"),
    sel("settlements"), sel("brokerages"), office ? sel("ledger_entries") : [], sel("dealers"), sel("lenders"),
  ]);
  return { cars, costs, loans, payments, sales, buyers, settlements, brokerages, ledger, dealers, lenders };
}
