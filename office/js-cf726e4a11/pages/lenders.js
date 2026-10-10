// 재고금융관리 → 금융사별 현황 · 금융사 조건 설정. 금융사마다 기본기간·연장·이율·연장 조건·상환해지수수료가 다르다.
import { html, useState, useEffect, Money, Field, Seg, Loading, Empty, run, won, go, today, W, toast , 차줄 } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 대출상태, 연장조건, 재고금융이자, 해지수수료, 상환비용 } from "../calc.js";

const n = v => Math.round(Number(v) || 0);

/** 금융사 조건 한 줄 요약 */
// 기간별 이율 글 ↔ 값: "2:6.7, 4:7.7, 6:8.8" ↔ [[2,6.7],[4,7.7],[6,8.8]]
const 단계글 = t => Array.isArray(t) ? t.map(([m, r]) => `${m}:${r}`).join(", ") : "";
const 단계읽기 = s => { const a = String(s || "").split(/[,\s]+/).map(x => x.split(":").map(Number)).filter(([m, r]) => m > 0 && r > 0).sort((a, b) => a[0] - b[0]); return a.length ? a : null; };

export function 조건요약(x) {
  if (!x) return "";
  const parts = [`기본 ${x.base_months}개월`];
  if (Number(x.ext_months)) parts.push(`연장 ${x.ext_months}개월 (총 ${Number(x.base_months) + Number(x.ext_months)}개월)`);
  else parts.push("연장 없음");
  if (Array.isArray(x.rate_tiers) && x.rate_tiers.length) parts.push("기간별 이율 " + x.rate_tiers.map(([m, r], i) => `${i ? x.rate_tiers[i - 1][0] + 1 : 1}~${m}개월 ${r}%`).join(" / "));
  else if (x.base_rate != null) parts.push(x.ext_rate != null && Number(x.ext_rate) !== Number(x.base_rate) ? `이율 ${Number(x.base_rate)}% → 연장분 ${Number(x.ext_rate)}%` : `이율 ${Number(x.base_rate)}% 고정`);
  if (Number(x.ext_repay_pct)) parts.push(`연장 전 원금 ${Number(x.ext_repay_pct)}% 상환`);
  parts.push(x.repay_fee_method === "없음" ? "중도상환수수료 없음" : `중도상환수수료 ${x.repay_fee_method} ${Number(x.repay_fee_pct)}%`);
  if (Number(x.release_fee)) parts.push(`저당해지비용 ${won(x.release_fee)}원`);
  return parts.join(" · ");
}

/** 연장 — 금융사 조건대로(기본 만기일부터, 연장 전 원금 상환, 연장분 이율). 조건이 없거나 이미 연장했으면 개월 수를 물어 수동 연장.
 *  이미 은행에서 연장해 둔 것도 이 버튼으로 기록한다 (먼저 갚은 원금은 실제 금액으로 고칠 수 있다). 성공하면 true */
export async function extendLoan(app, l) {
  const lender = app.lenders.find(x => x.id === l.lender_id), c = 연장조건(l, lender);
  let m, 상환 = 0;
  if (c.가능) {
    if (c.상환필요) {
      const v = window.prompt(`${lender.name} ${c.개월}개월 연장 (연장 시작 ${c.시작일})\n연장 전에 갚은 원금 (조건: ${Number(lender.ext_repay_pct)}% = ${won(c.상환필요)}원)`, String(c.상환필요));
      if (v == null) return false;
      상환 = Number(String(v).replace(/\D/g, "")) || 0;
    } else if (!window.confirm(`${lender.name} 조건으로 ${c.개월}개월 연장합니다. (연장 시작 ${c.시작일})`)) return false;
    m = c.개월;
  } else if (Number(l.extended_months) > 0 || Number(lender?.ext_months) > 0) {
    // 연장은 한 번뿐 — 한 번 연장하면 최종 만기, 그 뒤엔 전액 상환
    toast(`${lender?.name || ""}: 이미 연장해 최종 만기입니다. 더 연장할 수 없고 전액 상환해야 합니다.`, "err");
    return false;
  } else {
    m = Number(String(window.prompt(`${lender?.name || ""}: 금융사 연장 조건이 아직 없습니다 (조건 설정에서 넣을 수 있음).\n${l.months}개월 → 몇 개월 연장할까요? (수동)`, "") || "").replace(/\D/g, ""));
    if (!m) return false;
  }
  const s = 대출상태(l, today());
  return !!(await run(() => q(app.db.from("car_loans").update({ months: l.months + m, extended_months: (l.extended_months || 0) + m,
    ext_start: l.ext_start || s.기본만기, ext_rate: c.가능 ? c.이율 : l.ext_rate, principal_repaid: Number(l.principal_repaid || 0) + 상환,
    memo: [l.memo, `${today()} ${m}개월 연장${상환 ? ` (원금 ${won(상환)} 상환)` : ""}`].filter(Boolean).join(" / ") }).eq("id", l.id)), `${m}개월 연장했습니다`));
}

