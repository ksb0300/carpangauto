import { html, useState, useEffect, Money, Field, Select, Seg, Loading, run, go, today, won, toast } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리, 예상취득세 } from "../calc.js";

const EMPTY = {
  consign: "상사매입", dealer_id: null, car_kind: "승용", car_name: "", plate: "", plate_before: "",
  purchase_date: today(), transfer_date: null, purchase_amount: 0, purchase_fee: 0, acq_tax: 0, evidence: "의제매입",
  seller_name: "", seller_type: "개인", seller_biz_no: "", seller_phone: "", seller_email: "",
  seller_zip: "", seller_addr1: "", seller_addr2: "", contract_no: "", invoice_date: null, fact_confirm: null,
  memo: "", association_memo: "", parking_zone_id: null, key_no: "",
  purchase_channel: null, brand: "", model: "", grade: "", fskey: null, car_type: null,
  vin: "", model_year: "", first_reg_date: null, mileage: null, fuel: "", transmission: "", motor_type: "",
};
const EDITABLE = Object.keys(EMPTY);

// 통합키(fskey = "모델 | 연료 | 등급 [| 트림]", carrot/pricelab keys 어휘표)에서 차명을 고른다
const FUEL = { "가솔린+전기": "하이브리드", "디젤+전기": "하이브리드", "LPG+전기": "하이브리드", "가솔린+LPG": "LPG" };
const keyPatch = (k, p) => ({ fskey: k.key, car_type: k.car_type, car_name: [k.model, k.grade, k.trim].filter(Boolean).join(" "),
  brand: k.brand || p.brand, model: k.model, grade: k.grade, fuel: p.fuel || FUEL[k.fuel] || k.fuel || null });

let keySeq = 0;     // 늦게 온 이전 검색 결과가 최신 결과를 덮지 않게
function KeyPicker({ app, f, onPick, onText }) {
  const [list, setList] = useState(null);
  const search = async text => {
    onText(text);
    const my = ++keySeq;
    const words = text.trim().split(/\s+/).filter(w => w.length >= 1);
    if (!words.length) return setList(null);
    let qy = app.db.from("car_keys").select("car_type,key,brand,model,fuel,grade,trim,stock_now");
    for (const w of words.slice(0, 4)) qy = qy.ilike("key", `%${w}%`);
    const { data } = await qy.order("stock_now", { ascending: false }).limit(15);
    if (my === keySeq) setList(data || []);
  };
  return html`<div class="keypick">
    <input placeholder="통합키에서 검색 — 예) 그랜저 하이브리드, X3 30e" value=${f.car_name} required
      onInput=${e => search(e.target.value)} onBlur=${() => setTimeout(() => setList(null), 200)} />
    ${f.fskey ? html`<small class="hint">통합키: ${f.fskey}</small>` : f.car_name && html`<small class="hint muted">통합키 미연결 — 목록에서 고르면 연결됩니다</small>`}
    ${list && html`<div class="keylist">${!list.length ? html`<div class="muted small">맞는 통합키가 없습니다. 그대로 쓰면 직접 입력한 차명으로 저장됩니다.</div>`
      : list.map(k => html`<button type="button" onMouseDown=${e => e.preventDefault()} onClick=${() => { onPick(k); setList(null); }}>
          <b>${k.brand ? k.brand + " " : ""}${k.model}</b> <span>${[k.grade, k.trim].filter(Boolean).join(" · ")}</span>
          <small class="muted">${k.fuel || ""}${k.car_type === "import" ? " · 수입" : ""}${k.stock_now ? ` · 엔카 재고 ${k.stock_now}` : ""}</small></button>`)}</div>`}
  </div>`;
}
// 엔카 제조사 이름 그대로 (엔카 연동이 채우는 값과 같게)
const BRANDS = ["현대", "기아", "제네시스", "쉐보레(GM대우)", "르노코리아(삼성)", "KG모빌리티(쌍용)", "벤츠", "BMW", "아우디", "폭스바겐", "미니", "포르쉐",
  "볼보", "테슬라", "렉서스", "토요타", "혼다", "랜드로버", "재규어", "지프", "포드", "링컨", "캐딜락", "닛산", "푸조", "BYD", "폴스타", "마세라티", "벤틀리", "람보르기니", "페라리"];

