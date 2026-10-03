import { html, useState, Money, Field, Select, run, won, today, toast, go } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리, 할부수수료 } from "../calc.js";

export const SALE_TYPES = ["내수판매", "수출", "엔카믿고", "알선판매"];

let tmp = 0;
const newBuyer = share => ({ _new: ++tmp, name: "", ssn: "", biz_no: "", phone: "", zip: "", addr: "", memo: "", share_rate: share });

export function SaleTab({ app, car, sale, buyers, settlement, reload, locked, office }) {
  const [editing, setEditing] = useState(!sale && office);
  if (!sale && !office) return html`<div class="card empty">아직 매도되지 않았습니다.</div>`;
  if (editing) return html`<${SaleForm} app=${app} car=${car} sale=${sale} buyers=${buyers} onDone=${saved => { setEditing(false); if (saved) reload(); }} />`;
  if (!sale) return html`<div class="card empty">아직 매도되지 않았습니다. <button class="btn primary" onClick=${() => setEditing(true)}>매도 처리</button></div>`;

  const dealer = app.dealers.find(d => d.id === sale.dealer_id);
  const cancel = async () => {
    if (settlement?.finalized) return toast("정산완료된 차량입니다. 정산 탭에서 확정을 먼저 해제하세요.", "err");
    if (!confirm("매도를 취소할까요? 차량이 재고로 돌아가고 임시정산도 지워집니다.")) return;
    await run(() => q(app.db.from("car_sales").delete().eq("car_id", car.id)), "매도를 취소했습니다");
    reload();
  };
  return html`<div class="card">
    <div class="bar"><h3>매도정보</h3><span class="grow"></span>
      ${office && !locked && html`<button class="btn" onClick=${() => setEditing(true)}>수정</button><button class="btn danger" onClick=${cancel}>매도취소</button>`}
      ${office && html`<button class="btn primary" onClick=${() => go(`/car/${car.id}/settle`)}>정산하기 →</button>`}</div>
    <div class="kvgrid">
      <div><span>매도일</span><b>${sale.sale_date}</b></div>
      <div><span>매도담당</span><b>${dealer?.name || "-"}${sale.other_dealer ? " (타상사딜러)" : ""}</b></div>
      <div><span>매도유형</span><b>${sale.sale_type}</b></div>
      <div><span>알선딜러</span><b>${app.dealers.find(d => d.id === sale.broker_dealer_id)?.name || "-"}</b></div>
      <div><span>매도금액</span><b>${won(sale.sale_amount)} <small class="muted">(공급가 ${won(sale.sale_supply)} / 부가세 ${won(sale.sale_vat)})</small></b></div>
      <div><span>상사매도비</span><b>${won(sale.sale_fee)}</b></div>
      <div><span>성능보험료</span><b>${won(sale.perf_insurance)}</b></div>
      ${Number(sale.installment_amount) > 0 && html`<div><span>할부금융 수익</span><b>${won(sale.installment_income)} <small class="muted">(할부 ${won(sale.installment_amount)} × ${Number(sale.installment_rate)}% = ${won(sale.installment_fee)} − 원천징수 ${won(sale.installment_tax)})</small></b></div>`}
      <div><span>출고 번호판</span><b>${sale.plate_out || car.plate}</b></div>
      <div><span>특이사항</span><b>${sale.memo || "-"}</b></div>
    </div>
    <h3>매수고객</h3>
    <div class="table-wrap"><table class="grid"><thead><tr><th>고객명</th><th>주민(법인)번호</th><th>사업자번호</th><th>연락처</th><th>주소</th><th class="r">지분율</th></tr></thead>
      <tbody>${buyers.map(b => html`<tr><td>${b.name}</td><td>${b.ssn_masked || "-"}</td><td>${b.biz_no || "-"}</td><td>${b.phone || "-"}</td><td>${b.addr || "-"}</td><td class="r">${b.share_rate}%</td></tr>`)}</tbody></table></div>
  </div>`;
}

