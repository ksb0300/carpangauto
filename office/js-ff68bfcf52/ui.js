// 화면 공용 도구 — Preact + htm (빌드 없이 쓰는 JSX 대용)
export { html, render, useState, useEffect, useMemo, useRef, useCallback, useContext, createContext }
  from "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js";
import { html, useState, useEffect, createContext, useContext } from "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js";
import { 원 } from "./calc.js";

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
export const won = n => 원(n);
export const digits = s => Number(String(s ?? "").replace(/[^\d-]/g, "")) || 0;

export function go(path) { location.hash = path; }

/** 금액 입력칸: 쉼표 표시, 숫자로 돌려준다 */
export function Money({ value, onInput, readOnly, placeholder = "0", ...rest }) {
  const [text, setText] = useState(value ? 원(value) : "");
  useEffect(() => { if (digits(text) !== (Number(value) || 0)) setText(value ? 원(value) : ""); }, [value]);
  return html`<input class="money" inputmode="numeric" placeholder=${placeholder} readOnly=${readOnly} value=${text} ...${rest}
    onInput=${e => { const n = digits(e.target.value); setText(n ? 원(n) : ""); onInput && onInput(n); }} />`;
}

export function Field({ label, req, hint, wide, children }) {
  return html`<label class=${"field" + (wide ? " wide" : "")}>
    <span class="lab">${label}${req && html`<b class="req">*</b>`}</span>
    ${children}
    ${hint && html`<small class="hint">${hint}</small>`}
  </label>`;
}

export function Select({ value, onChange, options, empty }) {
  return html`<select value=${value ?? ""} onChange=${e => onChange(e.target.value || null)}>
    ${empty !== undefined && html`<option value="">${empty}</option>`}
    ${options.map(o => Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o}>${o}</option>`)}
  </select>`;
}

export function Seg({ value, onChange, options }) {
  return html`<div class="seg">${options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return html`<button type="button" class=${String(value) === String(v) ? "on" : ""} onClick=${() => onChange(v)}>${l}</button>`;
  })}</div>`;
}

export const Badge = ({ tone = "gray", children }) => html`<span class=${"badge " + tone}>${children}</span>`;

// ── 알림 ──
let pushToast = () => {};
export function toast(msg, tone = "ok") { pushToast({ msg, tone, id: Math.random() }); }
export function Toasts() {
  const [list, setList] = useState([]);
  pushToast = t => { setList(l => [...l, t]); setTimeout(() => setList(l => l.filter(x => x !== t)), t.tone === "err" ? 6000 : 2600); };
  return html`<div class="toasts">${list.map(t => html`<div class=${"toast " + t.tone}>${t.msg}</div>`)}</div>`;
}

/** 비동기 작업 실행 + 에러는 알림으로.
 *  성공이면 결과를, 결과가 없는 성공(저장만 하고 돌려받지 않은 경우)이면 true, 실패면 undefined. */
export async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r ?? true; }
  catch (e) { console.error(e); toast(e.message || String(e), "err"); return undefined; }
}

export function Loading({ text = "불러오는 중…" }) { return html`<div class="loading">${text}</div>`; }

export function Empty({ children }) { return html`<div class="empty">${children}</div>`; }

/** 합계·보기 전용 표 한 줄 */
export const KV = ({ k, v, strong, tone }) => html`<div class=${"kv" + (strong ? " strong" : "")}><span>${k}</span><b class=${tone || ""}>${v}</b></div>`;

/** 표를 CSV(엑셀에서 바로 열림)로 내려받기 */
export function downloadCsv(name, rows) {
  const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["\ufeff" + rows.map(r => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${name}_${today()}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const lastDay = ym => `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, "0")}`;
export const monthRange = ym => ({ from: ym + "-01", to: lastDay(ym) });

/** 기간 고르기: 월 / 분기(부가세 신고 단위) / 연 / 직접 */
export function Period({ value, onChange, modes = ["월", "분기", "연", "직접"] }) {
  const { mode, ym, year, qtr, from, to } = value;
  const emit = p => {
    const v = { ...value, ...p };
    let r;
    if (v.mode === "월") r = monthRange(v.ym);
    else if (v.mode === "분기") { const s = (v.qtr - 1) * 3 + 1; r = { from: `${v.year}-${String(s).padStart(2, "0")}-01`, to: lastDay(`${v.year}-${String(s + 2).padStart(2, "0")}`) }; }
    else if (v.mode === "연") r = { from: `${v.year}-01-01`, to: `${v.year}-12-31` };
    else r = { from: v.from, to: v.to };
    onChange({ ...v, ...r });
  };
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  return html`<span class="period">
    <${Seg} value=${mode} onChange=${m => emit({ mode: m })} options=${modes} />
    ${mode === "월" && html`<input type="month" value=${ym} onInput=${e => e.target.value && emit({ ym: e.target.value })} />`}
    ${(mode === "분기" || mode === "연") && html`<select value=${year} onChange=${e => emit({ year: +e.target.value })}>${years.map(y => html`<option value=${y}>${y}년</option>`)}</select>`}
    ${mode === "분기" && html`<select value=${qtr} onChange=${e => emit({ qtr: +e.target.value })}>
      ${[[1, "1분기 (1기 예정)"], [2, "2분기 (1기 확정)"], [3, "3분기 (2기 예정)"], [4, "4분기 (2기 확정)"]].map(([q, l]) => html`<option value=${q}>${l}</option>`)}</select>`}
    ${mode === "직접" && html`<input type="date" value=${from} onInput=${e => emit({ from: e.target.value })} /> ~ <input type="date" value=${to} onInput=${e => emit({ to: e.target.value })} />`}
  </span>`;
}
export function initPeriod(mode = "월") {
  const t = today(), ym = t.slice(0, 7), year = +t.slice(0, 4), qtr = Math.floor((+t.slice(5, 7) - 1) / 3) + 1;
  const base = { mode, ym, year, qtr, from: ym + "-01", to: t };
  if (mode === "월") return { ...base, ...monthRange(ym) };
  if (mode === "분기") { const s = (qtr - 1) * 3 + 1; return { ...base, from: `${year}-${String(s).padStart(2, "0")}-01`, to: lastDay(`${year}-${String(s + 2).padStart(2, "0")}`) }; }
  if (mode === "연") return { ...base, from: `${year}-01-01`, to: `${year}-12-31` };
  return base;
}

/** 해시 주소 기반 하위 탭 */
export const SubTabs = ({ base, tabs, cur }) =>
  html`<nav class="tabs">${tabs.map(([k, l]) => html`<a class=${cur === k ? "on" : ""} href=${`#${base}/${k}`}>${l}</a>`)}</nav>`;

/** 확인 창 (기본 confirm 대신 — 문구를 한 곳에서 관리) */
export const ask = msg => window.confirm(msg);

/** 숫자 칸 공통: 0 은 흐리게 */
export const W = (n, cls = "") => html`<td class=${"r " + cls}>${Number(n) ? won(n) : html`<span class="muted">0</span>`}</td>`;