/** 연장은 한 번뿐 — 아직 연장 전이면 true (조건이 없는 금융사는 개월 수를 물어 수동 연장) */
export const 연장됨 = l => Number(l.extended_months) > 0;
export const canExtend = (l, lender) => l.status === "진행중" && !연장됨(l) && (연장조건(l, lender).가능 || !(Number(lender?.ext_months) > 0));

/** 상환 — 고른 상환일로 상환완료 처리, 상환 비용(저당해지비용·중도상환수수료)도 기록. 성공하면 true
 *  차를 판 날과 실제로 갚은 날이 다를 수 있어 날짜는 늘 고르게 한다 (기본 오늘) */
export async function repayLoan(app, l, d = today()) {
  const lender = app.lenders.find(x => x.id === l.lender_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) { toast("상환일을 골라 주세요.", "err"); return false; }
  if (d < l.start_date) { toast("상환일이 대출 실행일보다 앞섭니다.", "err"); return false; }
  const fee = 상환비용(l, lender, d), 중도 = 해지수수료(l, lender, d);
  if (fee && !window.confirm(`상환 비용 ${won(fee)}원 (저당해지비용 ${won(Number(lender?.release_fee) || 0)}${중도 ? ` + 중도상환수수료 ${won(중도)}` : ""}) — 상환완료 처리할까요?`)) return false;
  return !!(await run(() => q(app.db.from("car_loans").update({ status: "상환완료", repaid_date: d, repay_fee: fee || null }).eq("id", l.id)), "상환완료 처리했습니다"));
}

/** 목록용 버튼은 하나: 아직 연장 전이면 '연장', 한 번 연장했으면(최종 만기) '상환' */
export function LoanAction({ app, l, lender, onDone }) {
  if (l.status !== "진행중" || app.profile.role === "dealer") return null;
  const go_ = async (e, f) => { e.stopPropagation(); if (await f(app, l)) onDone(); };
  const 연장 = html`<button class="btn sm" onClick=${e => go_(e, extendLoan)}>연장</button>`;
  return canExtend(l, lender) ? 연장 : html`<${RepayButton} app=${app} l=${l} onDone=${onDone} />`;
}

/** [상환] → 상환일 달력(기본 오늘) + 확인. 목록·대시보드·차 화면에서 같이 쓴다 */
export function RepayButton({ app, l, onDone, label = "상환", cls = "btn sm primary" }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(today());
  const stop = e => e.stopPropagation();
  if (!open) return html`<button class=${cls} onClick=${e => { stop(e); setD(today()); setOpen(true); }}>${label}</button>`;
  return html`<span class="repay-pick" onClick=${stop}>
    <input type="date" value=${d} max=${today()} min=${l.start_date} onInput=${e => setD(e.target.value)} title="실제로 갚은 날" />
    <button class="btn sm primary" onClick=${async () => { if (await repayLoan(app, l, d)) { setOpen(false); onDone(); } }}>확인</button>
    <button class="btn sm ghost" onClick=${() => setOpen(false)}>✕</button></span>`;
}

