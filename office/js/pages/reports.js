// 종합업무현황 (똑순이와 같은 구성 + 부가세·매입장): 장부 전체를 읽어 기간별로 집계한다. 계산은 report-calc.js (테스트로 검증).
import { html, useState, useEffect, useMemo, Select, Seg, Loading, Empty, run, won, today, Period, initPeriod, SubTabs, downloadCsv, W } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 상사매출자료, 상사매입자료, 부가세자료, 원천징수자료, 종합현황, 딜러별종합현황, 딜러월별, 월별추이 } from "../report-calc.js";
import { EntryForm } from "./ledger.js";
import { 미납이자, 대출이자 } from "../calc.js";
import { monthRange } from "../ui.js";

const OFFICE_TABS = [["withholding", "딜러원천징수현황"], ["total", "딜러별종합현황"], ["monthly-dealer", "딜러월별 수익"],
  ["revenue", "상사매출관리"], ["expense", "상사매입관리"], ["operation", "상사운영보고서"], ["vat", "부가세"], ["purchases", "매입장"], ["summary", "종합현황"]];
const DEALER_TABS = [["monthly-dealer", "내 월별 수익"], ["total", "내 종합현황"]];
const DEFAULT_MODE = { vat: "분기", operation: "연", withholding: "월", "monthly-dealer": "연" };

export function ReportsPage({ app, tab }) {
  const office = app.profile.role !== "dealer";
  const tabs = office ? OFFICE_TABS : DEALER_TABS;
  const cur = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState(initPeriod(DEFAULT_MODE[cur] || "월"));
  const reload = () => run(async () => setData(await loadAll(app.db, { office })));
  useEffect(() => { reload(); }, []);
  useEffect(() => { setPeriod(initPeriod(DEFAULT_MODE[cur] || "월")); }, [cur]);

  const P = { app, data, period, setPeriod, office, reload };
  return html`<div class="report">
    <div class="bar"><h2>종합업무현황</h2><span class="grow"></span><button class="btn ghost" onClick=${() => print()}>인쇄</button></div>
    <${SubTabs} base="/reports" tabs=${tabs} cur=${cur} />
    ${!data ? html`<${Loading} />` : html`
      ${html`<div class="bar"><${Period} value=${period} onChange=${setPeriod} modes=${cur === "operation" ? ["연"] : undefined} />
        <span class="muted small">${period.from} ~ ${period.to}</span></div>`}
      ${html`<${VIEWS[cur]} key=${cur} ...${P} />`}`}
  </div>`;
}

const VIEWS = {};   // 아래에서 채움 (탭마다 별도 컴포넌트라 훅이 섞이지 않는다)
const name = (app, id) => app.dealers.find(d => d.id === id)?.name || "-";
const plateOf = (data, id) => data.cars.find(c => c.id === id)?.plate || "";

