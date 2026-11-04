// 차량입력 → [📥 명세서 올리기]: 상품화 업체 거래명세서(탑광택 엑셀·하우모터스 이미지 등)를 차마다 상품화비용으로 (사용자 2026-11-01, 이미지 11-03).
//   이미지(png·jpg·pdf)는 서버(read-invoice, Gemini)가 표로 읽어 오고, 읽은 금액 합이 명세서의 공급가액과 맞는지 보여 준다.
//   파일을 고르면 미리보기(차 찾기·이미 넣음·대장 바꿈·주의) → 체크한 줄만 [넣기]. 읽기·계획은 ../cost-import.js (시험 있음)
//   손익확정된 대표 차는 정산 손익(net_income)도 늘어난 비용만큼 같이 고친다 — 할부 고치기와 같은 방식. 손익 0 인 정산(대장에서 옮긴 차)은 그대로
import { html, useState, run, won, toast, ask } from "../ui.js";
import { q } from "../db.js";
import { 명세서읽기, 계획, 항목들, 그림줄 } from "../cost-import.js";

const XLSX_JS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const 불러오기 = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => {
  const s = document.createElement("script"); s.src = XLSX_JS; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error("엑셀 읽기 도구를 못 불러왔습니다 (인터넷 확인)"));
  document.head.appendChild(s);
});
const 전부 = async qb => { const out = []; for (let i = 0; ; i += 1000) { const r = await q(qb().range(i, i + 999)); out.push(...r); if (r.length < 1000) return out; } };
const 월일 = d => d ? d.slice(5).replace("-", "/") : "";

