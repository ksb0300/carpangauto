// 타상사 알선매도: 알선수수료에서 공제비용·세액(13.3%)을 빼 딜러지급액을 정하고, 필요하면 증빙을 발행한다.
// 똑순이는 '등록과 동시에 발행'이 기본으로 켜져 있어 실수 신고 위험이 있었다 → 여기서는 기본 꺼짐.
import { html, useState, useEffect, useMemo, Money, Field, Select, Seg, Loading, Empty, run, won, today, toast, ask, Period, initPeriod, downloadCsv, W } from "../ui.js";
import { q } from "../db.js";
import { 알선정산 } from "../calc.js";
import { DocForm } from "./docs-ui.js";

export function BrokeragePage({ app }) {
  const [rows, setRows] = useState(null);
  const [period, setPeriod] = useState(initPeriod("월"));
  const [edit, setEdit] = useState(null);
  const [doc, setDoc] = useState(null);
  const [dealerF, setDealerF] = useState(null);
  const office = app.profile.role !== "dealer";
  const dealer = Object.fromEntries(app.dealers.map(d => [d.id, d]));
  const load = () => run(async () => setRows(await q(app.db.from("brokerages").select("*")
    .gte("sale_date", period.from).lte("sale_date", period.to).order("sale_date", { ascending: false }))));
  useEffect(() => { load(); }, [period.from, period.to]);

  const all = rows;
  const shown = (all || []).filter(r => !dealerF || r.dealer_id === dealerF);
  const sum = k => shown.reduce((t, r) => t + Number(r[k] || 0), 0);
  return html`<div class="bar"><h2>타상사알선매도 관리</h2><span class="muted">알선매도일</span><${Period} value=${period} onChange=${setPeriod} />
      ${office && html`<${Select} value=${dealerF} onChange=${setDealerF} empty="알선딜러 전체" options=${app.dealers.map(d => [d.id, d.name])} />`}<span class="grow"></span>
      ${rows?.length > 0 && html`<button class="btn" onClick=${() => downloadCsv("알선매출", [["알선일", "딜러", "항목", "차량", "고객/상사", "타상사딜러", "수수료", "공제비용", "세액", "딜러지급", "원천", "방식", "증빙"],
        ...rows.map(r => [r.sale_date, dealer[r.dealer_id]?.name, r.item, [r.plate, r.car_name].filter(Boolean).join(" "), r.customer_name, r.other_dealer,
          r.fee, r.deduct_cost, r.tax_total, r.payout, r.withholding ? "대상" : "미대상", r.method, r.evidence])])}>엑셀(CSV)</button>`}
      ${office && html`<button class="btn primary" onClick=${() => setEdit({})}>+ 알선 등록</button>`}</div>
    ${edit && html`<${BrokerageForm} app=${app} init=${edit} onDone=${saved => { setEdit(null); load(); if (saved?.issueNow) setDoc(saved); }} />`}
    ${doc && html`<div class="card"><h3>알선 증빙 발행 — ${doc.customer_name || ""}</h3>
      <${DocForm} app=${app} init=${{ source: "알선수수료", brokerage_id: doc.id, amount: Number(doc.fee), item_name: `${doc.item} ${doc.plate || ""}`.trim(),
        trade_date: doc.sale_date, doc_type: doc.evidence === "세금계산서" ? "세금계산서" : "현금영수증", customer_name: doc.customer_name || "",
        corp_name: doc.customer_name || "", identity: doc.phone || "", phone: doc.phone || "" }} onDone=${() => setDoc(null)} /></div>`}
    ${all && all.length > 0 && html`<div class="table-wrap"><table class="grid sumtable"><thead><tr><th>합계표</th><th class="r">건수</th><th class="r">합계금액</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">딜러지급액</th></tr></thead>
      <tbody><tr><th>합계</th><td class="r">${shown.length}</td>${W(sum("fee"))}${W(sum("supply"))}${W(sum("tax_total"))}${W(sum("payout"))}</tr></tbody></table></div>`}
    ${!all ? html`<${Loading} />` : !shown.length ? html`<${Empty}>이 기간 알선 건이 없습니다.<//>` : html`
    <div class="table-wrap"><table class=${"grid" + (office ? " click" : "")}>
      <thead><tr><th>알선일</th><th>담당</th><th>항목</th><th>차량</th><th>고객/상사</th><th class="r">수수료</th><th class="r">공제</th>
        <th class="r">세액</th><th class="r">딜러지급</th><th>증빙</th>${office && html`<th></th>`}</tr></thead>
      <tbody>${shown.map(r => html`<tr onClick=${() => office && setEdit(r)}>
        <td>${r.sale_date}</td><td>${dealer[r.dealer_id]?.name || "-"}</td><td>${r.item}</td>
        <td>${[r.plate, r.car_name].filter(Boolean).join(" ") || "-"}</td><td>${r.customer_name || "-"}${r.other_dealer ? html` <span class="muted small">(${r.other_dealer})</span>` : ""}</td>
        <td class="r">${won(r.fee)}</td><td class="r">${won(r.deduct_cost)}</td><td class="r">${won(r.tax_total)}</td><td class="r"><b>${won(r.payout)}</b></td>
        <td>${r.evidence}</td>
        ${office && html`<td onClick=${e => e.stopPropagation()}>${r.evidence !== "미발행" && r.evidence !== "카드" &&
          html`<button class="btn sm" onClick=${() => setDoc(r)}>증빙 발행</button>`}</td>`}</tr>`)}</tbody>
      <tfoot><tr><td colspan="5">${shown.length}건</td><td class="r">${won(sum("fee"))}</td><td class="r">${won(sum("deduct_cost"))}</td>
        <td class="r">${won(sum("tax_total"))}</td><td class="r">${won(sum("payout"))}</td><td colspan=${office ? 2 : 1}></td></tr></tfoot>
    </table></div>`}`;
}

