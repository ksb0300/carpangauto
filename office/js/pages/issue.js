// 매출관리 (똑순이와 같은 구성): 발행(대기) 체크 리스트 / 발행완료 / 현금영수증 발행 리스트 / 전자세금계산서 발행 리스트 / 건별 발행 등록
import { html, useState, useEffect, useMemo, Seg, Select, Loading, Empty, run, won, go, toast, ask, Period, initPeriod, SubTabs, downloadCsv, W } from "../ui.js";
import { q } from "../db.js";
import { DocTable, DocForm, issueMany, StatusBadge } from "./docs-ui.js";
import { planLines } from "./tab-docs.js";
import { PB_NOTE } from "../pb.js";

const TABS = [["wait", "발행(대기) 체크"], ["done", "발행완료"], ["cash", "현금영수증"], ["tax", "전자세금계산서"], ["new", "건별 발행 등록"]];

/** 매도 차량마다: 증빙 계획(항목·매수자별) 대비 실제 발행 */
function carIssueRows(d, app) {
  const dealers = Object.fromEntries(app.dealers.map(x => [x.id, x]));
  return d.sales.map(s => {
    const car = d.cars[s.car_id]; if (!car) return null;
    const buyers = d.buyers.filter(b => b.car_id === s.car_id).sort((a, b) => a.sort - b.sort);
    const lines = planLines({ car, sale: s, buyers, dealer: dealers[s.dealer_id || car.dealer_id], settings: app.settings });
    const docs = d.docs.filter(x => x.car_id === s.car_id && x.status !== "취소");
    const cnt = ev => { const ls = lines.filter(l => l.evidence === ev); return { 대상: ls.length, 대상금액: ls.reduce((t, l) => t + l.amount, 0) }; };
    const issued = ev => docs.filter(x => x.doc_type === ev && x.status === "발행");
    const c = cnt("현금영수증"), t = cnt("세금계산서"), k = cnt("카드결제");
    const ci = issued("현금영수증"), ti = issued("세금계산서");
    const 대상 = c.대상 + t.대상, 발행 = ci.length + ti.length;
    return { car, sale: s, buyers, c, t, k, ci, ti, 대상, 발행, 대상금액: c.대상금액 + t.대상금액,
      발행금액: [...ci, ...ti].reduce((x, y) => x + Number(y.amount), 0),
      상태: !대상 ? "해당없음" : 발행 >= 대상 ? "발행완료" : 발행 ? "일부발행" : docs.length ? "대기" : "미작성" };
  }).filter(Boolean);
}

