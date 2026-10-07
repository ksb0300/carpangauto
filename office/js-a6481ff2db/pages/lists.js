// 목록 화면: 리스트(재고·매도 차량) / 상품화비용(차량별·비용별) / 재고금융(리스트·이자납입) / 매도차량.
// 공통: 차량번호 검색, 매입담당, 검색기간(기준일 선택), 정렬, 엑셀(CSV) 다운로드, 합계표, 등록 버튼.
import { html, useState, useEffect, useMemo, Select, Seg, Loading, Empty, run, won, go, today, Period, initPeriod, SubTabs, downloadCsv, W, toast, Money, 검색맞음 } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 부가세분리, 대출이자, 미납이자, 재고금융이자 } from "../calc.js";
import { settleBadge } from "./cars.js";
import { LenderOverview, 할일, LoanAction } from "./lenders.js";
import { 대출상태 } from "../calc.js";

const n = v => Math.round(Number(v) || 0);
const days = (a, b = today()) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const addMonths = (d, m) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + Number(m)); return x.toISOString().slice(0, 10); };

// 상품화비용 = 수리비 + 도색광택 + 탁송유류 (예전 항목 이름도 같이). 나머지 비용(취득세·광고비·수수료·성능비·기타)은 재반비용.
const 상품화항목 = new Set(["수리비", "도색광택", "탁송유류", "판금도장비", "기능수리/상품화", "광택/세차", "매입탁송비", "주유대"]);
export const 비용구분 = item => 상품화항목.has(item) ? "상품화" : "재반";

/** 목록 공통 데이터 + 차량별 합계 */
function useBook(app) {
  const [d, setD] = useState(null);
  const reload = () => run(async () => {
    const all = await loadAll(app.db, { office: app.profile.role !== "dealer" });
    const docs = await (async () => { try { const { data } = await app.db.from("issue_docs").select("car_id,status,trade_date,doc_type"); return data || []; } catch { return []; } })();
    const by = (arr, k = "car_id") => arr.reduce((m, r) => ((m[r[k]] ||= []).push(r), m), {});
    const lenderOf = Object.fromEntries(all.lenders.map(x => [x.id, x]));
    const cost = by(all.costs), loan = by(all.loans), pay = by(all.payments, "loan_id"), sale = Object.fromEntries(all.sales.map(s => [s.car_id, s]));
    const settle = Object.fromEntries(all.settlements.map(s => [s.car_id, s])), doc = by(docs);
    const buyer = by(all.buyers);
    const cars = all.cars.filter(c => !c.deleted_at).map(c => {
      const ks = cost[c.id] || [], ls = loan[c.id] || [];
      const 납입 = ls.reduce((t, l) => t + (pay[l.id] || []).reduce((u, p) => u + n(p.amount), 0), 0);
      const issued = (doc[c.id] || []).filter(x => x.status === "발행").map(x => x.trade_date).sort();
      return { ...c, costs: ks, loans: ls,
        상품화: ks.reduce((t, k) => t + n(k.amount), 0), 상품화건수: ks.length,
        상품화최근: ks.map(k => k.created_at?.slice(0, 10)).sort().pop() || "",
        재고금융: ls.filter(l => l.status === "진행중").reduce((t, l) => t + n(l.amount), 0),
        재고금융전체: ls.reduce((t, l) => t + n(l.amount), 0), 총납입이자: 납입,
        // 총납입이자(자동): 매입매출대장처럼 매입일부터 (상환했으면 상환일, 팔렸으면 매도일, 아니면 오늘까지) — 금융사 조건(연장 이율 등) 반영
        재고이자: ls.reduce((t, l) => t + 재고금융이자({ ...l, start_date: c.purchase_date < l.start_date ? c.purchase_date : l.start_date },
          c.purchase_date, l.repaid_date || sale[c.id]?.sale_date || today()), 0),
        상품화비: ks.filter(k => 비용구분(k.item) === "상품화").reduce((t, k) => t + n(k.amount), 0),
        // 재반: 상품화 외 비용 + 저당해지비용(상환했으면 낸 금액, 아직이면 금융사 설정값으로 예상)
        해지비용: ls.reduce((t, l) => t + (l.status === "상환완료" ? n(l.repay_fee) : n(lenderOf[l.lender_id]?.release_fee)), 0),
        재반항목: ks.filter(k => 비용구분(k.item) === "재반").reduce((t, k) => t + n(k.amount), 0)
          + ls.reduce((t, l) => t + (l.status === "상환완료" ? n(l.repay_fee) : n(lenderOf[l.lender_id]?.release_fee)), 0),
        sale: sale[c.id], settle: settle[c.id], buyers: buyer[c.id] || [], 매출발행일: issued[0] || "" };
    });
    setD({ ...all, cars });
  });
  useEffect(() => { reload(); }, []);
  return [d, reload];
}

/** 검색줄: 차량번호, 매입담당, 기준일 + 기간, 정렬 */
function Filters({ app, f, setF, dateKeys, sortKeys, extra }) {
  const office = app.profile.role !== "dealer";
  return html`<div class="bar">
    <input class="search" placeholder="차량번호·차명" value=${f.q} onInput=${e => { const v = e.target.value; saveQ(v); setF(p => ({ ...p, q: v })); }} />
    ${office && html`<${Select} value=${f.dealer} onChange=${v => setF(p => ({ ...p, dealer: v }))} empty="매입담당 전체" options=${app.dealers.map(d => [d.id, d.name])} />`}
    ${dateKeys.length > 1 && html`<${Select} value=${f.dateKey} onChange=${v => setF(p => ({ ...p, dateKey: v }))} options=${dateKeys} />`}
    <label class="check"><input type="checkbox" checked=${f.useDate} onChange=${e => setF(p => ({ ...p, useDate: e.target.checked }))} /> 기간</label>
    ${f.useDate && html`<${Period} value=${f.period} onChange=${v => setF(p => ({ ...p, period: v }))} />`}
    ${extra}
    <${Select} value=${f.sort} onChange=${v => setF(p => ({ ...p, sort: v }))} options=${sortKeys} />
    <${Seg} value=${f.dir} onChange=${v => setF(p => ({ ...p, dir: v }))} options=${[["desc", "내림차순"], ["asc", "오름차순"]]} />
  </div>`;
}
// 검색어는 차 화면(#/car/…)에 들어갔다 돌아올 때만 남는다. 메뉴로 다른 화면에 다녀오면 초기화
let prevHash = "", curHash = location.hash;
addEventListener("hashchange", () => { prevHash = curHash; curHash = location.hash; });   // 화면 전환(App)보다 먼저 등록된다
const qKey = () => "list-q:" + (location.hash.slice(1).split("?")[0].split("/")[1] || "");
const saveQ = v => { try { sessionStorage.setItem(qKey(), v); } catch {} };
// (useState 초기값 식은 매 렌더마다 계산되니 여기서 지우지 않고 읽기만)
const loadQ = () => { try { return prevHash.startsWith("#/car/") ? sessionStorage.getItem(qKey()) || "" : ""; } catch { return ""; } };
const initF = (dateKey, sort) => ({ q: loadQ(), dealer: null, dateKey, useDate: false, period: initPeriod("월"), sort, dir: "desc" });
const match = (f, c, date) => 점수(f, c) > 0
  && (!f.dealer || c.dealer_id === f.dealer || c.sale?.dealer_id === f.dealer)
  && (!f.useDate || (date && date >= f.period.from && date <= f.period.to));