function SaleForm({ app, car, sale, buyers, onDone }) {
  const [f, setF] = useState(sale ? { ...sale } : {
    sale_date: today(), dealer_id: car.dealer_id, other_dealer: false, sale_type: "내수판매", sale_amount: 0,
    plate_out: car.plate, sale_fee: app.settings.sale_fee, perf_insurance: 0, memo: "", broker_dealer_id: null,
    installment_amount: 0, installment_rate: 0 });
  const [bs, setBs] = useState(buyers.length ? buyers.map(b => ({ ...b, ssn: "" })) : [newBuyer(100)]);
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const upd = (i, k, v) => setBs(x => x.map((b, j) => j === i ? { ...b, [k]: v } : b));
  const vat = 부가세분리(f.sale_amount);
  const 할부 = 할부수수료(f.installment_amount, f.installment_rate);
  // 엔카믿고면 매도비 242,000 (설정값), 다른 유형으로 돌리면 기본 매도비
  const pickType = v => setF(p => ({ ...p, sale_type: v,
    sale_fee: v === "엔카믿고" ? (app.settings.sale_fee_encar ?? 242000) : p.sale_type === "엔카믿고" ? app.settings.sale_fee : p.sale_fee }));
  const shareSum = bs.reduce((s, b) => s + Number(b.share_rate || 0), 0);

  const save = async e => {
    e.preventDefault();
    if (!f.sale_amount) return toast("매도금액을 입력하세요.", "err");
    for (const b of bs) {
      if (!b.name.trim()) return toast("매수고객 이름을 입력하세요.", "err");
      if (!b.ssn.trim() && !b.ssn_masked && !b.biz_no?.trim()) return toast(`${b.name}: 주민번호나 사업자번호 중 하나는 꼭 입력하세요.`, "err");
    }
    if (Math.abs(shareSum - 100) > 0.001) return toast(`지분율 합계가 100%가 아닙니다 (${shareSum}%).`, "err");
    setBusy(true);
    const ok = await run(async () => {
      const row = { car_id: car.id, sale_date: f.sale_date, dealer_id: f.dealer_id, other_dealer: f.other_dealer, sale_type: f.sale_type,
        sale_amount: f.sale_amount, plate_out: f.plate_out || null, sale_fee: f.sale_fee, perf_insurance: f.perf_insurance, memo: f.memo || null,
        broker_dealer_id: f.broker_dealer_id || null,
        installment_amount: Number(f.installment_amount) || 0, installment_rate: Number(f.installment_rate) || 0 };
      if (sale) await q(app.db.from("car_sales").update(row).eq("car_id", car.id));
      else await q(app.db.from("car_sales").insert(row));
      const keep = new Set(bs.filter(b => b.id).map(b => b.id));
      const gone = buyers.filter(b => !keep.has(b.id)).map(b => b.id);
      if (gone.length) await q(app.db.from("car_buyers").delete().in("id", gone));
      for (const [i, b] of bs.entries()) {
        const r = { name: b.name.trim(), biz_no: b.biz_no || null, phone: b.phone || null, zip: b.zip || null, addr: b.addr || null,
          memo: b.memo || null, share_rate: Number(b.share_rate), sort: i };
        const id = b.id ? (await q(app.db.from("car_buyers").update(r).eq("id", b.id).select("id").single())).id
                        : (await q(app.db.from("car_buyers").insert({ ...r, car_id: car.id }).select("id").single())).id;
        if (b.ssn.trim()) await q(app.db.rpc("set_ssn", { p_target: "buyer", p_id: id, p_ssn: b.ssn.trim() }));
      }
      return true;
    }, sale ? "매도정보를 수정했습니다" : "매도 처리했습니다");
    setBusy(false);
    if (ok) onDone(true);
  };

  return html`<form class="card form" onSubmit=${save}>
    <div class="bar"><h3>${sale ? "매도정보 수정" : "매도 처리"}</h3><span class="grow"></span>
      <button type="button" class="btn ghost" onClick=${() => onDone(false)}>취소</button>
      <button class="btn primary" disabled=${busy}>${busy ? "저장 중…" : "저장"}</button></div>
    <div class="fgrid">
      <${Field} label="매도일" req><input type="date" value=${f.sale_date} onInput=${e => set("sale_date")(e.target.value)} required /><//>
      <${Field} label="매도담당"><div class="row"><${Select} value=${f.dealer_id} onChange=${set("dealer_id")} options=${app.dealers.map(d => [d.id, d.name + (d.partner ? " (대표)" : "")])} />
        <label class="check"><input type="checkbox" checked=${f.other_dealer} onChange=${e => set("other_dealer")(e.target.checked)} /> 타상사딜러</label></div><//>
      <${Field} label="알선딜러" hint="다른 딜러가 손님을 데려와 판 경우 — 정산 때 정산금을 나눕니다">
        <${Select} value=${f.broker_dealer_id} onChange=${set("broker_dealer_id")} empty="없음" options=${app.dealers.filter(d => d.id !== f.dealer_id).map(d => [d.id, d.name])} /><//>
      <${Field} label="판매유형" hint=${f.sale_type === "수출" ? "수출 — 성능점검비가 22,000원으로 바뀝니다" : f.sale_type === "엔카믿고" ? "엔카믿고 — 매도비 242,000원" : ""}>
        <${Select} value=${f.sale_type} onChange=${pickType} options=${SALE_TYPES} /><//>
      <${Field} label="매도금액" req hint=${f.sale_amount ? `공급가 ${won(vat.공급가)} / 부가세 ${won(vat.부가세)}` : "부가세 포함"}><${Money} value=${f.sale_amount} onInput=${set("sale_amount")} /><//>
      <${Field} label="상사매도비" hint="상사 매출로 잡힙니다"><${Money} value=${f.sale_fee} onInput=${set("sale_fee")} /><//>
      <${Field} label="성능보험료" hint="상사 매출로 잡힙니다"><${Money} value=${f.perf_insurance} onInput=${set("perf_insurance")} /><//>
      <${Field} label="할부금액" hint="할부(금융)로 판 경우"><${Money} value=${f.installment_amount} onInput=${set("installment_amount")} /><//>
      <${Field} label="할부피(%)" hint=${할부.수수료 ? `수수료 ${won(할부.수수료)} − 원천징수 ${won(할부.원천징수)} = 수익 ${won(할부.수익)}` : "수익 = 할부금액 × 할부피 − 원천징수 3.3%"}>
        <input inputmode="decimal" value=${f.installment_rate || ""} onInput=${e => set("installment_rate")(e.target.value)} /><//>
      <${Field} label="출고 번호판"><input value=${f.plate_out || ""} onInput=${e => set("plate_out")(e.target.value)} /><//>
      <${Field} label="특이사항" wide><input value=${f.memo || ""} onInput=${e => set("memo")(e.target.value)} /><//>
    </div>
    <div class="bar"><h3>매수고객</h3><span class=${"muted" + (Math.abs(shareSum - 100) > 0.001 ? " red" : "")}>지분율 합계 ${shareSum}%</span><span class="grow"></span>
      <button type="button" class="btn sm" onClick=${() => setBs(x => [...x, newBuyer(0)])}>+ 공동명의 추가</button></div>
    ${bs.map((b, i) => html`<div class="buyer fgrid">
      <${Field} label="고객명" req><input value=${b.name} onInput=${e => upd(i, "name", e.target.value)} /><//>
      <${Field} label="주민(법인)번호" hint=${b.ssn_masked ? `저장됨 ${b.ssn_masked}` : "암호화 저장"}><input autocomplete="off" placeholder=${b.ssn_masked || ""} value=${b.ssn} onInput=${e => upd(i, "ssn", e.target.value)} /><//>
      <${Field} label="사업자번호"><input value=${b.biz_no || ""} onInput=${e => upd(i, "biz_no", e.target.value)} /><//>
      <${Field} label="연락처"><input value=${b.phone || ""} onInput=${e => upd(i, "phone", e.target.value)} /><//>
      <${Field} label="주소" wide><input value=${b.addr || ""} onInput=${e => upd(i, "addr", e.target.value)} /><//>
      <${Field} label="지분율(%)"><div class="row"><input inputmode="decimal" value=${b.share_rate} onInput=${e => upd(i, "share_rate", e.target.value)} />
        ${bs.length > 1 && html`<button type="button" class="btn sm ghost" onClick=${() => setBs(x => x.filter((_, j) => j !== i))}>삭제</button>`}</div><//>
    </div>`)}
  </form>`;
}