/** 대출 한 건의 '다음 할 일' */
export function 할일(l, lender, t) {
  const s = 대출상태(l, t), c = 연장조건(l, lender);
  const 조건없음 = !(Number(lender?.ext_months) > 0);       // 연장 조건을 아직 안 넣은 금융사 (KB국민·신한 등)
  if (l.status !== "진행중") return { text: "상환완료", tone: "gray" };
  const 연장전 = !연장됨(l) && (c.가능 || 조건없음);
  if (조건없음 && 연장전 && s.남은일 < 0) return { text: `만기 ${-s.남은일}일 지남 · 연장 기록`, tone: "red" };
  if (조건없음 && 연장전 && s.남은일 <= 14) return { text: `D-${s.남은일} 만기 — 연장 필요`, tone: "amber" };
  // 기본 만기는 지났는데 연장 기록이 없음 — 은행에서 이미 연장했으면 '연장'으로 기록, 아니면 상환
  if (s.남은일 < 0 && c.가능) return { text: `기본 만기 ${-s.남은일}일 지남 · 연장 기록`, tone: "red" };
  if (s.남은일 < 0) return { text: `최종 만기 ${-s.남은일}일 지남 · 상환`, tone: "red" };
  if (c.가능 && s.남은일 <= 14) return { text: `D-${s.남은일} 연장 필요${c.상환필요 ? ` — 원금 ${won(c.상환필요)} 먼저 상환` : ""}`, tone: "amber" };
  if (!c.가능 && s.남은일 <= 14) return { text: `D-${s.남은일} 최종 만기 · 상환 준비`, tone: s.남은일 <= 7 ? "red" : "amber" };
  return { text: `${s.단계} · D-${s.남은일}`, tone: "green" };
}

