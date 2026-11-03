// 상품화 업체 거래명세서 엑셀 → 차 상품화비용 (사용자 2026-11-01, 탑광택 '이용내역.xlsx').
//   시트 하나 = 한 달 명세서. 머리줄: 작업일 | 작업내용(세차·광택·도색 v) | 딜러 | 전화번호 | 차종 | 색상 | 번호 | 금액(세차·광택·도색·기타작업·합계) | 출고여부 | 비고
//   달마다 '도색'·'기타작업' 칸 순서가 바뀌어 있어 칸 제목으로 읽는다. 금액은 부가세 별도 → 넣을 때 10% 더함 (사용자: 세금계산서 받는 거래)
//   차마다 '도색광택' 칸에 항목별로 한 줄씩 (auto_source '엑셀:업체:작업일:항목' — 같은 파일을 다시 올려도 안 겹침)
//   매입매출대장에서 옮겨 온 도색광택(대장)이 명세서 합계와 같으면 그 줄을 엑셀 내용으로 바꾼다 (사용자: 9월분 바꾸기)

export const 항목들 = ["세차", "광택", "세광", "도색", "기타"];        // 세광 = 세차+광택 (하우모터스 명세서)
const 번호판 = /(\d{2,3})\s*([가-힣])\s*(\d{4})/;
export const 판 = s => { const m = String(s ?? "").match(번호판); return m ? m[1] + m[2] + m[3] : null; };
const 글 = v => String(v ?? "").replace(/\s+/g, "");
const 수 = v => typeof v === "number" ? Math.round(v) : /^-?[\d,]+$/.test(String(v ?? "").trim()) ? Number(String(v).replace(/,/g, "")) : 0;
const 날 = v => {
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);   // 엑셀 날짜 일련번호
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const m = String(v ?? "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};
export const 부가세더함 = v => Math.round(v * 1.1);

/** 시트들 [{ name, rows: 2차원 배열 }] → 작업 줄들 (번호판 있는 줄만) */
export function 명세서읽기(sheets) {
  const out = [];
  for (const { name, rows } of sheets) {
    const h = rows.findIndex(r => (r || []).some(c => 글(c) === "번호"));
    if (h < 0) continue;
    const 머리 = rows[h].map(글), 윗머리 = (rows[h - 1] || []).map(글);
    const 칸 = t => { const i = 머리.indexOf(t); return i >= 0 ? i : 윗머리.indexOf(t); };
    const 번호칸 = 머리.indexOf("번호");
    const 금액칸 = k => 머리.findIndex((t, i) => i > 번호칸 && (t === k || (k === "기타" && t.startsWith("기타"))));
    const cols = { date: 칸("작업일"), model: 칸("차종"), memo: 칸("비고"), total: 금액칸("합계"), ...Object.fromEntries(항목들.map(k => [k, 금액칸(k)])) };
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r] || [], plate = 판(row[번호칸]);
      if (!plate) continue;
      const amounts = Object.fromEntries(항목들.map(k => [k, cols[k] >= 0 ? 수(row[cols[k]]) : 0]));
      const sum = 항목들.reduce((t, k) => t + amounts[k], 0);
      const total = cols.total >= 0 && row[cols.total] !== "" && row[cols.total] != null && typeof row[cols.total] !== "string" ? 수(row[cols.total]) : sum;
      out.push({ sheet: name, row: r + 1, date: 날(row[cols.date]), plate, model: String(row[cols.model] ?? "").trim(), memo: String(row[cols.memo] ?? "").trim(),
        amounts, sum, total, sumOk: total === sum });
    }
  }
  return out;
}

/** 작업 줄 → 넣을 계획. cars [{id, plate, purchase_date, car_name}], costs [{id, car_id, item, amount, auto_source}], settlements [{car_id, finalized, mode}],
 *  sales [{car_id, sale_date, contract}] — 작업일보다 한참 전에 판 차는 같은 번호판의 다른 차일 수 있어 묻는다 */