const 점수 = (f, c) => 검색맞음(f.q, c.plate, c.plate_before, c.car_name, c.brand, c.model, c.grade, c.fskey);
// 검색어가 있으면 글자 그대로 맞는 차가 먼저, 소리만 비슷한 차(소나타→쏘나타)는 그 아래. 그 안에선 고른 정렬대로
const sorter = (f, get) => (a, b) => { if (f.q) { const d = 점수(f, b) - 점수(f, a); if (d) return d; }
  const x = get(a, f.sort), y = get(b, f.sort); const r = x < y ? -1 : x > y ? 1 : 0; return f.dir === "asc" ? r : -r; };

/** 차를 골라 그 차의 탭으로 (상품화비용 등록·재고금융 등록·매도차량 등록) */
function CarPick({ cars, label, tab, onClose }) {
  const [id, setId] = useState(null);
  return html`<div class="subform row" style="flex-wrap:wrap"><span>${label}: 차량 선택</span>
    <${Select} value=${id} onChange=${setId} empty="차량을 고르세요" options=${cars.map(c => [c.id, `${c.plate} ${c.car_name}`])} />
    <button class="btn primary" disabled=${!id} onClick=${() => go(`/car/${id}/${tab}`)}>다음 →</button>
    <button class="btn ghost" onClick=${onClose}>닫기</button></div>`;
}

