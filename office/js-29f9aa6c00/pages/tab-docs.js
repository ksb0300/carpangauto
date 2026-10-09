// 차량 상세 → 매출증빙: 이 차에서 나갈 현금영수증·세금계산서를 정하고 발행한다.
// 매도정보(차량대금·상사매도비·성능보험료)는 매수자별 결제비율로 나누고, 상사매입비는 딜러 앞으로.
import { html, useState, useEffect, Select, run, won, toast, ask } from "../ui.js";
import { q } from "../db.js";
import { DocTable, DocForm, issueMany } from "./docs-ui.js";
import { PB_NOTE } from "../pb.js";

const EVID = ["현금영수증", "세금계산서", "카드결제", "발행안함"];
const digits = s => String(s || "").replace(/\D/g, "");

export function planLines({ car, sale, buyers, dealer, settings }) {
  const plan = sale.evidence_plan || {};
  const rate = b => Number(sale.pay_shares?.[b.id] ?? b.share_rate) || 0;
  const split = amount => {
    let left = Number(amount) || 0;
    return buyers.map((b, i) => {
      const a = i === buyers.length - 1 ? left : Math.round((Number(amount) || 0) * rate(b) / 100);
      left -= a; return { buyer: b, amount: a };
    }).filter(x => x.amount > 0);
  };
  const def = b => (digits(b?.biz_no).length === 10 ? "세금계산서" : "현금영수증");
  const lines = [];
  const push = (source, taxable, parts) => parts.forEach(p => lines.push({ source, taxable, ...p,
    evidence: plan[source] || (source === "상사매입비" ? "현금영수증" : def(p.buyer)) }));
  if (car.consign === "상사매입") push("차량대금", true, split(sale.sale_amount));
  push("상사매도비", true, split(sale.sale_fee));
  push("성능보험료", false, split(sale.perf_insurance));
  if (Number(car.purchase_fee) > 0) push("상사매입비", true, [{ dealer, amount: Number(car.purchase_fee) }]);
  // 합산 발행: 같은 사람·현금영수증·과세 항목을 한 장으로
  if (settings.cash_issue_form === "합산") {
    const merged = [], key = l => l.buyer?.id;
    for (const l of lines) {
      const m = l.buyer && l.evidence === "현금영수증" && l.taxable && merged.find(x => key(x) === key(l) && x.evidence === "현금영수증" && x.taxable && x.buyer);
      if (m) { m.amount += l.amount; m.parts.push(l.source); } else merged.push({ ...l, parts: [l.source] });
    }
    return merged;
  }
  return lines.map(l => ({ ...l, parts: [l.source] }));
}

const sameTarget = (d, l) => d.source === l.source && (d.buyer_id || null) === (l.buyer?.id || null) && d.status !== "취소";

