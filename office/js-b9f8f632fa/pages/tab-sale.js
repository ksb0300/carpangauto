import { html, useState, useEffect, Money, Field, Select, run, won, today, toast, go } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리, 할부수수료, 엔카믿고수수료 } from "../calc.js";
import { 매도글, 원, 계약금일시 } from "../forms.js";
import { 보내기 as 알림 } from "../push.js";
import { 짧은차명 } from "./board.js";

export const SALE_TYPES = ["내수판매", "수출", "엔카믿고", "알선판매", "FM", "AM"];

let tmp = 0;
// 매수고객 입력은 조합 전산과 연동되기 전까지 숨긴다 (사용자 2026-10-04). 연동되면 true 로 — 똑순이처럼 공동명의·지분율까지 받는 코드는 그대로 있다
const SHOW_BUYERS = false;
const newBuyer = share => ({ _new: ++tmp, name: "", ssn: "", biz_no: "", phone: "", zip: "", addr: "", memo: "", share_rate: share });

const KST날 = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const 형태글 = t => ({ 내수판매: "내수", 알선판매: "내수" })[t] || t;           // 매도 탭 판매유형 → 게시판 매도형태
const 형태탭 = t => ({ 내수: "내수판매" })[t] || (SALE_TYPES.includes(t) ? t : null);

/** 이 차의 게시판 매도정보 글 (사용자 2026-11-01 매도 탭과 잇기) — car_id 로, 없으면 차량번호로(차 등록 전에 쓴 글).
 *  매입 한 달 전보다 오래된 글(예전에 판 같은 번호 차)은 빼고, 안 끝난 글 먼저. 없으면 null */
async function 이어진글(app, car) {
  const 부터 = car.purchase_date ? new Date(Date.parse(car.purchase_date) - 30 * 864e5).toISOString() : "2000-01-01";
  const 찾기 = b => q(b.eq("category", "매도정보").gte("created_at", 부터).order("created_at", { ascending: false }).limit(5));
  const 열 = "id, title, form, done_at, done_by, created_at, car_id";
  let r = await 찾기(app.db.from("board_posts").select(열).eq("car_id", car.id));
  if (!r.length && car.plate) r = await 찾기(app.db.from("board_posts").select(열).is("car_id", null).eq("plate", car.plate));
  return r.find(p => !p.done_at) || r[0] || null;
}

/** 매도 탭 저장 → 게시판 매도정보 글 새로 올리기 + 알림 (사무장에게 알리는 글을 따로 안 써도 되게).
 *  이미 글이 있으면 건드리지 않는다 (글 고치기는 쓴 사람 몫) — 잔금 완료는 DB 가 양쪽을 맞춘다 */