export function CostImport({ app, onClose, onDone }) {
  const [vendor, setVendor] = useState("탑광택");
  const [p, setP] = useState(null);           // { file, rows: 계획 줄들, sets: 정산, 공급가?: 이미지에 적힌 공급가액 }
  const [chk, setChk] = useState({});
  const [busy, setBusy] = useState(false);

  const 읽기 = file => file && run(async () => {
    let items, 업체 = vendor.trim() || "업체", 공급가 = null;
    if (/\.(png|jpe?g|webp|pdf)$/i.test(file.name)) {          // 이미지 명세서 — 서버가 읽는다 (10초쯤)
      if (file.size > 10e6) throw new Error("10MB 넘는 파일은 읽을 수 없습니다");
      toast("이미지를 읽는 중입니다… (10초쯤)");
      const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(file); });
      const mime = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "image/png");
      const { data, error } = await app.db.functions.invoke("read-invoice", { body: { mime, data: b64 } });
      if (error || !data?.ok) throw new Error(data?.msg || (await error?.context?.json?.().catch(() => null))?.msg || "이미지를 못 읽었습니다");
      items = 그림줄(data, file.name);
      if (data.vendor) { 업체 = String(data.vendor).replace(/\s+/g, "").replace(/[_\-].*$/, "") || 업체; setVendor(업체); }
      공급가 = Number(data.supply_total) || null;
    } else {
      const X = await 불러오기();
      const wb = X.read(await file.arrayBuffer(), { type: "array" });
      const sheets = wb.SheetNames.map(name => ({ name, rows: X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }) }));
      items = 명세서읽기(sheets);
    }
    if (!items.length) throw new Error("작업 줄을 못 찾았습니다 — 거래명세서(차량번호·금액 칸이 있는 표)인지 확인해 주세요");
    const [cars, costs, settlements, sales] = await Promise.all([
      전부(() => app.db.from("cars").select("id, plate, purchase_date, car_name").is("deleted_at", null).order("id")),
      전부(() => app.db.from("car_costs").select("id, car_id, item, amount, auto_source").eq("item", "도색광택").order("id")),
      전부(() => app.db.from("settlements").select("car_id, finalized, mode, net_income, cost_total, base_amount, base_supply").order("car_id")),
      전부(() => app.db.from("car_sales").select("car_id, sale_date, contract").order("car_id")),
    ]);
    const rows = 계획(items, { cars, costs, settlements, sales, vendor: 업체 });
    setP({ file: file.name, rows, sets: settlements, 공급가, 읽은합: items.reduce((t, r) => t + r.sum, 0) });
    setChk(Object.fromEntries(rows.map((r, i) => [i, r.check])));
  });

  const 고른 = p ? p.rows.filter((r, i) => chk[i] && r.lines.length && r.car) : [];
  const 넣을합 = 고른.reduce((t, r) => t + r.add, 0);
  const 바꿀차 = new Set(고른.filter(r => r.replace.length).map(r => r.car.id));
  const 확정차 = new Set(고른.filter(r => r.settled).map(r => r.car.id));

  const 넣기 = () => ask(`${고른.reduce((t, r) => t + r.lines.length, 0)}줄 (${won(넣을합)}원, 부가세 포함)을 넣을까요?${바꿀차.size ? `\n이미 있던 도색광택(대장·직접 넣은 것) ${바꿀차.size}대는 명세서 내용으로 바뀝니다.` : ""}${확정차.size ? `\n손익확정된 차 ${확정차.size}대는 차량 손익도 같이 고칩니다.` : ""}`) && (async () => {
    setBusy(true);
    const ok = await run(async () => {
      const 차별 = {};                       // car_id → { add, removed }
      const 지울 = new Set();
      for (const r of 고른) {
        const x = 차별[r.car.id] ||= { add: 0, removed: 0 };
        x.add += r.add;
        if (r.replace.length && !r.replace.every(id => 지울.has(id))) { r.replace.forEach(id => 지울.add(id)); x.removed += r.replaced; }
      }
      const 넣을 = 고른.flatMap(r => r.lines.map(l => ({ car_id: r.car.id, item: "도색광택", amount: l.amount, paid_by: "딜러", taxable: true, paid_date: r.date,
        include_in_settlement: true, memo: `${vendor.trim() || "업체"} ${월일(r.date)} ${l.kind}${r.memo ? " · " + r.memo : ""}`, auto_source: l.key })));
      for (let i = 0; i < 넣을.length; i += 200) await q(app.db.from("car_costs").insert(넣을.slice(i, i + 200)));
      if (지울.size) await q(app.db.from("car_costs").delete().in("id", [...지울]));
      for (const [car_id, x] of Object.entries(차별)) {      // 손익확정된 대표 차: 손익 = 매출 − 매입 − 비용(부가세 포함) 이라 늘어난 비용만큼 뺀다
        const s = p.sets.find(t => t.car_id === car_id), d = x.add - x.removed;
        if (!s?.finalized || s.mode !== "대표" || !d || !Number(s.net_income)) continue;
        await q(app.db.from("settlements").update({ net_income: Number(s.net_income) - d, cost_total: Number(s.cost_total || 0) + d,
          base_amount: Number(s.base_amount || 0) - d, base_supply: Number(s.base_supply || 0) - d }).eq("car_id", car_id));
      }
      return true;
    }, `${고른.length}건 넣었습니다`);
    setBusy(false);
    if (ok) { onDone(); setP(null); }
  })();

  const 상태색 = r => r.status === "차 없음" || r.warn && !r.check ? "red" : r.warn ? "amber" : r.status === "이미 넣음" ? "muted" : "green";
  return html`<div class="card" style="margin-bottom:12px">
    <div class="bar"><h3>📥 거래명세서 올리기</h3><span class="muted small">업체 명세서(엑셀 또는 이미지·PDF) → 차마다 '도색광택'에 항목별로 · 금액은 부가세 별도로 보고 10% 더해 넣습니다 · 같은 파일을 다시 올려도 안 겹칩니다</span>
      <span class="grow"></span><button class="btn ghost" onClick=${onClose}>닫기</button></div>
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
      <label class="small">업체 <input value=${vendor} onInput=${e => setVendor(e.target.value)} style="width:110px" /></label>
      <input type="file" accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp,.pdf" onChange=${e => { 읽기(e.target.files?.[0]); e.target.value = ""; }} />
      ${p && html`<span class="small"><b>${p.file}</b> · ${p.rows.length}줄</span>`}
    </div>
    ${p?.공급가 && html`<p class=${"note" + (p.공급가 === p.읽은합 ? "" : " red")} style="margin-top:8px">${p.공급가 === p.읽은합
      ? `✔ 읽은 금액 합 ${won(p.읽은합)}원 = 명세서 공급가액 ${won(p.공급가)}원`
      : `⚠ 읽은 금액 합 ${won(p.읽은합)}원 ≠ 명세서 공급가액 ${won(p.공급가)}원 — 이미지에서 잘못 읽은 줄이 있을 수 있습니다. 표를 이미지와 대 보고 넣어 주세요`}</p>`}
    ${p && html`<div class="table-wrap" style="margin-top:10px;max-height:60vh;overflow:auto"><table class="grid">
      <thead><tr><th><input type="checkbox" checked=${p.rows.every((r, i) => !r.lines.length || !r.car || chk[i])}
          onChange=${e => setChk(Object.fromEntries(p.rows.map((r, i) => [i, e.target.checked && !!r.car && r.lines.length > 0 && r.status !== "이미 넣음"])))} /></th>
        <th>시트</th><th>작업일</th><th>번호</th><th>차종(엑셀)</th><th>업무관리 차</th>${항목들.map(k => html`<th class="r">${k}</th>`)}<th class="r">넣을 금액<br /><small>(부가세 포함)</small></th><th>상태</th></tr></thead>
      <tbody>${p.rows.map((r, i) => html`<tr key=${i} class=${!chk[i] ? "muted" : ""}>
        <td><input type="checkbox" checked=${!!chk[i]} disabled=${!r.car || !r.lines.length || r.status === "이미 넣음" || r.status === "딜러 정산 확정"} onChange=${e => setChk(c => ({ ...c, [i]: e.target.checked }))} /></td>
        <td class="small">${r.sheet}</td><td>${월일(r.date)}</td><td><b>${r.plate}</b></td><td class="small">${r.model}</td>
        <td class="small">${r.car ? html`<a href=${"#/car/" + r.car.id} target="_blank">${r.car.car_name || r.car.plate}</a> <span class="muted">${r.car.purchase_date?.slice(2) || ""} 매입</span>` : html`<span class="red">없음</span>`}</td>
        ${항목들.map(k => html`<td class="r">${r.amounts[k] ? won(r.amounts[k]) : ""}</td>`)}
        <td class="r"><b>${r.add ? won(r.add) : ""}</b>${r.replaced ? html`<br /><small class="muted">기존 ${won(r.replaced)} → 바꿈</small>` : ""}</td>
        <td class="small"><b class=${상태색(r)}>${r.status}</b>${r.settled ? html` <span class="muted">· 정산확정(손익 같이)</span>` : ""}${r.warn ? html`<br /><span class=${r.check ? "amber" : "red"}>${r.warn}</span>` : ""}${r.memo ? html`<br /><span class="muted">${r.memo}</span>` : ""}</td>
      </tr>`)}</tbody></table></div>
      <div class="bar" style="margin-top:10px"><span>고른 ${고른.length}건 · <b>${won(넣을합)}원</b> (부가세 포함)${바꿀차.size ? ` · 기존 줄 바꿈 ${바꿀차.size}대` : ""}${확정차.size ? ` · 손익확정 차 ${확정차.size}대 손익 같이 고침` : ""}</span>
        <span class="grow"></span><button class="btn primary" disabled=${busy || !고른.length} onClick=${넣기}>${busy ? "넣는 중…" : "넣기"}</button></div>`}
  </div>`;
}
