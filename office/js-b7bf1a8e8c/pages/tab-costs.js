import { html, useState, useEffect, useRef, Money, Select, run, won, today, toast } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리 } from "../calc.js";

export const COST_ITEMS = ["상사매입비", "취득세", "매입탁송비", "성능점검비", "의무보험료", "주유대", "판금도장비",
  "기능수리/상품화", "광택/세차", "광고비", "경매장수수료", "통행료", "이자비용", "기타비용"];
// 항목 목록은 사무실이 고친다 (사용자 2026-11-04) — settings.cost_items, 없으면 위 기본값. ✕로 빼고, 직접 입력한 새 항목은 목록에 더한다
export const 비용항목들 = app => app.settings?.cost_items?.length ? app.settings.cost_items : COST_ITEMS;

/** 항목 고르기: 누르면 목록(✕로 빼기) + 맨 아래 '직접 입력'(Enter 면 이 줄에 쓰고 목록에도 더함) */
export function ItemPick({ app, value, onChange }) {
  const [open, setOpen] = useState(null), [, 다시] = useState(0), [새, set새] = useState("");   // open = 목록 띄울 화면 위치 (표가 스크롤돼도 안 잘리게 fixed)
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const 밖 = e => { if (box.current && !box.current.contains(e.target)) setOpen(null); };
    addEventListener("pointerdown", 밖); return () => removeEventListener("pointerdown", 밖);
  }, [open]);
  const 목록 = 비용항목들(app);
  const 고침 = r => { app.settings.cost_items = r; 다시(x => x + 1); };
  const 빼기 = (e, it) => { e.stopPropagation();
    if (!confirm(`'${it}'을(를) 목록에서 뺄까요? (이미 넣은 비용은 그대로)`)) return;
    run(async () => 고침(await q(app.db.rpc("cost_item_remove", { p_name: it }))), `'${it}' 뺐습니다`); };
  const 더하기 = () => { const v = 새.trim().replace(/\s+/g, " "); if (!v) return;
    run(async () => { if (!목록.includes(v)) 고침(await q(app.db.rpc("cost_item_add", { p_name: v }))); onChange(v); set새(""); setOpen(null); }); };
  return html`<span class="itempick" ref=${box}>
    <button type="button" class="itempick-btn" onClick=${e => { const r = e.currentTarget.getBoundingClientRect();
      setOpen(open ? null : { left: r.left, top: r.bottom + 4 < innerHeight - 360 ? r.bottom + 4 : Math.max(8, r.top - 364) }); }}>${value || "항목"} <span class="muted">▾</span></button>
    ${open && html`<div class="pop itempick-pop" style=${`position:fixed;left:${open.left}px;top:${open.top}px`}>
      ${목록.map(it => html`<div class=${"pr" + (it === value ? " on" : "")} onClick=${() => { onChange(it); setOpen(null); }}>
        <span class="grow">${it}</span><button type="button" class="linkbtn x" title="목록에서 빼기" onClick=${e => 빼기(e, it)}>✕</button></div>`)}
      ${value && !목록.includes(value) && html`<div class="pr muted small">지금 값 '${value}'은 목록에 없음</div>`}
      <div class="row" style="gap:4px;margin-top:6px"><input placeholder="직접 입력 → Enter" value=${새} onInput=${e => set새(e.target.value)}
        onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); 더하기(); } }} style="width:140px" />
        <button type="button" class="btn sm" onClick=${더하기}>추가</button></div>
    </div>`}</span>`;
}

export const EVIDENCES = ["전자세금계산서", "종이세금계산서", "카드영수증", "현금영수증", "계산서(비과세)", "간이영수증", "기타영수증", "자료없음"];

let tmp = 0;
const blank = () => ({ _new: ++tmp, item: "기타비용", paid_by: "딜러", taxable: true, amount: 0, paid_date: today(),
  evidence: null, memo: "", include_in_settlement: true });