function Summary({ data, period }) {
  const s = 종합현황(data, period.from, period.to, [period.to, today()].sort()[0]);
  const 수익 = Object.entries(s.상사수익);
  return html`
    <div class="stat-grid">
      <div class="stat"><span>매입(제시)</span><b>${s.매입.대수}대</b><small>${won(s.매입.금액)}원</small></div>
      <div class="stat"><span>매도</span><b>${s.매도.대수}대</b><small>${won(s.매도.금액)}원 · 차량마진 ${won(s.매도.마진)}</small></div>
      <div class="stat"><span>정산완료</span><b>${s.정산.건수}건</b><small>실지급 ${won(s.정산.실지급)} · 원천징수 ${won(s.정산.세액)}</small></div>
      <div class="stat"><span>현재 재고</span><b>${s.재고.대수}대</b><small>${won(s.재고.금액)}원 · 평균 ${s.재고.평균일수}일</small></div>
      <div class=${"stat" + (s.재고.장기90일 ? " warn" : "")}><span>90일 넘은 재고</span><b>${s.재고.장기90일}대</b></div>
      <div class="stat"><span>진행중 재고금융</span><b>${won(s.재고.재고금융)}</b></div>
    </div>
    <div class="two">
      <div class="card"><h3>상사 수익</h3><table class="st"><tbody>
        ${수익.map(([k, v]) => html`<tr><th>${k}</th><td class=${"r" + (v < 0 ? " red" : "")}>${won(v)}</td></tr>`)}
        <tr class="em"><th>수익 합계</th><td class="r">${won(s.수익합계)}</td></tr>
        <tr><th>운영비·지출(장부)</th><td class="r red">−${won(s.운영비)}</td></tr>
        <tr class="em"><th>운영이익</th><td class=${"r" + (s.운영이익 < 0 ? " red" : " blue")}>${won(s.운영이익)}</td></tr>
      </tbody></table>
      <p class="note">딜러 차량 마진은 정산으로 딜러에게 가므로 상사 수익에 넣지 않습니다. 재고금융은 딜러에게 받은 이자 − 금융사에 낸 이자(일할)로 계산합니다.</p></div>
      <div class="card"><h3>정산</h3><table class="st"><tbody>
        <tr><th>정산기준금액 합</th><td class="r">${won(s.정산.정산기준)}</td></tr>
        <tr><th>원천징수(13.3%) 합</th><td class="r">${won(s.정산.세액)}</td></tr>
        <tr><th>딜러 실지급 합</th><td class="r">${won(s.정산.실지급)}</td></tr>
      </tbody></table></div>
    </div>`;
}

function Monthly({ data, period }) {
  const y = period.from.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const rows = months.map(m => ({ m, ...종합현황(data, monthRange(m).from, monthRange(m).to, monthRange(m).to) }));
  const lines = [["매입 대수", r => r.매입.대수, true], ["매입 금액", r => r.매입.금액], ["매도 대수", r => r.매도.대수, true], ["매도 금액", r => r.매도.금액],
    ["차량마진", r => r.매도.마진], ["정산 실지급", r => r.정산.실지급], ["원천징수", r => r.정산.세액],
    ["상사매도비", r => r.상사수익.상사매도비], ["상사매입비", r => r.상사수익.상사매입비], ["성능보험료", r => r.상사수익.성능보험료],
    ["재고금융 이자차익", r => r.상사수익.딜러이자 + r.상사수익.캐피탈이자], ["알선 상사몫", r => r.상사수익.알선몫], ["기타매출", r => r.상사수익.기타매출],
    ["상사 수익 합계", r => r.수익합계], ["운영비·지출", r => -r.운영비], ["운영이익", r => r.운영이익]];
  const csv = () => downloadCsv(`운영보고서_${y}`, [["항목", ...months.map(m => m.slice(5) + "월"), "합계"],
    ...lines.map(([k, f]) => [k, ...rows.map(f), rows.reduce((t, r) => t + f(r), 0)])]);
  return html`<div class="bar"><span class="grow"></span><button class="btn" onClick=${csv}>엑셀(CSV)</button></div>
    <div class="table-wrap"><table class="grid">
    <thead><tr><th>${y}년</th>${months.map(m => html`<th class="r">${+m.slice(5)}월</th>`)}<th class="r">합계</th></tr></thead>
    <tbody>${lines.map(([k, f, cnt]) => html`<tr class=${/합계|운영이익/.test(k) ? "em" : ""}><th>${k}</th>
      ${rows.map(r => html`<td class=${"r" + (f(r) < 0 ? " red" : "")}>${cnt ? f(r) || "" : f(r) ? won(f(r)) : ""}</td>`)}
      <td class="r"><b>${cnt ? rows.reduce((t, r) => t + f(r), 0) : won(rows.reduce((t, r) => t + f(r), 0))}</b></td></tr>`)}</tbody>
  </table></div>`;
}

