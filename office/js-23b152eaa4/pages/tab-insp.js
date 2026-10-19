// 성능점검 (KAIWA 자동 연동, kaiwa_sync.py) — 제시정보 탭 아래 카드 + 대시보드 만료 판정
import { html, useState, useEffect, Badge, won, run, toast } from "../ui.js";
import { q } from "../db.js";

export const ALERT_DAYS = 90;

/** 성능점검 연장(재점검) — 연장한 날을 받아 그날부터 90일을 다시 세고, 유효기한은 그날 + 119일 (KAIWA 와 같은 기간). 성공하면 true */
export async function renewInsp(app, i) {
  const v = window.prompt("성능점검 연장(재점검)한 날 (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
  if (!v) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) { toast("날짜를 YYYY-MM-DD 로 넣어 주세요.", "err"); return false; }
  const d = v.trim(), exp = new Date(Date.parse(d + "T00:00:00Z") + 119 * 864e5).toISOString().slice(0, 10);
  return !!(await run(() => q(app.db.from("car_inspections").update({ renewed_on: d, expire_date: exp, alerted_at: null }).eq("id", i.id)), `연장했습니다 — 유효 ${exp}까지`));
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** 점검 한 건의 상태: 경과일, 남은 날, 표시 색 */
export function inspState(i, t) {
  const 경과 = days(i.renewed_on || i.recept_date, t);       // 연장(재점검)했으면 그날부터
  const 남은 = i.expire_date ? days(t, i.expire_date) : null;
  const tone = 남은 !== null && 남은 < 0 ? "red" : 경과 >= ALERT_DAYS ? "amber" : "green";
  const text = 남은 !== null && 남은 < 0 ? `만료 (${-남은}일 지남)` : `${경과}일 경과` + (남은 !== null ? ` · D-${남은}` : "");
  return { 경과, 남은, tone, text };
}

const FLAGS = ["사고이력", "단순수리", "침수·화재", "렌트·영업용", "튜닝"];

export function InspectionCard({ app, car, office }) {
  const [rows, setRows] = useState(null);
  const [ver, setVer] = useState(0);
  useEffect(() => { run(async () => {
    const [ins, files] = await Promise.all([
      q(app.db.from("car_inspections").select("*").eq("car_id", car.id).order("recept_date", { ascending: false })),
      office ? q(app.db.from("car_files").select("id,path,name").eq("car_id", car.id).eq("kind", "성능")) : [],
    ]);
    setRows(ins.map(i => ({ ...i, file: files.find(f => f.id === i.file_id) })));
  }); }, [car.id, ver]);
  if (!rows) return null;

  const openPdf = async f => {
    const { data, error } = await app.db.storage.from("car-files").createSignedUrl(f.path, 120);
    if (error) return toast(error.message, "err");
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const t = new Date().toISOString().slice(0, 10);
  return html`<div class="card insp">
    <div class="bar"><h3>성능점검</h3><span class="muted small">KAIWA 자동 연동</span></div>
    ${!rows.length ? html`<p class="muted">아직 연동된 성능점검이 없습니다. 점검이 끝나면 하루 두 번 자동으로 들어옵니다.</p>`
      : rows.map((i, n) => { const s = inspState(i, t); const r = i.result || {};
        return html`<div class=${"insp-row" + (n ? " old" : "")}>
          <div class="insp-line">
            <b>${i.check_no || "-"}</b>
            ${n === 0 && car.status === "재고" ? html`<${Badge} tone=${s.tone}>${s.text}<//>` : html`<span class="muted small">이전 점검</span>`}
            <span class="muted small">${i.place || ""} · 점검 ${i.recept_date}${i.renewed_on ? ` · 연장 ${i.renewed_on}` : ""}${i.expire_date ? ` · 유효 ${i.expire_date}까지` : ""}</span>
            <span class="grow"></span>
            ${office && n === 0 && car.status === "재고" && html`<button class="btn sm" onClick=${async () => { if (await renewInsp(app, i)) setVer(v => v + 1); }}>연장</button>`}
            ${office && i.file && html`<button class="btn sm" onClick=${() => openPdf(i.file)}>기록부 PDF</button>`}
          </div>
          <div class="insp-line insp-flags">
            ${FLAGS.map(k => r[k] && html`<span class=${"badge " + (r[k] === "있음" ? "red" : "gray")}>${k} ${r[k]}</span>`)}
            <span class="muted small">보험료 ${won(i.insur_price)}원 · 점검비 ${won(i.check_price)}원${i.insurer ? ` · ${i.insurer}` : ""}${i.mileage ? ` · ${won(i.mileage)}km` : ""}</span>
          </div>
          ${(i.warnings || []).map(w => html`<p class="note red">⚠ ${w}</p>`)}
        </div>`; })}
  </div>`;
}