export function CostsTab({ app, car, costs, reload, locked, office }) {
  const [rows, setRows] = useState(costs.map(c => ({ ...c })));
  const [busy, setBusy] = useState(false);
  // 공동대표 차는 손익을 그때그때 다시 계산하므로 확정 뒤에도 고친다 (딜러 차는 딜러 지급액이 정해져 잠금)
  const partner = !!app.dealers.find(d => d.id === car.dealer_id)?.partner;
  const edit = (!locked || partner) && office;
  const upd = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const dirty = JSON.stringify(rows) !== JSON.stringify(costs);

  const calc = rows.map(r => ({ ...r, ...부가세분리(r.amount, r.taxable) }));
  const tot = f => calc.filter(f).reduce((s, r) => ({ a: s.a + r.금액, s: s.s + r.공급가, v: s.v + r.부가세, n: s.n + 1 }), { a: 0, s: 0, v: 0, n: 0 });
  const inS = tot(r => r.include_in_settlement), outS = tot(r => !r.include_in_settlement), all = tot(() => true);

  const save = async () => {
    if (rows.some(r => !r.auto_source && !r.amount)) return toast("금액이 0인 행이 있습니다.", "err");
    setBusy(true);
    await run(async () => {
      const keep = new Set(rows.filter(r => r.id).map(r => r.id));
      const gone = costs.filter(c => !c.auto_source && !keep.has(c.id)).map(c => c.id);
      if (gone.length) await q(app.db.from("car_costs").delete().in("id", gone));
      const pick = r => ({ item: r.item, paid_by: r.paid_by, taxable: r.taxable, amount: r.amount, paid_date: r.paid_date || null,
        evidence: r.evidence || null, memo: r.memo || null, include_in_settlement: r.include_in_settlement });
      for (const r of rows.filter(r => r.id && !r.auto_source)) {
        const o = costs.find(c => c.id === r.id);
        if (JSON.stringify(pick(o)) !== JSON.stringify(pick(r))) await q(app.db.from("car_costs").update(pick(r)).eq("id", r.id));
      }
      // 자동 행은 정산반영·증빙·비고만 바꿀 수 있다 (금액은 제시정보에서)
      for (const r of rows.filter(r => r.auto_source)) {
        const o = costs.find(c => c.id === r.id);
        if (o.include_in_settlement !== r.include_in_settlement || o.evidence !== r.evidence || o.memo !== r.memo)
          await q(app.db.from("car_costs").update({ include_in_settlement: r.include_in_settlement, evidence: r.evidence, memo: r.memo }).eq("id", r.id));
      }
      const add = rows.filter(r => !r.id).map((r, i) => ({ ...pick(r), car_id: car.id, sort: 10 + i }));
      if (add.length) await q(app.db.from("car_costs").insert(add));
    }, "상품화비용을 저장했습니다");
    setBusy(false);
    reload();
  };

  return html`<div class="card">
    <div class="bar"><h3>상품화비용</h3>
      ${locked && (partner ? html`<span class="muted small">손익확정된 차 — 고치면 손익·대표 실적이 바로 바뀝니다 (변경 기록이 남습니다)</span>`
        : html`<span class="muted">정산완료된 차량이라 잠겨 있습니다 (정산 탭에서 확정 해제)</span>`)}
      <span class="grow"></span>
      ${edit && html`<button class="btn" onClick=${() => setRows(r => [...r, blank()])}>+ 비용 추가</button>
        <button class="btn primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "저장 중…" : "저장"}</button>`}
    </div>
    <div class="table-wrap"><table class="grid costs">
      <thead><tr><th>항목</th><th>지출</th><th>과세</th><th class="r">금액</th><th class="r">공급가</th><th class="r">부가세</th>
        <th title="매입원가로 공제(정산기준금액에서 차감)">정산반영</th><th>결제일</th><th>지출증빙</th><th>비고/지출처</th><th></th></tr></thead>
      <tbody>${calc.map((r, i) => {
        const auto = !!r.auto_source, ro = !edit;
        return html`<tr class=${auto ? "auto" : ""}>
          <td>${ro || auto ? html`${r.item}${auto && html` <small class="muted">자동</small>`}` : html`<${ItemPick} app=${app} value=${r.item} onChange=${v => upd(i, "item", v)} />`}</td>
          <td>${ro || auto ? r.paid_by : html`<${Select} value=${r.paid_by} onChange=${v => upd(i, "paid_by", v)} options=${["딜러", "상사"]} />`}</td>
          <td>${ro || auto ? (r.taxable ? "과세" : "비과세") : html`<${Select} value=${r.taxable ? "과세" : "비과세"} onChange=${v => upd(i, "taxable", v === "과세")} options=${["과세", "비과세"]} />`}</td>
          <td class="r">${ro || auto ? won(r.amount) : html`<${Money} value=${r.amount} onInput=${v => upd(i, "amount", v)} />`}</td>
          <td class="r muted">${won(r.공급가)}</td><td class="r muted">${won(r.부가세)}</td>
          <td class="c"><input type="checkbox" disabled=${ro} checked=${r.include_in_settlement} onChange=${e => upd(i, "include_in_settlement", e.target.checked)} /></td>
          <td>${ro || auto ? (r.paid_date || "") : html`<input type="date" value=${r.paid_date || ""} onInput=${e => upd(i, "paid_date", e.target.value)} />`}</td>
          <td>${ro ? (r.evidence || "") : html`<${Select} value=${r.evidence} onChange=${v => upd(i, "evidence", v)} empty="-" options=${EVIDENCES} />`}</td>
          <td>${ro ? (r.memo || "") : html`<input value=${r.memo || ""} onInput=${e => upd(i, "memo", e.target.value)} />`}</td>
          <td>${edit && !auto && html`<button class="btn sm ghost" title="삭제" onClick=${() => setRows(rs => rs.filter((_, j) => j !== i))}>✕</button>`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
    <div class="sums">
      <div><span>정산반영 (매입원가 공제) ${inS.n}건</span><b>${won(inS.a)}</b><small>공급가 ${won(inS.s)} · 부가세 ${won(inS.v)}</small></div>
      <div><span>정산제외 ${outS.n}건</span><b>${won(outS.a)}</b><small>공급가 ${won(outS.s)} · 부가세 ${won(outS.v)}</small></div>
      <div class="strong"><span>총계 ${all.n}건</span><b>${won(all.a)}</b><small>공급가 ${won(all.s)} · 부가세 ${won(all.v)}</small></div>
    </div>
    <p class="note">지출구분 <b>상사</b> + 정산반영이면 상사가 대신 낸 돈으로 보고 정산 때 딜러 지급액에서 상계합니다.
      상사매입비·취득세·매입수수료 행은 차량정보에서 바꾸면 자동으로 따라갑니다.</p>
  </div>`;
}
