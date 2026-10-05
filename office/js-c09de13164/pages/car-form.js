import { html, useState, useEffect, Money, Field, Select, Seg, Loading, run, go, today, won, toast } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리, 예상취득세 } from "../calc.js";

// 직접 입력은 간단하게 — 조합 제시는 조합 전산에서 하고, 여기선 장부용으로 최소한만 적는다.
// 차명은 통합키에서 고르고(브랜드·모델·등급 따라옴), 차량정보(차대번호·연식·주행거리 등)는 성능점검(KAIWA)이 채운다.
const EMPTY = {
  dealer_id: null, car_name: "", plate: "", purchase_date: today(), purchase_amount: 0, purchase_fee: 0, acq_tax: 0,
  evidence: "의제매입", purchase_channel: null, key_no: "", memo: "",
  fskey: null, car_type: null, brand: null, model: null, grade: null, fuel: null,
};
const EDITABLE = Object.keys(EMPTY);   // 수정할 때도 이 칸들만 보낸다 (예전에 넣은 매도자 정보 등은 그대로 둔다)

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
    const { data } = await qy.order("stock_now", { ascending: false }).limit(30);
    if (my === keySeq) setList(data || []);
  };
  return html`<div class="keypick">
    <input placeholder="예) 쏘렌토" value=${f.car_name} required autocomplete="off"
      onInput=${e => search(e.target.value)} onFocus=${e => !f.fskey && e.target.value && search(e.target.value)} onBlur=${() => setTimeout(() => setList(null), 200)} />
    ${list && html`<div class="keylist">${!list.length ? html`<div class="muted small">맞는 통합키가 없습니다. 그대로 쓰면 직접 입력한 차명으로 저장됩니다.</div>`
      : list.map(k => html`<button type="button" onMouseDown=${e => e.preventDefault()} onClick=${() => { onPick(k); setList(null); }}>
          <b>${k.brand ? k.brand + " " : ""}${k.model}</b> <span>${[k.grade, k.trim].filter(Boolean).join(" · ")}</span>
          <small class="muted">${k.fuel || ""}${k.car_type === "import" ? " · 수입" : ""}${k.stock_now ? ` · 엔카 재고 ${k.stock_now}` : ""}</small></button>`)}</div>`}
  </div>`;
}
export function CarForm({ app, id }) {
  const [f, setF] = useState(null);
  const [taxEdited, setTaxEdited] = useState(false);     // 취득세를 손으로 고치면 매입가가 바뀌어도 자동계산을 덮지 않는다
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const setT = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => { run(async () => {
    if (!id) {
      const dealer_id = app.profile.dealer_id || null;
      return setF({ ...EMPTY, dealer_id, purchase_fee: app.dealers.find(d => d.id === dealer_id)?.partner ? 0 : dealer_id ? app.settings.purchase_fee : 0 });
    }
    setF(await q(app.db.from("cars").select("*").eq("id", id).single())); setTaxEdited(true);
  }); }, [id]);

  if (!f) return html`<${Loading} />`;
  const isPartner = id => !!app.dealers.find(d => d.id === id)?.partner;
  const partner = isPartner(f.dealer_id);
  // 담당을 바꾸면 상사매입비도 따라간다 (대표 0 · 딜러 설정값)
  const pickDealer = v => setF(p => ({ ...p, dealer_id: v, purchase_fee: isPartner(v) || !v ? 0 : (isPartner(p.dealer_id) || !p.dealer_id ? app.settings.purchase_fee : p.purchase_fee) }));
  const vat = 부가세분리(f.purchase_amount);
  const autoTax = 예상취득세(f.purchase_amount, f.car_kind || "승용");
  const setPrice = v => setF(p => ({ ...p, purchase_amount: v, ...(taxEdited ? {} : { acq_tax: 예상취득세(v, p.car_kind || "승용") }) }));
  const channel = (app.settings.purchase_channels || []).find(c => c.name === f.purchase_channel);

  const save = async e => {
    e.preventDefault();
    if (!f.car_name.trim() || !f.plate.trim()) return toast("차명과 차량번호는 꼭 입력하세요.", "err");
    if (!f.purchase_amount) return toast("매입가를 입력하세요.", "err");
    setBusy(true);
    const row = Object.fromEntries(EDITABLE.map(k => [k, f[k] === "" ? null : f[k]]));
    row.plate = row.plate.replace(/\s/g, "");
    if (!id) row.plate_before = row.plate;       // 성능점검(KAIWA) 짝짓기용
    const saved = await run(async () => id ? await q(app.db.from("cars").update(row).eq("id", id).select("id").single())
                                           : await q(app.db.from("cars").insert(row).select("id").single()), id ? "수정했습니다" : "등록했습니다");
    setBusy(false);
    if (saved) go("/car/" + saved.id);
  };

  return html`<form class="card form" onSubmit=${save}>
    <div class="bar"><h2>${id ? "차량 정보 수정" : "차량 등록"}</h2><span class="grow"></span>
      <button type="button" class="btn ghost" onClick=${() => history.back()}>취소</button>
      <button class="btn primary" disabled=${busy}>${busy ? "저장 중…" : "저장"}</button></div>
    <div class="fgrid">
      <${Field} label="차명" req wide hint=${f.fskey ? `통합키: ${f.fskey}` : "대충 적어도 됩니다 (예: 쏘렌토) — 엔카 광고가 올라가면 통합키로 차명이 자동으로 바뀝니다. 아래 목록에서 골라도 됩니다"}>
        <${KeyPicker} app=${app} f=${f} onPick=${k => setF(p => ({ ...p, ...keyPatch(k, p) }))} onText=${v => setF(p => ({ ...p, car_name: v, fskey: null }))} /><//>
      <${Field} label="차량번호" req><input placeholder="12가3456" value=${f.plate} onInput=${setT("plate")} required /><//>
      <${Field} label="매입일" req><input type="date" value=${f.purchase_date} onInput=${setT("purchase_date")} required /><//>
      <${Field} label="매입가" req hint=${f.purchase_amount ? `공급가 ${won(vat.공급가)} / 부가세 ${won(vat.부가세)}` : "부가세 포함"}>
        <${Money} value=${f.purchase_amount} onInput=${setPrice} /><//>
      <${Field} label="매입담당" hint=${!f.dealer_id ? "" : partner ? "대표 — 상사매입비 없음, 손익이 본인 실적" : "딜러 — 상사매입비·딜러 정산 적용"}>
        <${Select} value=${f.dealer_id} onChange=${pickDealer} empty="선택" options=${app.dealers.filter(d => d.active || d.id === f.dealer_id).map(d => [d.id, d.name + (d.partner ? "" : " (딜러)")])} /><//>
      <${Field} label="매입처" hint=${channel && Number(channel.fee) ? `매입수수료 ${won(channel.fee)}원 자동` : ""}>
        <${Select} value=${f.purchase_channel} onChange=${set("purchase_channel")} empty="선택" options=${(app.settings.purchase_channels || []).map(c => c.name)} /><//>
      <${Field} label="매입증빙" hint=${f.evidence === "세금계산서" ? "사업자(렌트사·법인 등)에게 사서 세금계산서를 받은 경우" : "개인에게 산 경우 (대부분)"}>
        <${Seg} value=${f.evidence} onChange=${set("evidence")} options=${["의제매입", "세금계산서"]} /><//>
      <${Field} label="취득세" hint=${`자동계산 ${won(autoTax)}원`}>
        <div class="row"><${Money} value=${f.acq_tax} onInput=${v => { setTaxEdited(true); set("acq_tax")(v); }} />
        <button type="button" class="btn sm" onClick=${() => { setTaxEdited(false); set("acq_tax")(autoTax); }}>자동계산</button></div><//>
      ${f.dealer_id && !partner && html`<${Field} label="상사매입비" hint="딜러 차 — 상품화비용으로 자동 반영"><${Money} value=${f.purchase_fee} onInput=${set("purchase_fee")} /><//>`}
      <${Field} label="Key번호"><input value=${f.key_no || ""} onInput=${setT("key_no")} /><//>
      <${Field} label="메모" wide><input value=${f.memo || ""} onInput=${setT("memo")} /><//>
    </div>
    <p class="note">차대번호·연식·최초등록일·주행거리·연료·변속기는 성능점검(KAIWA)이 끝나면 자동으로 채워집니다.</p>
  </form>`;
}