export function LenderOverview({ app }) {
  const [d, setD] = useState(null);
  const load = () => run(async () => setD(await loadAll(app.db)));
  useEffect(() => { load(); }, []);
  const ext = async (e, l) => { e.stopPropagation(); if (await extendLoan(app, l)) load(); };
  if (!d) return html`<${Loading} />`;
  const t = today();
  const car = Object.fromEntries(d.cars.filter(c => !c.deleted_at).map(c => [c.id, c]));
  const act = d.loans.filter(l => l.status === "진행중" && car[l.car_id]);
  // 진행중 대출이 있는 금융사 먼저, 그다음 설정 순서
  const cnt = id => act.filter(l => l.lender_id === id).length;
  const lenders = d.lenders.filter(x => x.active || cnt(x.id)).sort((a, b) => (cnt(b.id) > 0) - (cnt(a.id) > 0) || (a.sort || 0) - (b.sort || 0));
  const 전체 = act.reduce((s, l) => s + n(l.amount) - n(l.principal_repaid), 0);
  const 이자 = act.reduce((s, l) => s + 재고금융이자(l, l.start_date, t), 0);
  const 급함 = act.filter(l => ["red", "amber"].includes(할일(l, d.lenders.find(x => x.id === l.lender_id), t).tone)).length;
  return html`
    <div class="stat-grid">
      <div class="stat"><span>진행중 재고금융</span><b>${won(전체)}</b><small>${act.length}건</small></div>
      <div class="stat"><span>오늘까지 쌓인 이자</span><b>${won(이자)}</b><small>실행일부터 일할</small></div>
      <div class=${"stat" + (급함 ? " warn" : "")}><span>연장·상환 챙길 것 (2주 안)</span><b>${급함}건</b></div>
    </div>
    ${lenders.filter(x => cnt(x.id) || n(x.credit_limit)).map(x => {
      const mine = act.filter(l => l.lender_id === x.id).sort((a, b) => 대출상태(a, t).만기.localeCompare(대출상태(b, t).만기));
      const used = mine.reduce((s, l) => s + n(l.amount) - n(l.principal_repaid), 0) + n(x.existing_amount), lim = n(x.credit_limit);
      return html`<div class="card lender">
        <div class="bar"><h3>${x.name}</h3>${!x.active && html`<span class="badge gray">사용 안 함</span>`}<span class="grow"></span>
          <span class="muted small">${lim ? `한도 ${won(lim)} · 사용 ${won(used)} · 잔여 ` : `사용 ${won(used)}`}${lim ? html`<b class=${lim - used < 0 ? "red" : ""}>${won(lim - used)}</b>` : ""}</span>
          <button class="btn sm" onClick=${() => go(`/loans/lender/${x.id}`)}>조건 설정</button></div>
        <p class="note" style="margin-top:0">${조건요약(x)}${x.rule_memo ? ` — ${x.rule_memo}` : ""}</p>
        ${!mine.length ? html`<p class="muted small">진행중 대출 없음</p>` : html`<div class="table-wrap"><table class="grid click">
          <thead><tr><th>차량</th><th class="r">대출(잔액)</th><th>실행일</th><th>단계</th><th>만기</th><th class="r">이율</th><th class="r">오늘까지 이자</th><th class="r" title="중도상환수수료 + 저당해지비용">지금 갚으면 상환비용</th><th>다음 할 일</th><th></th></tr></thead>
          <tbody>${mine.map(l => { const s = 대출상태(l, t), h = 할일(l, x, t), c = car[l.car_id];
            return html`<tr onClick=${() => go(`/car/${c.id}/loans`)}><td>${차줄(c)}</td>
              ${W(s.원금잔액)}<td>${l.start_date}</td><td>${s.단계}</td><td>${s.만기}</td>
              <td class="r">${s.연장됨 && l.ext_rate != null ? `${Number(l.ext_rate)}%` : `${Number(l.lender_rate ?? 0)}%`}</td>
              ${W(재고금융이자(l, l.start_date, t))}${W(상환비용(l, x, t))}<td><span class=${"badge " + h.tone}>${h.text}</span></td>
              <td><${LoanAction} app=${app} l=${l} lender=${x} onDone=${load} /></td></tr>`; })}</tbody></table></div>`}
      </div>`;
    })}
    ${(rest => rest.length > 0 && html`<div class="card"><h3>대출 없는 금융사</h3><table class="st"><tbody>${rest.map(x => html`<tr>
      <th>${x.name}${!x.active ? html` <span class="badge gray">사용 안 함</span>` : ""}</th><td class="note">${조건요약(x)}${x.rule_memo ? ` — ${x.rule_memo}` : ""}</td>
      <td class="r"><button class="btn sm" onClick=${() => go(`/loans/lender/${x.id}`)}>조건 설정</button></td></tr>`)}</tbody></table></div>`)(lenders.filter(x => !cnt(x.id) && !n(x.credit_limit)))}
    <p class="note">이자는 실행일부터 오늘까지 일할(연장 구간은 먼저 갚은 원금을 뺀 잔액 × 연장분 이율)입니다. 금융사 조건은 '조건 설정'에서 바꾸고, 새로 실행하는 대출부터 적용됩니다.</p>`;
}

