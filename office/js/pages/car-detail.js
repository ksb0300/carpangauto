import { html, useState, useEffect, Loading, Badge, won, go, run, toast } from "../ui.js";
import { q } from "../db.js";
import { CostsTab } from "./tab-costs.js";
import { LoansTab } from "./tab-loans.js";
import { SaleTab } from "./tab-sale.js";
import { SettleTab } from "./tab-settle.js";
import { DocsTab } from "./tab-docs.js";
import { FilesTab } from "./tab-files.js";

export async function loadCar(db, id) {
  const [car, costs, loans, sale, buyers, settlement] = await Promise.all([
    q(db.from("cars").select("*").eq("id", id).maybeSingle()),
    q(db.from("car_costs").select("*").eq("car_id", id).order("sort").order("created_at")),
    q(db.from("car_loans").select("*").eq("car_id", id).order("start_date")),
    q(db.from("car_sales").select("*").eq("car_id", id).maybeSingle()),
    q(db.from("car_buyers").select("*").eq("car_id", id).order("sort")),
    q(db.from("settlements").select("*").eq("car_id", id).maybeSingle()),
  ]);
  if (!car) return null;
  const payments = loans.length ? await q(db.from("loan_payments").select("*").in("loan_id", loans.map(l => l.id)).order("paid_date")) : [];
  return { car, costs, loans: loans.map(l => ({ ...l, payments: payments.filter(p => p.loan_id === l.id) })), sale, buyers, settlement };
}

const TABS = [["info", "제시정보"], ["costs", "상품화비용"], ["loans", "재고금융"], ["sale", "매도"], ["docs", "매출증빙"], ["settle", "정산"], ["files", "첨부서류"]];

export function CarDetail({ app, id, tab }) {
  const [d, setD] = useState(undefined);
  const [ver, setVer] = useState(0);     // 저장 후 탭 입력 상태를 새 데이터로 다시 시작
  const reload = () => run(async () => { setD(await loadCar(app.db, id)); setVer(v => v + 1); });
  useEffect(() => { reload(); }, [id]);

  if (d === undefined) return html`<${Loading} />`;
  if (d === null) return html`<div class="empty">차량을 찾을 수 없습니다. <a href="#/cars">목록으로</a></div>`;
  const { car, costs, loans, sale, settlement } = d;
  const dealer = app.dealers.find(x => x.id === car.dealer_id);
  const cost = costs.reduce((s, r) => s + Number(r.amount), 0);
  const loan = loans.filter(l => l.status === "진행중").reduce((s, r) => s + Number(r.amount), 0);
  const ctx = { app, ...d, reload, locked: !!settlement?.finalized, office: app.profile.role !== "dealer" };

  return html`
    <div class="car-head card">
      <div class="title">
        <a class="back" href="#/cars">← 목록</a>
        <h2>${car.plate} <span>${car.car_name}</span></h2>
        <div class="tags">
          <${Badge} tone=${car.status === "매도" ? "blue" : "gray"}>${car.status}<//>
          ${car.consign === "고객위탁" && html`<${Badge}>고객위탁<//>`}
          ${settlement && html`<${Badge} tone=${settlement.finalized ? "green" : "amber"}>${settlement.finalized ? "정산완료" : "임시정산"}<//>`}
          <span class="muted">${car.code} · ${dealer?.name || "딜러 미지정"} · 제시 ${car.purchase_date}</span>
        </div>
      </div>
      <div class="nums">
        <div><small>제시금액</small><b>${won(car.purchase_amount)}</b></div>
        <div><small>상품화비</small><b>${won(cost)}</b></div>
        <div><small>재고금융</small><b>${won(loan)}</b></div>
        <div><small>매도금액</small><b>${sale ? won(sale.sale_amount) : "-"}</b></div>
        ${settlement && html`<div><small>딜러 실지급</small><b class="blue">${won(settlement.payout)}</b></div>`}
      </div>
    </div>
    <nav class="tabs">${TABS.filter(([k]) => k !== "files" || ctx.office).map(([k, l]) => html`<a class=${tab === k ? "on" : ""} href=${`#/car/${id}/${k}`}>${l}</a>`)}</nav>
    ${tab === "costs" ? html`<${CostsTab} key=${ver} ...${ctx} />`
      : tab === "loans" ? html`<${LoansTab} key=${ver} ...${ctx} />`
      : tab === "sale" ? html`<${SaleTab} key=${ver} ...${ctx} />`
      : tab === "settle" ? html`<${SettleTab} key=${ver} ...${ctx} />`
      : tab === "docs" ? html`<${DocsTab} key=${ver} ...${ctx} />`
      : tab === "files" && ctx.office ? html`<${FilesTab} key=${ver} ...${ctx} />`
      : html`<${InfoTab} key=${ver} ...${ctx} />`}`;
}

function InfoTab({ app, car, sale, office }) {
  const [ssn, setSsn] = useState(null);
  const zone = app.parking.find(p => p.id === car.parking_zone_id);
  const rows = [
    ["제시구분", car.consign], ["제시딜러", app.dealers.find(x => x.id === car.dealer_id)?.name],
    ["제시일", car.purchase_date], ["이전일", car.transfer_date],
    ["제시금액", `${won(car.purchase_amount)} (공급가 ${won(car.purchase_supply)} / 부가세 ${won(car.purchase_vat)})`],
    ["상사매입비", won(car.purchase_fee)], ["(예상)취득세", won(car.acq_tax)],
    ["차종", car.car_kind], ["차량번호(제시전)", car.plate_before], ["제시증빙", car.evidence],
    ["매도자", car.seller_name ? `${car.seller_name} (${car.seller_type})` : null],
    ["주민(법인)번호", ssn ? html`<b>${ssn}</b>` : car.seller_ssn_masked],
    ["사업자번호", car.seller_biz_no], ["연락처", car.seller_phone], ["이메일", car.seller_email],
    ["주소", [car.seller_zip, car.seller_addr1, car.seller_addr2].filter(Boolean).join(" ")],
    ["관인계약서번호", car.contract_no], ["계산서 발행일", car.invoice_date], ["사실확인서", car.fact_confirm],
    ["주차위치", zone?.name], ["Key번호", car.key_no], ["특이사항", car.memo], ["조합제시메모", car.association_memo],
  ];
  const remove = async () => {
    if (sale) return toast("매도된 차량은 삭제할 수 없습니다. 매도취소 후 삭제하세요.", "err");
    if (!confirm(`${car.plate} 제시를 삭제할까요? (목록에서 사라지고, 이력은 남습니다)`)) return;
    const ok = await run(() => q(app.db.from("cars").update({ deleted_at: new Date().toISOString() }).eq("id", car.id).select("id")), "삭제했습니다");
    if (ok) go("/cars");
  };
  return html`<div class="card">
    <div class="bar"><h3>제시정보</h3><span class="grow"></span>
      ${app.profile.role === "admin" && car.seller_ssn_masked && !ssn && html`<button class="btn sm ghost" onClick=${() =>
        run(async () => setSsn(await q(app.db.rpc("reveal_ssn", { p_target: "car_seller", p_id: car.id }))))}>주민번호 원문 보기</button>`}
      ${office && html`<button class="btn" onClick=${() => go(`/car/${car.id}/edit`)}>수정</button>
        <button class="btn danger" onClick=${remove}>제시 삭제</button>`}
    </div>
    <div class="kvgrid">${rows.map(([k, v]) => html`<div><span>${k}</span><b>${v || html`<i class="muted">-</i>`}</b></div>`)}</div>
  </div>`;
}
