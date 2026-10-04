import { html, useState, useMemo, Money, Field, Seg, run, won, today, toast, go } from "../ui.js";
import { popbill } from "../pb.js";
import { q } from "../db.js";
import { 정산, 미납이자, 대표손익, 차량캐피탈이자 } from "../calc.js";

const loanOf = l => ({ 대출금액: l.amount, 딜러이율: l.dealer_rate, 개월: l.months, 실행일: l.start_date,
  납입이자누계: l.payments.reduce((s, p) => s + Number(p.amount), 0) });

/** 재고금융·미납이자 자동 상계 (진행중 대출 기준) */
function autoOffsets(loans, date) {
  const act = loans.filter(l => l.status === "진행중");
  if (!act.length) return [];
  return [
    { 항목: "재고금융", 금액: act.reduce((s, l) => s + Number(l.amount), 0), auto: true },
    { 항목: "재고금융(미납)이자", 금액: act.reduce((s, l) => s + 미납이자(loanOf(l), date), 0), auto: true },
  ];
}

export function SettleTab(P) {
  const { app, car, sale } = P;
  if (!sale) return html`<div class="card empty">매도 처리 후 정산할 수 있습니다. <a href=${`#/car/${car.id}/sale`}>매도 탭으로 →</a></div>`;
  return app.dealers.find(d => d.id === car.dealer_id)?.partner ? html`<${PartnerSettle} ...${P} />` : html`<${DealerSettle} ...${P} />`;
}

