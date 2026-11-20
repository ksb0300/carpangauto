import { html, useState, useEffect, Money, Field, Select, run, won, today, toast, go } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리, 할부수수료, 엔카믿고수수료 } from "../calc.js";
import { 계약금일시 } from "../forms.js";

export const SALE_TYPES = ["내수판매", "수출", "엔카믿고", "알선판매", "FM", "AM"];

let tmp = 0;
// 매수고객 입력은 조합 전산과 연동되기 전까지 숨긴다 (사용자 2026-10-04). 연동되면 true 로 — 똑순이처럼 공동명의·지분율까지 받는 코드는 그대로 있다
const SHOW_BUYERS = false;
const newBuyer = share => ({ _new: ++tmp, name: "", ssn: "", biz_no: "", phone: "", zip: "", addr: "", memo: "", share_rate: share });

const KST날 = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
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

// 매도 탭 저장 → 게시판 매도정보 글은 DB 가 올린다 (트리거 car_sales_board_post — 배포 전에 열어 둔 옛 화면에서도 빠지지 않게).
//   이미 글이 있으면 건드리지 않는다 (글 고치기는 쓴 사람 몫), 알림은 tick 이 1분 안에. 잔금 완료는 DB 가 양쪽을 맞춘다

/** 매도대금으로 고를 수 있는 통장 입금 — 다른 이름으로 들어온 계약금·잔금 (사용자 2026-11-01).
 *  최근 2주, 아직 안 나눈 입금 + 이 차(이 글)에 이미 이은 입금. 다른 글·다른 용도로 나눈 건 뺀다 */
export async function 고를입금(app, { car_id = null, post_id = null, from = null } = {}) {
  const 부터 = from || new Date(Date.now() + 9 * 3600e3 - 14 * 864e5).toISOString().slice(0, 10);
  const r = await q(app.db.from("bank_txs").select("id, tx_date, tx_time, deposit, counterparty, remark, match_kind, car_id, post_id")
    .gt("deposit", 0).gte("tx_date", 부터).order("tx_date", { ascending: false }).order("tx_time", { ascending: false }).limit(300));
  return r.filter(t => (!t.post_id || t.post_id === post_id)
    && (!t.match_kind || (t.match_kind === "차량매도대금" && (!t.car_id || t.car_id === car_id))));
}
export const 입금글 = t => `${t.tx_date.slice(5).replace("-", "/")} ${t.tx_time || ""} ${t.counterparty || t.remark || "?"} ${won(t.deposit)}원`;

const 키 = s => String(s || "").toLowerCase().replace(/\(주\)|㈜|주식회사|[\s()·.,\-[\]]/g, "");
/** 이 차에 이은 매도대금 입금 */
const 이은입금 = (app, car_id) => q(app.db.from("bank_txs").select("id, tx_date, tx_time, deposit, counterparty, remark, matched_by")
  .eq("car_id", car_id).eq("match_kind", "차량매도대금").gt("deposit", 0).order("tx_date").order("tx_time"));
const 합 = r => r.reduce((s, t) => s + (Number(t.deposit) || 0), 0);

/** 통장 입금 고르기 (사용자 2026-11-15 "매도 올릴 때 무조건 연결") — 검색 + 체크. 구매자 이름이 들어간 입금은 위로 */
function 입금고르기({ list, picked, setPicked, buyer }) {
  const [찾기, set찾기] = useState("");
  const b = 키(buyer).slice(0, 3);
  const 맞음 = t => b.length >= 2 && 키(t.counterparty || t.remark).includes(b);
  const 보임 = list.filter(t => 찾기 ? 키(입금글(t)).includes(키(찾기)) || String(t.deposit).includes(찾기.replace(/\D/g, "") || "@")
                                 : Number(t.deposit) >= 100000 || picked.has(t.id))      // 이자·환급 같은 잔돈은 찾을 때만
    .sort((x, y) => (picked.has(y.id) - picked.has(x.id)) || (맞음(y) - 맞음(x)));
  const 토글 = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return html`<div>
    <input placeholder="이름·금액으로 찾기" value=${찾기} onInput=${e => set찾기(e.target.value)} style="margin-bottom:6px" />
    <div style="max-height:220px;overflow:auto;border:1px solid var(--line, #ddd);border-radius:8px;padding:4px 8px">
      ${보임.length ? 보임.map(t => html`<label class="check" style="display:flex;padding:3px 0">
        <input type="checkbox" checked=${picked.has(t.id)} onChange=${() => 토글(t.id)} /> ${입금글(t)}${맞음(t) ? html` <b class="green">· 구매자 이름</b>` : ""}</label>`)
        : html`<span class="muted small">최근 통장 입금이 없습니다</span>`}
    </div></div>`;
}

