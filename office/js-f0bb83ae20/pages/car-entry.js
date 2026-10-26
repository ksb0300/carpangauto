// 차량입력 (사용자 2026-10-26): 사무장이 차마다 들어가지 않고 매입매출대장처럼 한 화면에서 바로 친다.
//   비용(도색광택·수리비·광택세차·광고비·탁송유류·기타) — 칸에 친 금액이 한 건 '더해진다'(날짜별 내역은 ▾ 에서 보고 지움)
//   취득세(차 값 그대로 — 넣으면 '모름'이 풀리고 비용 줄은 DB 가 자동) · 재고대출(금융사·대출금 — 없으면 새로, 있으면 고침) · 키번호
//   Enter = 저장하고 아래 차로, Tab = 오른쪽 칸. '30' 처럼 1000 미만은 만원 단위(30만원).
import { html, useState, useEffect, useMemo, useRef, Seg, Loading, Empty, run, won, today, toast, ask, go, 검색맞음, 간략차명 } from "../ui.js";
import { q } from "../db.js";
import { 금액 } from "../forms.js";
import { 비용구분 } from "./lists.js";

const 비용칸 = [["도색광택", "도색광택"], ["수리비", "수리비"], ["광택/세차", "광택세차"], ["광고비", "광고비"], ["탁송유류", "탁송유류"], ["기타비용", "기타"]];
const n = v => Math.round(Number(v) || 0);
/** '30' → 300,000 (1000 미만은 만원), '30만'·'300,000' 그대로. 못 읽으면 null */
const 읽기 = s => { const t = String(s ?? "").trim(); if (!t) return null; const v = 금액(t); return v == null ? null : v < 1000 ? v * 10000 : v; };

