// 대시보드: 오늘 확인할 것 — 미정산·미발행·미매칭·만기 임박·장기재고, 이번 달 숫자, 재고금융 한도
import { html, useState, useEffect, Loading, run, won, today } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 종합현황, 이자납부예정, 월별추이, 대표별실적, 수익배분 } from "../report-calc.js";
import { planLines } from "./tab-docs.js";
import { TrendChart } from "./reports.js";
import { 미납이자 } from "../calc.js";
import { monthRange } from "../ui.js";
import { inspState, ALERT_DAYS } from "./tab-insp.js";
import { 할일 } from "./lenders.js";

export function Dashboard({ app }) {
  const [d, setD] = useState(null);
  useEffect(() => { run(async () => {
    const [all, docs, unmatched, insp] = await Promise.all([
      loadAll(app.db),
      q(app.db.from("issue_docs").select("id,status,amount,car_id,doc_type,buyer_id,source")),
      q(app.db.from("bank_txs").select("id").is("match_kind", null)),
      q(app.db.from("car_inspections").select("car_id,recept_date,expire_date").order("recept_date", { ascending: false })),
    ]);
    setD({ ...all, allDocs: docs, docs: docs.filter(x => ["대기", "실패"].includes(x.status)), unmatched, insp });
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
  // 금융사 조건(기본만기·연장 가능 여부)으로 2주 안에 연장하거나 갚아야 할 것
  const 챙길 = act.map(l => ({ l, h: 할일(l, d.lenders.find(x => x.id === l.lender_id), t) })).filter(x => ["red", "amber"].includes(x.h.tone));
  const 미납합 = act.reduce((a, l) => a + 미납이자({ 대출금액: l.amount, 딜러이율: l.dealer_rate, 개월: l.months, 실행일: l.start_date, 납입이자누계: pay(l.id) }, t), 0);
  const 장기 = live.filter(c => c.status === "재고" && (Date.parse(t) - Date.parse(c.purchase_date)) / 864e5 >= 90);
  // 성능점검: 재고 차마다 가장 최근 점검이 90일 지났거나 만료된 것
  const 최근점검 = {}; for (const i of d.insp) 최근점검[i.car_id] ??= i;
  const 성능 = live.filter(c => c.status === "재고" && 최근점검[c.id]).map(c => ({ c, s: inspState(최근점검[c.id], t) }))
    .filter(x => x.s.경과 >= ALERT_DAYS || x.s.tone === "red").sort((a, b) => b.s.경과 - a.s.경과);
  const 성능만료 = 성능.filter(x => x.s.tone === "red");
  const 실패 = d.docs.filter(x => x.status === "실패").length;
  const lenders = d.lenders.filter(l => l.active && Number(l.credit_limit));
  const used = id => act.filter(l => l.lender_id === id).reduce((a, l) => a + Number(l.amount), 0);
  const 정보없음 = !app.settings.biz_no;

  // 똑순이 대시보드: 현금영수증·세금계산서 미발행 리스트 (매도했는데 그 증빙이 아직 발행 안 된 것)
  const dealerOf = id => app.dealers.find(x => x.id === id);
  const 미발행 = { 현금영수증: [], 세금계산서: [] };
  for (const s of d.sales) {
    const c = car[s.car_id]; if (!c) continue;
    const buyers = d.buyers.filter(b => b.car_id === s.car_id);
    for (const l of planLines({ car: c, sale: s, buyers, dealer: dealerOf(s.dealer_id || c.dealer_id), settings: app.settings })) {
      if (!미발행[l.evidence]) continue;
      const done = d.allDocs.some(x => x.car_id === c.id && x.source === l.source && (x.buyer_id || null) === (l.buyer?.id || null) && x.status === "발행");
      if (!done) 미발행[l.evidence].push({ c, s, l, 경과: Math.round((Date.parse(t) - Date.parse(s.sale_date)) / 864e5) });
    }
  }
  const 이자예정 = 이자납부예정(d, t).filter(x => (Date.parse(x.납입예정일) - Date.parse(t)) / 864e5 <= 31);
  const 추이 = 월별추이(d, t.slice(0, 7), 12).map(r => ({ ...r, label: String(+r.월.slice(5)) }));

  const todo = [
    정보없음 && { href: "#/settings/company", tone: "bad", text: "상사정보(사업자번호·대표자·주소)를 먼저 입력하세요 — 발행·보고서에 필요합니다." },
    미정산.length && { href: "#/sales", tone: "warn", text: `매도했지만 정산(손익)확정 안 된 차량 ${미정산.length}대` },
    d.docs.length && { href: "#/issue/wait", tone: 실패 ? "bad" : "warn", text: `발행대기 ${d.docs.length}건 (${won(d.docs.reduce((a, x) => a + Number(x.amount), 0))}원)${실패 ? ` · 실패 ${실패}건` : ""}` },
    d.unmatched.length && { href: "#/bank", tone: "warn", text: `통장 입출금 중 장부와 연결 안 된 거래 ${d.unmatched.length}건` },
    챙길.length && { href: "#/loans/lenders", tone: 챙길.some(x => x.h.tone === "red") ? "bad" : "warn",
      text: `재고금융 연장·상환 챙길 것 ${챙길.length}건 (${챙길.map(x => `${car[x.l.car_id].plate} ${x.h.text.split(" — ")[0]}`).slice(0, 3).join(", ")}${챙길.length > 3 ? " 외" : ""})` },
    성능.length && { href: `#/car/${성능[0].c.id}/info`, tone: 성능만료.length ? "bad" : "warn",
      text: `성능점검 ${ALERT_DAYS}일 지난 재고 ${성능.length}대${성능만료.length ? ` (만료 ${성능만료.length}대)` : ""} — 재점검 확인 (${성능.map(x => `${x.c.plate} ${x.s.남은 !== null && x.s.남은 >= 0 ? "D-" + x.s.남은 : "만료"}`).slice(0, 4).join(", ")}${성능.length > 4 ? " 외" : ""})` },
    장기.length && { href: "#/reports/summary", tone: "warn", text: `90일 넘은 재고 ${장기.length}대 (${장기.map(c => c.plate).slice(0, 4).join(", ")}${장기.length > 4 ? " 외" : ""})` },
  ].filter(Boolean);

  // 공동대표: 이번 달 내 실적과 배분 예상
  const 대표들 = 대표별실적(d, m.from, m.to, t);
  const 나 = 대표들.find(r => r.dealer_id === app.profile.dealer_id);
  const 배분 = 대표들.length ? 수익배분(d, m.from, m.to, t) : null;

  return html`<div class="bar"><h2>대시보드</h2><span class="muted">${t} · ${app.settings.company_name}</span></div>
    ${배분 && html`<div class="card"><div class="bar"><h3>이번 달 공동대표 실적</h3><span class="grow"></span><a class="btn sm" href="#/reports/partners">대표별 실적</a><a class="btn sm" href="#/reports/share">수익 배분</a></div>
      <div class="stat-grid">
        ${대표들.map(r => html`<a class=${"stat" + (r === 나 ? " on" : "")} href="#/reports/partners"><span>${r.이름}${r === 나 ? " (나)" : ""}</span>
          <b class=${r.손익 < 0 ? "red" : ""}>${won(r.손익)}</b><small>매입 ${r.매입대수} · 매도 ${r.매도대수} · 재고 ${r.재고대수}대${r.장기재고 ? ` (90일+ ${r.장기재고})` : ""}</small></a>`)}
        <a class="stat" href="#/reports/share"><span>회사 순이익 → 1인 배분</span><b class=${배분.순이익 < 0 ? "red" : "blue"}>${won(배분.인당)}</b><small>순이익 ${won(배분.순이익)} ÷ ${배분.대표수}명</small></a>
      </div></div>`}
    <div class="card"><h3>확인할 것</h3>
      ${!todo.length ? html`<p class="muted">밀린 일이 없습니다.</p>` : html`<ul class="todo">${todo.map(x => html`<li>
        <span class=${"badge " + (x.tone === "bad" ? "red" : "amber")}>${x.tone === "bad" ? "급함" : "확인"}</span><a href=${x.href}>${x.text}</a></li>`)}</ul>`}</div>
    <h3>이번 달</h3>
    <div class="stat-grid">
      <a class="stat" href="#/purchases"><span>재고</span><b>${s.재고.대수}대</b><small>${won(s.재고.금액)}원 · 평균 ${s.재고.평균일수}일</small></a>
      <a class="stat" href="#/reports/summary"><span>이번 달 매입 / 매도</span><b>${s.매입.대수} / ${s.매도.대수}대</b><small>매도 ${won(s.매도.금액)}원</small></a>
      <a class="stat" href="#/settlements"><span>이번 달 정산 지급</span><b>${won(s.정산.실지급)}</b><small>${s.정산.건수}건 · 원천징수 ${won(s.정산.세액)}</small></a>
      <a class="stat" href="#/reports/summary"><span>이번 달 상사 수익</span><b class=${s.수익합계 < 0 ? "red" : ""}>${won(s.수익합계)}</b><small>운영이익 ${won(s.운영이익)}</small></a>
      <a class="stat" href="#/loans"><span>재고금융 진행중</span><b>${won(s.재고.재고금융)}</b><small>딜러 미납이자 ${won(미납합)}</small></a>
    </div>
    <div class="two">
      ${["현금영수증", "세금계산서"].map(k => html`<div class="card"><div class="bar"><h3>${k === "현금영수증" ? "현금영수증" : "전자세금계산서"} 미발행 리스트</h3><span class="grow"></span>
        <a class="btn sm" href="#/issue/wait">발행대기 리스트</a></div>
        ${!미발행[k].length ? html`<p class="muted">없음</p>` : html`<div class="table-wrap"><table class="grid click"><thead><tr><th>차량</th><th class="r">금액</th><th>고객명</th><th>거래일자</th><th class="r">경과일</th></tr></thead>
          <tbody>${미발행[k].slice(0, 8).map(x => html`<tr onClick=${() => (location.hash = `/car/${x.c.id}/docs`)}><td><b>${x.c.plate}</b> <span class="small">${x.l.parts.join("+")}</span></td>
            <td class="r">${won(x.l.amount)}</td><td>${(x.l.buyer || x.l.dealer)?.name || "-"}</td><td>${x.s.sale_date}</td><td class=${"r" + (x.경과 > 3 ? " red" : "")}>${x.경과}</td></tr>`)}</tbody></table></div>
          ${미발행[k].length > 8 ? html`<p class="note">외 ${미발행[k].length - 8}건</p>` : ""}`}</div>`)}
    </div>
    <div class="two">
      <div class="card"><div class="bar"><h3>미납 이자 납부 대상</h3><span class="grow"></span><a class="btn sm" href="#/loans/interest">이자납입 리스트</a></div>
        ${!이자예정.length ? html`<p class="muted">한 달 안에 낼 이자가 없습니다.</p>` : html`<div class="table-wrap"><table class="grid click"><thead><tr><th>차량</th><th>재고금융사</th><th class="r">대출금액</th><th class="r">월이자</th><th>납입예정일</th></tr></thead>
          <tbody>${이자예정.map(x => html`<tr onClick=${() => (location.hash = `/car/${x.car.id}/loans`)}><td><b>${x.car.plate}</b></td><td>${x.금융사}</td><td class="r">${won(x.대출금액)}</td>
            <td class="r">${x.월이자 ? won(x.월이자) : html`<span class="muted" title="캐피탈이율 미입력">-</span>`}</td><td>${x.납입예정일}</td></tr>`)}</tbody></table></div>
          <p class="note">상사가 재고금융사에 내는 이자입니다(캐피탈이율 × 대출금 ÷ 12). 납입예정일은 설정 → 재고금융사의 이자지급일, 없으면 실행일 기준.</p>`}</div>
      <div class="card"><h3>최근 12개월 제시 · 매도 추이</h3><${TrendChart} rows=${추이} a=${{ key: "제시", label: "제시(대)" }} b=${{ key: "매도", label: "매도(대)" }} /></div>
    </div>
    ${lenders.length > 0 && html`<div class="card"><h3>재고금융 이용 현황</h3><table class="st"><tbody>${lenders.map(l => {
      const u = used(l.id) + Number(l.existing_amount || 0), lim = Number(l.credit_limit), pct = Math.round(u / lim * 100);
      return html`<tr><th>${l.name}</th><td><div class="bar-meter"><i class=${pct > 100 ? "over" : ""} style=${`width:${Math.min(100, pct)}%`}></i></div></td>
        <td class="r">${won(u)} / ${won(lim)}</td><td class=${"r" + (lim - u < 0 ? " red" : "")}>잔여 ${won(lim - u)}</td></tr>`; })}</tbody></table></div>`}`;
}