export function LenderEdit({ app, id }) {
  const x = app.lenders.find(l => l.id === id);
  const [f, setF] = useState(x ? { ...x } : null);
  if (!f) return html`<${Empty}>금융사를 찾을 수 없습니다. <a href="#/loans/lenders">목록으로</a><//>`;
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const setT = k => e => set(k)(e.target.value);
  const num = v => (v === "" || v == null ? null : Number(v));
  const save = async e => {
    e.preventDefault();
    const row = { name: f.name.trim(), credit_limit: n(f.credit_limit), existing_amount: n(f.existing_amount),
      interest_day: f.interest_day ? Number(f.interest_day) : null, active: f.active,
      base_months: Number(f.base_months) || 1, ext_months: Number(f.ext_months) || 0, base_rate: num(f.base_rate), ext_rate: num(f.ext_rate),
      ext_repay_pct: Number(f.ext_repay_pct) || 0, repay_fee_method: f.repay_fee_method, repay_fee_pct: Number(f.repay_fee_pct) || 0, rule_memo: f.rule_memo || null,
      release_fee: n(f.release_fee), rate_tiers: 단계읽기(f.tiers_text ?? 단계글(f.rate_tiers)) };
    const ok = await run(async () => { await q(app.db.from("lenders").update(row).eq("id", id)); await app.reload(); return true; }, "저장했습니다");
    if (ok) go("/loans/lenders");
  };
  return html`<form class="card form" onSubmit=${save}>
    <div class="bar"><a class="back" href="#/loans/lenders">← 금융사별 현황</a><h2>${x.name} 조건 설정</h2><span class="grow"></span>
      <button type="button" class="btn ghost" onClick=${() => go("/loans/lenders")}>취소</button><button class="btn primary">저장</button></div>
    <p class="note">${조건요약({ ...f, base_months: Number(f.base_months), ext_months: Number(f.ext_months) })}</p>
    <h3>기간 · 이율</h3>
    <div class="fgrid">
      <${Field} label="금융사 이름" req><input value=${f.name} onInput=${setT("name")} required /><//>
      <${Field} label="기본 대출기간 (개월)" req><input inputmode="numeric" value=${f.base_months} onInput=${setT("base_months")} /><//>
      <${Field} label="연장 가능 (개월)" hint="0이면 연장 불가"><input inputmode="numeric" value=${f.ext_months} onInput=${setT("ext_months")} /><//>
      <${Field} label="기본 이율 (연 %)"><input inputmode="decimal" value=${f.base_rate ?? ""} onInput=${setT("base_rate")} /><//>
      <${Field} label="연장분 이율 (연 %)" hint="비우면 기본 이율 그대로"><input inputmode="decimal" value=${f.ext_rate ?? ""} onInput=${setT("ext_rate")} /><//>
      <${Field} label="연장 조건: 먼저 갚을 원금 (%)" hint="예) JB우리 9.5 — 0이면 조건 없음"><input inputmode="decimal" value=${f.ext_repay_pct ?? 0} onInput=${setT("ext_repay_pct")} /><//>
      <${Field} label="기간별 이율" wide hint="기간에 따라 이율이 오르는 금융사만 (예: 키움 '2:6.7, 4:7.7, 6:8.8' = 1~2개월 6.7% · 3~4개월 7.7% · 5~6개월 8.8%). 비우면 위 기본 이율">
        <input placeholder="2:6.7, 4:7.7, 6:8.8" value=${f.tiers_text ?? 단계글(f.rate_tiers)} onInput=${setT("tiers_text")} /><//>
    </div>
    <h3>상환할 때 드는 돈</h3>
    <div class="fgrid">
      <${Field} label="방식" hint=${f.repay_fee_method === "일할" ? "잔액 × 율 × 남은일수 ÷ 전체일수" : f.repay_fee_method === "정률" ? "잔액 × 율" : "확인되면 바꾸세요"}>
        <${Seg} value=${f.repay_fee_method} onChange=${set("repay_fee_method")} options=${["없음", "정률", "일할"]} /><//>
      ${f.repay_fee_method !== "없음" && html`<${Field} label="수수료율 (%)"><input inputmode="decimal" value=${f.repay_fee_pct ?? 0} onInput=${setT("repay_fee_pct")} /><//>`}
      <${Field} label="저당해지비용" hint="상환할 때마다 한 번 (보통 19,300원) — 차 손익에 비용으로 들어갑니다"><${Money} value=${f.release_fee} onInput=${set("release_fee")} /><//>
    </div>
    <h3>한도 · 기타</h3>
    <div class="fgrid">
      <${Field} label="총 한도"><${Money} value=${f.credit_limit} onInput=${set("credit_limit")} /><//>
      <${Field} label="외부 기존대출" hint="업무관리 밖에서 이미 쓰는 금액"><${Money} value=${f.existing_amount} onInput=${set("existing_amount")} /><//>
      <${Field} label="이자지급일 (매월)"><input inputmode="numeric" value=${f.interest_day || ""} onInput=${setT("interest_day")} /><//>
      <${Field} label="사용"><${Seg} value=${f.active ? "사용" : "중지"} onChange=${v => set("active")(v === "사용")} options=${["사용", "중지"]} /><//>
      <${Field} label="그 밖의 조건 메모" wide><input value=${f.rule_memo || ""} onInput=${setT("rule_memo")} /><//>
    </div>
  </form>`;
}
