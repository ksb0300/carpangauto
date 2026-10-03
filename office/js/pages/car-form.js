import { html, useState, useEffect, Money, Field, Select, Seg, Loading, run, go, today, won, toast } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리, 예상취득세 } from "../calc.js";

const EMPTY = {
  consign: "상사매입", dealer_id: null, car_kind: "승용", car_name: "", plate: "", plate_before: "",
  purchase_date: today(), transfer_date: null, purchase_amount: 0, purchase_fee: 0, acq_tax: 0, evidence: "의제매입",
  seller_name: "", seller_type: "개인", seller_biz_no: "", seller_phone: "", seller_email: "",
  seller_zip: "", seller_addr1: "", seller_addr2: "", contract_no: "", invoice_date: null, fact_confirm: null,
  memo: "", association_memo: "", parking_zone_id: null, key_no: "",
  vin: "", model_year: "", first_reg_date: null, mileage: null, fuel: "", transmission: "", motor_type: "",
};
const EDITABLE = Object.keys(EMPTY);

export function CarForm({ app, id }) {
  const [f, setF] = useState(null);
  const [ssn, setSsn] = useState("");          // 새로 입력한 주민번호 (저장 시 암호화 함수로만 보냄)
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const setT = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => { run(async () => {
    if (!id) return setF({ ...EMPTY, purchase_fee: app.settings.purchase_fee, dealer_id: app.profile.dealer_id || app.dealers[0]?.id || null });
    setF(await q(app.db.from("cars").select("*").eq("id", id).single()));
  }); }, [id]);

  if (!f) return html`<${Loading} />`;
  const vat = 부가세분리(f.purchase_amount);
  const autoTax = 예상취득세(f.purchase_amount, f.car_kind);

  const save = async e => {
    e.preventDefault();
    if (!f.car_name.trim() || !f.plate.trim()) return toast("차명과 번호판은 꼭 입력하세요.", "err");
    if (!f.purchase_amount) return toast("제시금액을 입력하세요.", "err");
    setBusy(true);
    const row = Object.fromEntries(EDITABLE.map(k => [k, f[k] === "" ? null : f[k]]));
    row.plate = row.plate.replace(/\s/g, ""); if (row.plate_before) row.plate_before = row.plate_before.replace(/\s/g, "");
    const saved = await run(async () => {
      const r = id ? await q(app.db.from("cars").update(row).eq("id", id).select("id").single())
                   : await q(app.db.from("cars").insert(row).select("id").single());
      if (ssn.trim()) await q(app.db.rpc("set_ssn", { p_target: "car_seller", p_id: r.id, p_ssn: ssn.trim() }));
      return r;
    }, id ? "수정했습니다" : "등록했습니다");
    setBusy(false);
    if (saved) go("/car/" + saved.id);
  };

  return html`<form class="card form" onSubmit=${save}>
    <div class="bar"><h2>${id ? "제시정보 수정" : "차량 등록 (제시)"}</h2><span class="grow"></span>
      <button type="button" class="btn ghost" onClick=${() => history.back()}>취소</button>
      <button class="btn primary" disabled=${busy}>${busy ? "저장 중…" : "저장"}</button></div>

    <h3>필수 정보</h3>
    <div class="fgrid">
      <${Field} label="제시구분" req><${Seg} value=${f.consign} onChange=${set("consign")} options=${["상사매입", "고객위탁"]} /><//>
      <${Field} label="제시딜러"><${Select} value=${f.dealer_id} onChange=${set("dealer_id")} empty="선택" options=${app.dealers.filter(d => d.active).map(d => [d.id, d.name])} /><//>
      <${Field} label="제시일" req hint="조합전산 제시일"><input type="date" value=${f.purchase_date} onInput=${setT("purchase_date")} required /><//>
      <${Field} label="제시금액" req hint=${f.purchase_amount ? `공급가 ${won(vat.공급가)} / 부가세 ${won(vat.부가세)}` : "부가세 포함 금액"}>
        <${Money} value=${f.purchase_amount} onInput=${set("purchase_amount")} /><//>
      <${Field} label="상사매입비" hint="설정값 자동 · 상품화비용으로 자동 반영"><${Money} value=${f.purchase_fee} onInput=${set("purchase_fee")} /><//>
      <${Field} label="(예상)취득세" hint=${`자동계산 ${won(autoTax)}원 · 감면+최소납부(200만 초과분만 15%)`}>
        <div class="row"><${Money} value=${f.acq_tax} onInput=${set("acq_tax")} />
        <button type="button" class="btn sm" onClick=${() => set("acq_tax")(autoTax)}>자동계산</button></div><//>
      <${Field} label="차종·차명" req>
        <div class="row"><${Select} value=${f.car_kind} onChange=${set("car_kind")} options=${["승용", "승합", "경차", "화물", "특수"]} />
        <input placeholder="예) BMW 530e M 스포츠" value=${f.car_name} onInput=${setT("car_name")} required /></div><//>
      <${Field} label="차량번호(제시후)" req><input placeholder="12가3456" value=${f.plate} onInput=${setT("plate")} required /><//>
      <${Field} label="차량번호(제시전)"><input value=${f.plate_before || ""} onInput=${setT("plate_before")} /><//>
      <${Field} label="매도자(전소유자)"><input value=${f.seller_name || ""} onInput=${setT("seller_name")} /><//>
      <${Field} label="고객유형"><${Seg} value=${f.seller_type} onChange=${set("seller_type")} options=${["개인", "법인"]} /><//>
      <${Field} label="제시증빙"><${Select} value=${f.evidence} onChange=${set("evidence")} options=${["의제매입", "세금계산서", "계산서"]} /><//>
    </div>

    <h3>선택 정보</h3>
    <div class="fgrid">
      <${Field} label="관인계약서번호"><input value=${f.contract_no || ""} onInput=${setT("contract_no")} /><//>
      <${Field} label="이전일" hint="조합전산 이전일"><input type="date" value=${f.transfer_date || ""} onInput=${setT("transfer_date")} /><//>
      <${Field} label="주민(법인)등록번호" hint=${f.seller_ssn_masked ? `저장됨: ${f.seller_ssn_masked} (바꿀 때만 입력)` : "암호화되어 저장됩니다"}>
        <input autocomplete="off" placeholder=${f.seller_ssn_masked || "000000-0000000"} value=${ssn} onInput=${e => setSsn(e.target.value)} /><//>
      <${Field} label="사업자등록번호"><input value=${f.seller_biz_no || ""} onInput=${setT("seller_biz_no")} /><//>
      <${Field} label="연락처"><input value=${f.seller_phone || ""} onInput=${setT("seller_phone")} /><//>
      <${Field} label="이메일"><input type="email" value=${f.seller_email || ""} onInput=${setT("seller_email")} /><//>
      <${Field} label="주소" wide><div class="row">
        <input class="w80" placeholder="우편번호" value=${f.seller_zip || ""} onInput=${setT("seller_zip")} />
        <input placeholder="주소" value=${f.seller_addr1 || ""} onInput=${setT("seller_addr1")} />
        <input placeholder="상세주소" value=${f.seller_addr2 || ""} onInput=${setT("seller_addr2")} /></div><//>
      <${Field} label="계산서 발행일"><input type="date" value=${f.invoice_date || ""} onInput=${setT("invoice_date")} /><//>
      <${Field} label="비사업용 사실확인서"><${Select} value=${f.fact_confirm} onChange=${set("fact_confirm")} empty="선택" options=${["해당없음", "수취", "미수취"]} /><//>
      <${Field} label="주차위치"><${Select} value=${f.parking_zone_id} onChange=${set("parking_zone_id")} empty="선택" options=${app.parking.map(p => [p.id, p.name])} /><//>
      <${Field} label="Key번호"><input value=${f.key_no || ""} onInput=${setT("key_no")} /><//>
      <${Field} label="특이사항" wide><input value=${f.memo || ""} onInput=${setT("memo")} /><//>
      <${Field} label="조합제시메모" wide><input value=${f.association_memo || ""} onInput=${setT("association_memo")} /><//>
    </div>

    <h3>차량 정보 <span class="muted small">성능점검이 연동되면 빈 칸이 자동으로 채워집니다</span></h3>
    <div class="fgrid">
      <${Field} label="차대번호"><input value=${f.vin || ""} onInput=${setT("vin")} /><//>
      <${Field} label="연식"><input value=${f.model_year || ""} onInput=${setT("model_year")} /><//>
      <${Field} label="최초등록일"><input type="date" value=${f.first_reg_date || ""} onInput=${setT("first_reg_date")} /><//>
      <${Field} label="주행거리(km)"><${Money} value=${f.mileage || 0} onInput=${v => set("mileage")(v || null)} /><//>
      <${Field} label="연료"><${Select} value=${f.fuel} onChange=${set("fuel")} empty="선택" options=${["가솔린", "디젤", "LPG", "하이브리드", "전기", "수소전기", "기타"]} /><//>
      <${Field} label="변속기"><${Select} value=${f.transmission} onChange=${set("transmission")} empty="선택" options=${["자동", "수동", "세미오토", "무단변속기", "기타"]} /><//>
      <${Field} label="원동기형식"><input value=${f.motor_type || ""} onInput=${setT("motor_type")} /><//>
    </div>
  </form>`;
}