export function CarEntryPage({ app }) {
  const [d, setD] = useState(null);
  const [scope, setScope] = useState("재고");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(null);       // ▾ 내역 { car, item }
  const [고른, set고른] = useState({});           // 재고대출 없는 차: 금융사만 먼저 고른 것 { 차id: 금융사id } — 대출금을 치면 등록
  const load = () => run(async () => {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    let cars = await q(app.db.from("cars").select("id, plate, car_name, model_year, mileage, dealer_id, purchase_date, acq_tax, acq_tax_unknown, key_no, status")
      .is("deleted_at", null).eq("status", "재고").order("purchase_date", { ascending: false }));
    if (scope === "최근 매도") {
      const sold = await q(app.db.from("car_sales").select("car_id").gte("sale_date", since));
      cars = sold.length ? await q(app.db.from("cars").select("id, plate, car_name, model_year, mileage, dealer_id, purchase_date, acq_tax, acq_tax_unknown, key_no, status")
        .is("deleted_at", null).in("id", sold.map(s => s.car_id)).order("purchase_date", { ascending: false })) : [];
    }
    const ids = cars.map(c => c.id);
    const [costs, loans] = ids.length ? await Promise.all([
      q(app.db.from("car_costs").select("id, car_id, item, amount, paid_date, memo, auto_source").in("car_id", ids)),
      q(app.db.from("car_loans").select("id, car_id, lender_id, amount, start_date, status").in("car_id", ids).eq("status", "진행중").order("start_date")),
    ]) : [[], []];
    setD({ cars, costs, loans });
  });
  useEffect(() => { setD(null); load(); }, [scope]);

  const rows = useMemo(() => (d?.cars || []).filter(c => !text.trim() || 검색맞음(text, c.plate, c.car_name) > 0), [d, text]);
  if (!d) return html`<${Loading} />`;
  const 합 = (car, item) => d.costs.filter(k => k.car_id === car && k.item === item).reduce((t, k) => t + n(k.amount), 0);
  const 대출 = car => d.loans.find(l => l.car_id === car) || null;
  // '작성필요'는 리스트와 같은 뜻으로만: 상품화비용(수리·도색·세차·탁송 등)이 하나도 없는 차의 도색광택 칸, 취득세 모르는 차
  const 상품화없음 = car => !d.costs.some(k => k.car_id === car && 비용구분(k.item) === "상품화" && n(k.amount));
  const lenders = (app.lenders || []).filter(l => l.active !== false);
  const partner = c => !!app.dealers.find(x => x.id === c.dealer_id)?.partner;

  // 저장들 — 하나 저장하면 그 줄만 다시 읽지 않고 전체를 가볍게 다시 (65대 정도라 충분히 빠르다)
  const 비용더하기 = (c, item, v) => run(async () => {
    await q(app.db.from("car_costs").insert({ car_id: c.id, item, amount: v, paid_by: "딜러", taxable: true, paid_date: today(), include_in_settlement: true }));
    toast(`${c.plate} ${item} +${won(v)}원`); load();
  });
  const 취득세 = (c, v) => run(async () => {
    await q(app.db.from("cars").update({ acq_tax: v, acq_tax_unknown: false }).eq("id", c.id));      // 0 을 치면 '0원으로 확인
    toast(`${c.plate} 취득세 ${won(v)}원`); load();
  });
  const 키번호 = (c, v) => run(async () => { await q(app.db.from("cars").update({ key_no: v || null }).eq("id", c.id)); load(); });
  const 대출저장 = (c, patch) => run(async () => {
    const l = 대출(c.id);
    if (l) { await q(app.db.from("car_loans").update(patch).eq("id", l.id)); toast(`${c.plate} 재고대출 고침`); return load(); }
    if (!n(patch.amount)) { set고른(x => ({ ...x, [c.id]: patch.lender_id })); return toast("대출금을 넣으면 등록됩니다"); }
    const lender = lenders.find(x => x.id === patch.lender_id);
    if (!lender || !n(patch.amount)) return;                   // 금융사·금액이 둘 다 있어야 새로 만든다
    if (!partner(c)) throw new Error("딜러 차는 딜러이율이 있어 차 화면 → 재고금융에서 넣어 주세요");
    await q(app.db.from("car_loans").insert({ car_id: c.id, lender_id: lender.id, kind: "신규", amount: n(patch.amount), start_date: c.purchase_date || today(),
      months: Number(lender.base_months) || 3, base_months: Number(lender.base_months) || 3, lender_rate: lender.base_rate != null ? Number(lender.base_rate) : null,
      rate_tiers: lender.rate_tiers || null, ext_rate: lender.ext_rate ?? null, due_day: lender.due_day ?? null, due_cutoff: lender.due_cutoff ?? null,
      due_min_days: lender.due_min_days ?? null, dealer_rate: 0 }));
    set고른(x => { const y = { ...x }; delete y[c.id]; return y; });
    toast(`${c.plate} 재고대출 등록 (${lender.name}, 실행일 = 매입일 ${c.purchase_date})`); load();
  });
  const 지우기 = k => ask(`${k.paid_date} ${k.item} ${won(k.amount)}원을 지울까요?`) && run(async () => { await q(app.db.from("car_costs").delete().eq("id", k.id)); load(); });

  return html`<div class="bar"><h2>차량입력</h2><span class="muted small">칸에 금액 → Enter (아래 차로) · '30' = 30만원 · 비용은 친 만큼 더해집니다</span><span class="grow"></span>
      <input class="search" placeholder="차량번호·차명" value=${text} onInput=${e => setText(e.target.value)} style="max-width:200px" />
      <${Seg} value=${scope} onChange=${setScope} options=${["재고", "최근 매도"]} /></div>
    ${!rows.length ? html`<${Empty}>${scope === "재고" ? "재고 차가 없습니다." : "최근 30일 매도 차가 없습니다."}<//>` : html`
    <div class="table-wrap entry-wrap"><table class="grid entry">
      <thead><tr><th>매입일</th><th>차량</th><th class="r">취득세</th><th>재고대출 금융사</th><th class="r">대출금</th>
        ${비용칸.map(([, l]) => html`<th class="r">${l}</th>`)}<th>키번호</th></tr></thead>
      <tbody>${rows.map((c, i) => { const l = 대출(c.id); return html`<tr key=${c.id}>
        <td class="muted small">${c.purchase_date?.slice(2) || ""}</td>
        <td><a href=${"#/car/" + c.id} title=${c.car_name}><b>${c.plate}</b></a><small class="muted"> ${간략차명(c)}</small></td>
        <td><${칸} row=${i} col=${0} value=${n(c.acq_tax)} 빈칸=${c.acq_tax_unknown} onSave=${v => 취득세(c, v)} /></td>
        <td><select class="cell" value=${l?.lender_id || 고른[c.id] || ""} onChange=${e => e.target.value ? 대출저장(c, { lender_id: e.target.value, amount: l?.amount || 0 }) : (toast("재고대출을 지우려면 차 화면 → 재고금융에서", "err"), load())}>
          <option value="">${l ? "-" : "없음"}</option>${lenders.map(x => html`<option value=${x.id}>${x.name}</option>`)}</select></td>
        <td><${칸} row=${i} col=${1} value=${n(l?.amount)} onSave=${v => l ? 대출저장(c, { amount: v }) : 고른[c.id] ? 대출저장(c, { lender_id: 고른[c.id], amount: v }) : toast("금융사를 먼저 고르세요", "err")} /></td>
        ${비용칸.map(([item], j) => { const s = 합(c.id, item); return html`<td class="sumcell"><${칸} row=${i} col=${2 + j} value=${s} 빈칸=${item === "도색광택" && 상품화없음(c.id)} 더하기 onSave=${v => 비용더하기(c, item, v)} />
          ${s > 0 && html`<button class="mini" title="내역" onClick=${() => setOpen({ car: c, item })}>▾</button>`}</td>`; })}
        <td><input class="cell key" value=${c.key_no || ""} data-row=${i} data-col=${2 + 비용칸.length} onKeyDown=${e => 이동(e, i, 2 + 비용칸.length)}
          onChange=${e => 키번호(c, e.target.value.trim())} /></td>
      </tr>`; })}</tbody></table></div>`}
    ${open && html`<div class="modal-back" onClick=${() => setOpen(null)}><div class="card modal" onClick=${e => e.stopPropagation()}>
      <div class="bar"><h3>${open.car.plate} · ${open.item}</h3><span class="grow"></span><button class="btn sm ghost" onClick=${() => setOpen(null)}>닫기</button></div>
      <table class="grid"><tbody>${d.costs.filter(k => k.car_id === open.car.id && k.item === open.item).map(k => html`<tr>
        <td>${k.paid_date || ""}</td><td class="r">${won(k.amount)}</td><td class="muted small">${k.memo || ""}${k.auto_source ? " (자동)" : ""}</td>
        <td><button class="btn sm ghost" onClick=${() => 지우기(k)}>지우기</button></td></tr>`)}</tbody></table>
      <p class="small"><a href=${"#/car/" + open.car.id + "/costs"} onClick=${() => setOpen(null)}>차 화면 비용 탭에서 자세히 →</a></p></div></div>`}`;
}

