// 통계: 브랜드·연식·주행거리·매입처·매입가·판매유형·매입담당별로 대수·평균 손익·평균 판매일을 막대로 본다.
// 손익은 차량 손익(대표 차 기준식: 매도 + 매도비 + 할부 − 매입가 − 상품화비 − 재고금융 이자, 부가세 안 뺌)
import { html, useState, useEffect, Seg, Loading, Empty, run, won, today, Period, initPeriod } from "../ui.js";
import { loadAll } from "./report-data.js";
import { 대표차량계산, 월별추이 } from "../report-calc.js";
import { TrendChart } from "./reports.js";

const n = v => Math.round(Number(v) || 0);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const band = (v, edges, unit, fmt = x => x) => {
  if (v == null || v === "") return "모름";
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return i === 0 ? `~${fmt(edges[0])}${unit}` : `${fmt(edges[i - 1])}~${fmt(edges[i])}${unit}`;
  return `${fmt(edges.at(-1))}${unit}~`;
};
const KM = [30000, 60000, 100000, 150000];
const PRICE = [5_000_000, 10_000_000, 20_000_000, 30_000_000, 50_000_000];
const man = v => (v / 10_000).toLocaleString();   // 만원

const GROUPS = [
  ["brand", "브랜드", c => c.brand || "모름"],
  ["year", "연식", c => c.model_year ? String(c.model_year).slice(0, 4) + "년" : "모름"],
  ["km", "주행거리", c => band(c.mileage, KM, "km", man).replace(/km/g, "만km")],
  ["channel", "매입처", c => c.purchase_channel || "모름"],
  ["price", "매입가", c => band(n(c.purchase_amount), PRICE, "만원", man)],
  ["saletype", "판매유형", c => c.sale?.sale_type || "재고"],
  ["owner", "매입담당", c => c.owner || "미지정"],
];
const METRICS = [["n", "대수"], ["profit", "평균 손익"], ["days", "평균 판매일"]];

export function StatsPage({ app }) {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState(() => ({ ...initPeriod("직접"), from: "2000-01-01", to: today() }));
  const [metric, setMetric] = useState("n");
  const [scope, setScope] = useState("전체");
  useEffect(() => { run(async () => setD(await loadAll(app.db))); }, []);
  if (!d) return html`<${Loading} />`;
  const t = today();
  const sale = Object.fromEntries(d.sales.map(s => [s.car_id, s]));
  const dealer = Object.fromEntries(d.dealers.map(x => [x.id, x.name]));
  const cars = d.cars.filter(c => !c.deleted_at && c.purchase_date >= period.from && c.purchase_date <= period.to)
    .filter(c => scope === "전체" || (scope === "매도" ? sale[c.id] : !sale[c.id]))
    .map(c => { const s = sale[c.id];
      return { ...c, sale: s, owner: dealer[c.dealer_id], 손익: s ? 대표차량계산(d, c, s).손익 : null, 판매일: s ? days(c.purchase_date, s.sale_date) : null }; });
  const sold = cars.filter(c => c.sale);
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const 추이 = 월별추이(d, t.slice(0, 7), 12).map(r => ({ ...r, label: String(+r.월.slice(5)) }));
  return html`<div class="bar"><h2>통계</h2><span class="muted small">매입일 기준 · 손익은 매도된 차만 (부가세 안 뺌)</span></div>
    <div class="bar"><${Period} value=${period} onChange=${setPeriod} /><span class="muted small">${period.from === "2000-01-01" ? "전체 기간" : `${period.from} ~ ${period.to}`}</span>
      <button class="btn sm ghost" onClick=${() => setPeriod(p => ({ ...p, from: "2000-01-01", to: t }))}>전체 기간</button>
      <span class="grow"></span><${Seg} value=${scope} onChange=${setScope} options=${["전체", "재고", "매도"]} />
      <${Seg} value=${metric} onChange=${setMetric} options=${METRICS} /></div>
    <div class="stat-grid">
      <div class="stat"><span>차량</span><b>${cars.length}대</b><small>재고 ${cars.length - sold.length} · 매도 ${sold.length}</small></div>
      <div class="stat"><span>평균 매입가</span><b>${won(avg(cars.map(c => n(c.purchase_amount))) || 0)}</b></div>
      <div class="stat"><span>평균 손익 (매도)</span><b class=${(avg(sold.map(c => c.손익)) || 0) < 0 ? "red" : ""}>${won(avg(sold.map(c => c.손익)) || 0)}</b><small>손실 ${sold.filter(c => c.손익 < 0).length}대</small></div>
      <div class="stat"><span>평균 판매일</span><b>${avg(sold.map(c => c.판매일)) ?? "-"}일</b></div>
      <div class="stat"><span>평균 주행거리</span><b>${won(avg(cars.filter(c => c.mileage).map(c => n(c.mileage))) || 0)}km</b></div>
    </div>
    ${!cars.length ? html`<${Empty}>이 기간에 매입한 차가 없습니다.<//>` : html`<div class="stats-grid">
      ${GROUPS.map(([k, title, key]) => html`<${StatCard} key=${k} title=${title} cars=${cars} by=${key} metric=${metric} />`)}
      <div class="card"><h3>최근 12개월 매입 · 매도</h3><${TrendChart} rows=${추이} a=${{ key: "제시", label: "매입(대)" }} b=${{ key: "매도", label: "매도(대)" }} /></div>
    </div>`}
    <p class="note">연식·주행거리는 성능점검(KAIWA), 브랜드는 엔카 광고(통합키)가 연결되면 채워집니다. 과거 판매 차량을 옮겨 넣으면 통계가 훨씬 풍부해집니다.</p>`;
}

function StatCard({ title, cars, by, metric }) {
  const g = {};
  for (const c of cars) { const k = by(c); const x = g[k] ||= { k, n: 0, p: [], dd: [] }; x.n++; if (c.손익 != null) x.p.push(c.손익); if (c.판매일 != null) x.dd.push(c.판매일); }
  const avg = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null;
  let rows = Object.values(g).map(x => ({ ...x, profit: avg(x.p), days: avg(x.dd) }));
  rows.sort(metric === "n" ? (a, b) => b.n - a.n : (a, b) => (b[metric] ?? -1e15) - (a[metric] ?? -1e15));
  // 구간(연식·주행거리·매입가)은 구간 순서대로
  if (/^[~\d]/.test(rows[0]?.k || "") && rows.every(r => /^[~\d]|모름/.test(r.k))) rows.sort((a, b) => parseFloat(a.k.replace(/[~,]/g, "")) - parseFloat(b.k.replace(/[~,]/g, "")) || 0);
  rows = rows.slice(0, 12);
  const max = Math.max(1, ...rows.map(r => Math.abs(r[metric] ?? 0)));
  const fmt = v => v == null ? "-" : metric === "n" ? `${v}대` : metric === "days" ? `${v}일` : won(v);
  return html`<div class="card"><h3>${title}</h3><table class="st statbars"><tbody>${rows.map(r => html`<tr>
    <th>${r.k}</th>
    <td><div class="statbar"><i class=${(r[metric] ?? 0) < 0 ? "neg" : ""} style=${`width:${Math.round(Math.abs(r[metric] ?? 0) / max * 100)}%`}></i></div></td>
    <td class=${"r" + ((r[metric] ?? 0) < 0 ? " red" : "")}>${fmt(r[metric])}</td>
    <td class="r muted small">${metric === "n" ? (r.profit != null ? `손익 ${won(r.profit)}` : "") : `${r.n}대`}</td></tr>`)}</tbody></table></div>`;
}
