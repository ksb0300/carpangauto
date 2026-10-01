import { html, useState, Money, Select, run, won, today, toast } from "../ui.js";
import { q } from "../db.js";
import { 부가세분리 } from "../calc.js";

export const COST_ITEMS = ["상사매입비", "취득세", "매입탁송비", "성능점검비", "의무보험료", "주유대", "판금도장비",
  "기능수리/상품화", "광택/세차", "광고비", "경매장수수료", "통행료", "이자비용", "기타비용"];
export const EVIDENCES = ["전자세금계산서", "종이세금계산서", "카드영수증", "현금영수증", "계산서(비과세)", "간이영수증", "기타영수증", "자료없음"];

let tmp = 0;
const blank = () => ({ _new: ++tmp, item: "기타비용", paid_by: "딜러", taxable: true, amount: 0, paid_date: today(),
  evidence: null, memo: "", include_in_settlement: true });

export function CostsTab({ app, car, costs, reload, locked, office }) {
  const [rows, setRows] = useState(costs.map(c => ({ ...c })));
  const [busy, setBusy] = useState(false);
  const edit = !locked && office;
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
      ${locked && html`<span class="muted">정산완료된 차량이라 잠겨 있습니다 (정산 탭에서 확정 해제)</span>`}
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
          <td>${ro || auto ? html`${r.item}${auto && html` <small class="muted">자동</small>`}` : html`<${Select} value=${r.item} onChange=${v => upd(i, "item", v)} options=${COST_ITEMS} />`}</td>
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
      상사매입비·취득세 행은 제시정보에서 금액을 바꾸면 자동으로 따라갑니다.</p>
  </div>`;
}
