import { html, useState, useEffect, Loading, Badge, won, go, run, toast } from "../ui.js";
import { q } from "../db.js";
import { CostsTab } from "./tab-costs.js";
import { LoansTab } from "./tab-loans.js";
import { SaleTab } from "./tab-sale.js";
import { SettleTab } from "./tab-settle.js";
import { DocsTab } from "./tab-docs.js";
import { FilesTab } from "./tab-files.js";
import { InspectionCard } from "./tab-insp.js";

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

const TABS = [["info", "차량정보"], ["costs", "상품화비용"], ["loans", "재고금융"], ["sale", "매도"], ["docs", "매출증빙"], ["settle", "정산"], ["files", "첨부서류"]];

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
        <a class="back" href="#/purchases" onClick=${e => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>← 목록</a>
        <h2>${car.plate} <span>${car.car_name}</span></h2>
        <div class="tags">
          <${Badge} tone=${car.status === "매도" ? "blue" : "gray"}>${car.status}<//>
          ${car.consign === "고객위탁" && html`<${Badge}>고객위탁<//>`}
          ${settlement && html`<${Badge} tone=${settlement.finalized ? "green" : "amber"}>${settlement.mode === "대표" ? (settlement.finalized ? "손익확정" : "임시") : settlement.finalized ? "정산완료" : "임시정산"}<//>`}
          <span class="muted">${car.code} · ${dealer ? dealer.name + (dealer.partner ? " (대표)" : "") : "담당 미지정"} · 매입 ${car.purchase_date}</span>
        </div>
      </div>
      <div class="nums">
        <div><small>매입가</small><b>${won(car.purchase_amount)}</b></div>
        <div><small>상품화비</small><b>${won(cost)}</b></div>
        <div><small>재고금융</small><b>${won(loan)}</b></div>
        <div><small>매도금액</small><b>${sale ? won(sale.sale_amount) : "-"}</b></div>
        ${settlement && (settlement.mode === "대표" ? html`<div><small>차량 손익</small><b class=${Number(settlement.net_income) < 0 ? "red" : "blue"}>${won(settlement.net_income)}</b></div>`
          : html`<div><small>딜러 실지급</small><b class="blue">${won(settlement.payout)}</b></div>`)}
      </div>
    </div>
    ${ctx.office && html`<${SendBox} app=${app} car=${car} sale=${sale} />`}
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
  const rows = [
    ["매입담당", (d => d ? d.name + (d.partner ? " (대표)" : " (딜러)") : html`<span class="red">미지정</span>`)(app.dealers.find(x => x.id === car.dealer_id))],
    ["매입일", car.purchase_date],
    ["매입가", `${won(car.purchase_amount)} (공급가 ${won(car.purchase_supply)} / 부가세 ${won(car.purchase_vat)})`],
    ["매입처", car.purchase_channel], ["매입증빙", car.evidence], ["취득세", won(car.acq_tax)],
    ...(Number(car.purchase_fee) ? [["상사매입비", won(car.purchase_fee)]] : []),
    ["브랜드 · 모델", [car.brand, car.model, car.grade].filter(Boolean).join(" · ")], ["통합키", car.fskey],
    ["차대번호", car.vin], ["연식", car.model_year], ["최초등록일", car.first_reg_date],
    ["주행거리", car.mileage != null ? `${won(car.mileage)} km` : null], ["연료 · 변속기", [car.fuel, car.transmission].filter(Boolean).join(" · ")], ["원동기형식", car.motor_type],
    ["Key번호", car.key_no], ["메모", car.memo],
  ];
  const remove = async () => {
    if (sale) return toast("매도된 차량은 삭제할 수 없습니다. 매도취소 후 삭제하세요.", "err");
    if (!confirm(`${car.plate} 차량을 삭제할까요? (목록에서 사라지고, 이력은 남습니다)`)) return;
    const ok = await run(() => q(app.db.from("cars").update({ deleted_at: new Date().toISOString() }).eq("id", car.id).select("id")), "삭제했습니다");
    if (ok) go("/cars");
  };
  return html`<div class="card">
    <div class="bar no-print"><h3>차량정보</h3><span class="grow"></span>
      <button class="btn ghost" onClick=${() => print()}>인쇄</button>
      ${office && html`<button class="btn" onClick=${() => go(`/car/${car.id}/edit`)}>수정</button>
        <button class="btn danger" onClick=${remove}>차량 삭제</button>`}
    </div>
    <div class="kvgrid">${rows.map(([k, v]) => html`<div><span>${k}</span><b>${v || html`<i class="muted">-</i>`}</b></div>`)}</div>
  </div>
  <${InspectionCard} app=${app} car=${car} office=${office} />`;
}

/** 고객에게 보내기 — 손님이 "견적서·성능지 받을 수 있나요?" 할 때 폰에서 바로 (카톡·문자 공유창) */
function SendBox({ app, car, sale }) {
  const [pdf, setPdf] = useState(undefined);      // 성능점검기록부 파일 (미리 받아 둔다 — 공유창은 누른 직후에 열어야 해서)
  useEffect(() => { run(async () => {
    const f = (await q(app.db.from("car_files").select("path,name").eq("car_id", car.id).eq("kind", "성능").order("created_at", { ascending: false }).limit(1)))[0];
    if (!f) return setPdf(null);
    const { data } = await app.db.storage.from("car-files").createSignedUrl(f.path, 3600);
    const blob = data?.signedUrl ? await (await fetch(data.signedUrl)).blob() : null;
    setPdf(blob ? new File([blob], `성능점검기록부_${car.plate}.pdf`, { type: "application/pdf" }) : null);
  }); }, [car.id]);
  const price = sale ? Number(sale.sale_amount) : Number(car.list_price || car.ad_price || 0);
  const quoteUrl = `${location.origin}/quote/?car=${encodeURIComponent(car.plate)}${price ? "&price=" + price : ""}`;
  const encarUrl = car.encar_id ? `https://fem.encar.com/cars/detail/${car.encar_id}` : null;
  const sharePdf = async () => {
    if (navigator.canShare?.({ files: [pdf] })) { try { await navigator.share({ files: [pdf], title: `${car.plate} 성능점검기록부` }); } catch {} return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(pdf); a.download = pdf.name; a.click();    // PC: 내려받기
  };
  const shareLink = async (url, title) => {
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { return; } }
    try { await navigator.clipboard.writeText(url); toast("링크를 복사했습니다 — 카톡에 붙여 넣으세요"); } catch { window.open(url, "_blank"); }
  };
  return html`<div class="card sendbox no-print"><b>고객에게 보내기</b>
    <button class="btn" disabled=${!pdf} title=${pdf === null ? "KAIWA 성능점검기록부가 아직 없습니다" : ""} onClick=${sharePdf}>${pdf === undefined ? "성능지 준비 중…" : pdf ? "📄 성능지 보내기" : "성능지 없음"}</button>
    <a class="btn" href=${quoteUrl} target="_blank" rel="noopener" title=${price ? `${won(price)}원으로 견적서를 엽니다` : "가격 없이 엽니다"}>🧾 견적서 만들기</a>
    ${encarUrl && html`<button class="btn" onClick=${() => shareLink(encarUrl, `${car.car_name} ${car.plate}`)}>🔗 엔카 광고 링크</button>`}
  </div>`;
}