export function IssuePage({ app, tab = "wait" }) {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState(initPeriod("월"));
  const [state, setState] = useState("전체");
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(null);
  const cur = TABS.some(([k]) => k === tab) ? tab : "wait";

  const load = () => run(async () => {
    const [docs, cars, sales, buyers] = await Promise.all([
      q(app.db.from("issue_docs").select("*").order("trade_date")), q(app.db.from("cars").select("*").is("deleted_at", null)),
      q(app.db.from("car_sales").select("*")), q(app.db.from("car_buyers").select("*")),
    ]);
    setD({ docs, cars: Object.fromEntries(cars.map(c => [c.id, c])), sales, buyers });
  });
  useEffect(() => { load(); }, []);
  useEffect(() => { setSel(new Set()); }, [cur]);

  if (!d) return html`<${Loading} />`;
  const inP = x => x >= period.from && x <= period.to;
  const head = html`<div class="bar"><h2>매출관리</h2><span class="muted small">${PB_NOTE}</span></div>
    <${SubTabs} base="/issue" tabs=${TABS} cur=${cur} />`;

  if (cur === "new") return html`${head}<div class="card"><h3>건별 발행 등록</h3>
    <p class="note">차량과 무관한 매출(잡수입·알선 등)이나 따로 발행할 때 씁니다. 차량 매출은 차량 → 매출증빙 탭이 편합니다.</p>
    <${DocForm} app=${app} onDone=${x => x && (location.hash = "/issue/" + (x.doc_type === "세금계산서" ? "tax" : "cash"))} /></div>`;

  if (cur === "wait" || cur === "done") {
    const all = carIssueRows(d, app).filter(r => inP(r.sale.sale_date));
    const rows = cur === "wait" ? all.filter(r => ["미작성", "대기", "일부발행"].includes(r.상태)) : all.filter(r => r.상태 === "발행완료");
    const pending = d.docs.filter(x => ["대기", "실패"].includes(x.status));
    return html`${head}
      <div class="bar"><span class="muted">매도일</span><${Period} value=${period} onChange=${setPeriod} /><span class="grow"></span>
        ${cur === "wait" && pending.length > 0 && html`<button class="btn primary" disabled=${busy} onClick=${async () => {
          if (!ask(`발행대기 문서 ${pending.length}건을 모두 발행할까요? 국세청으로 전송됩니다.`)) return;
          setBusy(true); await issueMany(app, pending); setBusy(false); load(); }}>대기 문서 ${pending.length}건 모두 발행</button>`}</div>
      ${!rows.length ? html`<${Empty}>${cur === "wait" ? "발행할 것이 남은 매도 차량이 없습니다." : "발행을 끝낸 매도 차량이 없습니다."}<//>` : html`
      <div class="table-wrap"><table class="grid click">
        <thead><tr><th>매도일</th><th>차량정보</th><th>고객</th><th class="r">매도금액</th>
          <th class="r">현금영수증</th><th class="r">세금계산서</th><th class="r">신용카드</th>
          ${cur === "done" ? html`<th class="r">발행/대상 매수</th><th class="r">발행금액</th><th class="r">대상금액</th>` : html`<th>상태</th>`}</tr></thead>
        <tbody>${rows.map(r => html`<tr onClick=${() => go(`/car/${r.car.id}/docs`)}>
          <td>${r.sale.sale_date}</td><td><b>${r.car.plate}</b> <span class="small">${r.car.car_name}</span></td>
          <td>${r.buyers[0]?.name || "-"}${r.buyers.length > 1 ? ` 외 ${r.buyers.length - 1}` : ""}</td>${W(r.sale.sale_amount)}
          <td class="r">${r.ci.length}/${r.c.대상}매</td><td class="r">${r.ti.length}/${r.t.대상}매</td><td class="r">${r.k.대상 ? `${r.k.대상}건 ${won(r.k.대상금액)}` : "-"}</td>
          ${cur === "done" ? html`<td class="r">${r.발행}/${r.대상}</td>${W(r.발행금액)}${W(r.대상금액)}`
            : html`<td><span class=${"badge " + (r.상태 === "일부발행" ? "blue" : r.상태 === "대기" ? "amber" : "red")}>${r.상태}</span></td>`}</tr>`)}</tbody>
      </table></div>`}
      <p class="note">차량별로 '매출증빙' 탭에서 정한 증빙(현금영수증·세금계산서·카드)을 기준으로 셉니다. 눌러서 그 차의 매출증빙으로 갑니다.</p>`;
  }

  // 현금영수증 / 전자세금계산서 발행 리스트
  const type = cur === "cash" ? "현금영수증" : "세금계산서";
  const docs = d.docs.filter(x => x.doc_type === type && inP(x.trade_date) && (state === "전체" || x.status === state));
  const issued = docs.filter(x => x.status === "발행");
  const sum = (rs, k) => rs.reduce((t, x) => t + Number(x[k] || 0), 0);
  const cars = d.cars;
  const selIssued = docs.filter(x => sel.has(x.id) && x.status === "발행");
  return html`${head}
    <div class="bar"><span class="muted">${cur === "cash" ? "거래(발행)일" : "작성일"}</span><${Period} value=${period} onChange=${setPeriod} />
      <${Seg} value=${state} onChange=${setState} options=${["전체", "대기", "발행", "취소", "실패"]} /><span class="grow"></span>
      ${cur === "cash" && html`<button class="btn" disabled=${!selIssued.length} onClick=${() => { setPrinting(selIssued); setTimeout(() => { print(); setPrinting(null); }, 80); }}>현금영수증 복수인쇄 (${selIssued.length})</button>`}
      <button class="btn" disabled=${!docs.length} onClick=${() => downloadCsv(type + "_발행리스트", [["거래일", "상태", "발행방법", "차량", "품명", "고객/거래처", "식별/등록번호", "용도/구분", "공급가액", "부가세", "합계", "국세청승인번호", "취소승인번호", "문서번호"],
        ...docs.map(x => [x.trade_date, x.status, x.issued_via, cars[x.car_id]?.plate, x.item_name, x.corp_name || x.customer_name, x.identity || x.biz_no, x.usage || x.purpose, x.supply, x.vat, x.amount, x.confirm_num, x.cancel_confirm_num, x.mgt_key])])}>다운로드</button>
      <button class="btn primary" onClick=${() => go("/issue/new")}>건별 발행 등록</button></div>
    <div class="table-wrap"><table class="grid sumtable"><thead><tr><th>합계표</th><th class="r">건수</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계금액</th></tr></thead>
      <tbody><tr><th>발행</th><td class="r">${issued.length}</td>${W(sum(issued, "supply"))}${W(sum(issued, "vat"))}${W(sum(issued, "amount"))}</tr>
        <tr><th>취소</th><td class="r">${docs.filter(x => x.status === "취소").length}</td>${W(sum(docs.filter(x => x.status === "취소"), "supply"))}${W(sum(docs.filter(x => x.status === "취소"), "vat"))}${W(sum(docs.filter(x => x.status === "취소"), "amount"))}</tr>
        <tr><th>대기·실패</th><td class="r">${docs.filter(x => ["대기", "실패"].includes(x.status)).length}</td>${W(sum(docs.filter(x => ["대기", "실패"].includes(x.status)), "supply"))}${W(sum(docs.filter(x => ["대기", "실패"].includes(x.status)), "vat"))}${W(sum(docs.filter(x => ["대기", "실패"].includes(x.status)), "amount"))}</tr></tbody></table></div>
    <${DocTable} app=${app} docs=${docs} reload=${load} showCar cars=${cars} select=${[sel, setSel]} selectAll />
    ${printing && html`<${Receipts} app=${app} docs=${printing} cars=${cars} />`}`;
}

