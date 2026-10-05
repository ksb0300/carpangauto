// 대시보드: 위젯 모음 — 계정마다 켜고 끄고 순서를 바꾼다(위젯 편집). 확인할 것·공동대표 실적·재고금융·성능점검·미발행·이자·추이·한도
import { html, useState, useEffect, Loading, run, won, today } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 종합현황, 이자납부예정, 월별추이, 대표별실적, 수익배분 } from "../report-calc.js";
import { planLines } from "./tab-docs.js";
import { TrendChart } from "./reports.js";
import { 미납이자 } from "../calc.js";
import { monthRange } from "../ui.js";
import { inspState, ALERT_DAYS, renewInsp } from "./tab-insp.js";
import { 할일, LoanAction } from "./lenders.js";
import { SignsWidget } from "./signs.js";
import { news } from "../pb.js";

export function Dashboard({ app }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(null);       // 편집 중 배치
  const [drag, setDrag] = useState(null);         // 끌고 있는 위젯
  const load = () => run(async () => {
    const [all, docs, unmatched, insp] = await Promise.all([
      loadAll(app.db),
      q(app.db.from("issue_docs").select("id,status,amount,car_id,doc_type,buyer_id,source")),
      q(app.db.from("bank_txs").select("id").is("match_kind", null)),
      q(app.db.from("car_inspections").select("id,car_id,recept_date,expire_date,renewed_on").order("recept_date", { ascending: false })),
    ]);
    setD({ ...all, allDocs: docs, docs: docs.filter(x => ["대기", "실패"].includes(x.status)), unmatched, insp });
  });
  useEffect(() => { load(); }, []);
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
  const 현금차 = live.filter(c => c.status === "재고" && !act.some(l => l.car_id === c.id)).map(c => {
    const done = d.loans.filter(l => l.car_id === c.id && l.status === "상환완료").sort((a, b) => String(b.repaid_date).localeCompare(String(a.repaid_date)))[0];
    return { c, 사유: done ? `상환완료 ${done.repaid_date || ""} · ${d.lenders.find(x => x.id === done.lender_id)?.name || ""}` : "재고금융 없음",
             일: Math.round((Date.parse(t) - Date.parse(c.purchase_date)) / 864e5) };
  }).sort((a, b) => b.일 - a.일);
  const 미납합 = act.reduce((a, l) => a + 미납이자({ 대출금액: l.amount, 딜러이율: l.dealer_rate, 개월: l.months, 실행일: l.start_date, 납입이자누계: pay(l.id) }, t), 0);
  const 장기 = live.filter(c => c.status === "재고" && (Date.parse(t) - Date.parse(c.purchase_date)) / 864e5 >= 90);
  // 성능점검: 재고 차마다 가장 최근 점검이 90일 지났거나 만료된 것
  const 최근점검 = {}; for (const i of d.insp) 최근점검[i.car_id] ??= i;
  const 성능 = live.filter(c => c.status === "재고" && 최근점검[c.id]).map(c => ({ c, i: 최근점검[c.id], s: inspState(최근점검[c.id], t) }))
    .filter(x => x.s.경과 >= ALERT_DAYS || x.s.tone === "red").sort((a, b) => b.s.경과 - a.s.경과);
  const 성능만료 = 성능.filter(x => x.s.tone === "red");
  const 실패 = d.docs.filter(x => x.status === "실패").length;
  // 한도를 넣었거나 대출이 있는 금융사 전부 (대출 많은 순) — 한도 없으면 사용액만
  const used = id => act.filter(l => l.lender_id === id).reduce((a, l) => a + Number(l.amount) - Number(l.principal_repaid || 0), 0);
  const cnt = id => act.filter(l => l.lender_id === id).length;
  const lenders = d.lenders.filter(l => (l.active && Number(l.credit_limit)) || cnt(l.id)).sort((a, b) => used(b.id) - used(a.id));
  const 정보없음 = !app.settings.biz_no;
  const hasDealer = app.dealers.some(x => x.active && !x.partner);      // 딜러가 있을 때만 '딜러 정산 지급' 칸

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

  // ── 위젯: 계정마다 켜고 끄고 순서를 바꾼다 (profiles.dashboard)
  const card = (title, body, extra) => html`<div class="card"><div class="bar"><h3>${title}</h3><span class="grow"></span>${extra || ""}</div>${body}</div>`;
  const 미발행카드 = k => card(`${k === "현금영수증" ? "현금영수증" : "전자세금계산서"} 미발행 리스트`,
    !미발행[k].length ? html`<p class="muted">없음</p>` : html`<div class="table-wrap"><table class="grid click"><thead><tr><th>차량</th><th class="r">금액</th><th>고객명</th><th>거래일자</th><th class="r">경과일</th></tr></thead>
      <tbody>${미발행[k].slice(0, 8).map(x => html`<tr onClick=${() => (location.hash = `/car/${x.c.id}/docs`)}><td><b>${x.c.plate}</b> <span class="small">${x.l.parts.join("+")}</span></td>
        <td class="r">${won(x.l.amount)}</td><td>${(x.l.buyer || x.l.dealer)?.name || "-"}</td><td>${x.s.sale_date}</td><td class=${"r" + (x.경과 > 3 ? " red" : "")}>${x.경과}</td></tr>`)}</tbody></table></div>
      ${미발행[k].length > 8 ? html`<p class="note">외 ${미발행[k].length - 8}건</p>` : ""}`, html`<a class="btn sm" href="#/issue/wait">발행대기 리스트</a>`);
  const 차표 = (rows, cols, cell, tab = "info") => !rows.length ? html`<p class="muted">없음</p>` : html`<div class="table-wrap"><table class="grid click">
    <thead><tr>${cols.map(c => html`<th>${c}</th>`)}</tr></thead><tbody>${rows.slice(0, 10).map(x => html`<tr onClick=${() => (location.hash = `/car/${x.c.id}/${tab}`)}>${cell(x)}</tr>`)}</tbody></table></div>
    ${rows.length > 10 ? html`<p class="note">외 ${rows.length - 10}대</p>` : ""}`;

  const WIDGETS = {
    partners: { title: "이번 달 공동대표 실적", size: "full", show: !!배분, render: () => card("이번 달 공동대표 실적", html`<div class="stat-grid">
        ${대표들.map(r => html`<a class=${"stat" + (r === 나 ? " on" : "")} href="#/reports/partners"><span>${r.이름}${r === 나 ? " (나)" : ""}</span>
          <b class=${r.손익 < 0 ? "red" : ""}>${won(r.손익)}</b><small>매입 ${r.매입대수} · 매도 ${r.매도대수} · 재고 ${r.재고대수}대${r.장기재고 ? ` (90일+ ${r.장기재고})` : ""}</small></a>`)}
        <a class="stat" href="#/reports/partners"><span>회사 순이익 → 1인 배분</span><b class=${배분.순이익 < 0 ? "red" : "blue"}>${won(배분.인당)}</b><small>순이익 ${won(배분.순이익)} ÷ ${배분.대표수}명</small></a></div>`,
      html`<a class="btn sm" href="#/reports/partners">대표별 실적</a>`) },
    todo: { title: "확인할 것", size: "full", render: () => card("확인할 것", !todo.length ? html`<p class="muted">밀린 일이 없습니다.</p>` : html`<ul class="todo">${todo.map(x => html`<li>
        <span class=${"badge " + (x.tone === "bad" ? "red" : "amber")}>${x.tone === "bad" ? "급함" : "확인"}</span><a href=${x.href}>${x.text}</a></li>`)}</ul>`) },
    month: { title: "이번 달 숫자", size: "full", render: () => html`<div><h3>이번 달</h3><div class="stat-grid">
      <a class="stat" href="#/purchases"><span>재고</span><b>${s.재고.대수}대</b><small>${won(s.재고.금액)}원 · 평균 ${s.재고.평균일수}일</small></a>
      <a class="stat" href="#/reports/summary"><span>이번 달 매입 / 매도</span><b>${s.매입.대수} / ${s.매도.대수}대</b><small>매도 ${won(s.매도.금액)}원</small></a>
      <a class="stat" href="#/reports/summary"><span>이번 달 회사 수익</span><b class=${s.수익합계 < 0 ? "red" : ""}>${won(s.수익합계)}</b><small>운영이익 ${won(s.운영이익)}</small></a>
      <a class="stat" href="#/loans"><span>재고금융 진행중</span><b>${won(s.재고.재고금융)}</b><small>${act.length}건</small></a>
${hasDealer && html`      <a class="stat" href="#/settlements"><span>이번 달 딜러 정산 지급</span><b>${won(s.정산.실지급)}</b><small>${s.정산.건수}건 · 원천징수 ${won(s.정산.세액)}</small></a>`}</div></div>` },
    loans_todo: { title: "재고금융 연장·상환 챙길 것", size: "half", render: () => card("재고금융 연장·상환 챙길 것",
      차표(챙길.map(x => ({ ...x, c: car[x.l.car_id] })), ["차량", "", "할 일", "금융사", "대출"],      // 버튼은 차량 바로 옆 — 위젯이 좁아도 안 가려지게
        x => html`<td class="nowrap"><b>${x.c.plate}</b></td><td><${LoanAction} app=${app} l=${x.l} lender=${d.lenders.find(l => l.id === x.l.lender_id)} onDone=${load} /></td>
          <td class="wrap"><span class=${"badge wrap " + x.h.tone}>${x.h.text}</span></td><td>${d.lenders.find(l => l.id === x.l.lender_id)?.name}</td><td class="r">${won(x.l.amount)}</td>`, "loans"),
      html`<a class="btn sm" href="#/loans/lenders">금융사별 현황</a>`) },
    cash_cars: { title: "현금 차량 리스트", size: "half", render: () => card(`현금 차량 리스트 — ${현금차.length}대 · ${won(현금차.reduce((a, x) => a + Number(x.c.purchase_amount), 0))}원`,
      차표(현금차, ["차량", "매입가", "재고일", "사유"], x => html`<td><b>${x.c.plate}</b> <span class="small">${x.c.car_name}</span></td><td class="r">${won(x.c.purchase_amount)}</td>
        <td class="r">${x.일}일</td><td class="small">${x.사유}</td>`), html`<a class="btn sm" href="#/purchases">리스트</a>`) },
    insp: { title: "성능점검 90일 지난 재고", size: "half", render: () => card(`성능점검 ${ALERT_DAYS}일 지난 재고`,
      차표(성능, ["차량", "", "경과", "상태"], x => html`<td class="wrap"><b>${x.c.plate}</b> <span class="small">${x.c.car_name}</span></td>
        <td><button class="btn sm" onClick=${async e => { e.stopPropagation(); if (await renewInsp(app, x.i)) load(); }}>연장</button></td>
        <td class="r nowrap">${x.s.경과}일</td><td class="wrap"><span class=${"badge wrap " + x.s.tone}>${x.s.text}</span></td>`)) },
    stock_old: { title: "90일 넘은 재고", size: "half", render: () => card("90일 넘은 재고",
      차표(장기.map(c => ({ c, 일: Math.round((Date.parse(t) - Date.parse(c.purchase_date)) / 864e5) })).sort((a, b) => b.일 - a.일), ["차량", "매입가", "재고일"],
        x => html`<td><b>${x.c.plate}</b> <span class="small">${x.c.car_name}</span></td><td class="r">${won(x.c.purchase_amount)}</td><td class="r red">${x.일}일</td>`)) },
    cash: { title: "현금영수증 미발행", size: "half", render: () => 미발행카드("현금영수증") },
    tax: { title: "전자세금계산서 미발행", size: "half", render: () => 미발행카드("세금계산서") },
    interest: { title: "이자 납부 대상", size: "half", render: () => card("미납 이자 납부 대상",
      !이자예정.length ? html`<p class="muted">한 달 안에 낼 이자가 없습니다.</p>` : html`<div class="table-wrap"><table class="grid click"><thead><tr><th>차량</th><th>재고금융사</th><th class="r">대출금액</th><th class="r">월이자</th><th>납입예정일</th></tr></thead>
        <tbody>${이자예정.map(x => html`<tr onClick=${() => (location.hash = `/car/${x.car.id}/loans`)}><td><b>${x.car.plate}</b></td><td>${x.금융사}</td><td class="r">${won(x.대출금액)}</td>
          <td class="r">${x.월이자 ? won(x.월이자) : html`<span class="muted" title="캐피탈이율 미입력">-</span>`}</td><td>${x.납입예정일}</td></tr>`)}</tbody></table></div>`,
      html`<a class="btn sm" href="#/loans/interest">이자납입 리스트</a>`) },
    trend: { title: "최근 12개월 매입·매도 추이", size: "half", render: () => card("최근 12개월 매입 · 매도 추이", html`<${TrendChart} rows=${추이} a=${{ key: "제시", label: "매입(대)" }} b=${{ key: "매도", label: "매도(대)" }} />`) },
    signs: { title: "새 서류 (비사업용 확인서)", size: "half", render: () => html`<${SignsWidget} app=${app} />` },
    news: { title: "중고차 뉴스", size: "half", render: () => html`<${NewsWidget} app=${app} />` },
    lenders: { title: "재고금융 한도 현황", size: "full", render: () => card("재고금융 한도 현황", !lenders.length ? html`<p class="muted">진행중 재고금융이 없습니다.</p>`
      : html`<div class="table-wrap plain"><table class="st"><tbody>${lenders.map(l => {
      const u = used(l.id) + Number(l.existing_amount || 0), lim = Number(l.credit_limit), pct = lim ? Math.round(u / lim * 100) : 0;
      return html`<tr><th>${l.name} <span class="muted small">${cnt(l.id)}건</span></th>
        <td>${lim ? html`<div class="bar-meter"><i class=${pct > 100 ? "over" : ""} style=${`width:${Math.min(100, pct)}%`}></i></div>` : html`<a class="muted small" href=${`#/loans/lender/${l.id}`}>한도 미입력 — 넣기</a>`}</td>
        <td class="r">${won(u)}${lim ? ` / ${won(lim)}` : ""}</td><td class=${"r" + (lim && lim - u < 0 ? " red" : "")}>${lim ? `잔여 ${won(lim - u)}` : ""}</td></tr>`; })}
      <tr class="em"><th>합계</th><td></td><td class="r">${won(lenders.reduce((t, l) => t + used(l.id) + Number(l.existing_amount || 0), 0))}</td><td></td></tr></tbody></table></div>`,
      html`<a class="btn sm" href="#/loans/lenders">금융사별 현황</a>`) },
  };
  const layout = normalize(app.profile.dashboard);
  const rows = edit ? draft : layout;
  const shown = rows.filter(w => w.on && WIDGETS[w.id] && WIDGETS[w.id].show !== false);
  const hidden = rows.filter(w => !w.on && WIDGETS[w.id]);
  const startEdit = () => { setDraft(layout.map(w => ({ ...w }))); setEdit(true); };
  // 끌어서 놓기: 끌고 있는 위젯을 놓는 자리 위젯 앞으로 (지나가는 동안 바로 자리 바뀜)
  const moveTo = (id, target) => setDraft(r => {
    if (id === target) return r;
    const x = r.filter(w => w.id !== id), i = x.findIndex(w => w.id === target), me = r.find(w => w.id === id);
    const from = r.findIndex(w => w.id === id), to = r.findIndex(w => w.id === target);
    x.splice(from < to ? i + 1 : i, 0, me); return x;
  });
  const step = (id, d) => setDraft(r => {
    const vis = r.filter(w => w.on), k = vis.findIndex(w => w.id === id), other = vis[k + d];
    if (!other) return r;
    const x = [...r], i = x.findIndex(w => w.id === id), j = x.findIndex(w => w.id === other.id); [x[i], x[j]] = [x[j], x[i]]; return x;
  });
  const toggle = (id, on) => setDraft(r => r.map(w => w.id === id ? { ...w, on } : w));
  const save = async list => {
    const ok = await run(async () => { await q(app.db.rpc("set_dashboard", { p_layout: list })); await app.reload(); return true; }, "대시보드를 저장했습니다");
    if (ok) setEdit(false);
  };

  return html`<div class="bar"><h2>대시보드</h2><span class="muted">${t} · ${app.settings.company_name}</span><span class="grow"></span>
      ${!edit ? html`<button class="btn sm ghost" onClick=${startEdit}>위젯 편집</button>` : html`
        <span class="muted small">위젯을 끌어서 옮기세요 (휴대폰은 ↑↓)</span>
        <button class="btn sm ghost" onClick=${() => save(null)}>기본값으로</button>
        <button class="btn sm ghost" onClick=${() => setEdit(false)}>취소</button>
        <button class="btn sm primary" onClick=${() => save(draft)}>저장</button>`}</div>
    ${edit && hidden.length > 0 && html`<div class="card dash-tray"><span class="muted small">숨긴 위젯 — 눌러서 다시 보이기</span>
      ${hidden.map(w => html`<button class="btn sm" onClick=${() => toggle(w.id, true)}>+ ${WIDGETS[w.id].title}</button>`)}</div>`}
    <div class=${"dash-grid" + (edit ? " editing" : "")}>${shown.map((w, k) => html`<div key=${w.id}
        class=${[WIDGETS[w.id].size === "full" ? "full" : "", edit ? "dash-item" : "", drag === w.id ? "dragging" : ""].join(" ")}
        draggable=${edit} onDragStart=${e => { if (!edit) return; setDrag(w.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", w.id); }}
        onDragEnter=${e => { if (edit && drag && drag !== w.id) { e.preventDefault(); moveTo(drag, w.id); } }}
        onDragOver=${e => edit && e.preventDefault()} onDrop=${e => e.preventDefault()} onDragEnd=${() => setDrag(null)}>
      ${edit && html`<div class="dash-handle"><span>⠿ ${WIDGETS[w.id].title}</span><span class="grow"></span>
        <button class="btn sm ghost" disabled=${k === 0} onClick=${() => step(w.id, -1)}>↑</button>
        <button class="btn sm ghost" disabled=${k === shown.length - 1} onClick=${() => step(w.id, 1)}>↓</button>
        <button class="btn sm ghost" onClick=${() => toggle(w.id, false)}>숨기기</button></div>`}
      ${WIDGETS[w.id].render()}</div>`)}</div>`;
}

// 기본 배치 (새 위젯은 여기 추가하면 기존 계정 배치 끝에 꺼진 채로 붙는다)
const DEFAULT = ["partners", "todo", "signs", "month", "loans_todo", "cash_cars", "insp", "news", "cash", "tax", "interest", "trend", "stock_old", "lenders"];
const DEFAULT_OFF = new Set(["stock_old"]);
function normalize(saved) {
  const list = Array.isArray(saved) ? saved.filter(w => DEFAULT.includes(w.id)) : DEFAULT.map(id => ({ id, on: !DEFAULT_OFF.has(id) }));
  for (const id of DEFAULT) if (!list.some(w => w.id === id)) list.push({ id, on: !DEFAULT_OFF.has(id) });   // 새로 생긴 위젯은 켜진 채로 끝에
  return list;
}

// 중고차 뉴스 — 서버 함수 'news' 가 구글 뉴스 RSS 를 읽어 준다 (30분 캐시)
const NEWS_Q = ["중고차", "중고차 수출", "수입차", "자동차 금융"];
function NewsWidget({ app }) {
  const [q, setQ] = useState(NEWS_Q[0]);
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { setItems(null); setErr(null); news(app.db, q).then(setItems).catch(e => setErr(e.message)); }, [q]);
  const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
  return html`<div class="card news"><div class="bar"><h3>중고차 뉴스</h3><span class="grow"></span>
      <select value=${q} onChange=${e => setQ(e.target.value)}>${NEWS_Q.map(x => html`<option value=${x}>${x}</option>`)}</select></div>
    ${err ? html`<p class="muted small">뉴스를 불러오지 못했습니다: ${err}</p>` : !items ? html`<p class="muted small">불러오는 중…</p>`
      : !items.length ? html`<p class="muted">기사가 없습니다.</p>` : html`<ul class="newslist">${items.slice(0, 8).map(n => html`<li>
        <a href=${n.link} target="_blank" rel="noopener">${n.title}</a><small class="muted">${n.source}${n.source && n.date ? " · " : ""}${n.date ? ago(n.date) : ""}</small></li>`)}</ul>`}
  </div>`;
}
