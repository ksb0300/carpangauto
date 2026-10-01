// 매출·발행: 발행대기 모아보기 / 발행현황(기간·종류·상태) / 건별 새로 발행
import { html, useState, useEffect, useMemo, Seg, Loading, run, won, toast, ask, Period, initPeriod, SubTabs, downloadCsv } from "../ui.js";
import { q } from "../db.js";
import { DocTable, DocForm, issueMany } from "./docs-ui.js";
import { PB_NOTE } from "../pb.js";

const TABS = [["wait", "발행대기"], ["status", "발행현황"], ["new", "새로 발행"]];

export function IssuePage({ app, tab = "wait" }) {
  const [docs, setDocs] = useState(null);
  const [cars, setCars] = useState({});
  const [period, setPeriod] = useState(initPeriod("월"));
  const [kind, setKind] = useState("전체");
  const [state, setState] = useState("전체");
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const load = () => run(async () => {
    const [d, c] = await Promise.all([
      tab === "wait" ? q(app.db.from("issue_docs").select("*").in("status", ["대기", "실패"]).order("trade_date"))
                     : q(app.db.from("issue_docs").select("*").gte("trade_date", period.from).lte("trade_date", period.to).order("trade_date")),
      q(app.db.from("cars").select("id,plate,car_name")),
    ]);
    setDocs(d); setCars(Object.fromEntries(c.map(x => [x.id, x])));
  });
  useEffect(() => { if (tab !== "new") load(); }, [tab, period.from, period.to]);

  const shown = useMemo(() => (docs || []).filter(d => (kind === "전체" || d.doc_type === kind) && (state === "전체" || d.status === state)), [docs, kind, state]);
  const sum = (rs, k) => rs.reduce((t, d) => t + Number(d[k] || 0), 0);
  const issued = shown.filter(d => d.status === "발행");

  const issueSel = async () => {
    const list = shown.filter(d => sel.has(d.id) && ["대기", "실패"].includes(d.status));
    if (!list.length) return toast("발행할 문서를 고르세요.", "err");
    if (!ask(`${list.length}건 (${won(sum(list, "amount"))}원)을 발행할까요? 국세청으로 전송됩니다.`)) return;
    setBusy(true); await issueMany(app, list); setBusy(false); setSel(new Set()); load();
  };
  const csv = () => downloadCsv("발행현황", [
    ["거래일", "종류", "용도/구분", "상태", "발행방법", "차량", "항목", "상대방", "식별/사업자번호", "금액", "공급가", "부가세", "승인번호", "취소승인번호", "문서번호"],
    ...shown.map(d => [d.trade_date, d.doc_type, d.usage || d.purpose, d.status, d.issued_via, cars[d.car_id]?.plate, d.item_name,
      d.corp_name || d.customer_name, d.identity || d.biz_no, d.amount, d.supply, d.vat, d.confirm_num, d.cancel_confirm_num, d.mgt_key]),
  ]);

  return html`<div class="bar"><h2>매출·발행</h2><span class="muted small">${PB_NOTE}</span></div>
    <${SubTabs} base="/issue" tabs=${TABS} cur=${tab} />
    ${tab === "new" ? html`<div class="card"><h3>건별 발행</h3>
        <p class="note">차량과 무관한 매출(잡수입, 알선 등)이나 차량 화면 밖에서 발행할 때 씁니다. 차량 매출은 차량 → 매출증빙 탭이 편합니다.</p>
        <${DocForm} app=${app} onDone=${d => d && (location.hash = "/issue/" + (d.status === "발행" ? "status" : "wait"))} /></div>`
    : html`
    <div class="bar">
      ${tab === "status" && html`<${Period} value=${period} onChange=${setPeriod} />`}
      <${Seg} value=${kind} onChange=${setKind} options=${["전체", "현금영수증", "세금계산서"]} />
      ${tab === "status" && html`<${Seg} value=${state} onChange=${setState} options=${["전체", "대기", "발행", "취소", "실패"]} />`}
      <span class="grow"></span>
      ${tab === "wait" && html`<button class="btn primary" disabled=${busy} onClick=${issueSel}>선택 발행</button>`}
      ${tab === "status" && html`<button class="btn" disabled=${!shown.length} onClick=${csv}>엑셀(CSV)</button>`}
    </div>
    ${!docs ? html`<${Loading} />` : html`
      ${tab === "status" && html`<div class="stat-grid">
        <div class="stat"><span>발행 건수</span><b>${issued.length}</b><small>현금영수증 ${issued.filter(d => d.doc_type === "현금영수증").length} · 세금계산서 ${issued.filter(d => d.doc_type === "세금계산서").length}</small></div>
        <div class="stat"><span>발행 금액</span><b>${won(sum(issued, "amount"))}</b><small>공급가 ${won(sum(issued, "supply"))} · 부가세 ${won(sum(issued, "vat"))}</small></div>
        <div class="stat ${shown.some(d => d.status === "실패") ? "bad" : ""}"><span>대기·실패</span><b>${shown.filter(d => ["대기", "실패"].includes(d.status)).length}</b></div>
        <div class="stat"><span>취소</span><b>${shown.filter(d => d.status === "취소").length}</b></div>
      </div>`}
      <${DocTable} app=${app} docs=${shown} reload=${load} showCar cars=${cars} select=${tab === "wait" ? [sel, setSel] : null} />`}`}`;
}