async function 매도글올리기(app, car, f, 손님) {
  const form = { type: 형태글(f.sale_type), plate: car.plate, car_name: 짧은차명(car.model || car.car_name) || null,
    buyer: 손님.buyer.trim() || null, phone: 손님.phone.trim() || null, amount: Number(f.sale_amount) || 0, fee_included: false,
    deposit: f.contract ? Number(f.deposit_amount) || 0 : null,
    deposit_when: f.contract && f.deposit_at ? new Date(Date.parse(f.deposit_at) + 9 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ") : null,
    memo: [f.contract && f.balance_due ? `잔금 ${Number(f.balance_due.slice(5, 7))}월 ${Number(f.balance_due.slice(8))}일 예정` : "", f.memo || ""].filter(Boolean).join("\n") || null };
  const title = [form.plate, form.car_name, "매도"].filter(Boolean).join(" ");
  const [p] = await q(app.db.from("board_posts").insert({ category: "매도정보", title, body: 매도글(form, form.memo || ""), plate: car.plate, car_id: car.id,
    author_name: app.profile.name, form, notified_at: new Date().toISOString() }).select("id"));
  await 알림(app, { title: `[매도정보] ${title}`, body: `${app.profile.name}${f.contract ? " · 계약중" : ""} · ${원(form.amount)}${form.buyer ? " · " + form.buyer : ""}`,
    url: "/office/#/board/" + p.id, tag: "board-" + p.id, exclude_self: true, pref: "board:매도정보" });
  await app.db.rpc("board_match_sales");      // 이미 들어온 계약금 등을 붙인다
  return p.id;
}

/** 게시판 글 한 줄 (매도 탭 위) */
const 글줄 = p => html`<p class="small" style="margin:0 0 10px">📋 게시판 매도정보 <a href=${"#/board/" + p.id}>${p.title}</a> ·
  ${p.done_at ? html`<b class="green">✔ 잔금 완료</b> <span class="muted">(${p.done_by || ""})</span>` : html`<b>⏳ 잔금 대기</b> <span class="muted">— 통장에 다 들어오면 매도로 자동 확정</span>`}</p>`;

// 알선딜러·출고 번호판 칸은 뺌 (사용자 2026-11-01) — 출고 번호판은 지금 번호판으로 저장(매도 등록증 연결용), 알선딜러는 예전 값만 그대로
export function SaleTab({ app, car, sale, buyers, settlement, reload, locked, office }) {
  const [editing, setEditing] = useState(!sale && office);
  const [할부, set할부] = useState(null);      // 확정된 대표 차: 할부만 바로 고치기 { company, amount, rate }
  const [글, set글] = useState(undefined);     // 이 차의 게시판 매도정보 글 (없으면 null, 읽는 중 undefined)
  useEffect(() => { 이어진글(app, car).then(set글, () => set글(null)); }, [car.id]);
  if (!sale && !office) return html`<div class="card empty">아직 매도되지 않았습니다.${글 ? html`<div style="margin-top:8px">${글줄(글)}</div>` : ""}</div>`;
  if (editing) return html`<${SaleForm} app=${app} car=${car} sale=${sale} buyers=${buyers} post=${글} onDone=${saved => { setEditing(false); if (saved) reload(); }} />`;
  if (!sale) return html`<div class="card empty">아직 매도되지 않았습니다. <button class="btn primary" onClick=${() => setEditing(true)}>매도 처리</button>${글 ? html`<div style="margin-top:8px">${글줄(글)}</div>` : ""}</div>`;

  const dealer = app.dealers.find(d => d.id === sale.dealer_id);
  const cancel = async () => {
    if (settlement?.finalized) return toast("정산완료된 차량입니다. 정산 탭에서 확정을 먼저 해제하세요.", "err");
    if (!confirm("매도를 취소할까요? 차량이 재고로 돌아가고 임시정산도 지워집니다.")) return;
    await run(() => q(app.db.from("car_sales").delete().eq("car_id", car.id)), "매도를 취소했습니다");
    reload();
  };
  // 할부피는 정산 뒤에야 아는 경우가 많다 (사용자 2026-10-26) — 손익확정된 대표 차도 할부만은 확정 해제 없이 고친다.
  //   대표 차 손익(settlements.net_income)도 늘어난 할부수익만큼 같이 고친다 (할부수익은 비과세라 손익 차이 = 수익 차이). 딜러 차는 지급이 끝난 정산이라 확정 해제를 거친다
  const 할부바로 = office && locked && (!settlement || settlement.mode === "대표");
  const 할부저장 = () => run(async () => {
    const before = Number(sale.installment_income) || 0, amount = Number(할부.amount) || 0;
    if (amount > 0 && !할부.company) throw new Error("할부 캐피탈사를 고르세요.");
    const [s2] = await q(app.db.from("car_sales").update({ installment_company: amount > 0 ? 할부.company : null, installment_amount: amount,
      installment_rate: Number(할부.rate) || 0 }).eq("car_id", car.id).select("installment_income"));
    const d = (Number(s2?.installment_income) || 0) - before;
    if (d && settlement?.finalized) await q(app.db.from("settlements").update({ net_income: (Number(settlement.net_income) || 0) + d }).eq("car_id", car.id));
    set할부(null); reload();
  }, "할부를 고쳤습니다");
  const 할부미리 = 할부 ? 할부수수료(할부.amount, 할부.rate) : null;
  // 계약중 (사용자 2026-11-01): 계약금만 받은 차 — 재고 그대로, 잔금 받으면 [잔금 완료]로 매도 확정 (매도일 = 오늘)
  const 잔금완료 = () => confirm("잔금을 다 받았나요? 매도로 확정하고 매도일을 오늘로 합니다.") && run(async () => {
    await q(app.db.from("car_sales").update({ contract: false, sale_date: today() }).eq("car_id", car.id)); reload();
  }, "매도로 확정했습니다");
  const 일시 = iso => iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ") : "-";
  return html`<div class="card">
    ${글 && 글줄(글)}
    ${sale.contract && html`<div class="bank-ok bank-wait" style="margin-bottom:12px">📝 <b>계약중</b>
      <span class="muted small">계약금 ${won(sale.deposit_amount)} · 받은 때 ${일시(sale.deposit_at)} · 잔금 예정 ${sale.balance_due || "-"} — 차는 재고 그대로, 실적에는 안 잡힙니다</span><span class="grow"></span>
      ${office && html`<button class="btn sm primary" onClick=${잔금완료}>잔금 완료 → 매도 확정</button>`}</div>`}
    <div class="bar"><h3>매도정보</h3><span class="grow"></span>
      ${할부바로 && !할부 && html`<button class="btn" title="손익확정을 풀지 않고 할부만 고칩니다" onClick=${() => set할부({ company: sale.installment_company, amount: Number(sale.installment_amount) || 0, rate: Number(sale.installment_rate) || "" })}>할부 고치기</button>`}
      ${office && !locked && html`<button class="btn" onClick=${() => setEditing(true)}>수정</button><button class="btn danger" onClick=${cancel}>매도취소</button>`}
      ${office && !sale.contract && html`<button class="btn primary" onClick=${() => go(`/car/${car.id}/settle`)}>정산하기 →</button>`}</div>
    <div class="kvgrid">
      <div><span>${sale.contract ? "계약일" : "매도일"}</span><b>${sale.sale_date}</b></div>
      <div><span>매도담당</span><b>${dealer?.name || "-"}${sale.other_dealer ? " (타상사딜러)" : ""}</b></div>
      <div><span>매도유형</span><b>${sale.sale_type}</b></div>
      <div><span>매도금액</span><b>${won(sale.sale_amount)} <small class="muted">(공급가 ${won(sale.sale_supply)} / 부가세 ${won(sale.sale_vat)})</small></b></div>
      <div><span>상사매도비</span><b>${won(sale.sale_fee)}</b></div>
      <div><span>성능보험료</span><b>${won(sale.perf_insurance)}</b></div>
      ${Number(sale.am_income) > 0 && html`<div><span>AM수익</span><b>${won(sale.am_income)}</b></div>`}
      ${Number(sale.installment_amount) > 0 && html`<div><span>할부 (${sale.installment_company || "캐피탈사 미입력"})</span><b>${won(sale.installment_income)} <small class="muted">(할부 ${won(sale.installment_amount)} × ${Number(sale.installment_rate)}% = ${won(sale.installment_fee)} − 원천징수 ${won(sale.installment_tax)})</small></b></div>`}
      <div><span>특이사항</span><b>${sale.memo || "-"}</b></div>
    </div>
    ${할부 && html`<div class="bar" style="margin-top:12px"><h3>할부 고치기</h3><span class="muted small">손익확정은 그대로 두고 할부수익·차량 손익만 다시 계산합니다</span></div>
      <div class="fgrid">
        <${Field} label="캐피탈사"><${Select} value=${할부.company} onChange=${v => set할부({ ...할부, company: v })} empty="선택"
          options=${[...new Set([...(app.settings.installment_companies || []), ...(할부.company ? [할부.company] : [])])]} /><//>
        <${Field} label="할부금액"><${Money} value=${할부.amount} onInput=${v => set할부({ ...할부, amount: v })} /><//>
        <${Field} label="할부피(%)" hint=${할부미리?.수수료 ? `수수료 ${won(할부미리.수수료)} − 원천징수 ${won(할부미리.원천징수)} = 수익 ${won(할부미리.수익)}` : "수익 = 할부금액 × 할부피 − 원천징수 3.3%"}>
          <input inputmode="decimal" value=${할부.rate} onInput=${e => set할부({ ...할부, rate: e.target.value })} /><//>
      </div>
      <div class="bar"><span class="grow"></span><button class="btn ghost" onClick=${() => set할부(null)}>취소</button><button class="btn primary" onClick=${할부저장}>저장</button></div>`}
    ${(SHOW_BUYERS || buyers.length > 0) && html`<h3>매수고객</h3>
    <div class="table-wrap"><table class="grid"><thead><tr><th>고객명</th><th>주민(법인)번호</th><th>사업자번호</th><th>연락처</th><th>주소</th><th class="r">지분율</th></tr></thead>
      <tbody>${buyers.map(b => html`<tr><td>${b.name}</td><td>${b.ssn_masked || "-"}</td><td>${b.biz_no || "-"}</td><td>${b.phone || "-"}</td><td>${b.addr || "-"}</td><td class="r">${b.share_rate}%</td></tr>`)}</tbody></table></div>`}
  </div>`;
}

function SaleForm({ app, car, sale, buyers, post, onDone }) {
  const [f, setF] = useState(sale ? { ...sale } : {
    sale_date: today(), dealer_id: car.dealer_id, other_dealer: false, sale_type: "내수판매",
    sale_amount: car.list_price ? Number(car.list_price) : 0,   // 리스트에 넣은 판매가(매도비 제외 차값)
    plate_out: car.plate, sale_fee: app.settings.sale_fee, perf_insurance: 0, memo: "", broker_dealer_id: null,
    installment_company: null, installment_amount: 0, installment_rate: 0, am_income: 0,
    contract: false, deposit_amount: 0, deposit_at: null, balance_due: null });
  const [손님, set손님] = useState({ buyer: post?.form?.buyer || "", phone: post?.form?.phone || "" });   // 게시판 글에만 (매수고객 칸은 숨김 중)
  const [올리기, set올리기] = useState(true);
  const [채움, set채움] = useState(false);
  // 새 매도: 게시판 매도정보 글이 먼저 있으면 그 내용으로 채운다 — 계약금만 받은 글이면 계약중
  useEffect(() => { if (sale || !post) return;
    const g = post.form || {}, 계약 = !post.done_at && Number(g.deposit) > 0;
    const 받은때 = 계약금일시(g.deposit_when, post.created_at);
    const 잔 = (String(g.memo || "").match(/잔금[^\n]{0,10}?(\d{1,2}\s*[월./]\s*\d{1,2})/) || [])[1];
    const 잔금일 = 잔 && 계약금일시(잔, post.created_at);
    setF(p => ({ ...p, sale_type: 형태탭(g.type) || p.sale_type,
      sale_amount: Number(g.amount) ? Number(g.amount) - (g.fee_included ? Number(p.sale_fee) || 0 : 0) : p.sale_amount,
      sale_date: post.done_at ? KST날(post.done_at) : 계약 ? KST날(받은때 || post.created_at) : p.sale_date,
      contract: 계약, deposit_amount: 계약 ? Number(g.deposit) : 0, deposit_at: 계약 ? 받은때 : null, balance_due: 계약 && 잔금일 ? KST날(잔금일) : null,
      memo: p.memo || g.memo || "" }));
    set손님({ buyer: g.buyer || "", phone: g.phone || "" }); set채움(true);
  }, [post?.id]);
  const 글금액 = post?.form?.amount ? Number(post.form.amount) - (post.form.fee_included ? Number(f.sale_fee) || 0 : 0) : null;
  const [bs, setBs] = useState(buyers.length ? buyers.map(b => ({ ...b, ssn: "" })) : [newBuyer(100)]);
  // 새 매도: 성능보험료는 최근 성능점검(KAIWA)의 보험료를 기본값으로 (손님이 내는 돈 — 현금영수증용)
  useEffect(() => { if (!sale) run(async () => {
    const r = await q(app.db.from("car_inspections").select("insur_price").eq("car_id", car.id).order("recept_date", { ascending: false }).limit(1));
    if (r[0]?.insur_price) setF(p => p.perf_insurance ? p : { ...p, perf_insurance: Number(r[0].insur_price) });
  }); }, []);
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const upd = (i, k, v) => setBs(x => x.map((b, j) => j === i ? { ...b, [k]: v } : b));
  const vat = 부가세분리(f.sale_amount);
  const 할부 = 할부수수료(f.installment_amount, f.installment_rate);
  // 엔카믿고도 매도비는 그대로(고객이 44만원 냄) — 엔카가 떼는 수수료는 저장하면 상품화비용으로 자동 등록
  const pickType = v => setF(p => ({ ...p, sale_type: v }));
  const shareSum = bs.reduce((s, b) => s + Number(b.share_rate || 0), 0);

  const save = async e => {
    e.preventDefault();
    if (!f.sale_amount) return toast("매도금액을 입력하세요.", "err");
    if (SHOW_BUYERS) for (const b of bs) {
      if (!b.name.trim()) return toast("매수고객 이름을 입력하세요.", "err");
      if (!b.ssn.trim() && !b.ssn_masked && !b.biz_no?.trim()) return toast(`${b.name}: 주민번호나 사업자번호 중 하나는 꼭 입력하세요.`, "err");
    }
    if (SHOW_BUYERS && Math.abs(shareSum - 100) > 0.001) return toast(`지분율 합계가 100%가 아닙니다 (${shareSum}%).`, "err");
    if (Number(f.installment_amount) > 0 && !f.installment_company) return toast("할부 캐피탈사를 고르세요.", "err");
    setBusy(true);
    const ok = await run(async () => {
      const row = { car_id: car.id, sale_date: f.sale_date, dealer_id: f.dealer_id, other_dealer: f.other_dealer, sale_type: f.sale_type,
        sale_amount: f.sale_amount, plate_out: f.plate_out || null, sale_fee: f.sale_fee, perf_insurance: f.perf_insurance, memo: f.memo || null,
        broker_dealer_id: f.broker_dealer_id || null,
        installment_company: Number(f.installment_amount) > 0 ? (f.installment_company || null) : null,
        installment_amount: Number(f.installment_amount) || 0, installment_rate: Number(f.installment_rate) || 0,
        am_income: f.sale_type === "AM" ? Number(f.am_income) || 0 : 0,
        // 계약중 칸 — DB 에 칸이 있을 때(기존 매도에 contract 가 있거나 계약중을 체크했을 때)만 보낸다
        ...(f.contract || (sale && "contract" in sale) ? { contract: !!f.contract, deposit_amount: Number(f.deposit_amount) || 0,
          deposit_at: f.deposit_at ? new Date(f.deposit_at).toISOString() : null, balance_due: f.balance_due || null } : {}) };
      if (sale) await q(app.db.from("car_sales").update(row).eq("car_id", car.id));
      else await q(app.db.from("car_sales").insert(row));
      if (post === null && 올리기 && (!sale || f.contract)) { await 매도글올리기(app, car, f, 손님); toast("게시판 매도정보에도 올리고 알렸습니다"); }
      if (!SHOW_BUYERS) return true;     // 매수고객 숨김 중 — 기존 기록은 건드리지 않는다
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
    ${채움 && html`<p class="note">📋 게시판 매도정보 글 <a href=${"#/board/" + post.id}>${post.title}</a> 내용으로 채웠습니다 — 확인하고 저장하세요.</p>`}
    ${post && !채움 && 글줄(post)}
    <div class="fgrid">
      <${Field} label="계약중" hint=${f.contract ? "계약금만 받음 — 차는 재고 그대로, 실적에 안 잡힘. 잔금 받으면 체크를 풀거나 [잔금 완료]" : "잔금까지 다 받았으면 체크하지 않습니다"}>
        <label class="check"><input type="checkbox" checked=${!!f.contract} onChange=${e => setF(p => ({ ...p, contract: e.target.checked, ...(!e.target.checked && p.contract ? { sale_date: today() } : {}) }))} /> 계약금만 받았음</label><//>
      <${Field} label=${f.contract ? "계약일" : "매도일"} req><input type="date" value=${f.sale_date} onInput=${e => set("sale_date")(e.target.value)} required /><//>
      ${f.contract && html`<${Field} label="계약금"><${Money} value=${f.deposit_amount || 0} onInput=${set("deposit_amount")} /><//>
      <${Field} label="계약금 받은 일시" hint="대충이라도"><input type="datetime-local" value=${f.deposit_at ? new Date(Date.parse(f.deposit_at) + 9 * 3600e3).toISOString().slice(0, 16) : ""}
        onInput=${e => set("deposit_at")(e.target.value ? e.target.value + ":00+09:00" : null)} /><//>
      <${Field} label="잔금 예정일" hint="대충이라도"><input type="date" value=${f.balance_due || ""} onInput=${e => set("balance_due")(e.target.value || null)} /><//>`}
      <${Field} label="매도담당"><div class="row"><${Select} value=${f.dealer_id} onChange=${set("dealer_id")} options=${app.dealers.map(d => [d.id, d.name + (d.partner ? " (대표)" : "")])} />
        <label class="check"><input type="checkbox" checked=${f.other_dealer} onChange=${e => set("other_dealer")(e.target.checked)} /> 타상사딜러</label></div><//>
      <${Field} label="판매유형" hint=${f.sale_type === "수출" ? "수출 — 성능점검비가 22,000원으로 바뀝니다" : f.sale_type === "엔카믿고" ? `엔카믿고 — 수수료 ${won(엔카믿고수수료(f.sale_amount))}원이 상품화비용으로 자동 등록됩니다 (매도비에서 엔카가 떼고 입금)` : ""}>
        <${Select} value=${f.sale_type} onChange=${pickType} options=${SALE_TYPES} /><//>
      ${f.sale_type === "AM" && html`<${Field} label="AM수익" hint="마진(차량 손익)에 더해집니다"><${Money} value=${f.am_income || 0} onInput=${set("am_income")} /><//>`}
      <${Field} label="매도금액" req hint=${글금액 != null && 글금액 !== Number(f.sale_amount) ? html`<span class="red">게시판 글은 ${won(글금액)} (매도비 빼고) — 다릅니다</span>`
        : f.sale_amount ? `공급가 ${won(vat.공급가)} / 부가세 ${won(vat.부가세)}` : "부가세 포함"}><${Money} value=${f.sale_amount} onInput=${set("sale_amount")} /><//>
      <${Field} label="상사매도비" hint="상사 매출로 잡힙니다"><${Money} value=${f.sale_fee} onInput=${set("sale_fee")} /><//>
      <${Field} label="성능보험료" hint="손님이 내는 돈 — 현금영수증용, 손익에는 안 들어감"><${Money} value=${f.perf_insurance} onInput=${set("perf_insurance")} /><//>
      <${Field} label="구매자 (입금자명)" hint="통장 입금과 짝짓기용 — 게시판 매도정보 글에 들어갑니다"><input value=${손님.buyer} onInput=${e => set손님(s => ({ ...s, buyer: e.target.value }))} /><//>
      <${Field} label="구매자 연락처"><input inputmode="tel" value=${손님.phone} onInput=${e => set손님(s => ({ ...s, phone: e.target.value }))} /><//>
      <${Field} label="특이사항" wide><input value=${f.memo || ""} onInput=${e => set("memo")(e.target.value)} /><//>
      ${post === null && (!sale || f.contract) && html`<${Field} label="게시판" wide hint="사무장님께 알림이 갑니다 — 통장에 잔금이 다 들어오면 매도로 자동 확정">
        <label class="check"><input type="checkbox" checked=${올리기} onChange=${e => set올리기(e.target.checked)} /> 게시판 매도정보에도 올리기</label><//>`}
    </div>
    <div class="bar"><h3>할부 내용</h3><span class="muted small">할부(금융)로 판 경우만 — 재고금융 → 할부실적에 캐피탈사별로 쌓입니다</span></div>
    <div class="fgrid">
      <${Field} label="캐피탈사"><${Select} value=${f.installment_company} onChange=${set("installment_company")} empty="선택"
        options=${[...new Set([...(app.settings.installment_companies || []), ...(f.installment_company ? [f.installment_company] : [])])]} /><//>
      <${Field} label="할부금액"><${Money} value=${f.installment_amount} onInput=${set("installment_amount")} /><//>
      <${Field} label="할부피(%)" hint=${할부.수수료 ? `수수료 ${won(할부.수수료)} − 원천징수 ${won(할부.원천징수)} = 수익 ${won(할부.수익)}` : "수익 = 할부금액 × 할부피 − 원천징수 3.3%"}>
        <input inputmode="decimal" value=${f.installment_rate || ""} onInput=${e => set("installment_rate")(e.target.value)} /><//>
    </div>
    ${SHOW_BUYERS && html`<div class="bar"><h3>매수고객</h3><span class=${"muted" + (Math.abs(shareSum - 100) > 0.001 ? " red" : "")}>지분율 합계 ${shareSum}%</span><span class="grow"></span>
      <button type="button" class="btn sm" onClick=${() => setBs(x => [...x, newBuyer(0)])}>+ 공동명의 추가</button></div>
    ${bs.map((b, i) => html`<div class="buyer fgrid">
      <${Field} label="고객명" req><input value=${b.name} onInput=${e => upd(i, "name", e.target.value)} /><//>
      <${Field} label="주민(법인)번호" hint=${b.ssn_masked ? `저장됨 ${b.ssn_masked}` : "암호화 저장"}><input autocomplete="off" placeholder=${b.ssn_masked || ""} value=${b.ssn} onInput=${e => upd(i, "ssn", e.target.value)} /><//>
      <${Field} label="사업자번호"><input value=${b.biz_no || ""} onInput=${e => upd(i, "biz_no", e.target.value)} /><//>
      <${Field} label="연락처"><input value=${b.phone || ""} onInput=${e => upd(i, "phone", e.target.value)} /><//>
      <${Field} label="주소" wide><input value=${b.addr || ""} onInput=${e => upd(i, "addr", e.target.value)} /><//>
      <${Field} label="지분율(%)"><div class="row"><input inputmode="decimal" value=${b.share_rate} onInput=${e => upd(i, "share_rate", e.target.value)} />
        ${bs.length > 1 && html`<button type="button" class="btn sm ghost" onClick=${() => setBs(x => x.filter((_, j) => j !== i))}>삭제</button>`}</div><//>
    </div>`)}`}
  </form>`;
}