/** 공동대표 차: 딜러 지급 없이 차량 손익만 확정한다 (원천징수·상사매입비·딜러이자 없음) */
function PartnerSettle({ app, car, costs, loans, sale, settlement, reload, office }) {
  const fin = !!settlement?.finalized;
  const ro = fin || !office;
  const owner = app.dealers.find(d => d.id === car.dealer_id);
  const [f, setF] = useState({ settle_date: settlement?.settle_date || today(), other_revenue: settlement?.other_revenue || [],
    loan_repay: settlement?.loan_repay ?? true, memo: settlement?.memo || "" });
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const r = useMemo(() => 대표손익({
    매도금액: Number(sale.sale_amount), 기타매출: f.other_revenue.map(x => ({ 금액: Number(x.금액) || 0, 과세: x.과세 !== false })),
    상사매도비: Number(sale.sale_fee), 할부수익: Number(sale.installment_income) || 0, 제시금액: Number(car.purchase_amount), 제시증빙: car.evidence,
    비용: costs.map(c => ({ 금액: Number(c.amount), 과세: c.taxable, 정산반영: c.include_in_settlement })),
    캐피탈이자: 차량캐피탈이자(loans, sale.sale_date),
  }), [f, costs, sale, car, loans]);
  const save = async finalize => {
    if (finalize && !confirm(`${owner?.name || ""} 대표 실적으로 손익을 확정할까요?\n손익 ${won(r.손익)}원${f.loan_repay && loans.some(l => l.status === "진행중") ? "\n진행중인 재고금융은 상환완료 처리됩니다." : ""}`)) return;
    setBusy(true);
    const row = { car_id: car.id, mode: "대표", settle_date: f.settle_date, withholding: false, method: app.settings.settle_method, allow_negative: true,
      other_revenue: f.other_revenue, offsets: [], loan_repay: f.loan_repay, memo: f.memo || null,
      sale_total: r.매출.금액, purchase_total: r.제시.금액, cost_total: r.C.금액, base_amount: r.손익, base_supply: r.손익, base_vat: r.부가세,
      income_amount: 0, income_tax: 0, local_tax: 0, tax_total: 0, offset_total: 0, payout: 0, net_income: r.손익, detail: r, finalized: !!finalize };
    await run(() => q(app.db.from("settlements").upsert(row, { onConflict: "car_id" })), finalize ? "손익을 확정했습니다" : "임시저장했습니다");
    setBusy(false); reload();
  };
  const unfinalize = async () => {
    if (!confirm("손익 확정을 해제할까요?")) return;
    await run(() => q(app.db.from("settlements").update({ finalized: false }).eq("car_id", car.id)), "확정을 해제했습니다");
    reload();
  };
  const rowUpd = (i, key, v) => setF(p => ({ ...p, other_revenue: p.other_revenue.map((x, j) => j === i ? { ...x, [key]: v } : x) }));
  const L = (k, v, note, cls) => html`<tr class=${cls || ""}><th>${k}</th><td class=${"r" + (v < 0 && cls ? " red" : "")}>${won(v)}</td><td class="note">${note || ""}</td></tr>`;
  return html`<div class="settle">
    <div class="card no-print">
      <div class="bar"><h3>차량 손익 <span class="muted small">대표 ${owner?.name || ""}</span></h3>
        ${fin && html`<span class="badge green">손익확정 ${settlement.finalized_at?.slice(0, 10) || ""}</span>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${() => print()}>인쇄</button>
        ${office && (fin ? html`<button class="btn" onClick=${unfinalize}>확정 해제</button>` : html`
          <button class="btn" disabled=${busy} onClick=${() => save(false)}>임시저장</button>
          <button class="btn primary" disabled=${busy} onClick=${() => save(true)}>손익확정</button>`)}
      </div>
      <div class="fgrid">
        <${Field} label="확정일"><input type="date" disabled=${ro} value=${f.settle_date} onInput=${e => set("settle_date")(e.target.value)} /><//>
        <${Field} label="재고금융" hint="확정 시 진행중 대출을 상환완료 처리"><label class="check"><input type="checkbox" disabled=${ro} checked=${f.loan_repay} onChange=${e => set("loan_repay")(e.target.checked)} /> 상환완료 종결처리</label><//>
        <${Field} label="메모" wide><input disabled=${ro} value=${f.memo} onInput=${e => set("memo")(e.target.value)} /><//>
      </div>
      <div class="bar"><h4>기타 매출</h4><span class="grow"></span>${!ro && html`<button class="btn sm" onClick=${() => set("other_revenue")([...f.other_revenue, { 항목: "", 금액: 0, 과세: true }])}>+ 추가</button>`}</div>
      ${f.other_revenue.map((x, i) => html`<div class="row line"><input placeholder="항목" disabled=${ro} value=${x.항목} onInput=${e => rowUpd(i, "항목", e.target.value)} />
        <${Money} value=${x.금액} readOnly=${ro} onInput=${v => rowUpd(i, "금액", v)} />
        ${!ro && html`<button class="btn sm ghost" onClick=${() => set("other_revenue")(f.other_revenue.filter((_, j) => j !== i))}>✕</button>`}</div>`)}
      <p class="note">대표 차는 상사매입비·원천징수·딜러 지급이 없습니다. 상품화비용은 <a href=${`#/car/${car.id}/costs`}>상품화비용 탭</a>에서 고치세요.</p>
    </div>
    <div class="card statement print-area">
      <div class="st-head"><h3>차량 손익</h3><span>${app.settings.company_name} · ${fin ? "손익확정" : "미확정"}</span></div>
      <div class="st-meta"><span>${car.plate} ${car.car_name}</span><span>매입담당 ${owner?.name || "-"} (대표)</span>
        <span>제시 ${car.purchase_date} · 매도 ${sale.sale_date}${sale.sale_type !== "내수판매" ? ` (${sale.sale_type})` : ""}</span></div>
      <table class="st"><tbody>
        ${L("매도금액", sale.sale_amount)}
        ${Number(sale.sale_fee) ? L("상사매도비", sale.sale_fee, "대표 본인 수익") : ""}
        ${Number(sale.installment_income) ? L("할부금융 수익", sale.installment_income, `할부 ${won(sale.installment_amount)} × ${Number(sale.installment_rate)}% − 원천징수 ${won(sale.installment_tax)}`) : ""}
        ${f.other_revenue.filter(x => Number(x.금액)).map(x => L(x.항목 || "기타매출", x.금액))}
        ${L("매출 합계", r.매출.금액, `공급가 ${won(r.매출.공급가)} / 부가세 ${won(r.매출.부가세)}`, "em")}
        ${L("매입가", -r.제시.금액, car.evidence === "계산서" ? "계산서 — 매입세액 공제 없음" : `${car.evidence} — 매입세액 ${won(r.제시.부가세)} 공제`)}
        ${L("상품화비용", -r.C.금액, `${costs.length}건`)}
        ${r.이자 ? L("재고금융 이자(캐피탈)", -r.이자, "실행일 ~ 매도일") : ""}
        ${L("차량 손익 (실적)", r.손익, "부가세는 빼지 않음", "em")}
        <tr><th class="muted">참고: 예상 부가세</th><td class="r muted">${won(r.부가세)}</td><td class="note">매출세액 − 제시·비용 매입세액 (손익에 안 뺌)</td></tr>
        ${Number(sale.perf_insurance) ? html`<tr><th class="muted">성능보험료</th><td class="r muted">${won(sale.perf_insurance)}</td><td class="note">손님 부담 — 손익 제외</td></tr>` : ""}
      </tbody></table>
    </div>
  </div>`;
}

function DealerSettle({ app, car, costs, loans, sale, settlement, reload, office }) {
  const dealer = app.dealers.find(d => d.id === (sale.dealer_id || car.dealer_id));
  const fin = !!settlement?.finalized;
  const init = settlement ? {
    settle_date: settlement.settle_date, withholding: settlement.withholding, method: settlement.method,
    allow_negative: settlement.allow_negative, other_revenue: settlement.other_revenue || [],
    offsets: fin ? settlement.offsets : [...autoOffsets(loans, settlement.settle_date), ...(settlement.offsets || []).filter(o => !o.auto)],
    loan_repay: settlement.loan_repay, memo: settlement.memo || "",
    broker_amount: Number(settlement.broker_amount) || 0, broker_withholding: settlement.broker_withholding !== false,
  } : {
    settle_date: today(), withholding: dealer?.kind === "개인", method: app.settings.settle_method, allow_negative: false,
    other_revenue: [], offsets: autoOffsets(loans, today()), loan_repay: true, memo: "",
    broker_amount: 0, broker_withholding: app.dealers.find(d => d.id === sale.broker_dealer_id)?.kind === "개인",
  };
  const broker = app.dealers.find(d => d.id === sale.broker_dealer_id);
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("딜러용");     // 인쇄 양식
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const ro = fin || !office;
  const printAs = m => { setMode(m); setTimeout(() => print(), 50); };

  const r = useMemo(() => 정산({
    매출: [{ 금액: Number(sale.sale_amount) }, ...f.other_revenue.map(x => ({ 금액: Number(x.금액) || 0, 과세: x.과세 !== false }))],
    제시금액: Number(car.purchase_amount),
    비용: costs.map(c => ({ 금액: Number(c.amount), 과세: c.taxable, 지출구분: c.paid_by, 정산반영: c.include_in_settlement })),
    상계: f.offsets.map(o => ({ 항목: o.항목, 금액: Number(o.금액) || 0 })),
    원천징수대상: f.withholding, 방식: f.method, 마이너스허용: f.allow_negative,
    알선: broker ? { 금액: f.broker_amount, 원천징수대상: f.broker_withholding } : null,
  }), [f, costs, sale, car]);

  const rowUpd = (k, i, key, v) => setF(p => ({ ...p, [k]: p[k].map((x, j) => j === i ? { ...x, [key]: v } : x) }));
  const refreshAuto = date => setF(p => ({ ...p, settle_date: date, offsets: [...autoOffsets(loans, date), ...p.offsets.filter(o => !o.auto)] }));

  const save = async finalize => {
    if (finalize && !confirm(`정산을 확정할까요?\n딜러 실지급액 ${won(r.실지급액)}원${f.loan_repay && loans.some(l => l.status === "진행중") ? "\n진행중인 재고금융은 상환완료 처리됩니다." : ""}`)) return;
    setBusy(true);
    const row = {
      car_id: car.id, settle_date: f.settle_date, withholding: f.withholding, method: f.method, allow_negative: f.allow_negative,
      other_revenue: f.other_revenue, offsets: f.offsets.filter(o => Number(o.금액)), loan_repay: f.loan_repay, memo: f.memo || null,
      sale_total: r.A, purchase_total: r.B, cost_total: r.C.금액, base_amount: r.D, base_supply: r.D공급가, base_vat: r.D부가세,
      income_amount: r.소득금액, income_tax: r.소득세, local_tax: r.지방세, tax_total: r.징수세액,
      offset_total: r.L, payout: r.실지급액, net_income: r.세후소득, detail: r, finalized: !!finalize,
      broker_dealer_id: broker?.id || null, broker_amount: r.알선?.기준 || 0, broker_withholding: f.broker_withholding,
      broker_income: r.알선?.소득금액 || 0, broker_income_tax: r.알선?.소득세 || 0, broker_local_tax: r.알선?.지방세 || 0,
      broker_tax_total: r.알선?.세액 || 0, broker_payout: r.알선?.지급액 || 0, mode: "딜러",
    };
    await run(() => q(app.db.from("settlements").upsert(row, { onConflict: "car_id" })), finalize ? "정산을 확정했습니다" : "임시저장했습니다");
    setBusy(false); reload();
  };
  const unfinalize = async () => {
    if (!confirm("정산 확정을 해제할까요? 금액은 그대로 두고 다시 수정할 수 있게 됩니다.\n(정산완료 때 자동으로 상환완료된 재고금융은 진행중으로 돌아갑니다)")) return;
    await run(() => q(app.db.from("settlements").update({ finalized: false }).eq("car_id", car.id)), "확정을 해제했습니다");
    reload();
  };

  const 반영 = costs.filter(c => c.include_in_settlement);
  return html`<div class="settle">
    <div class="card no-print">
      <div class="bar"><h3>정산</h3>
        ${fin && html`<span class="badge green">정산완료 ${settlement.finalized_at?.slice(0, 10) || ""}</span>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${() => printAs("딜러용")}>인쇄(딜러용)</button>
        <button class="btn ghost" onClick=${() => printAs("상사용")}>인쇄(상사용)</button>
        ${office && html`<button class="btn ghost" onClick=${() => sendSms(app, car, sale, dealer, f, r)}>딜러에게 문자</button>`}
        ${office && (fin ? html`<button class="btn" onClick=${unfinalize}>확정 해제</button>` : html`
          <button class="btn" disabled=${busy} onClick=${() => save(false)}>임시저장</button>
          <button class="btn primary" disabled=${busy} onClick=${() => save(true)}>정산완료</button>`)}
      </div>
      <div class="fgrid">
        <${Field} label="정산일"><input type="date" disabled=${ro} value=${f.settle_date} onInput=${e => refreshAuto(e.target.value)} /><//>
        <${Field} label="원천징수" hint=${`딜러 ${dealer?.name || ""}(${dealer?.kind || "-"}) · 대표 본인 매도·세금계산서 처리 건은 미대상`}>
          <${Seg} value=${f.withholding ? "대상" : "미대상"} onChange=${v => !ro && set("withholding")(v === "대상")} options=${["대상", "미대상"]} /><//>
        <${Field} label="13.3% 처리" hint=${f.method === "일괄" ? "정산기준금액 × 13.3%" : "예수부가세 10% 먼저, 나머지에서 3.3%"}>
          <${Seg} value=${f.method} onChange=${v => !ro && set("method")(v)} options=${["일괄", "분할"]} /><//>
        <${Field} label="손실일 때"><${Seg} value=${f.allow_negative ? "마이너스" : "0"} onChange=${v => !ro && set("allow_negative")(v === "마이너스")} options=${[["0", "0으로"], ["마이너스", "마이너스로"]]} /><//>
        <${Field} label="재고금융" hint="정산완료 시 진행중 대출을 상환완료 처리"><label class="check"><input type="checkbox" disabled=${ro} checked=${f.loan_repay} onChange=${e => set("loan_repay")(e.target.checked)} /> 상환완료 종결처리</label><//>
        ${broker && html`<${Field} label=${`알선딜러 몫 — ${broker.name}`} hint=${`정산기준금액 ${won(r.D + (r.알선?.기준 || 0))} 중 알선딜러에게 줄 금액`}>
          <div class="row"><${Money} value=${f.broker_amount} readOnly=${ro} onInput=${v => set("broker_amount")(v)} />
          <${Seg} value=${f.broker_withholding ? "대상" : "미대상"} onChange=${v => !ro && set("broker_withholding")(v === "대상")} options=${["대상", "미대상"]} /></div><//>`}
        <${Field} label="정산메모" wide><input disabled=${ro} value=${f.memo} onInput=${e => set("memo")(e.target.value)} /><//>
      </div>
      <div class="two">
        <div>
          <div class="bar"><h4>기타 매출</h4><span class="grow"></span>${!ro && html`<button class="btn sm" onClick=${() => set("other_revenue")([...f.other_revenue, { 항목: "", 금액: 0, 과세: true }])}>+ 추가</button>`}</div>
          ${f.other_revenue.map((x, i) => html`<div class="row line"><input placeholder="항목" disabled=${ro} value=${x.항목} onInput=${e => rowUpd("other_revenue", i, "항목", e.target.value)} />
            <${Money} value=${x.금액} readOnly=${ro} onInput=${v => rowUpd("other_revenue", i, "금액", v)} />
            ${!ro && html`<button class="btn sm ghost" onClick=${() => set("other_revenue")(f.other_revenue.filter((_, j) => j !== i))}>✕</button>`}</div>`)}
          ${!f.other_revenue.length && html`<p class="muted small">없음</p>`}
        </div>
        <div>
          <div class="bar"><h4>상계 (딜러 지급액에서 뺄 것)</h4><span class="grow"></span>${!ro && html`<button class="btn sm" onClick=${() => set("offsets")([...f.offsets, { 항목: "기타상계", 금액: 0 }])}>+ 추가</button>`}</div>
          ${f.offsets.map((x, i) => html`<div class="row line"><input disabled=${ro || x.auto} value=${x.항목} onInput=${e => rowUpd("offsets", i, "항목", e.target.value)} />
            <${Money} value=${x.금액} readOnly=${ro} onInput=${v => rowUpd("offsets", i, "금액", v)} />
            ${!ro && !x.auto && html`<button class="btn sm ghost" onClick=${() => set("offsets")(f.offsets.filter((_, j) => j !== i))}>✕</button>`}
            ${x.auto && html`<small class="muted">자동</small>`}</div>`)}
          ${r.상사선지출 > 0 && html`<div class="row line"><input disabled value="상사선지출 (상사 지출·정산반영 비용)" /><${Money} value=${r.상사선지출} readOnly /><small class="muted">자동</small></div>`}
        </div>
      </div>
      <p class="note">상품화비용 정산반영 ${반영.length}건 (${won(r.C.금액)}원) — 바꾸려면 <a href=${`#/car/${car.id}/costs`}>상품화비용 탭</a>에서 수정하세요.</p>
    </div>

    <${Statement} app=${app} car=${car} sale=${sale} dealer=${dealer} f=${f} r=${r} fin=${fin} mode=${mode} costs=${costs} loans=${loans} />
  </div>`;
}

/** 정산 결과를 딜러에게 장문 문자로 (팝빌) */
async function sendSms(app, car, sale, dealer, f, r) {
  if (!dealer?.phone) return toast("딜러 휴대폰 번호가 없습니다. 설정 → 딜러에서 넣어 주세요.", "err");
  const body = [`[${app.settings.company_name}] 정산내역 안내`, `${car.plate} ${car.car_name}`,
    `매도 ${sale.sale_date} / 정산 ${f.settle_date}`, `매출 ${won(r.A)} / 제시 ${won(r.B)}`, `상품화비(반영) ${won(r.C.금액)}`,
    `정산기준 ${won(r.D)} / 세액 ${won(r.징수세액)}`, ...r.상계.map(o => `${o.항목} ${won(o.금액)}`), `실지급액 ${won(r.실지급액)}원`].join("\n");
  if (!window.confirm(`${dealer.name}(${dealer.phone})에게 보낼까요?\n\n${body}`)) return;
  await run(() => popbill(app.db, "sms.send", { to: dealer.phone, name: dealer.name, subject: "정산내역 안내", body, car_id: car.id }), "문자를 보냈습니다");
}

/** 정산내역서 — 화면과 인쇄 겸용 (딜러용 / 상사용) */
function Statement({ app, car, sale, dealer, f, r, fin, mode, costs = [], loans = [] }) {
  const L = (k, v, note, cls) => html`<tr class=${cls || ""}><th>${k}</th><td class="r">${won(v)}</td><td class="note">${note || ""}</td></tr>`;
  return html`<div class="card statement print-area">
    <div class="st-head"><h3>정산내역서 <span class="muted small">(${mode})</span></h3><span>${app.settings.company_name} · ${fin ? "정산완료" : "미확정"}</span></div>
    <div class="st-meta">
      <span>${car.plate} ${car.car_name}</span><span>딜러 ${dealer?.name || "-"}</span>
      <span>제시 ${car.purchase_date} · 매도 ${sale.sale_date} · 정산 ${f.settle_date}</span>
      <span>원천징수 ${f.withholding ? "대상" : "미대상"} · ${f.method}정산</span>
    </div>
    <div class="two">
      <table class="st"><caption>정산 금액</caption><tbody>
        ${L("매출 합계 (A)", r.A, `공급가 ${won(r.매출.공급가)} / 부가세 ${won(r.매출.부가세)}`)}
        ${L("제시 합계 (B)", r.B, `공급가 ${won(r.제시.공급가)} / 부가세 ${won(r.제시.부가세)}`)}
        ${L("차량 마진 (M)", r.M, "M = A − B")}
        ${L("상품화비용 (C)", r.C.금액, "정산반영분")}
        ${L("정산기준금액 (D)", r.D, "D = M − C", "em")}
        ${r.D !== 0 && L("  공급가 / 부가세", r.D공급가, `부가세 ${won(r.D부가세)}`)}
        ${f.method === "분할" && f.withholding && html`
          ${L("예수부가세 (F)", r.예수부가세, "매출VAT − 제시VAT − 비용VAT")}
          ${L("소득금액", r.소득금액, "D − F")}
          ${L("소득세 3%", r.소득세)}
          ${L("지방소득세 0.3%", r.지방세)}`}
        ${L("징수세액 (I)", r.징수세액, f.withholding ? (f.method === "일괄" ? "D × 13.3%" : "F + 소득세 + 지방세") : "원천징수 미대상", "em")}
        ${L("세후소득 (J)", r.세후소득, "J = D − I")}
      </tbody></table>
      <table class="st"><caption>상계 금액</caption><tbody>
        ${r.상계.map(o => L(o.항목, o.금액))}
        ${!r.상계.length && html`<tr><td colspan="3" class="muted">없음</td></tr>`}
        ${L("상계 합계 (L)", r.L, "", "em")}
      </tbody></table>
    </div>
    ${r.알선 && html`<table class="st" style="margin-top:14px"><caption>알선딜러 몫 — ${app.dealers.find(d => d.id === sale.broker_dealer_id)?.name || ""}</caption><tbody>
      ${L("알선 정산기준금액", r.알선.기준)}${L("소득금액", r.알선.소득금액)}${L("세액", r.알선.세액, f.method === "일괄" ? "13.3%" : "부가세 + 3.3%")}
      ${L("알선딜러 실지급액", r.알선.지급액, "", "em")}</tbody></table>`}
    <div class="payout"><span>${r.알선 ? "차주딜러" : "딜러"} 실지급액 (O)</span><b>${won(r.실지급액)}원</b><small>O = A − (I + L)${r.알선 ? " − 알선 몫" : ""}</small></div>
    ${mode === "상사용" && html`<div class="print-only-extra">
      <table class="st" style="margin-top:14px"><caption>상품화비용 상세</caption><tbody>
        ${costs.map(c => html`<tr><th>${c.item} <span class="muted small">${c.paid_by} · ${c.evidence || "-"}${c.include_in_settlement ? "" : " · 정산제외"}</span></th>
          <td class="r">${won(c.amount)}</td><td class="note">${c.memo || ""}</td></tr>`)}</tbody></table>
      ${loans.length > 0 && html`<table class="st" style="margin-top:14px"><caption>재고금융</caption><tbody>
        ${loans.map(l => html`<tr><th>${app.lenders.find(x => x.id === l.lender_id)?.name} · ${l.start_date} · ${l.months}개월 · 딜러 ${l.dealer_rate}% / 캐피탈 ${l.lender_rate ?? "-"}%</th>
          <td class="r">${won(l.amount)}</td><td class="note">${l.status}</td></tr>`)}</tbody></table>`}
      <table class="st" style="margin-top:14px"><caption>매도·매입</caption><tbody>
        <tr><th>매도자(전소유자)</th><td class="r">${car.seller_name || "-"}</td><td class="note">${car.evidence}</td></tr>
        <tr><th>상사매도비 / 성능보험료</th><td class="r">${won(sale.sale_fee)} / ${won(sale.perf_insurance)}</td><td class="note">상사 매출</td></tr>
      </tbody></table>
      <div class="st-meta" style="margin-top:18px"><span>확인: 대표 ____________</span><span>딜러 ____________</span></div>
    </div>`}
  </div>`;
}