const Sum = ({ rows }) => html`<div class="table-wrap"><table class="grid sumtable"><tbody>
  ${rows.map(r => html`<tr class=${r.em ? "em" : ""}>${r.cells.map((c, i) => i === 0 ? html`<th>${c}</th>` : typeof c === "number" ? W(c) : html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>`;

/** 목록에서 바로 매입담당 바꾸기 — 대표↔딜러로 바뀌면 상사매입비도 따라간다(DB 트리거) */
function OwnerPick({ app, car, onDone }) {
  const pick = async v => {
    if (!v || v === car.dealer_id) return;
    const to = app.dealers.find(x => x.id === v);
    // 대표끼리(공동매입 포함)는 손익 계산이 같아 확정된 차도 바꿀 수 있다. 딜러로 바뀌면 정산 방식이 달라져 확정 해제가 먼저
    if (car.settle?.finalized && !(car.settle.mode === "대표" && to?.partner))
      return toast("정산(손익) 확정된 차는 딜러로 바꿀 수 없습니다. 확정을 먼저 해제하세요.", "err");
    const fee = to?.partner ? 0 : app.settings.purchase_fee;
    await run(() => q(app.db.from("cars").update({ dealer_id: v, purchase_fee: fee }).eq("id", car.id)), `${car.plate} → ${to?.name}`);
    onDone();
  };
  return html`<${Select} value=${car.dealer_id} onChange=${pick} empty="선택" options=${app.dealers.filter(x => x.active || x.id === car.dealer_id).map(x => [x.id, x.name + (x.partner ? "" : " (딜러)")])} />`;
}

// ───────────────────────── 리스트 (재고·매도 차량) ─────────────────────────
const priceTimers = {};
export function PurchasesPage({ app }) {
  const [d, reload] = useBook(app);
  const [f, setF] = useState({ ...initF("매입일", "매입일"), status: "재고" });
  const [price, setPrice] = useState({});        // 입력 중인 판매가·추가수익 (저장 전에도 마진이 바로 보이게) — 키: 차id / "x"+차id
  const office = app.profile.role !== "dealer";
  const dealer = Object.fromEntries(app.dealers.map(x => [x.id, x.name]));
  const dateOf = c => ({ 매입일: c.purchase_date, 등록일: c.created_at?.slice(0, 10) }[f.dateKey]);
  // 재반비용 = 취득세·광고비·수수료·성능비 등(상품화 외 비용) + 재고이자 / 총원가 = 매입가 + 재반 + 상품화
  // 판매가 = 차값(매도비 제외, 대장과 같게) / 마진 = 판매가 + 매도비 + 추가수익 − 총원가
  // 매도된 차는 실제 값(매도금액, 매도비, 할부수익 + 정산 기타매출), 아니면 입력값(매도비는 기본 매도비)
  const 기본매도비 = n(app.settings.sale_fee);
  const calc = c => {
    const 재반 = c.재반항목 + c.재고이자, 총원가 = n(c.purchase_amount) + 재반 + c.상품화비;
    const 입력가 = price[c.id] ?? (c.list_price != null ? n(c.list_price) : null);
    const 예상 = !c.sale && !입력가 && n(c.ad_price) > 0;          // 판매가를 안 넣었으면 엔카 광고가로 '예상'
    const 판매가 = c.sale ? n(c.sale.sale_amount) : 입력가 || (예상 ? n(c.ad_price) : null);
    const 매도비 = c.sale ? n(c.sale.sale_fee) : 기본매도비;
    const 추가수익 = c.sale ? n(c.sale.installment_income) + (c.settle?.other_revenue || []).reduce((t, x) => t + n(x.금액), 0)
      : n(price["x" + c.id] ?? c.extra_income);
    return { 재반, 총원가, 판매가, 매도비, 추가수익, 예상, 본전가: 총원가 - 매도비 - 추가수익, 마진: 판매가 ? 판매가 + 매도비 + 추가수익 - 총원가 : null };
  };
  const rows = useMemo(() => (d?.cars || []).filter(c => (f.status === "전체" || c.status === f.status) && match(f, c, dateOf(c)))
    .sort(sorter(f, (c, k) => ({ 매입일: c.purchase_date, 매입가: n(c.purchase_amount), 차량번호: c.plate, 재고일수: -days(c.purchase_date), 총원가: calc(c).총원가, 마진: calc(c).마진 ?? -1e15 }[k]))), [d, f, f.sort === "마진" ? price : null]);
  if (!d) return html`<${Loading} />`;
  // 판매가·추가수익: 입력을 멈추고 0.8초 뒤 자동 저장 (칸을 벗어나지 않아도)
  const typeField = (c, col, key, v) => {
    setPrice(p => ({ ...p, [key]: v }));
    clearTimeout(priceTimers[key]);
    priceTimers[key] = setTimeout(() => run(async () => { await q(app.db.from("cars").update({ [col]: v || null }).eq("id", c.id)); c[col] = v || null; }), 800);
  };
  const sum = k => rows.reduce((t, c) => t + n(k(c)), 0);
  const csv = () => downloadCsv("차량리스트", [["매입일", "차량번호", "매입담당", "차량명", "매입가", "재반비용", "(재고이자)", "상품화비용", "총원가", "추가수익", "판매가(매도비제외)", "매도비", "마진", "재고일", "상태"],
    ...rows.map(c => { const x = calc(c); return [c.purchase_date, c.plate, dealer[c.dealer_id], c.car_name, c.purchase_amount, x.재반, c.재고이자, c.상품화비, x.총원가, x.추가수익 || "", x.판매가 ?? "", x.매도비, x.마진 ?? "",
      c.status === "재고" ? days(c.purchase_date) : "", c.status]; })]);
  return html`<div class="bar"><h2>차량 리스트</h2><span class="grow"></span>
      <button class="btn" onClick=${csv}>다운로드</button>${office && html`<button class="btn primary" onClick=${() => go("/cars/new")}>차량 등록</button>`}</div>
    <${Filters} app=${app} f=${f} setF=${setF} dateKeys=${["매입일", "등록일"]} sortKeys=${["매입일", "매입가", "차량번호", "재고일수", "총원가", "마진"]}
      extra=${html`<${Seg} value=${f.status} onChange=${v => setF(p => ({ ...p, status: v }))} options=${["재고", "매도", "전체"]} />`} />
    <${Sum} rows=${[{ cells: ["합계", "건수", "매입가", "재반비용", "상품화비용", "총원가", "추가수익", "판매가", "마진"], em: true },
      { cells: ["", rows.length + "대", sum(c => c.purchase_amount), sum(c => calc(c).재반), sum(c => c.상품화비), sum(c => calc(c).총원가), sum(c => calc(c).추가수익), sum(c => calc(c).판매가), sum(c => calc(c).마진)] }]} />
    ${!rows.length ? html`<${Empty}>조건에 맞는 차량이 없습니다.<//>` : html`<div class="table-wrap"><table class="grid click carlist">
      <thead><tr><th>매입일</th><th>차량번호</th><th>매입담당</th><th>차량명</th><th class="r">매입가</th>
        <th class="r" title="취득세·광고비·수수료·성능비 등 + 재고이자(매입일부터 오늘·매도일까지)">재반비용</th><th class="r" title="수리비 + 도색광택 + 탁송유류">상품화비용</th>
        <th class="r" title="매입가 + 재반비용 + 상품화비용">총원가</th><th class="r" title="할부 수수료 등 차값 말고 더 들어올 돈 (매도된 차는 할부수익 + 정산 기타매출)">추가수익</th><th class="r">판매가(매도비제외)</th>
        <th class="r" title="판매가 + 매도비 + 추가수익 − 총원가">마진</th><th class="r">재고일</th><th>매도·정산</th></tr></thead>
      <tbody>${rows.map(c => { const x = calc(c); return html`<tr key=${c.id} onClick=${() => go("/car/" + c.id)}><td>${c.purchase_date}</td>
        <td><b>${c.plate}</b></td><td onClick=${e => office && e.stopPropagation()}>${office ? html`<${OwnerPick} app=${app} car=${c} onDone=${reload} />` : dealer[c.dealer_id] || "-"}</td>
        <td class="ellipsis">${c.car_name}</td>${W(c.purchase_amount)}
        <td class="r" title=${`비용 ${won(c.재반항목 - c.해지비용)} + 저당해지비용 ${won(c.해지비용)} + 재고이자 ${won(c.재고이자)}`}>${won(x.재반)}</td>${W(c.상품화비)}<td class="r"><b>${won(x.총원가)}</b></td>
        <td class="r" onClick=${e => e.stopPropagation()}>${c.sale ? (x.추가수익 ? html`<span title="할부수익 + 정산 기타매출">${won(x.추가수익)}</span>` : html`<span class="muted">-</span>`)
          : office ? html`<${Money} value=${price["x" + c.id] ?? c.extra_income ?? ""} placeholder="" style="width:84px" onInput=${v => typeField(c, "extra_income", "x" + c.id, v)} onKeyDown=${e => e.key === "Enter" && e.target.blur()} />` : (x.추가수익 ? won(x.추가수익) : "-")}</td>
        <td class="r" onClick=${e => e.stopPropagation()}>${c.sale ? html`<span title=${`매도금액 (매도비 ${won(x.매도비)} 별도)`}>${won(x.판매가)}</span>`
          : office ? html`<${Money} value=${x.예상 ? 0 : x.판매가 ?? 0} placeholder=${c.ad_price ? won(c.ad_price) : "입력"}
              title=${c.ad_price ? `엔카 광고가 ${won(c.ad_price)}원 (${String(c.ad_price_at || "").slice(5, 10)} 확인) — 비워 두면 이 값으로 예상마진` : "엔카 광고가 없음"}
              onInput=${v => typeField(c, "list_price", c.id, v)} onKeyDown=${e => e.key === "Enter" && e.target.blur()} />` : (x.판매가 ? won(x.판매가) : "-")}</td>
        <td class=${"r " + (x.마진 == null ? "muted" : x.마진 < 0 ? "red" : "blue") + (x.예상 ? " est" : "")}
          title=${(x.마진 == null ? "" : `${x.예상 ? "엔카 광고가" : "판매가"} ${won(x.판매가)} + 매도비 ${won(x.매도비)} + 추가수익 ${won(x.추가수익)} − 총원가 ${won(x.총원가)}
`) + (c.sale ? "" : `본전가 ${won(x.본전가)}원 — 이 아래로 팔면 손해`)}>
          ${x.마진 == null ? "-" : html`${x.예상 ? html`<small>예상 </small>` : ""}${won(x.마진)}`}</td>
        <td class="r">${c.status === "재고" ? days(c.purchase_date) : ""}</td>
        <td onClick=${e => e.stopPropagation()}>${c.status === "재고" && office ? html`<button class="btn sm primary" title="매도 등록 — 저장하면 매도차량으로 넘어갑니다" onClick=${() => go("/car/" + c.id + "/sale")}>매도</button>` : settleBadge(c)}</td></tr>`; })}</tbody></table></div>`}
    <p class="note">[매도]를 누르면 그 차의 매도 등록으로 가고, 저장하면 매도차량으로 넘어갑니다. 재반비용 = 취득세·광고비·수수료·성능비 등 + 재고이자 · 상품화비용 = 수리비 + 도색광택 + 탁송유류 · 총원가 = 매입가 + 재반비용 + 상품화비용 · 판매가는 매도비를 뺀 차값 (비워 두면 엔카 광고가로 회색 '예상' 마진) · 마진 = 판매가 + 매도비(기본 ${won(기본매도비)}) + 추가수익 − 총원가 · 마진에 마우스를 올리면 본전가(이 아래로 팔면 손해)가 보입니다. 판매가·추가수익은 칸에 바로 넣으면 저장되고(매도된 차는 실제 값), 마진 위에 마우스를 올리면 계산 내역이 보입니다.</p>`;
}

// ───────────────────────── 상품화비용 (차량별 / 비용별) ─────────────────────────
export function CostsPage({ app, tab = "car" }) {
  const [d] = useBook(app);
  const [f, setF] = useState(initF("매입일", "등록일"));
  const [item, setItem] = useState(null), [evid, setEvid] = useState(null), [by, setBy] = useState("전체");
  const [pick, setPick] = useState(false);
  const office = app.profile.role !== "dealer";
  const dealer = Object.fromEntries(app.dealers.map(x => [x.id, x.name]));
  if (!d) return html`<${Loading} />`;
  const head = html`<div class="bar"><h2>상품화비용</h2><span class="grow"></span>
      ${office && html`<button class="btn primary" onClick=${() => setPick(true)}>상품화비용 등록</button>`}</div>
    ${pick && html`<${CarPick} cars=${d.cars.filter(c => c.status === "재고")} label="상품화비용 등록" tab="costs" onClose=${() => setPick(false)} />`}
    <${SubTabs} base="/costs" tabs=${[["car", "차량별"], ["cost", "비용별"]]} cur=${tab} />`;
  if (tab === "cost") {
    const all = d.cars.flatMap(c => c.costs.map(k => ({ ...k, car: c, d: k.paid_date || c.purchase_date })));
    const rows = all.filter(k => match({ ...f, useDate: false }, k.car) && (!f.useDate || (k.d >= f.period.from && k.d <= f.period.to))
      && (!item || k.item === item) && (!evid || k.evidence === evid) && (by === "전체" || k.paid_by === by))
      .sort(sorter(f, (k, s) => ({ 등록일: k.created_at, 결제일: k.d, 금액: n(k.amount) }[s])));
    const sum = k => rows.reduce((t, r) => t + n(r[k]), 0);
    return html`${head}
      <${Filters} app=${app} f=${f} setF=${setF} dateKeys=${["결제일"]} sortKeys=${["등록일", "결제일", "금액"]}
        extra=${html`<${Select} value=${item} onChange=${setItem} empty="비용항목 전체" options=${[...new Set(all.map(k => k.item))]} />
          <${Select} value=${evid} onChange=${setEvid} empty="지출증빙 전체" options=${[...new Set(all.map(k => k.evidence).filter(Boolean))]} />
          <${Seg} value=${by} onChange=${setBy} options=${["전체", "딜러", "상사"]} />`} />
      <${Sum} rows=${[{ cells: ["구분", "건수", "상품화비용", "공급가", "부가세"], em: true },
        { cells: ["정산반영", rows.filter(r => r.include_in_settlement).length + "건", rows.filter(r => r.include_in_settlement).reduce((t, r) => t + n(r.amount), 0), rows.filter(r => r.include_in_settlement).reduce((t, r) => t + n(r.supply), 0), rows.filter(r => r.include_in_settlement).reduce((t, r) => t + n(r.vat), 0)] },
        { cells: ["합계", rows.length + "건", sum("amount"), sum("supply"), sum("vat")], em: true }]} />
      <div class="bar"><span class="grow"></span><button class="btn" onClick=${() => downloadCsv("상품화비용_비용별", [["차량번호", "매입담당", "비용항목", "지출구분", "과세구분", "금액", "공급가", "부가세", "정산반영", "결제일자", "등록일자", "지출증빙", "비고"],
        ...rows.map(k => [k.car.plate, dealer[k.car.dealer_id], k.item, k.paid_by, k.taxable ? "과세" : "비과세", k.amount, k.supply, k.vat, k.include_in_settlement ? "Y" : "N", k.d, k.created_at?.slice(0, 10), k.evidence, k.memo])])}>다운로드</button></div>
      ${!rows.length ? html`<${Empty}>조건에 맞는 비용이 없습니다.<//>` : html`<div class="table-wrap"><table class="grid click">
        <thead><tr><th>차량번호</th><th>매입담당</th><th>비용항목</th><th>지출구분</th><th>과세</th><th class="r">금액</th><th class="r">공급가</th><th class="r">부가세</th>
          <th>정산반영</th><th>결제일자</th><th>등록일자</th><th>지출증빙</th></tr></thead>
        <tbody>${rows.map(k => html`<tr onClick=${() => go(`/car/${k.car.id}/costs`)}><td><b>${k.car.plate}</b></td><td>${dealer[k.car.dealer_id] || "-"}</td>
          <td>${k.item}${k.auto_source && html` <span class="muted small">자동</span>`}</td><td>${k.paid_by}</td><td>${k.taxable ? "과세" : "비과세"}</td>
          ${W(k.amount)}${W(k.supply)}${W(k.vat)}<td>${k.include_in_settlement ? "Y" : html`<span class="muted">N</span>`}</td><td>${k.d}</td>
          <td>${k.created_at?.slice(0, 10)}</td><td>${k.evidence || ""}</td></tr>`)}</tbody></table></div>`}`;
  }
  const rows = d.cars.filter(c => c.상품화건수 && match(f, c, c.purchase_date)).sort(sorter(f, (c, s) => ({ 등록일: c.상품화최근, 결제일: c.purchase_date, 금액: c.상품화 }[s])));
  const 공 = c => c.costs.reduce((t, k) => t + n(k.supply), 0), 세 = c => c.costs.reduce((t, k) => t + n(k.vat), 0);
  return html`${head}
    <${Filters} app=${app} f=${f} setF=${setF} dateKeys=${["매입일"]} sortKeys=${["등록일", "금액"]} />
    <${Sum} rows=${[{ cells: ["구분", "건수", "상품화비용", "공급가", "부가세"], em: true },
      { cells: ["합계", rows.reduce((t, c) => t + c.상품화건수, 0) + "건 / " + rows.length + "대", rows.reduce((t, c) => t + c.상품화, 0), rows.reduce((t, c) => t + 공(c), 0), rows.reduce((t, c) => t + 세(c), 0)], em: true }]} />
    <div class="bar"><span class="grow"></span><button class="btn" onClick=${() => downloadCsv("상품화비용_차량별", [["차량번호", "매입담당", "차량명", "매입일", "매입가", "상품화건수", "최근등록일", "상품화금액", "공급가", "부가세", "상태", "매도일"],
      ...rows.map(c => [c.plate, dealer[c.dealer_id], c.car_name, c.purchase_date, c.purchase_amount, c.상품화건수, c.상품화최근, c.상품화, 공(c), 세(c), c.status, c.sale?.sale_date])])}>다운로드</button></div>
    ${!rows.length ? html`<${Empty}>상품화비용이 있는 차량이 없습니다.<//>` : html`<div class="table-wrap"><table class="grid click">
      <thead><tr><th>차량번호</th><th>매입담당</th><th>차량명</th><th>매입일</th><th class="r">매입가</th><th class="r">상품화건수</th><th>등록일자</th>
        <th class="r">상품화금액</th><th class="r">공급가</th><th class="r">부가세</th><th>상태</th><th>매도일</th></tr></thead>
      <tbody>${rows.map(c => html`<tr onClick=${() => go(`/car/${c.id}/costs`)}><td><b>${c.plate}</b></td><td>${dealer[c.dealer_id] || "-"}</td><td class="ellipsis">${c.car_name}</td>
        <td>${c.purchase_date}</td>${W(c.purchase_amount)}<td class="r">${c.상품화건수}</td><td>${c.상품화최근}</td>${W(c.상품화)}${W(공(c))}${W(세(c))}
        <td>${c.status}</td><td>${c.sale?.sale_date || ""}</td></tr>`)}</tbody></table></div>`}`;
}

// ───────────────────────── 재고금융 (리스트 / 이자납입 리스트) ─────────────────────────
function LenderLimits({ d }) {
  const t = today();
  const act = d.loans.filter(l => l.status === "진행중" && d.cars.some(c => c.id === l.car_id));
  return html`<div class="card"><h3>재고금융사 한도 현황</h3><div class="table-wrap"><table class="grid">
    <thead><tr><th>재고금융사</th><th class="r">총한도</th><th class="r">기존이용금액</th><th class="r">업무관리 이용금액</th><th class="r">잔여한도</th><th>이자납입일</th><th>사용률</th><th class="r">유효건수</th><th>최근이용차량</th></tr></thead>
    <tbody>${d.lenders.filter(l => n(l.credit_limit) || act.some(x => x.lender_id === l.id)).map(l => { const mine = act.filter(x => x.lender_id === l.id), used = mine.reduce((s, x) => s + n(x.amount) - n(x.principal_repaid), 0);
      const lim = n(l.credit_limit), u = used + n(l.existing_amount), pct = lim ? Math.round(u / lim * 100) : 0;
      const last = mine.sort((a, b) => b.start_date.localeCompare(a.start_date))[0]; const lc = last && d.cars.find(c => c.id === last.car_id);
      return html`<tr><td>${l.name}</td>${W(lim)}${W(l.existing_amount)}${W(used)}<td class=${"r" + (lim && lim - u < 0 ? " red" : "")}>${lim ? won(lim - u) : "-"}</td>
        <td>${l.interest_day ? `매월 ${l.interest_day}일` : "-"}</td><td>${lim ? html`<div class="bar-meter"><i class=${pct > 100 ? "over" : ""} style=${`width:${Math.min(100, pct)}%`}></i></div> <span class="small">${pct}%</span>` : ""}</td>
        <td class="r">${mine.length}</td><td class="small">${lc ? `${lc.plate} ${lc.car_name}` : ""}</td></tr>`; })}</tbody></table></div></div>`;
}

export function LoansPage({ app, tab = "lenders" }) {
  if (tab === "lenders") return html`<div class="bar"><h2>재고금융관리</h2></div>
    <${SubTabs} base="/loans" tabs=${loanTabs(app)} cur=${tab} />
    <${LenderOverview} app=${app} />`;
  if (tab === "installment") return html`<${InstallmentPerf} app=${app} />`;
  return html`<${LoansList} app=${app} tab=${tab} />`;
}
// '이자납입 리스트'는 딜러에게 받는 이자라 딜러가 있을 때만
const loanTabs = app => [["lenders", "금융사별 현황"], ["list", "재고금융 리스트"], ["installment", "할부실적"],
  ...(app.dealers.some(x => x.active && !x.partner) ? [["interest", "이자납입 리스트"]] : [])];

/** 할부실적 — 캐피탈사마다 할부를 얼마나 넣어 줬나 (수익이 아니라 할부금액이 핵심). 매도일 기준 */
function InstallmentPerf({ app }) {
  const [d] = useBook(app);
  const [period, setPeriod] = useState(() => initPeriod("월"));
  if (!d) return html`<${Loading} />`;
  const dealer = Object.fromEntries(app.dealers.map(x => [x.id, x.name]));
  const rows = d.cars.filter(c => c.sale && n(c.sale.installment_amount) > 0 && c.sale.sale_date >= period.from && c.sale.sale_date <= period.to)
    .sort((a, b) => b.sale.sale_date.localeCompare(a.sale.sale_date));
  const by = {};
  for (const c of rows) { const k = c.sale.installment_company || "(캐피탈사 미입력)"; const g = by[k] ||= { k, n: 0, amt: 0, fee: 0, inc: 0 };
    g.n++; g.amt += n(c.sale.installment_amount); g.fee += n(c.sale.installment_fee); g.inc += n(c.sale.installment_income); }
  const groups = Object.values(by).sort((a, b) => b.amt - a.amt), total = groups.reduce((t, g) => t + g.amt, 0);
  const csv = () => downloadCsv("할부실적", [["매도일", "차량번호", "차량명", "캐피탈사", "할부금액", "할부피(%)", "수수료", "수익(원천징수 후)", "매도담당"],
    ...rows.map(c => [c.sale.sale_date, c.plate, c.car_name, c.sale.installment_company || "", c.sale.installment_amount, Number(c.sale.installment_rate), c.sale.installment_fee, c.sale.installment_income, dealer[c.sale.dealer_id || c.dealer_id] || ""])]);
  return html`<div class="bar"><h2>재고금융관리</h2></div>
    <${SubTabs} base="/loans" tabs=${loanTabs(app)} cur="installment" />
    <div class="bar"><${Period} value=${period} onChange=${setPeriod} /><span class="muted small">매도일 기준 · 매도 화면 '할부 내용'에서 넣은 것</span><span class="grow"></span>
      <button class="btn" onClick=${csv}>다운로드</button></div>
    ${!rows.length ? html`<${Empty}>이 기간에 할부로 판 차가 없습니다.<//>` : html`
    <div class="table-wrap"><table class="grid"><thead><tr><th>캐피탈사</th><th class="r">건수</th><th class="r">할부금액</th><th>비중</th><th class="r">평균 할부피</th><th class="r">수익(원천징수 후)</th></tr></thead>
      <tbody>${groups.map(g => html`<tr><td><b>${g.k}</b></td><td class="r">${g.n}건</td><td class="r"><b>${won(g.amt)}</b></td>
        <td style="min-width:160px"><div class="statbar"><i style=${`width:${total ? Math.round(g.amt / total * 100) : 0}%`}></i></div></td>
        <td class="r">${g.amt ? (g.fee / g.amt * 100).toFixed(2) : "0"}%</td><td class="r">${won(g.inc)}</td></tr>`)}
        <tr class="em"><th>합계</th><td class="r">${rows.length}건</td><td class="r"><b>${won(total)}</b></td><td></td><td></td><td class="r">${won(groups.reduce((t, g) => t + g.inc, 0))}</td></tr></tbody></table></div>
    <div class="table-wrap"><table class="grid click"><thead><tr><th>매도일</th><th>차량번호</th><th>차량명</th><th>캐피탈사</th><th class="r">할부금액</th><th class="r">할부피</th><th class="r">수익</th><th>매도담당</th></tr></thead>
      <tbody>${rows.map(c => html`<tr onClick=${() => go("/car/" + c.id + "/sale")}><td>${c.sale.sale_date}</td><td><b>${c.plate}</b></td><td class="ellipsis">${c.car_name}</td>
        <td>${c.sale.installment_company || html`<span class="muted">미입력</span>`}</td>${W(c.sale.installment_amount)}<td class="r">${Number(c.sale.installment_rate)}%</td>${W(c.sale.installment_income)}
        <td>${dealer[c.sale.dealer_id || c.dealer_id] || "-"}</td></tr>`)}</tbody></table></div>`}
    <p class="note">할부실적은 번 돈보다 캐피탈사마다 할부를 얼마나 넣어 줬는지가 중요해서 할부금액 순으로 보여 줍니다. 대장에서 옮긴 과거 판매는 할부금액·캐피탈사 기록이 없어 여기 안 나옵니다(할부 수익만 손익에 들어가 있음).</p>`;
}

function LoansList({ app, tab }) {
  const [d, reload] = useBook(app);
  const [f, setF] = useState(initF("실행일", "실행일"));
  const [state, setState] = useState("전체");
  const [pick, setPick] = useState(false);
  const office = app.profile.role !== "dealer";
  const dealer = Object.fromEntries(app.dealers.map(x => [x.id, x.name]));
  if (!d) return html`<${Loading} />`;
  const lender = Object.fromEntries(d.lenders.map(l => [l.id, l.name]));
  const loans = d.cars.flatMap(c => c.loans.map(l => {
    const ps = d.payments.filter(p => p.loan_id === l.id).sort((a, b) => a.paid_date.localeCompare(b.paid_date));
    const paid = ps.reduce((t, p) => t + n(p.amount), 0), di = 대출이자(l.amount, l.dealer_rate, l.months);
    const st = 대출상태(l, today());
    const 이자 = 재고금융이자(l, l.start_date, l.repaid_date || today()), 일이자 = Math.round(st.원금잔액 * (Number(st.연장됨 && l.ext_rate != null ? l.ext_rate : l.lender_rate) || 0) / 100 / 365);
    return { ...l, car: c, ps, paid, 이자, 캐피탈일이자: 일이자, 잔액: st.원금잔액, 만기: st.만기, 단계: st.단계, 할일: 할일(l, d.lenders.find(x => x.id === l.lender_id), today()), 최근납입: ps.at(-1)?.paid_date || "", ...di,
      미납: l.status === "진행중" ? 미납이자({ 대출금액: l.amount, 딜러이율: l.dealer_rate, 개월: l.months, 실행일: l.start_date, 납입이자누계: paid }, today()) : 0 };
  })).filter(l => match(f, l.car, l.start_date) && (state === "전체" || l.status === state)).sort(sorter(f, (l, s) => ({ 실행일: l.start_date, 대출금액: n(l.amount), 만기일: l.만기 }[s])));
  const head = html`<div class="bar"><h2>재고금융관리</h2><span class="grow"></span>
      ${office && html`<button class="btn primary" onClick=${() => setPick(true)}>재고금융 등록</button>`}</div>
    ${pick && html`<${CarPick} cars=${d.cars.filter(c => c.status === "재고")} label="재고금융 등록" tab="loans" onClose=${() => setPick(false)} />`}
    <${SubTabs} base="/loans" tabs=${loanTabs(app)} cur=${tab} />
    <${Filters} app=${app} f=${f} setF=${setF} dateKeys=${["실행일"]} sortKeys=${["실행일", "대출금액", "만기일"]}
      extra=${html`<${Seg} value=${state} onChange=${setState} options=${["전체", "진행중", "상환완료"]} />`} />`;
  if (tab === "interest") {
    const rows = loans.flatMap(l => l.ps.length ? l.ps.map(p => ({ l, p })) : [{ l, p: null }]);
    return html`${head}
      <div class="bar"><span class="grow"></span><button class="btn" onClick=${() => downloadCsv("이자납입", [["차량번호", "매입담당", "재고금융사", "대출금액", "실행일", "대출기간", "딜러이율", "일이자", "월이자", "총이자", "납입이자", "이자납일", "총납입이자", "진행상태"],
        ...rows.map(({ l, p }) => [l.car.plate, dealer[l.car.dealer_id], lender[l.lender_id], l.amount, l.start_date, l.months, l.dealer_rate, l.일이자, l.월이자, l.총이자, p?.amount || 0, p?.paid_date || "", l.paid, l.status])])}>다운로드</button></div>
      ${!rows.length ? html`<${Empty}>이자납입 기록이 없습니다.<//>` : html`<div class="table-wrap"><table class="grid click">
        <thead><tr><th>차량번호</th><th>매입담당</th><th>재고금융사</th><th class="r">대출금액</th><th>실행일</th><th class="r">기간</th><th class="r">딜러이율</th>
          <th class="r">일이자</th><th class="r">월이자</th><th class="r">총이자</th><th class="r">납입이자</th><th>이자납일</th><th class="r">총납입이자</th><th>상태</th></tr></thead>
        <tbody>${rows.map(({ l, p }) => html`<tr onClick=${() => go(`/car/${l.car.id}/loans`)}><td><b>${l.car.plate}</b></td><td>${dealer[l.car.dealer_id] || "-"}</td><td>${lender[l.lender_id]}</td>
          ${W(l.amount)}<td>${l.start_date}</td><td class="r">${l.months}개월</td><td class="r">${l.dealer_rate}%</td>${W(l.일이자)}${W(l.월이자)}${W(l.총이자)}
          ${W(p?.amount || 0)}<td>${p?.paid_date || html`<span class="muted">납입 없음</span>`}</td>${W(l.paid)}<td>${l.status}</td></tr>`)}</tbody></table></div>`}
      <${LenderLimits} d=${d} />`;
  }
  const sum = k => loans.reduce((t, l) => t + n(l[k]), 0);
  const hasDealer = app.dealers.some(x => x.active && !x.partner);
  return html`${head}
    <div class="bar"><span class="grow"></span><button class="btn" onClick=${() => downloadCsv("재고금융", [["차량번호", "매입담당", "차량명", "재고금융사", "대출금액", "잔액", "실행일", "대출기간", "만기일", "할 일", "이율", "일이자", "이자(오늘까지)", "상태"],
      ...loans.map(l => [l.car.plate, dealer[l.car.dealer_id], l.car.car_name, lender[l.lender_id], l.amount, l.잔액, l.start_date, l.months, l.만기, l.할일.text, l.lender_rate, l.캐피탈일이자, l.이자, l.status])])}>다운로드</button></div>
    ${!loans.length ? html`<${Empty}>조건에 맞는 재고금융이 없습니다.<//>` : html`<div class="table-wrap"><table class="grid click">
      <thead><tr><th>차량번호</th><th>매입담당</th><th>재고금융사</th><th class="r">대출(잔액)</th><th>실행일</th><th class="r">기간</th><th>만기일</th><th>상태·할 일</th>
        <th class="r">일이자</th><th class="r" title="실행일부터 오늘까지(상환했으면 상환일까지) 일할, 금융사 조건 반영">이자(오늘까지)</th>${hasDealer && html`<th class="r">딜러 미납이자</th>`}<th></th></tr></thead>
      <tbody>${loans.map(l => html`<tr onClick=${() => go(`/car/${l.car.id}/loans`)}><td><b>${l.car.plate}</b></td><td>${dealer[l.car.dealer_id] || "-"}</td>
        <td>${lender[l.lender_id]}</td>${W(l.잔액)}<td>${l.start_date}</td><td class="r">${l.months}개월</td>
        <td class=${l.status === "진행중" && l.만기 < today() ? "red" : ""}>${l.만기}</td><td><span class=${"badge " + l.할일.tone}>${l.할일.text}</span></td>${W(l.캐피탈일이자)}${W(l.이자)}${hasDealer && W(l.미납, "red")}
        <td><${LoanAction} app=${app} l=${l} lender=${d.lenders.find(x => x.id === l.lender_id)} onDone=${reload} /></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="3">${loans.length}건</td><td class="r">${won(sum("잔액"))}</td><td colspan="4"></td><td class="r">${won(sum("캐피탈일이자"))}</td>
        <td class="r">${won(sum("이자"))}</td>${hasDealer && html`<td class="r">${won(sum("미납"))}</td>`}<td></td></tr></tfoot></table></div>`}
    <${LenderLimits} d=${d} />`;
}

// ───────────────────────── 매도차량 리스트 ─────────────────────────
export function SalesPage({ app }) {
  const [d] = useBook(app);
  // 기본은 최근 1개월 매도분만 — '기간'을 끄거나 바꾸면 전체·원하는 기간
  const [f, setF] = useState(() => { const t = today(), d = new Date(t + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1);
    return { ...initF("매도일", "매도일"), useDate: !loadQ(),   // 검색어를 들고 돌아왔으면 기간 없이 (예전에 판 차도 보이게)
      period: { ...initPeriod("직접"), mode: "직접", from: d.toISOString().slice(0, 10), to: t } }; });
  const [pick, setPick] = useState(false);
  const office = app.profile.role !== "dealer";
  const dealer = Object.fromEntries(app.dealers.map(x => [x.id, x.name]));
  if (!d) return html`<${Loading} />`;
  const rows = d.cars.filter(c => c.sale && match(f, c, c.sale.sale_date)).sort(sorter(f, (c, s) => ({ 매도일: c.sale.sale_date, 매도금액: n(c.sale.sale_amount), 매입일: c.purchase_date }[s])));
  // 총마진 = 매도금액 + 매도비 + 추가수익(할부수익 + 정산 기타매출) − (매입가 + 비용 전체 + 재고이자) — 차량 리스트 마진과 같은 식
  const yr = c => c.model_year ? String(c.model_year).slice(0, 4) : "";
  const 마진 = c => n(c.sale.sale_amount) + n(c.sale.sale_fee) + n(c.sale.installment_income) + (c.settle?.other_revenue || []).reduce((t, x) => t + n(x.금액), 0)
    - n(c.purchase_amount) - c.상품화 - c.재고이자 - c.해지비용;
  const tot = k => rows.reduce((t, c) => t + n(k(c)), 0);
  return html`<div class="bar"><h2>매도차량 리스트</h2><span class="grow"></span>
      <button class="btn" onClick=${() => downloadCsv("매도차량", [["매입일", "차량번호", "차명", "연식", "키로수", "판매유형", "매도담당", "알선딜러", "매입가", "재고금융금액", "총납입이자", "상품화비용", "매도금액", "상사매도비", "성능보험료", "매도일", "총마진", "매출발행일", "정산일"],
        ...rows.map(c => [c.purchase_date, c.plate, c.car_name, yr(c), c.mileage ?? "", c.sale.sale_type, dealer[c.sale.dealer_id || c.dealer_id], dealer[c.sale.broker_dealer_id] || "", c.purchase_amount, c.재고금융전체, c.재고이자, c.상품화,
          c.sale.sale_amount, c.sale.sale_fee, c.sale.perf_insurance, c.sale.sale_date, 마진(c), c.매출발행일, c.settle?.settle_date])])}>다운로드</button>
      ${office && html`<button class="btn primary" onClick=${() => setPick(true)}>매도차량 등록</button>`}</div>
    ${pick && html`<${CarPick} cars=${d.cars.filter(c => c.status === "재고")} label="매도 등록" tab="sale" onClose=${() => setPick(false)} />`}
    <${Filters} app=${app} f=${f} setF=${setF} dateKeys=${["매도일"]} sortKeys=${["매도일", "매도금액", "매입일"]} />
    <${Sum} rows=${[{ cells: ["합계", "건수", "매입가", "재고금융", "총납입이자", "매도금액", "상사매도비", "성능보험료", "총마진"], em: true },
      { cells: ["", rows.length + "대", tot(c => c.purchase_amount), tot(c => c.재고금융전체), tot(c => c.재고이자), tot(c => c.sale.sale_amount), tot(c => c.sale.sale_fee), tot(c => c.sale.perf_insurance), tot(마진)] }]} />
    ${!rows.length ? html`<${Empty}>조건에 맞는 매도 차량이 없습니다.<//>` : html`<div class="table-wrap"><table class="grid click carlist">
      <thead><tr><th>매입일</th><th>차량번호</th><th>차명</th><th>연식</th><th class="r">키로수</th><th>판매유형</th><th>매도담당</th><th class="r">매입가</th><th class="r">재고금융</th><th class="r" title="매입일부터 매도일(상환일)까지 자동계산">총납입이자</th>
        <th class="r">상품화비용</th><th class="r">매도금액</th><th class="r">상사매도비</th><th class="r">성능보험료</th><th>매도일</th><th class="r" title="매도금액 + 매도비 + 추가수익(할부수익·기타매출) − 매입가 − 비용 − 재고이자">총마진</th><th title="(일부) 매출 발행일">매출발행</th><th title="(임시) 정산일">정산일</th></tr></thead>
      <tbody>${rows.map(c => html`<tr onClick=${() => go(`/car/${c.id}/sale`)}><td>${c.purchase_date}</td><td><b>${c.plate}</b></td>
        <td class="ellipsis" title=${c.car_name}>${c.car_name}</td><td>${yr(c) || "-"}</td><td class="r">${c.mileage != null ? won(c.mileage) : "-"}</td><td>${c.sale.sale_type}</td>
        <td>${dealer[c.sale.dealer_id || c.dealer_id] || "-"}${c.sale.broker_dealer_id ? html`<br /><span class="muted small">알선 ${dealer[c.sale.broker_dealer_id]}</span>` : ""}</td>
        ${W(c.purchase_amount)}${W(c.재고금융전체)}${W(c.재고이자)}${W(c.상품화)}${W(c.sale.sale_amount)}${W(c.sale.sale_fee)}${W(c.sale.perf_insurance)}
        <td>${c.sale.sale_date}</td><td class=${"r " + (마진(c) < 0 ? "red" : "blue")}><b>${won(마진(c))}</b></td><td>${c.매출발행일}</td><td>${c.settle ? html`${c.settle.settle_date}${!c.settle.finalized && html` <span class="badge amber">임시</span>`}` : ""}</td></tr>`)}</tbody></table></div>`}`;
}
