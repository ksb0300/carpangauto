// 대시보드: 오늘 확인할 것 — 미정산·미발행·미매칭·만기 임박·장기재고, 이번 달 숫자, 재고금융 한도
import { html, useState, useEffect, Loading, run, won, today } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 종합현황 } from "../report-calc.js";
import { 미납이자 } from "../calc.js";
import { monthRange } from "../ui.js";

export function Dashboard({ app }) {
  const [d, setD] = useState(null);
  useEffect(() => { run(async () => {
    const [all, docs, unmatched] = await Promise.all([
      loadAll(app.db),
      q(app.db.from("issue_docs").select("id,status,amount").in("status", ["대기", "실패"])),
      q(app.db.from("bank_txs").select("id").is("match_kind", null)),
    ]);
    setD({ ...all, docs, unmatched });
  }); }, []);
  if (!d) return html`<${Loading} />`;

  const t = today(), m = monthRange(t.slice(0, 7));
  const s = 종합현황(d, m.from, m.to, t);
  const live = d.cars.filter(c => !c.deleted_at);
  const car = Object.fromEntries(live.map(c => [c.id, c]));
  const settled = new Set(d.settlements.filter(x => x.finalized).map(x => x.car_id));
  const 미정산 = d.sales.filter(x => car[x.car_id] && !settled.has(x.car_id));
  const pay = id => d.payments.filter(p => p.loan_id === id).reduce((a, p) => a + Number(p.amount), 0);
  const act = d.loans.filter(l => l.status === "진행중" && car[l.car_id]);
  const 만기임박 = act.map(l => { const e = new Date(l.start_date + "T00:00:00Z"); e.setUTCMonth(e.getUTCMonth() + l.months); return { ...l, 만기: e.toISOString().slice(0, 10) }; })
    .filter(l => (Date.parse(l.만기) - Date.parse(t)) / 864e5 <= 14).sort((a, b) => a.만기.localeCompare(b.만기));
  const 미납합 = act.reduce((a, l) => a + 미납이자({ 대출금액: l.amount, 딜러이율: l.dealer_rate, 개월: l.months, 실행일: l.start_date, 납입이자누계: pay(l.id) }, t), 0);
  const 장기 = live.filter(c => c.status === "재고" && (Date.parse(t) - Date.parse(c.purchase_date)) / 864e5 >= 90);
  const 실패 = d.docs.filter(x => x.status === "실패").length;
  const lenders = d.lenders.filter(l => l.active && Number(l.credit_limit));
  const used = id => act.filter(l => l.lender_id === id).reduce((a, l) => a + Number(l.amount), 0);
  const 정보없음 = !app.settings.biz_no;

  const todo = [
    정보없음 && { href: "#/settings/company", tone: "bad", text: "상사정보(사업자번호·대표자·주소)를 먼저 입력하세요 — 발행·보고서에 필요합니다." },
    미정산.length && { href: "#/cars?tab=매도", tone: "warn", text: `매도했지만 정산완료 안 된 차량 ${미정산.length}대` },
    d.docs.length && { href: "#/issue/wait", tone: 실패 ? "bad" : "warn", text: `발행대기 ${d.docs.length}건 (${won(d.docs.reduce((a, x) => a + Number(x.amount), 0))}원)${실패 ? ` · 실패 ${실패}건` : ""}` },
    d.unmatched.length && { href: "#/bank", tone: "warn", text: `통장 입출금 중 장부와 연결 안 된 거래 ${d.unmatched.length}건` },
    만기임박.length && { href: "#/reports/loans", tone: "bad", text: `재고금융 만기 2주 이내·지난 것 ${만기임박.length}건 (${만기임박.map(l => car[l.car_id].plate).slice(0, 4).join(", ")}${만기임박.length > 4 ? " 외" : ""})` },
    장기.length && { href: "#/reports/summary", tone: "warn", text: `90일 넘은 재고 ${장기.length}대 (${장기.map(c => c.plate).slice(0, 4).join(", ")}${장기.length > 4 ? " 외" : ""})` },
  ].filter(Boolean);

  return html`<div class="bar"><h2>대시보드</h2><span class="muted">${t} · ${app.settings.company_name}</span></div>
    <div class="card"><h3>확인할 것</h3>
      ${!todo.length ? html`<p class="muted">밀린 일이 없습니다.</p>` : html`<ul class="todo">${todo.map(x => html`<li>
        <span class=${"badge " + (x.tone === "bad" ? "red" : "amber")}>${x.tone === "bad" ? "급함" : "확인"}</span><a href=${x.href}>${x.text}</a></li>`)}</ul>`}</div>
    <h3>이번 달</h3>
    <div class="stat-grid">
      <a class="stat" href="#/cars"><span>재고</span><b>${s.재고.대수}대</b><small>${won(s.재고.금액)}원 · 평균 ${s.재고.평균일수}일</small></a>
      <a class="stat" href="#/reports/summary"><span>이번 달 매입 / 매도</span><b>${s.매입.대수} / ${s.매도.대수}대</b><small>매도 ${won(s.매도.금액)}원</small></a>
      <a class="stat" href="#/settlements"><span>이번 달 정산 지급</span><b>${won(s.정산.실지급)}</b><small>${s.정산.건수}건 · 원천징수 ${won(s.정산.세액)}</small></a>
      <a class="stat" href="#/reports/summary"><span>이번 달 상사 수익</span><b class=${s.수익합계 < 0 ? "red" : ""}>${won(s.수익합계)}</b><small>운영이익 ${won(s.운영이익)}</small></a>
      <a class="stat" href="#/reports/loans"><span>재고금융 진행중</span><b>${won(s.재고.재고금융)}</b><small>딜러 미납이자 ${won(미납합)}</small></a>
    </div>
    ${lenders.length > 0 && html`<div class="card"><h3>재고금융 한도</h3><table class="st"><tbody>${lenders.map(l => {
      const u = used(l.id) + Number(l.existing_amount || 0), lim = Number(l.credit_limit), pct = Math.round(u / lim * 100);
      return html`<tr><th>${l.name}</th><td><div class="bar-meter"><i class=${pct > 100 ? "over" : ""} style=${`width:${Math.min(100, pct)}%`}></i></div></td>
        <td class="r">${won(u)} / ${won(lim)}</td><td class=${"r" + (lim - u < 0 ? " red" : "")}>잔여 ${won(lim - u)}</td></tr>`; })}</tbody></table></div>`}`;
}
