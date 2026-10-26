// 차량입력 (사용자 2026-10-26): 사무장이 차마다 들어가지 않고 매입매출대장처럼 한 화면에서 바로 친다.
//   비용(도색광택·수리비·광택세차·광고비·탁송유류·기타) — 엑셀 수식처럼: 칸을 누르면 '300000+50000' 이 보이고, 고치거나 지우고 Enter 면
//     그대로 맞춘다(지운 금액은 삭제, 새 금액은 한 건씩 추가 — 사용자 2026-10-26 "클릭해서 지우기 말고 그냥"). 자동으로 들어간 줄(auto_source)은 건드리지 않는다.
//     수리비는 오른쪽 '+ 수리비' 칸으로 빨리 더하기도
//   취득세(차 값 그대로 — 넣으면 '모름'이 풀리고 비용 줄은 DB 가 자동) · 재고대출(금융사·대출금 — 없으면 새로, 있으면 고침)
//   키번호는 뺌 (사용자 2026-10-26 — 264대 중 쓴 차 0대). 화면은 전체 폭·큰 글씨
//   Enter = 저장하고 아래 차로, Tab = 오른쪽 칸. '30' 처럼 1000 미만은 만원 단위(30만원).
import { html, useState, useEffect, useMemo, useRef, Seg, Loading, Empty, run, won, today, toast, ask, go, 검색맞음, 간략차명 } from "../ui.js";
import { q } from "../db.js";
import { 금액 } from "../forms.js";
import { 취득세0원 } from "../calc.js";
import { 비용구분 } from "./lists.js";

const 비용칸 = [["도색광택", "도색광택"], ["수리비", "수리비"], ["광택/세차", "광택세차"], ["광고비", "광고비"], ["탁송유류", "탁송유류"], ["기타비용", "기타"]];
const n = v => Math.round(Number(v) || 0);
/** '30' → 300,000 (1000 미만은 만원), '30만'·'300,000' 그대로. 못 읽으면 null */
const 읽기 = s => { const t = String(s ?? "").trim(); if (!t) return null; if (/^[0,]+원?$/.test(t)) return 0; const v = 금액(t); return v == null ? null : v < 1000 ? v * 10000 : v; };
/** '152323+233311' → [152323, 233311] (사용자 2026-10-26 — 수리비는 여러 번 나와서 + 로 이어 친다). 하나라도 못 읽으면 null */
const 여러개 = s => { const ts = String(s ?? "").split("+").map(x => x.trim()).filter(Boolean); const vs = ts.map(읽기); return vs.length && vs.every(v => v != null) ? vs : null; };
// 수리비는 합계 칸 오른쪽에 '+' 칸을 따로 (합계는 보기만, ▾ 로 내역)
const 따로더하기 = new Set(["수리비"]);
// 손으로 고칠 수 있는 줄: 직접 넣은 것 + 매입매출대장에서 옮겨 온 것('대장'). 시스템이 관리하는 자동 줄(취득세 등)은 그대로
const 고칠수있음 = k => !k.auto_source || k.auto_source === "대장";
// 칸 너비·글씨 크기는 보는 사람이 조절 (사용자 2026-10-26) — 이 기기에만 기억 (localStorage)
const 기본폭 = { date: 84, car: 220, year: 64, km: 90, price: 120, tax: 110, lender: 140, loan: 140, cost: 120 };
const 기억 = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem("entry:" + k)); return v ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("entry:" + k, JSON.stringify(v)); } catch {} } };
const 만km = v => v == null || v === "" ? "" : Number(v) >= 10000 ? (Number(v) / 10000).toFixed(1).replace(/\.0$/, "") + "만" : Number(v).toLocaleString();