export function 계획(items, { cars, costs, settlements, sales = [], vendor = "탑광택" }) {
  const 차찾기 = (plate, date) => {
    const cs = cars.filter(c => 판(c.plate) === plate).sort((a, b) => String(b.purchase_date || "").localeCompare(String(a.purchase_date || "")));
    return cs.find(c => !date || !c.purchase_date || c.purchase_date <= date) || cs[0] || null;
  };
  const rows = items.map(it => ({ ...it, car: 차찾기(it.plate, it.date) }));
  // 차마다: 대장 도색광택 합이 이 파일 합계와 같으면 바꾼다
  const 차합 = {}, 칸합 = {};          // 항목 합 / 명세서 '합계' 칸 합 (사무장이 합계 칸 금액을 그대로 넣어 둔 경우도 같은 것으로)
  for (const r of rows) if (r.car) { 차합[r.car.id] = (차합[r.car.id] || 0) + r.sum; 칸합[r.car.id] = (칸합[r.car.id] || 0) + r.total; }
  return rows.map(r => {
    const lines = 항목들.filter(k => r.amounts[k] > 0).map(k => ({ kind: k, supply: r.amounts[k], amount: 부가세더함(r.amounts[k]), key: `엑셀:${vendor}:${r.date}:${k}` }));
    const base = { ...r, lines, add: lines.reduce((t, l) => t + l.amount, 0), replace: [], replaced: 0, check: false, status: "", warn: "" };
    if (!r.car) return { ...base, status: "차 없음" };
    if (!r.date) return { ...base, status: "작업일 없음" };
    if (!lines.length) return { ...base, status: "금액 없음" };
    const mine = costs.filter(k => k.car_id === r.car.id && k.item === "도색광택");
    const 새줄 = lines.filter(l => !mine.some(k => k.auto_source === l.key));
    if (!새줄.length) return { ...base, status: "이미 넣음" };
    const s = settlements.find(x => x.car_id === r.car.id);
    if (s?.finalized && s.mode !== "대표") return { ...base, status: "딜러 정산 확정", warn: "확정을 풀고 넣어 주세요" };
    // 대장에서 옮긴 줄·사무장이 직접 넣은 줄이 명세서 합계(부가세 별도든 포함이든)와 같으면 명세서 내용으로 바꾼다 (사용자 2026-11-03)
    const T = 차합[r.car.id], Tc = 칸합[r.car.id], 같음 = v => v > 0 && [T, 부가세더함(T), Tc, 부가세더함(Tc)].includes(v);
    const 대장 = mine.filter(k => k.auto_source === "대장"), 대장합 = 대장.reduce((t, k) => t + Number(k.amount), 0);
    const 직접 = mine.filter(k => !k.auto_source), 직접합 = 직접.reduce((t, k) => t + Number(k.amount), 0);
    const out = { ...base, lines: 새줄, add: 새줄.reduce((t, l) => t + l.amount, 0), status: "새로", check: true };
    if (같음(대장합)) Object.assign(out, { replace: 대장.map(k => k.id), replaced: 대장합, status: "대장 바꿈" });
    else if (대장합) Object.assign(out, { check: false, warn: `대장에서 옮긴 도색광택 ${대장합.toLocaleString()}원이 따로 있음 — 겹칠 수 있음` });
    if (같음(직접합)) Object.assign(out, { replace: [...out.replace, ...직접.map(k => k.id)], replaced: out.replaced + 직접합, status: "직접 넣은 것 바꿈" });
    else if (직접합) Object.assign(out, { check: false, warn: `직접 넣은 도색광택 ${직접합.toLocaleString()}원이 이미 있음 — 겹칠 수 있음` });
    // 10월 명세서는 줄마다 합계 칸이 기타작업을 빼고 계산돼 있다 (맨 아래 총합계에는 들어감) — 그 경우는 기타까지 넣는다
    if (!r.sumOk && r.total === r.sum - r.amounts.기타) out.warn = `합계 칸에 기타작업 ${r.amounts.기타.toLocaleString()}원이 빠져 있음 (맨 아래 총합계엔 들어감) — 기타까지 넣음`;
    else if (!r.sumOk) Object.assign(out, { check: false, warn: `항목 합 ${r.sum.toLocaleString()}원 ≠ 합계 칸 ${r.total.toLocaleString()}원 — 업체에 확인` });
    const 판날 = sales.find(x => x.car_id === r.car.id && !x.contract)?.sale_date;
    if (판날 && Date.parse(판날) < Date.parse(r.date) - 14 * 864e5) Object.assign(out, { check: false, warn: `${판날}에 판 차 — 같은 번호판의 다른 차일 수 있음` });
    if (s?.finalized) out.settled = true;
    return out;
  });
}

/** 이미지 명세서를 읽은 결과(read-invoice) → 명세서읽기와 같은 모양의 작업 줄 */
export function 그림줄(res, name = "이미지") {
  const 키 = { 세차: "wash", 광택: "polish", 세광: "wash_polish", 도색: "paint", 기타: "etc" };
  return (res?.rows || []).map((x, i) => {
    const plate = 판(x.plate);
    if (!plate) return null;
    const amounts = Object.fromEntries(항목들.map(k => [k, Math.max(0, Math.round(Number(x[키[k]]) || 0))]));
    const sum = 항목들.reduce((t, k) => t + amounts[k], 0), total = Math.round(Number(x.total) || 0) || sum;
    return { sheet: name, row: i + 1, date: 날(x.date), plate, model: String(x.model || "").trim(), memo: String(x.content || "").replace(/\s+/g, " ").trim(),
      amounts, sum, total, sumOk: total === sum };
  }).filter(Boolean);
}