/** 현금영수증 인쇄용 (화면에는 안 보이고 인쇄할 때만) */
function Receipts({ app, docs, cars }) {
  const s = app.settings;
  const mask = v => { const x = String(v || "").replace(/\D/g, ""); return x.length > 7 ? x.slice(0, 3) + "****" + x.slice(-4) : x; };
  return html`<div class="print-receipts">${docs.map(x => html`<div class="receipt">
    <h3>현금영수증</h3>
    <table class="st"><tbody>
      <tr><th>가맹점</th><td>${s.company_name}</td></tr><tr><th>사업자번호</th><td>${s.biz_no || ""}</td></tr>
      <tr><th>대표자</th><td>${s.ceo_name || ""}</td></tr><tr><th>주소</th><td>${s.address || ""}</td></tr>
      <tr><th>거래일</th><td>${x.trade_date}</td></tr><tr><th>거래구분</th><td>승인거래 · ${x.usage}</td></tr>
      <tr><th>식별번호</th><td>${mask(x.identity)}</td></tr><tr><th>품명</th><td>${x.item_name}${x.car_id ? ` (${cars[x.car_id]?.plate || ""})` : ""}</td></tr>
      <tr><th>공급가액</th><td class="r">${won(x.supply)}</td></tr><tr><th>부가세</th><td class="r">${won(x.vat)}</td></tr>
      <tr class="em"><th>합계</th><td class="r">${won(x.amount)}원</td></tr>
      <tr><th>국세청 승인번호</th><td>${x.confirm_num || ""}</td></tr></tbody></table>
    <p class="note">현금영수증 문의 126-1-1 · 홈택스(hometax.go.kr)에서 조회할 수 있습니다.</p></div>`)}</div>`;
}