export function DocsTab({ app, car, sale, buyers, reload, office }) {
  const [docs, setDocs] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => run(async () => setDocs(await q(app.db.from("issue_docs").select("*").eq("car_id", car.id).order("created_at"))));
  useEffect(() => { load(); }, [car.id]);
  if (!docs) return null;

  const dealer = app.dealers.find(d => d.id === (sale?.dealer_id || car.dealer_id));
  const lines = sale ? planLines({ car, sale, buyers, dealer, settings: app.settings }) : [];
  const savePlan = (sources, v) => run(async () => {
    const next = { ...(sale.evidence_plan || {}) }; for (const s of sources) next[s] = v;
    await q(app.db.from("car_sales").update({ evidence_plan: next }).eq("car_id", car.id));
    reload();
  });
  const saveShare = (b, v) => run(async () => {
    await q(app.db.from("car_sales").update({ pay_shares: { ...(sale.pay_shares || {}), [b.id]: Number(v) || 0 } }).eq("car_id", car.id));
    reload();
  });
  const shareSum = buyers.reduce((s, b) => s + (Number(sale?.pay_shares?.[b.id] ?? b.share_rate) || 0), 0);

  const todo = lines.filter(l => ["현금영수증", "세금계산서"].includes(l.evidence) && !docs.some(d => sameTarget(d, l)));
  const create = async () => {
    if (Math.abs(shareSum - 100) > 0.001) return toast(`결제비율 합계가 100%가 아닙니다 (${shareSum}%).`, "err");
    setBusy(true);
    await run(async () => {
      for (const l of todo) {
        const who = l.buyer || l.dealer || {};
        const biz = digits(who.biz_no), phone = digits(who.phone);
        const base = { car_id: car.id, buyer_id: l.buyer?.id || null, dealer_id: l.dealer?.id || null, source: l.source,
          trade_date: sale.sale_date, taxable: l.taxable, amount: l.amount,
          item_name: (l.parts.length > 1 ? l.parts.join("·") : l.source === "차량대금" ? "중고자동차 매매대금" : l.source) + ` (${car.plate})`,
          customer_name: who.name || null, phone: who.phone || null };
        if (l.evidence === "현금영수증")
          await q(app.db.from("issue_docs").insert({ ...base, doc_type: "현금영수증", usage: biz.length === 10 ? "지출증빙용" : "소득공제용",
            identity: biz.length === 10 ? biz : phone || null }));
        else
          await q(app.db.from("issue_docs").insert({ ...base, doc_type: "세금계산서", biz_no: biz || null, corp_name: who.name || null,
            addr: who.addr || who.address || null, email: who.email || null }));
      }
    }, `발행대기 ${todo.length}건을 만들었습니다`);
    setBusy(false); load();
  };
  const pending = docs.filter(d => ["대기", "실패"].includes(d.status));
  const issueSel = async () => {
    const list = pending.filter(d => sel.has(d.id));
    if (!list.length) return toast("발행할 문서를 고르세요.", "err");
    if (!ask(`${list.length}건을 발행할까요? 국세청으로 전송됩니다.`)) return;
    setBusy(true); await issueMany(app, list); setBusy(false); setSel(new Set()); load();
  };

  return html`<div class="card">
    <div class="bar"><h3>매출증빙</h3><span class="muted small">${PB_NOTE}</span><span class="grow"></span>
      ${office && html`<button class="btn" onClick=${() => setAdding(true)}>+ 문서 직접 추가</button>`}</div>
    ${!sale ? html`<p class="muted">매도 처리 후 매출증빙을 정할 수 있습니다. 직접 추가는 언제든 됩니다.</p>` : html`
      <h4>발행할 항목 <span class="muted small">— 설정의 현금영수증 발행형태: ${app.settings.cash_issue_form === "합산" ? "합산 1장" : "항목별"}</span></h4>
      ${buyers.length > 1 && html`<div class="row line small">결제비율:
        ${buyers.map(b => html`<span class="check">${b.name} <input class="w80" inputmode="decimal" disabled=${!office}
          value=${sale.pay_shares?.[b.id] ?? b.share_rate} onChange=${e => saveShare(b, e.target.value)} />%</span>`)}
        <span class=${Math.abs(shareSum - 100) > 0.001 ? "red" : "muted"}>합계 ${shareSum}%</span></div>`}
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>항목</th><th>대상</th><th>식별·사업자번호</th><th class="r">금액</th><th>과세</th><th>증빙</th><th>문서</th></tr></thead>
        <tbody>${lines.map(l => {
          const who = l.buyer || l.dealer; const has = docs.find(d => sameTarget(d, l));
          return html`<tr><td>${l.parts.join(" + ")}</td><td>${who?.name || "-"}${l.dealer && html` <span class="muted small">딜러</span>`}</td>
            <td class="small">${who?.biz_no || who?.phone || html`<span class="red">없음</span>`}</td>
            <td class="r">${won(l.amount)}</td><td>${l.taxable ? "과세" : "면세"}</td>
            <td>${office && !has ? html`<${Select} value=${l.evidence} onChange=${v => savePlan(l.parts, v)} options=${EVID} />` : l.evidence}</td>
            <td>${has ? html`<span class="small">${has.doc_type} ${has.status}</span>` : ["카드결제", "발행안함"].includes(l.evidence) ? html`<span class="muted small">해당없음</span>` : html`<span class="amber small">미작성</span>`}</td></tr>`;
        })}</tbody></table></div>
      ${office && html`<div class="actions"><button class="btn primary" disabled=${busy || !todo.length} onClick=${create}>
        ${todo.length ? `발행대기 ${todo.length}건 만들기` : "만들 항목 없음"}</button></div>`}
      <p class="note">현금영수증 식별번호는 매수자의 <b>휴대폰</b>(개인) 또는 <b>사업자번호</b>(지출증빙)를 씁니다 — 매도 탭에서 연락처를 넣어 두세요.
        중고차 매매업은 현금 10만원 이상 거래 시 현금영수증 의무발행 업종입니다.</p>`}
    ${adding && html`<${DocForm} app=${app} init=${{ car_id: car.id, item_name: "", ...(sale ? { trade_date: sale.sale_date } : {}) }} onDone=${() => { setAdding(false); load(); }} />`}
    <div class="bar" style="margin-top:14px"><h4>이 차량의 문서</h4><span class="grow"></span>
      ${office && pending.length > 0 && html`<button class="btn primary" disabled=${busy} onClick=${issueSel}>선택 ${[...sel].filter(id => pending.some(d => d.id === id)).length}건 발행</button>`}</div>
    <${DocTable} app=${app} docs=${docs} reload=${load} select=${office ? [sel, setSel] : null} />
  </div>`;
}