function BrokerageForm({ app, init, onDone }) {
  const dealerOf = id => app.dealers.find(d => d.id === id);
  const first = app.dealers.find(d => d.active);
  const [f, setF] = useState({ dealer_id: first?.id, item: "알선수수료", sale_date: today(), plate: "", car_name: "", customer_name: "",
    other_dealer: "", phone: "", fee: 0, deduct_cost: 0, withholding: dealerOf(first?.id)?.kind === "개인", method: app.settings.settle_method,
    evidence: "미발행", memo: "", ...init });
  const [issueNow, setIssueNow] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v?.target ? v.target.value : v }));
  // 공동대표가 한 알선은 딜러 지급·원천징수 없이 전액 회사 수익 (대표 실적에 알선수익으로 잡힌다)
  const partner = !!dealerOf(f.dealer_id)?.partner;
  const r0 = 알선정산({ 수수료: f.fee, 공제비용: f.deduct_cost, 원천징수대상: !partner && f.withholding, 방식: f.method });
  const r = partner ? { ...r0, 소득세: 0, 지방세: 0, 세액: 0, 지급액: 0 } : r0;

  const save = async e => {
    e.preventDefault();
    if (!f.fee) return toast("알선수수료를 입력하세요.", "err");
    const row = { dealer_id: f.dealer_id, item: f.item, sale_date: f.sale_date, plate: f.plate || null, car_name: f.car_name || null,
      customer_name: f.customer_name || null, other_dealer: f.other_dealer || null, phone: f.phone || null, fee: f.fee, deduct_cost: f.deduct_cost || 0,
      withholding: !partner && f.withholding, method: f.method, evidence: f.evidence, memo: f.memo || null,
      base_amount: r.기준, supply: r.공급가, vat: r.부가세, income_tax: r.소득세, local_tax: r.지방세, tax_total: r.세액, payout: r.지급액 };
    const saved = await run(() => q(f.id ? app.db.from("brokerages").update(row).eq("id", f.id).select("*").single()
                                         : app.db.from("brokerages").insert(row).select("*").single()), "저장했습니다");
    if (saved) onDone({ ...saved, issueNow: issueNow && ["현금영수증", "세금계산서"].includes(f.evidence) });
  };
  const remove = async () => {
    if (!ask("이 알선 건을 지울까요?")) return;
    if (await run(() => q(app.db.from("brokerages").delete().eq("id", f.id)), "지웠습니다")) onDone(null);
  };

  return html`<form class="card form" onSubmit=${save}>
    <div class="bar"><h3>${f.id ? "알선 수정" : "알선 등록"}</h3><span class="grow"></span>
      ${f.id && html`<button type="button" class="btn danger" onClick=${remove}>삭제</button>`}
      <button type="button" class="btn ghost" onClick=${() => onDone(null)}>닫기</button><button class="btn primary">저장</button></div>
    <div class="fgrid">
      <${Field} label="알선담당" hint=${partner ? "공동대표 — 딜러 지급 없음, 전액 회사 수익" : ""}><${Select} value=${f.dealer_id} onChange=${v => setF(p => ({ ...p, dealer_id: v, withholding: !dealerOf(v)?.partner && dealerOf(v)?.kind === "개인" }))}
        options=${app.dealers.filter(d => d.active).map(d => [d.id, d.name + (d.partner ? " (대표)" : "")])} /><//>
      <${Field} label="항목"><${Seg} value=${f.item} onChange=${set("item")} options=${["알선수수료", "알선수익금"]} /><//>
      <${Field} label="알선일"><input type="date" value=${f.sale_date} onInput=${set("sale_date")} /><//>
      <${Field} label="알선수수료(부가세 포함)" req><${Money} value=${f.fee} onInput=${set("fee")} /><//>
      <${Field} label="공제비용" hint="상품화비 등 딜러가 부담할 것"><${Money} value=${f.deduct_cost} onInput=${set("deduct_cost")} /><//>
      ${!partner && html`<${Field} label="원천징수" hint=${`딜러 구분: ${dealerOf(f.dealer_id)?.kind || "-"}`}><${Seg} value=${f.withholding ? "대상" : "미대상"} onChange=${v => set("withholding")(v === "대상")} options=${["대상", "미대상"]} /><//>
      <${Field} label="13.3% 처리"><${Seg} value=${f.method} onChange=${set("method")} options=${["일괄", "분할"]} /><//>`}
      <${Field} label="차량번호"><input value=${f.plate} onInput=${set("plate")} /><//>
      <${Field} label="차명"><input value=${f.car_name} onInput=${set("car_name")} /><//>
      <${Field} label="고객/상사명"><input value=${f.customer_name} onInput=${set("customer_name")} /><//>
      <${Field} label="타상사 딜러"><input value=${f.other_dealer} onInput=${set("other_dealer")} /><//>
      <${Field} label="연락처"><input value=${f.phone} onInput=${set("phone")} /><//>
      <${Field} label="매출증빙"><${Select} value=${f.evidence} onChange=${set("evidence")} options=${["미발행", "현금영수증", "세금계산서", "카드"]} /><//>
      <${Field} label="특이사항" wide><input value=${f.memo} onInput=${set("memo")} /><//>
    </div>
    <div class="sums">
      <div><span>정산기준 (수수료 − 공제)</span><b>${won(r.기준)}</b><small>공급가 ${won(r.공급가)} · 부가세 ${won(r.부가세)}</small></div>
      <div><span>세액 ${f.withholding ? (f.method === "일괄" ? "(13.3%)" : "(부가세 + 3.3%)") : "(미대상)"}</span><b>${won(r.세액)}</b>
        <small>${f.method === "분할" && f.withholding ? `소득세 ${won(r.소득세)} · 지방세 ${won(r.지방세)}` : ""}</small></div>
      <div class="strong"><span>${partner ? "회사 수익 (대표 실적)" : "딜러지급액"}</span><b class="blue">${won(partner ? r.기준 : r.지급액)}</b></div>
    </div>
    ${["현금영수증", "세금계산서"].includes(f.evidence) && html`<label class="check" style="margin-top:10px">
      <input type="checkbox" checked=${issueNow} onChange=${e => setIssueNow(e.target.checked)} /> 저장 후 바로 ${f.evidence} 발행 화면 열기 (기본 꺼짐)</label>`}
  </form>`;
}