export function CarForm({ app, id }) {
  const [f, setF] = useState(null);
  const [ssn, setSsn] = useState("");          // 새로 입력한 주민번호 (저장 시 암호화 함수로만 보냄)
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const setT = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => { run(async () => {
    if (!id) {
      const dealer_id = app.profile.dealer_id || app.dealers.find(d => d.active)?.id || null;
      return setF({ ...EMPTY, dealer_id, purchase_fee: app.dealers.find(d => d.id === dealer_id)?.partner ? 0 : app.settings.purchase_fee });
    }
    setF(await q(app.db.from("cars").select("*").eq("id", id).single()));
  }); }, [id]);

  if (!f) return html`<${Loading} />`;
  const isPartner = id => !!app.dealers.find(d => d.id === id)?.partner;
  const partner = isPartner(f.dealer_id);
  // 담당을 바꾸면 상사매입비도 따라간다 (대표 0 · 딜러 설정값)
  const pickDealer = v => setF(p => ({ ...p, dealer_id: v, purchase_fee: isPartner(v) ? 0 : (isPartner(p.dealer_id) ? app.settings.purchase_fee : p.purchase_fee) }));
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
      <${Field} label="매입담당" hint=${partner ? "대표 차 — 상사매입비 없음, 손익이 본인 실적" : "딜러 차 — 상사매입비·딜러 정산 적용"}>
        <${Select} value=${f.dealer_id} onChange=${pickDealer} empty="선택" options=${app.dealers.filter(d => d.active || d.id === f.dealer_id).map(d => [d.id, d.name + (d.partner ? " (대표)" : "")])} /><//>
      <${Field} label="제시일" req hint="조합전산 제시일"><input type="date" value=${f.purchase_date} onInput=${setT("purchase_date")} required /><//>
      <${Field} label="제시금액" req hint=${f.purchase_amount ? `공급가 ${won(vat.공급가)} / 부가세 ${won(vat.부가세)}` : "부가세 포함 금액"}>
        <${Money} value=${f.purchase_amount} onInput=${set("purchase_amount")} /><//>
      ${!partner && html`<${Field} label="상사매입비" hint="설정값 자동 · 상품화비용으로 자동 반영"><${Money} value=${f.purchase_fee} onInput=${set("purchase_fee")} /><//>`}
      <${Field} label="(예상)취득세" hint=${`자동계산 ${won(autoTax)}원 · 감면+최소납부(200만 초과분만 15%)`}>
        <div class="row"><${Money} value=${f.acq_tax} onInput=${set("acq_tax")} />
        <button type="button" class="btn sm" onClick=${() => set("acq_tax")(autoTax)}>자동계산</button></div><//>
      <${Field} label="차종·차명" req>
        <div class="row"><${Select} value=${f.car_kind} onChange=${set("car_kind")} options=${["승용", "승합", "경차", "화물", "특수"]} />
        <${KeyPicker} app=${app} f=${f} onPick=${k => setF(p => ({ ...p, ...keyPatch(k, p) }))} onText=${v => setF(p => ({ ...p, car_name: v, fskey: null }))} /></div><//>
      <${Field} label="매입처" hint=${(c => c && Number(c.fee) ? `매입수수료 ${won(c.fee)}원 자동` : "")((app.settings.purchase_channels || []).find(c => c.name === f.purchase_channel))}>
        <${Select} value=${f.purchase_channel} onChange=${set("purchase_channel")} empty="선택" options=${(app.settings.purchase_channels || []).map(c => c.name)} /><//>
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
      <${Field} label="브랜드" hint="엔카에 올라가면 자동으로 채워집니다"><input list="brands" value=${f.brand || ""} onInput=${setT("brand")} />
        <datalist id="brands">${BRANDS.map(b => html`<option value=${b} />`)}</datalist><//>
      <${Field} label="모델"><input value=${f.model || ""} onInput=${setT("model")} /><//>
      <${Field} label="등급"><input value=${f.grade || ""} onInput=${setT("grade")} /><//>
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