export function CarEntryPage({ app }) {
  const [d, setD] = useState(null);
  const [scope, setScope] = useState("재고");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(null);       // ▾ 내역 { car, item }
  const [고른, set고른] = useState({});           // 재고대출 없는 차: 금융사만 먼저 고른 것 { 차id: 금융사id } — 대출금을 치면 등록
  const [폭, set폭] = useState(() => 기억.get("widths", {}));
  const [글씨, set글씨] = useState(() => 기억.get("font", 16));
  const 글씨바꾸기 = dv => set글씨(f => { const v = Math.min(24, Math.max(11, f + dv)); 기억.set("font", v); return v; });
  // 머리줄 오른쪽 끝을 끌어서 칸 너비 바꾸기
  const 끌기 = (key, e) => {
    e.preventDefault();
    const th = e.currentTarget.parentElement, x0 = e.clientX, w0 = th.getBoundingClientRect().width;
    const move = ev => set폭(p => ({ ...p, [key]: Math.max(44, Math.round(w0 + ev.clientX - x0)) }));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); set폭(p => { 기억.set("widths", p); return p; }); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const load = () => run(async () => {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    let cars = await q(app.db.from("cars").select("id, plate, car_name, model_year, mileage, purchase_amount, dealer_id, purchase_date, acq_tax, acq_tax_unknown, status")
      .is("deleted_at", null).eq("status", "재고").order("purchase_date", { ascending: false }));
    if (scope === "최근 매도") {
      const sold = await q(app.db.from("car_sales").select("car_id").gte("sale_date", since));
      cars = sold.length ? await q(app.db.from("cars").select("id, plate, car_name, model_year, mileage, purchase_amount, dealer_id, purchase_date, acq_tax, acq_tax_unknown, status")
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
  const 자동합 = (car, item) => d.costs.filter(k => k.car_id === car && k.item === item && !고칠수있음(k)).reduce((t, k) => t + n(k.amount), 0);
  const 식 = (car, item) => d.costs.filter(k => k.car_id === car && k.item === item && 고칠수있음(k)).map(k => n(k.amount)).join("+");
  const 합 = (car, item) => d.costs.filter(k => k.car_id === car && k.item === item).reduce((t, k) => t + n(k.amount), 0);
  const 대출 = car => d.loans.find(l => l.car_id === car) || null;
  // '작성필요'는 리스트와 같은 뜻으로만: 상품화비용(수리·도색·세차·탁송 등)이 하나도 없는 차의 도색광택 칸, 취득세 모르는 차
  const 상품화없음 = car => !d.costs.some(k => k.car_id === car && 비용구분(k.item) === "상품화" && n(k.amount));
  const lenders = (app.lenders || []).filter(l => l.active !== false);
  const partner = c => !!app.dealers.find(x => x.id === c.dealer_id)?.partner;

  // 저장들 — 하나 저장하면 그 줄만 다시 읽지 않고 전체를 가볍게 다시 (65대 정도라 충분히 빠르다)
  const 비용더하기 = (c, item, vs) => run(async () => {      // vs: 금액 여러 개 — 한 건씩 따로 남긴다 (날짜별 내역)
    await q(app.db.from("car_costs").insert(vs.map(v => ({ car_id: c.id, item, amount: v, paid_by: "딜러", taxable: true, paid_date: today(), include_in_settlement: true }))));
    toast(`${c.plate} ${item} +${won(vs.reduce((a, b) => a + b, 0))}원${vs.length > 1 ? ` (${vs.length}건)` : ""}`); load();
  });
  const 취득세 = (c, v) => run(async () => {
    v = v || 취득세0원;                       // 0원 처리하는 차는 6,002원 (사용자 2026-10-26)
    await q(app.db.from("cars").update({ acq_tax: v, acq_tax_unknown: false }).eq("id", c.id));
    toast(`${c.plate} 취득세 ${won(v)}원`); load();
  });
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
  // 수식 칸 저장: 새 금액 목록에 맞춰 손으로 넣은 줄을 지우고 더한다 (같은 금액이 있으면 그 줄은 그대로 — 날짜 유지)
  const 비용맞추기 = (c, item, vs) => run(async () => {
    const 남은 = d.costs.filter(k => k.car_id === c.id && k.item === item && 고칠수있음(k)), 새 = [];
    for (const v of vs) { const i = 남은.findIndex(k => n(k.amount) === v); if (i >= 0) 남은.splice(i, 1); else 새.push(v); }
    if (남은.length) await q(app.db.from("car_costs").delete().in("id", 남은.map(k => k.id)));
    if (새.length) await q(app.db.from("car_costs").insert(새.map(v => ({ car_id: c.id, item, amount: v, paid_by: "딜러", taxable: true, paid_date: today(), include_in_settlement: true }))));
    if (남은.length || 새.length) toast(`${c.plate} ${item} ${won(vs.reduce((a, b) => a + b, 0) + 자동합(c.id, item))}원`);
    load();
  });
  const 지우기 = k => ask(`${k.paid_date} ${k.item} ${won(k.amount)}원을 지울까요?`) && run(async () => { await q(app.db.from("car_costs").delete().eq("id", k.id)); load(); });

  // 칸 목록 (머리줄·너비 조절·colgroup 이 같은 순서)
  const 칸들 = [["date", "매입일"], ["car", "차량"], ["year", "연식"], ["km", "키로수"], ["price", "매입가"], ["tax", "취득세"], ["lender", "재고대출 금융사"], ["loan", "대출금"],
    ...비용칸.flatMap(([item, l]) => 따로더하기.has(item) ? [["c:" + item, l], ["p:" + item, "+ " + l]] : [["c:" + item, l]])];
  const 너비 = k => 폭[k] || 기본폭[k] || 기본폭.cost;
  return html`<div class="entry-page"><div class="bar"><h2>차량입력</h2><span class="muted small">칸에 금액 → Enter (아래 차로) · '30' = 30만원 · 비용 칸은 누르면 금액들 — 고치거나 지우고 Enter · 머리줄 오른쪽 끝을 끌면 너비 조절</span><span class="grow"></span>
      <span class="entry-font" title="글씨 크기"><button class="btn sm" onClick=${() => 글씨바꾸기(-1)}>가−</button><b>${글씨}</b><button class="btn sm" onClick=${() => 글씨바꾸기(1)}>가+</button></span>
      ${Object.keys(폭).length > 0 && html`<button class="btn sm ghost" onClick=${() => { set폭({}); 기억.set("widths", {}); }}>너비 처음대로</button>`}
      <input class="search" placeholder="차량번호·차명" value=${text} onInput=${e => setText(e.target.value)} style="max-width:200px" />
      <${Seg} value=${scope} onChange=${setScope} options=${["재고", "최근 매도"]} /></div>
    ${!rows.length ? html`<${Empty}>${scope === "재고" ? "재고 차가 없습니다." : "최근 30일 매도 차가 없습니다."}<//>` : html`
    <div class="table-wrap entry-wrap"><table class="grid entry" style=${`--ef:${글씨}px;width:${칸들.reduce((t, [k]) => t + 너비(k), 0)}px`}>
      <colgroup>${칸들.map(([k]) => html`<col key=${k} style=${`width:${너비(k)}px`} />`)}</colgroup>
      <thead><tr>${칸들.map(([k, l]) => html`<th key=${k} title=${k.startsWith("p:") ? "'152323+233311' 처럼 + 로 이어 치면 한 건씩 더해집니다" : ""}>${l}<span class="rz" onPointerDown=${e => 끌기(k, e)}></span></th>`)}</tr></thead>
      <tbody>${rows.map((c, i) => { const l = 대출(c.id); return html`<tr key=${c.id}>
        <td class="muted small">${c.purchase_date?.slice(2) || ""}</td>
        <td class="carcell"><a href=${"#/car/" + c.id} title=${c.car_name}><b>${c.plate}</b></a><small class="muted"> ${간략차명(c)}</small></td>
        <td class="c info">${c.model_year ? String(c.model_year).slice(0, 4) : ""}</td>
        <td class="r info">${만km(c.mileage)}</td>
        <td class="r info">${n(c.purchase_amount) ? won(c.purchase_amount) : ""}</td>
        <td><${칸} row=${i} col=${0} value=${n(c.acq_tax)} 빈칸=${c.acq_tax_unknown} onSave=${v => 취득세(c, v)} /></td>
        <td><select class="cell" value=${l?.lender_id || 고른[c.id] || ""} onChange=${e => e.target.value ? 대출저장(c, { lender_id: e.target.value, amount: l?.amount || 0 }) : (toast("재고대출을 지우려면 차 화면 → 재고금융에서", "err"), load())}>
          <option value="">${l ? "-" : "없음"}</option>${lenders.map(x => html`<option value=${x.id}>${x.name}</option>`)}</select></td>
        <td><${칸} row=${i} col=${1} value=${n(l?.amount)} onSave=${v => l ? 대출저장(c, { amount: v }) : 고른[c.id] ? 대출저장(c, { lender_id: 고른[c.id], amount: v }) : toast("금융사를 먼저 고르세요", "err")} /></td>
        ${비용칸.map(([item], j) => { const s = 합(c.id, item);
          const 내역 = s > 0 && html`<button class="mini" title="내역" onClick=${() => setOpen({ car: c, item })}>▾</button>`;
          const 수식칸 = html`<td class="sumcell"><${칸} row=${i} col=${2 + j * 2} value=${s} 식=${식(c.id, item)} 빈칸=${item === "도색광택" && 상품화없음(c.id)} onSave=${v => 비용맞추기(c, item, v)} />${내역}</td>`;
          return 따로더하기.has(item)
            ? html`${수식칸}<td><${칸} row=${i} col=${3 + j * 2} value=${0} 더하기 placeholder="+ 금액" onSave=${v => 비용더하기(c, item, v)} /></td>`
            : 수식칸; })}
      </tr>`; })}</tbody></table></div>`}
    ${open && html`<div class="modal-back" onClick=${() => setOpen(null)}><div class="card modal" onClick=${e => e.stopPropagation()}>
      <div class="bar"><h3>${open.car.plate} · ${open.item}</h3><span class="grow"></span><button class="btn sm ghost" onClick=${() => setOpen(null)}>닫기</button></div>
      <table class="grid"><tbody>${d.costs.filter(k => k.car_id === open.car.id && k.item === open.item).map(k => html`<tr>
        <td>${k.paid_date || ""}</td><td class="r">${won(k.amount)}</td><td class="muted small">${k.memo || ""}${고칠수있음(k) ? "" : " (자동)"}</td>
        <td><button class="btn sm ghost" onClick=${() => 지우기(k)}>지우기</button></td></tr>`)}</tbody></table>
      <p class="small"><a href=${"#/car/" + open.car.id + "/costs"} onClick=${() => setOpen(null)}>차 화면 비용 탭에서 자세히 →</a></p></div></div>`}</div>`;
}

/** 엑셀처럼: Enter 아래, Shift+Enter 위, 위·아래 화살표 */
function 이동(e, row, col) {
  const dr = e.key === "Enter" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (!dr || e.isComposing) return;
  e.preventDefault();
  if (e.key === "Enter") e.currentTarget.blur();          // blur 때 저장
  setTimeout(() => document.querySelector(`[data-row="${row + dr}"][data-col="${col}"]`)?.focus(), 0);
}

/** 금액 칸 하나. 더하기면 비어 있는 칸에 '이번에 더할 금액'을 치고(+ 로 여러 건 → onSave([금액…])), 아니면 값을 고친다(+ 는 합쳐서) */
function 칸({ row, col, value, 빈칸, 더하기, 식, wide, placeholder, onSave }) {
  const [t, setT] = useState(null);           // 고치는 중이면 글자, 아니면 null
  const 취소 = useRef(false);
  const 저장 = () => {
    if (취소.current) { 취소.current = false; setT(null); return; }
    if (t == null) return;
    const s = t.trim(); setT(null);
    if (식 != null) {                         // 수식 칸: 비우면 다 지우고, 고친 대로 맞춘다
      if (s.replace(/\s/g, "") === 식) return;
      const vs = s ? 여러개(s) : [];
      if (!vs) return toast("금액을 읽지 못했습니다: " + s, "err");
      return onSave(vs);
    }
    if (!s) return;
    const vs = 여러개(s);
    if (!vs) return toast("금액을 읽지 못했습니다: " + s, "err");
    if (더하기) return onSave(vs);
    const v = vs.reduce((a, b) => a + b, 0);
    if (v === value && !빈칸) return;          // 빈칸(모름)에 0 을 치면 0원으로 확인
    onSave(v);
  };
  return html`<input class=${"cell r" + (빈칸 ? " need" : "") + (wide ? " wide" : "")} inputmode="numeric" data-row=${row} data-col=${col}
    placeholder=${빈칸 ? "작성필요" : placeholder || ""} title=${식 != null ? "엑셀처럼: 누르면 금액들이 보입니다. 고치거나 지우고 Enter" : 더하기 ? "친 금액이 더해집니다 ('1000+2000' 처럼 여러 건도)" : ""}
    value=${t != null ? t : value ? won(value) : ""}
    onFocus=${e => { setT(식 != null ? 식 : 더하기 ? "" : value ? String(value) : ""); setTimeout(() => e.target.select(), 0); }}
    onInput=${e => setT(e.target.value)} onBlur=${저장}
    onKeyDown=${e => { if (e.key === "Escape") { 취소.current = true; e.target.blur(); } else 이동(e, row, col); }} />`;
}