function Withholding({ app, data, period }) {
  const w = 원천징수자료(data, period.from, period.to);
  const [revealed, setRevealed] = useState({});
  const admin = app.profile.role === "admin";
  const csv = async withSsn => {
    let ssn = revealed;
    if (withSsn) {
      ssn = {};
      const ok = await run(async () => {
        for (const d of w.딜러별) if (d.dealer_id) ssn[d.dealer_id] = await q(app.db.rpc("reveal_ssn", { p_target: "dealer", p_id: d.dealer_id }));
      });
      if (!ok) return;
      setRevealed(ssn);
    }
    downloadCsv(`원천징수_${period.from}_${period.to}`, [["딜러", "주민등록번호", "사업자번호", "건수", "지급액(소득금액)", "소득세(3%)", "지방소득세(0.3%)", "예수부가세 몫", "징수세액 합"],
      ...w.딜러별.map(d => { const x = app.dealers.find(z => z.id === d.dealer_id) || {};
        return [d.딜러, (withSsn && ssn[d.dealer_id]) || x.ssn_masked || "", x.biz_no || "", d.건수, d.지급액, d.소득세, d.지방세, d.예수부가세, d.징수세액]; })]);
  };
  if (!w.rows.length) return html`<${Empty}>이 기간 원천징수 대상이 없습니다.<//>`;
  return html`
    <div class="bar"><span class="grow"></span><button class="btn" onClick=${() => csv(false)}>엑셀 다운로드</button>
      ${admin && html`<button class="btn" title="주민번호 열람 기록이 남습니다" onClick=${() => csv(true)}>세무신고용 (주민번호 포함·대표)</button>`}</div>
    <div class="card"><h3>딜러별 합계 — 간이지급명세서·원천세 신고 참고</h3>
    <div class="table-wrap"><table class="grid"><thead><tr><th>딜러</th><th class="r">건수</th><th class="r">지급액(소득금액)</th><th class="r">소득세 3%</th><th class="r">지방소득세 0.3%</th><th class="r">예수부가세 몫</th><th class="r">징수세액</th></tr></thead>
      <tbody>${w.딜러별.map(d => html`<tr><td><b>${d.딜러}</b></td><td class="r">${d.건수}</td>${W(d.지급액)}${W(d.소득세)}${W(d.지방세)}${W(d.예수부가세)}${W(d.징수세액)}</tr>`)}</tbody></table></div>
    <p class="note">일괄(13.3%) 정산은 한 덩어리로 떼므로, 신고용으로 소득세 3% · 지방소득세 0.3% · 나머지(10% 예수부가세 몫)로 나눠 보여줍니다. 신고 전 세무사 확인을 권합니다.</p></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>일자</th><th>구분</th><th>딜러</th><th>차주딜러</th><th>차량</th><th>방식</th><th class="r">지급액</th><th class="r">소득세</th><th class="r">지방세</th><th class="r">징수세액</th></tr></thead>
      <tbody>${w.rows.map(r => html`<tr><td>${r.일자}</td><td>${r.구분}</td><td>${r.딜러}</td><td class="muted">${r.차주딜러 || ""}</td><td>${r.car_id ? html`<a href=${`#/car/${r.car_id}/settle`}>${r.차량}</a>` : r.차량}</td><td>${r.방식}</td>
        ${W(r.지급액)}${W(r.소득세)}${W(r.지방세)}${W(r.징수세액)}</tr>`)}</tbody></table></div>`;
}

function Vat({ data, period }) {
  const v = 부가세자료(data, period.from, period.to);
  const T = (rows, label) => html`<div class="table-wrap"><table class="grid"><thead><tr><th>일자</th><th>${label}</th><th>차량</th><th class="r">금액</th><th class="r">공급가</th><th class="r">세액</th></tr></thead>
    <tbody>${rows.map(r => html`<tr><td>${r.일자}</td><td>${r.항목}</td><td>${r.car_id ? plateOf(data, r.car_id) : ""}</td>${W(r.금액)}${W(r.공급가 ?? r.금액)}${W(r.부가세 ?? r.공제세액)}</tr>`)}</tbody></table></div>`;
  const csv = () => downloadCsv(`부가세_${period.from}_${period.to}`, [["구분", "일자", "항목", "차량", "금액", "공급가", "세액"],
    ...상사매출자료(data, period.from, period.to).filter(r => r.과세).map(r => ["매출", r.일자, r.항목, plateOf(data, r.car_id), r.금액, r.공급가, r.부가세]),
    ...v.매입.세금계산서.map(r => ["매입-세금계산서", r.일자, r.항목, plateOf(data, r.car_id), r.금액, r.공급가, r.부가세]),
    ...v.매입.카드현금.map(r => ["매입-카드·현금영수증", r.일자, r.항목, plateOf(data, r.car_id), r.금액, r.공급가, r.부가세]),
    ...v.매입.의제.map(r => ["의제매입(중고차)", r.일자, r.항목, plateOf(data, r.car_id), r.금액, "", r.공제세액])]);
  return html`
    <div class="bar"><span class="grow"></span><button class="btn" onClick=${csv}>엑셀(CSV)</button></div>
    <div class="stat-grid">
      <div class="stat"><span>과세 매출 공급가</span><b>${won(v.매출.과세공급가)}</b><small>면세 매출 ${won(v.매출.면세)}</small></div>
      <div class="stat"><span>매출세액</span><b>${won(v.매출.매출세액)}</b></div>
      <div class="stat"><span>매입세액 공제 합계</span><b>${won(v.매입.공제합계)}</b>
        <small>세금계산서 ${won(v.매입.세액.세금계산서)} · 카드·현금 ${won(v.매입.세액.카드현금)} · 의제 ${won(v.매입.세액.의제매입)}</small></div>
      <div class=${"stat " + (v.예상납부세액 < 0 ? "" : "warn")}><span>${v.예상납부세액 < 0 ? "예상 환급세액" : "예상 납부세액"}</span><b>${won(Math.abs(v.예상납부세액))}</b></div>
    </div>
    <div class="card"><h3>매출 (과세)</h3>
      <table class="st"><tbody>${v.매출.항목별.map(x => html`<tr><th>${x.항목} (${x.건수}건)</th><td class="r">${won(x.공급가)}</td><td class="r">${won(x.부가세)}</td></tr>`)}</tbody></table></div>
    <div class="card"><h3>매입세액 — 세금계산서 수취분</h3>${v.매입.세금계산서.length ? T(v.매입.세금계산서, "항목") : html`<p class="muted">없음</p>`}</div>
    <div class="card"><h3>매입세액 — 신용카드·현금영수증</h3>${v.매입.카드현금.length ? T(v.매입.카드현금, "항목") : html`<p class="muted">없음</p>`}</div>
    <div class="card"><h3>의제매입세액 — 중고자동차 (취득가 × 10/110)</h3>${v.매입.의제.length ? T(v.매입.의제, "항목") : html`<p class="muted">없음</p>`}
      <p class="note">개인 등 비사업자에게서 산 중고차(제시증빙 '의제매입')만 들어갑니다. 공제 요건·한도·시기는 신고 전 세무사와 확인하세요.
        이 화면은 신고서가 아니라 장부 기준 참고자료입니다.</p></div>`;
}

function LedgerList({ rows, data, app, name: title, kind, reload }) {
  const [edit, setEdit] = useState(null);
  const items = kind === "매출" ? app.settings.revenue_items : app.settings.expense_items;
  const form = edit && html`<${EntryForm} app=${app} kind=${edit.kind || kind} items=${items} init=${edit} onDone=${() => { setEdit(null); reload(); }} />`;
  const addBtn = html`<button class="btn primary" onClick=${() => setEdit({})}>${kind === "매출" ? "상사매출(수익) 등록하기" : "상사매입(지출) 등록하기"}</button>`;
  const sum = (k, f = () => true) => rows.filter(f).reduce((t, r) => t + r[k], 0);
  const csv = () => downloadCsv(title, [["일자", "항목", "출처", "차량", "딜러", "금액", "공급가", "부가세", "과세", "증빙", "비고"],
    ...rows.map(r => [r.일자, r.항목, r.출처, plateOf(data, r.car_id), name(app, r.dealer_id), r.금액, r.공급가, r.부가세, r.과세 ? "과세" : "면세", r.증빙 || "", r.비고 || ""])]);
  const by = {};
  for (const r of rows) { const x = by[r.항목] ||= { 항목: r.항목, n: 0, 금액: 0, 부가세: 0 }; x.n++; x.금액 += r.금액; x.부가세 += r.부가세; }
  if (!rows.length) return html`<div class="bar"><span class="grow"></span>${addBtn}</div>${form}<${Empty}>이 기간 자료가 없습니다.<//>`;
  return html`<div class="bar"><span class="grow"></span><button class="btn" onClick=${csv}>다운로드</button>${addBtn}</div>${form}
    <div class="card"><h3>항목별 합계</h3><table class="st"><tbody>
      ${Object.values(by).map(x => html`<tr><th>${x.항목} (${x.n}건)</th><td class="r">${won(x.금액)}</td><td class="note">부가세 ${won(x.부가세)}</td></tr>`)}
      <tr class="em"><th>합계</th><td class="r">${won(sum("금액"))}</td><td class="note">부가세 ${won(sum("부가세"))}</td></tr></tbody></table></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>일자</th><th>항목</th><th>출처</th><th>차량</th><th>딜러</th><th class="r">금액</th><th class="r">부가세</th><th>증빙</th><th>비고</th></tr></thead>
      <tbody>${rows.map(r => html`<tr class=${r.ledger_id ? "click-row" : ""} onClick=${() => r.ledger_id && setEdit((data.ledger || []).find(e => e.id === r.ledger_id))}>
        <td>${r.일자}</td><td>${r.항목}</td><td>${r.출처 === "장부" ? html`<span class="badge blue">직접입력</span>` : r.출처}</td>
        <td>${r.car_id ? html`<a href=${`#/car/${r.car_id}`}>${plateOf(data, r.car_id)}</a>` : ""}</td><td>${r.dealer_id ? name(app, r.dealer_id) : ""}</td>
        ${W(r.금액)}<td class="r muted">${r.과세 ? won(r.부가세) : "면세"}</td><td>${r.증빙 || ""}</td><td class="ellipsis">${r.비고 || ""}</td></tr>`)}</tbody></table></div>`;
}
const Revenue = ({ app, data, period, reload }) => html`<${LedgerList} app=${app} data=${data} kind="매출" reload=${reload} name="상사매출자료" rows=${상사매출자료(data, period.from, period.to)} />`;
const Expense = ({ app, data, period, reload }) => html`<${LedgerList} app=${app} data=${data} kind="지출" reload=${reload} name="상사매입자료" rows=${상사매입자료(data, period.from, period.to)} />`;

function Purchases({ app, data, period }) {
  const rows = data.cars.filter(c => !c.deleted_at && c.purchase_date >= period.from && c.purchase_date <= period.to).sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  return html`<div class="bar"><span class="grow"></span><button class="btn" disabled=${!rows.length} onClick=${() => downloadCsv("매입장", [["관리번호", "제시일", "이전일", "차량번호", "제시전번호", "차명", "차종", "매도자", "구분", "주민/법인번호", "사업자번호", "주소", "관인계약서", "제시금액", "공급가", "부가세", "증빙", "딜러"],
      ...rows.map(c => [c.code, c.purchase_date, c.transfer_date, c.plate, c.plate_before, c.car_name, c.car_kind, c.seller_name, c.seller_type, c.seller_ssn_masked, c.seller_biz_no,
        [c.seller_addr1, c.seller_addr2].filter(Boolean).join(" "), c.contract_no, c.purchase_amount, c.purchase_supply, c.purchase_vat, c.evidence, name(app, c.dealer_id)])])}>엑셀(CSV)</button></div>
    <div class="card statement"><div class="st-head"><h3>매입장</h3><span>${app.settings.company_name} · ${period.from} ~ ${period.to}</span></div>
    ${!rows.length ? html`<p class="muted">이 기간 제시 차량이 없습니다.</p>` : html`<div class="table-wrap"><table class="grid">
      <thead><tr><th>관리번호</th><th>제시일</th><th>차량번호</th><th>차명</th><th>매도자</th><th>주민/사업자</th><th>관인계약서</th><th class="r">제시금액</th><th class="r">부가세</th><th>증빙</th></tr></thead>
      <tbody>${rows.map(c => html`<tr><td>${c.code}</td><td>${c.purchase_date}</td><td><a href=${`#/car/${c.id}`}>${c.plate}</a></td><td>${c.car_name}</td>
        <td>${c.seller_name || "-"}</td><td class="small">${c.seller_ssn_masked || c.seller_biz_no || "-"}</td><td>${c.contract_no || "-"}</td>
        ${W(c.purchase_amount)}${W(c.purchase_vat)}<td>${c.evidence}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="7">${rows.length}대</td><td class="r">${won(rows.reduce((s, c) => s + Number(c.purchase_amount), 0))}</td>
        <td class="r">${won(rows.reduce((s, c) => s + Number(c.purchase_vat), 0))}</td><td></td></tr></tfoot></table></div>`}</div>`;
}



// ───────────────────────── 똑순이 종합업무현황 화면들 (2026-10-01) ─────────────────────────
const Bar = ({ rows, a, b }) => {
  const max = Math.max(1, ...rows.flatMap(r => [r[a.key], r[b.key]]));
  const w = 100 / rows.length;
  return html`<div><svg class="chart" viewBox="0 0 100 60" preserveAspectRatio="none">
      ${rows.map((r, i) => html`<rect class="b1" x=${i * w + w * 0.15} width=${w * 0.32} y=${55 - r[a.key] / max * 50} height=${r[a.key] / max * 50} />
        <rect class="b2" x=${i * w + w * 0.5} width=${w * 0.32} y=${55 - r[b.key] / max * 50} height=${r[b.key] / max * 50} />`)}
    </svg>
    <div class="row small muted" style="justify-content:space-between">${rows.map(r => html`<span>${r.label}</span>`)}</div>
    <div class="legend"><span><i style="background:#94a3b8"></i>${a.label}</span><span><i style="background:var(--pri)"></i>${b.label}</span></div></div>`;
};
export { Bar as TrendChart };

function DealerTotal({ app, data, period, office }) {
  const rows = 딜러별종합현황(data, period.from, period.to, [period.to, today()].sort()[0]).filter(r => office || r.dealer_id === app.profile.dealer_id);
  if (!rows.length) return html`<${Empty}>자료가 없습니다.<//>`;
  const G = [["현 제시현황", [["재고건수", 1], ["평균재고일", 2], ["재고금액"]]],
             ["매입 (기간)", [["매입건수", 1], ["매입금액"], ["과표금액"], ["매입공제세액"], ["공제건", 1], ["미공제건", 1]]],
             ["상품화비용", [["상품화금액"], ["상품화세액"]]],
             ["재고금융", [["대출금액"], ["캐피탈이자"], ["딜러청구이자"], ["딜러입금이자"], ["미납이자"]]],
             ["매도현황 (기간)", [["매도건수", 1], ["평균매도일", 2], ["매도금액"], ["매도이익금"], ["매도비"]]]];
  const label = { 재고건수: "건수", 평균재고일: "평균 보유일", 재고금액: "제시금액", 매입건수: "건수", 매입금액: "제시금액", 과표금액: "과표(공급가)",
    매입공제세액: "매입공제세액", 공제건: "공제 건", 미공제건: "미공제 건", 상품화금액: "금액", 상품화세액: "세액", 대출금액: "대출금액(진행)",
    캐피탈이자: "캐피탈 이자", 딜러청구이자: "딜러 청구이자", 딜러입금이자: "딜러 입금이자", 미납이자: "미납이자", 매도건수: "건수", 평균매도일: "평균 매도일",
    매도금액: "매도금액", 매도이익금: "매도이익금", 매도비: "매도비" };
  const total = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const cell = (r, k, t) => t === 1 ? html`<td class="r">${r[k]}</td>` : t === 2 ? html`<td class="r">${r[k]}일</td>` : W(r[k]);
  return html`<div class="bar"><span class="grow"></span><button class="btn" onClick=${() => downloadCsv("딜러별종합현황", [["딜러", ...G.flatMap(([g, cs]) => cs.map(([k]) => g + "·" + label[k]))],
      ...rows.map(r => [name(app, r.dealer_id), ...G.flatMap(([, cs]) => cs.map(([k]) => r[k]))])])}>엑셀(CSV)</button></div>
    <div class="table-wrap"><table class="grid">
      <thead><tr><th rowspan="2">딜러명</th>${G.map(([g, cs]) => html`<th colspan=${cs.length} class="c">${g}</th>`)}</tr>
        <tr>${G.flatMap(([, cs]) => cs.map(([k]) => html`<th class="r">${label[k]}</th>`))}</tr></thead>
      <tbody>${rows.map(r => html`<tr><td><b>${name(app, r.dealer_id)}</b></td>${G.flatMap(([, cs]) => cs.map(([k, t]) => cell(r, k, t)))}</tr>`)}</tbody>
      ${rows.length > 1 && html`<tfoot><tr><td>합계</td>${G.flatMap(([, cs]) => cs.map(([k, t]) => t === 2 ? html`<td></td>` : t === 1 ? html`<td class="r">${total(k)}</td>` : html`<td class="r">${won(total(k))}</td>`))}</tr></tfoot>`}
    </table></div>
    <p class="note">현 제시현황은 오늘 기준 재고, 나머지는 선택 기간입니다. 딜러 입금이자는 실제 받은 이자(이자납입 + 정산 때 상계한 미납이자), 청구이자는 딜러이율로 기간에 생긴 이자입니다.</p>`;
}

function DealerMonthly({ app, data, period, office }) {
  const rows = 딜러월별(data, period.from, period.to).filter(r => office || r.dealer_id === app.profile.dealer_id);
  const cols = ["건수", "제시금액", "매도금액", "상품화비", "재고금융이자", "소득금액", "세금", "실지급액"];
  if (!rows.length) return html`<${Empty}>이 기간 정산완료 건이 없습니다.<//>`;
  return html`<div class="bar"><span class="grow"></span><button class="btn" onClick=${() => downloadCsv("딜러월별수익", [["정산월", "딜러명", ...cols], ...rows.map(r => [r.정산월, name(app, r.dealer_id), ...cols.map(k => r[k])])])}>엑셀(CSV)</button></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>정산월</th><th>딜러명</th>${cols.map(k => html`<th class="r">${k === "세금" ? "세금(소득세+지방세)" : k}</th>`)}</tr></thead>
      <tbody>${rows.map(r => html`<tr><td>${r.정산월}</td><td><b>${name(app, r.dealer_id)}</b></td><td class="r">${r.건수}</td>${cols.slice(1).map(k => W(r[k]))}</tr>`)}</tbody>
      <tfoot><tr><td colspan="2">합계</td><td class="r">${rows.reduce((t, r) => t + r.건수, 0)}</td>${cols.slice(1).map(k => html`<td class="r">${won(rows.reduce((t, r) => t + r[k], 0))}</td>`)}</tr></tfoot></table></div>
    <p class="note">재고금융이자는 실제로 받은 이자입니다(똑순이는 계획 총이자를 보여줘 실제와 달랐습니다). 알선딜러 몫은 알선딜러 줄로 따로 잡힙니다.</p>`;
}

function Operation(P) {
  const { app, data, period, reload } = P;
  const [adding, setAdding] = useState(false);
  const y = period.from.slice(0, 4);
  const trend = 월별추이(data, `${y}-12`, 12).map((r, i) => {
    const s = 종합현황(data, monthRange(r.월).from, monthRange(r.월).to, monthRange(r.월).to);
    return { label: `${i + 1}`, 수익: Math.round(s.수익합계 / 10000), 운영비: Math.round(s.운영비 / 10000) };
  });
  const dm = 딜러월별(data, period.from, period.to);
  const byDealer = Object.values(dm.reduce((m, r) => { const x = m[r.dealer_id] ||= { dealer_id: r.dealer_id, 건수: 0, 제시금액: 0, 매도금액: 0, 소득금액: 0, 세금: 0, 실지급액: 0 };
    for (const k of ["건수", "제시금액", "매도금액", "소득금액", "세금", "실지급액"]) x[k] += r[k]; return m; }, {}));
  const 매출 = 상사매출자료(data, period.from, period.to);
  const 수입월 = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`).map(ym => ({ ym,
    매입비: 매출.filter(r => r.항목 === "상사매입비" && r.일자.startsWith(ym)).reduce((t, r) => t + r.금액, 0),
    매도비: 매출.filter(r => r.항목 === "상사매도비" && r.일자.startsWith(ym)).reduce((t, r) => t + r.금액, 0) })).filter(r => r.매입비 || r.매도비);
  const 운영비 = (data.ledger || []).filter(e => e.kind === "운영비" && (e.entry_date || e.ym + "-01") >= period.from && (e.entry_date || e.ym + "-01") <= period.to);
  const s = 종합현황(data, period.from, period.to);
  return html`
    <div class="card"><h3>월별 손익 추이 (단위: 만원, ${y}년)</h3><${Bar} rows=${trend} a=${{ key: "운영비", label: "운영비·지출" }} b=${{ key: "수익", label: "상사 수익" }} /></div>
    <${Monthly} ...${P} />
    <div class="two">
      <div class="card"><h3>딜러 실적 요약 (정산 완료 기준)</h3>${!byDealer.length ? html`<p class="muted">없음</p>` : html`<div class="table-wrap"><table class="grid">
        <thead><tr><th>딜러명</th><th class="r">처리건수</th><th class="r">제시금액</th><th class="r">매도금액</th><th class="r">소득금액</th><th class="r">세금</th><th class="r">실지급액</th></tr></thead>
        <tbody>${byDealer.map(r => html`<tr><td>${name(app, r.dealer_id)}</td><td class="r">${r.건수}</td>${W(r.제시금액)}${W(r.매도금액)}${W(r.소득금액)}${W(r.세금)}${W(r.실지급액)}</tr>`)}</tbody></table></div>`}</div>
      <div class="card"><h3>상사 수입 내역 (매입비 + 매도비)</h3>${!수입월.length ? html`<p class="muted">없음</p>` : html`<table class="st"><tbody>
        ${수입월.map(r => html`<tr><th>${r.ym}</th><td class="r">${won(r.매입비)}</td><td class="r">${won(r.매도비)}</td><td class="r"><b>${won(r.매입비 + r.매도비)}</b></td></tr>`)}</tbody></table>`}</div>
    </div>
    <div class="card"><div class="bar"><h3>상사 운영비 내역</h3><span class="grow"></span><button class="btn primary" onClick=${() => setAdding({})}>운영비 등록</button></div>
      ${adding && html`<${EntryForm} app=${app} kind="운영비" items=${app.settings.expense_items} init=${adding} onDone=${() => { setAdding(false); reload(); }} />`}
      ${!운영비.length ? html`<p class="muted">이 기간 운영비가 없습니다.</p>` : html`<div class="table-wrap"><table class="grid click"><thead><tr><th>년월</th><th>항목명</th><th class="r">금액</th><th>비고</th></tr></thead>
        <tbody>${운영비.map(e => html`<tr onClick=${() => setAdding(e)}><td>${e.ym}</td><td>${e.item}</td>${W(e.amount)}<td>${e.memo || ""}</td></tr>`)}</tbody></table></div>`}</div>
    <div class="card"><h3>종합 손익 요약 (${period.from} ~ ${period.to})</h3><table class="st"><tbody>
      ${Object.entries(s.상사수익).map(([k, v]) => html`<tr><th>${k}</th><td class=${"r" + (v < 0 ? " red" : "")}>${won(v)}</td></tr>`)}
      <tr class="em"><th>상사 수입 합계</th><td class="r">${won(s.수익합계)}</td></tr><tr><th>운영비·지출</th><td class="r red">−${won(s.운영비)}</td></tr>
      <tr class="em"><th>순손익</th><td class=${"r " + (s.운영이익 < 0 ? "red" : "blue")}>${won(s.운영이익)}</td></tr></tbody></table></div>`;
}

Object.assign(VIEWS, { withholding: Withholding, total: DealerTotal, "monthly-dealer": DealerMonthly, revenue: Revenue, expense: Expense,
  operation: Operation, vat: Vat, purchases: Purchases, summary: Summary });