/** 엑셀처럼: Enter 아래, Shift+Enter 위, 위·아래 화살표 */
function 이동(e, row, col) {
  const dr = e.key === "Enter" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (!dr || e.isComposing) return;
  e.preventDefault();
  if (e.key === "Enter") e.currentTarget.blur();          // blur 때 저장
  setTimeout(() => document.querySelector(`[data-row="${row + dr}"][data-col="${col}"]`)?.focus(), 0);
}

/** 금액 칸 하나. 더하기면 비어 있는 칸에 '이번에 더할 금액'을 치고, 아니면 값을 고친다 */
function 칸({ row, col, value, 빈칸, 더하기, onSave }) {
  const [t, setT] = useState(null);           // 고치는 중이면 글자, 아니면 null
  const 취소 = useRef(false);
  const 저장 = () => {
    if (취소.current) { 취소.current = false; setT(null); return; }
    if (t == null) return;
    const s = t.trim(); setT(null);
    if (!s) return;
    const v = 읽기(s);
    if (v == null) return toast("금액을 읽지 못했습니다: " + s, "err");
    if (!더하기 && v === value && !빈칸) return;          // 빈칸(모름)에 0 을 치면 0원으로 확인
    onSave(v);
  };
  return html`<input class=${"cell r" + (빈칸 ? " need" : "")} inputmode="numeric" data-row=${row} data-col=${col}
    placeholder=${빈칸 ? "작성필요" : ""} title=${더하기 ? "친 금액이 한 건 더해집니다" : ""}
    value=${t != null ? t : value ? won(value) : ""}
    onFocus=${e => { setT(더하기 ? "" : value ? String(value) : ""); setTimeout(() => e.target.select(), 0); }}
    onInput=${e => setT(e.target.value)} onBlur=${저장}
    onKeyDown=${e => { if (e.key === "Escape") { 취소.current = true; e.target.blur(); } else 이동(e, row, col); }} />`;
}