/** 매도 탭 위: 받은 돈 (계약중이면 잔금 대기 — 연결·할인·통장 외) */
function 받은돈({ app, car, sale, office, reload }) {
  const [이은, set이은] = useState(null);
  const [고르기, set고르기] = useState(null);       // 고를 입금 목록 (열렸을 때)
  const [picked, setPicked] = useState(new Set());
  const 읽기 = () => 이은입금(app, car.id).then(set이은, () => set이은([]));
  useEffect(() => { 읽기(); }, [car.id, sale.sale_amount, sale.contract]);
  if (!이은 || (!sale.contract && !이은.length && !sale.force_reason)) return null;     // 예전 매도(입금 연결 전)는 조용히
  const 받음 = 합(이은), 모자람 = Math.max(0, Number(sale.sale_amount) - 받음);
  const 열기 = () => run(async () => {
    const from = new Date(Date.parse(sale.sale_date) - 14 * 864e5).toISOString().slice(0, 10);
    set고르기((await 고를입금(app, { car_id: car.id, from })).filter(t => t.car_id !== car.id)); setPicked(new Set());
  });
  const 잇기 = () => picked.size && run(async () => {
    for (const id of picked) await q(app.db.rpc("sale_link_deposit", { p_tx: id, p_car: car.id, p_post: null }));
    await q(app.db.rpc("sale_settle", { p_car: car.id }));
    set고르기(null); reload();
  }, "입금을 연결했습니다");
  const 풀기 = t => confirm(`${입금글(t)} — 이 차에서 뺄까요?`) && run(async () => { await q(app.db.rpc("sale_unlink_deposit", { p_tx: t.id })); 읽기(); }, "뺐습니다");
  const 할인 = () => {
    const r = prompt(`받은 돈 ${won(받음)}원으로 매도 확정합니다.\n매도금액이 ${won(sale.sale_amount)} → ${won(받음)}원으로 줄고(할인 ${won(모자람)}원), 마진도 그만큼 줄어듭니다.\n\n사유(선택):`, "");
    if (r !== null) run(async () => { await q(app.db.rpc("sale_force", { p_car: car.id, p_mode: "할인", p_reason: r || null })); reload(); }, "매도로 확정했습니다");
  };
  const 통장외 = () => {
    const r = prompt(`통장에 안 찍힌 돈 ${won(모자람)}원을 받은 것으로 하고 매도 확정합니다 (매도금액 그대로).\n어떻게 받았나요? (예: 현금, 카뱅, 상계)`, "");
    if (r !== null) run(async () => {
      if (!r.trim()) throw new Error("사유를 적어 주세요.");
      await q(app.db.rpc("sale_force", { p_car: car.id, p_mode: "통장외", p_reason: r.trim() })); reload();
    }, "매도로 확정했습니다");
  };
  return html`<div class=${"bank-ok" + (sale.contract ? " bank-wait" : "")} style="margin-bottom:12px;display:block">
    <div class="bar" style="margin:0">${sale.contract ? html`<b>⏳ 잔금 대기</b>` : html`<b>💰 받은 돈</b>`}
      <span class="small">통장 ${won(받음)}원 / 매도금액 ${won(sale.sale_amount)}원${sale.contract && 모자람 ? html` · <b class="red">${won(모자람)}원 모자람</b>` : ""}</span>
      <span class="grow"></span>
      ${office && sale.contract && html`<button class="btn sm" onClick=${열기}>+ 입금 연결</button>
        ${받음 > 0 && html`<button class="btn sm" onClick=${할인}>받은 돈으로 확정 (할인)</button>`}
        <button class="btn sm" onClick=${통장외}>통장 외로 받음</button>`}</div>
    ${sale.contract && html`<p class="muted small" style="margin:4px 0">차는 재고 그대로, 실적에 안 잡힙니다 — 통장 입금이 매도금액만큼 연결되면 자동으로 매도(매도일 = 마지막 입금일)</p>`}
    ${이은.map(t => html`<div class="small">· ${입금글(t)} <span class="muted">${t.matched_by || ""}</span>
      ${office && sale.contract && html` <a href="javascript:void 0" class="muted" onClick=${() => 풀기(t)}>빼기</a>`}</div>`)}
    ${sale.force_reason && html`<div class="small" style="margin-top:4px">⚠️ ${sale.force_reason}</div>`}
    ${고르기 && html`<div style="margin-top:8px">
      <${입금고르기} list=${고르기} picked=${picked} setPicked=${setPicked} buyer=${sale.buyer_name || 이은[0]?.counterparty} />
      <div class="bar"><span class="small">고른 것 ${won(합(고르기.filter(t => picked.has(t.id))))}원</span><span class="grow"></span>
        <button class="btn ghost sm" onClick=${() => set고르기(null)}>닫기</button><button class="btn primary sm" disabled=${!picked.size} onClick=${잇기}>연결</button></div></div>`}
  </div>`;
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
  // 계약중 = 잔금 대기 (사용자 2026-11-15): 통장 입금이 매도금액만큼 이어져야 매도 — 손으로 확정하는 버튼 대신 연결·할인·통장 외 (받은돈)
  return html`<div class="card">
    ${글 && 글줄(글)}
    <${받은돈} app=${app} car=${car} sale=${sale} office=${office} reload=${reload} />
    ${sale.contract && sale.balance_due && html`<p class="small muted" style="margin:-6px 0 10px">잔금 예정 ${sale.balance_due}</p>`}
    <div class="bar"><h3>매도정보</h3><span class="grow"></span>
      ${할부바로 && !할부 && html`<button class="btn" title="손익확정을 풀지 않고 할부만 고칩니다" onClick=${() => set할부({ company: sale.installment_company, amount: Number(sale.installment_amount) || 0, rate: Number(sale.installment_rate) || "" })}>할부 고치기</button>`}
      ${office && !locked && html`<button class="btn" onClick=${() => setEditing(true)}>수정</button><button class="btn danger" onClick=${cancel}>매도취소</button>`}
      ${office && !sale.contract && html`<button class="btn primary" onClick=${() => go(`/car/${car.id}/settle`)}>정산하기 →</button>`}</div>
    <div class="kvgrid">
      <div><span>${sale.contract ? "계약일" : "매도일"}</span><b>${sale.sale_date}</b></div>
      <div><span>매도담당</span><b>${dealer?.name || "-"}${sale.other_dealer ? " (타상사딜러)" : ""}</b></div>
      <div><span>매도유형</span><b>${sale.sale_type}</b></div>
      <div><span>매도금액</span><b>${won(sale.sale_amount)} <small class="muted">(공급가 ${won(sale.sale_supply)} / 부가세 ${won(sale.sale_vat)})</small>${Number(sale.discount) > 0 ? html` <small class="red">할인 ${won(sale.discount)}</small>` : ""}</b></div>
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
    installment_company: null, installment_amount: 0, installment_rate: 0, am_income: 0, balance_due: null });
  const [손님, set손님] = useState({ buyer: sale?.buyer_name || post?.form?.buyer || "", phone: sale?.buyer_phone || post?.form?.phone || "" });   // 매수고객 칸은 숨김 중 — 이름·연락처만
  const [올리기, set올리기] = useState(true);
  const [채움, set채움] = useState(false);
  // 새 매도: 받은 돈(계약금·잔금·할부금)을 통장 입금에서 고른다 (사용자 2026-11-15 "무조건 연결") — 다 차면 바로 매도, 모자라면 잔금 대기
  const [입금들, set입금들] = useState(null), [picked, setPicked] = useState(new Set());
  useEffect(() => { if (!sale) run(async () => {
    const r = await 고를입금(app, { car_id: car.id, post_id: post?.id || null });
    set입금들(r); setPicked(new Set(r.filter(t => t.car_id === car.id && t.match_kind === "차량매도대금").map(t => t.id)));
  }); }, [post?.id]);
  const 고른돈 = 합((입금들 || []).filter(t => picked.has(t.id)));
  // 새 매도: 게시판 매도정보 글이 먼저 있으면 그 내용으로 채운다
  useEffect(() => { if (sale || !post) return;
    const g = post.form || {};
    const 받은때 = 계약금일시(g.deposit_when, post.created_at);
    const 잔 = (String(g.memo || "").match(/잔금[^\n]{0,10}?(\d{1,2}\s*[월./]\s*\d{1,2})/) || [])[1];
    const 잔금일 = 잔 && 계약금일시(잔, post.created_at);
    setF(p => ({ ...p, sale_type: 형태탭(g.type) || p.sale_type,
      sale_amount: Number(g.amount) ? Number(g.amount) - (g.fee_included ? Number(p.sale_fee) || 0 : 0) : p.sale_amount,
      sale_date: post.done_at ? KST날(post.done_at) : KST날(받은때 || post.created_at),
      balance_due: 잔금일 ? KST날(잔금일) : p.balance_due,
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
        buyer_name: 손님.buyer.trim() || null, buyer_phone: 손님.phone.trim() || null, board_post: !!올리기,
        ...(!sale || sale.contract ? { balance_due: f.balance_due || null } : {}) };
      // 매도/잔금 대기는 DB 가 정한다 (통장 입금 합계 ≥ 매도금액이면 매도, 매도일 = 마지막 입금일) — 그래서 고른 입금을 먼저 잇고 저장
      if (!sale) {
        for (const t of 입금들 || []) {
          const 이음 = t.car_id === car.id && t.match_kind === "차량매도대금";
          if (picked.has(t.id) && !이음) await q(app.db.rpc("sale_link_deposit", { p_tx: t.id, p_car: car.id, p_post: post?.id || null }));
          if (!picked.has(t.id) && 이음) await q(app.db.rpc("sale_unlink_deposit", { p_tx: t.id }));
        }
      }
      if (sale) await q(app.db.from("car_sales").update(row).eq("car_id", car.id));
      else await q(app.db.from("car_sales").insert(row));
      await q(app.db.rpc("sale_settle", { p_car: car.id }));        // 매도금액을 고쳐 받은 돈과 맞았으면 매도로
      if (post === null && 올리기 && !sale) {      // 글은 DB 가 올렸다 — 이미 들어온 계약금 등을 붙인다
        await app.db.rpc("board_match_sales"); toast("게시판 매도정보에도 올렸습니다 — 1분 안에 알림이 갑니다");
      }
      if (!sale && 고른돈 < Number(f.sale_amount)) toast(`받은 돈 ${won(고른돈)}원 — 잔금 대기로 저장했습니다. 잔금이 통장에 연결되면 자동으로 매도됩니다`);
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
      <${Field} label=${sale && !sale.contract ? "매도일" : "계약일"} req hint=${sale && !sale.contract ? "" : "매도일은 잔금 들어온 날로 자동"}><input type="date" value=${f.sale_date} onInput=${e => set("sale_date")(e.target.value)} required /><//>
      ${(!sale || sale.contract) && html`<${Field} label="잔금 예정일" hint="대충이라도"><input type="date" value=${f.balance_due || ""} onInput=${e => set("balance_due")(e.target.value || null)} /><//>`}
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
      ${!sale && html`<${Field} label="받은 돈 (통장 입금)" wide hint=${입금들 === null ? "통장 입금 읽는 중…" : html`계약금·잔금·할부금을 모두 고르세요 — 고른 것 <b>${won(고른돈)}원</b> / 매도금액 ${won(f.sale_amount)}원 ·
          ${고른돈 >= Number(f.sale_amount) && Number(f.sale_amount) > 0 ? html`<b class="green">다 받음 → 저장하면 매도 (매도일 = 마지막 입금일)</b>`
            : html`<b>모자람 → 잔금 대기로 저장</b>, 잔금이 통장에 연결되면 자동으로 매도`}`}>
        ${입금들 && html`<${입금고르기} list=${입금들} picked=${picked} setPicked=${setPicked} buyer=${손님.buyer} />`}<//>`}
      <${Field} label="특이사항" wide><input value=${f.memo || ""} onInput=${e => set("memo")(e.target.value)} /><//>
      ${post === null && !sale && html`<${Field} label="게시판" wide hint="사무장님께 알림이 갑니다 — 통장에 잔금이 다 들어오면 매도로 자동 확정">
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
