// 재고금융관리 → 금융사별 현황 · 금융사 조건 설정. 금융사마다 기본기간·연장·이율·연장 조건·상환해지수수료가 다르다.
import { html, useState, useEffect, Money, Field, Seg, Loading, Empty, run, won, go, today, W, toast } from "../ui.js";
import { q } from "../db.js";
import { loadAll } from "./report-data.js";
import { 대출상태, 연장조건, 재고금융이자, 해지수수료 } from "../calc.js";

const n = v => Math.round(Number(v) || 0);

/** 금융사 조건 한 줄 요약 */
export function 조건요약(x) {
  if (!x) return "";
  const parts = [`기본 ${x.base_months}개월`];
  if (Number(x.ext_months)) parts.push(`연장 ${x.ext_months}개월 (총 ${Number(x.base_months) + Number(x.ext_months)}개월)`);
  else parts.push("연장 없음");
  if (x.base_rate != null) parts.push(x.ext_rate != null && Number(x.ext_rate) !== Number(x.base_rate) ? `이율 ${Number(x.base_rate)}% → 연장분 ${Number(x.ext_rate)}%` : `이율 ${Number(x.base_rate)}% 고정`);
  if (Number(x.ext_repay_pct)) parts.push(`연장 전 원금 ${Number(x.ext_repay_pct)}% 상환`);
  parts.push(x.repay_fee_method === "없음" ? "해지수수료 없음(확인 중)" : `해지수수료 ${x.repay_fee_method} ${Number(x.repay_fee_pct)}%`);
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
  } else if (Number(lender?.ext_months) > 0) {
    // 연장 조건이 있는 금융사(부산은행·JB우리 등)는 한 번 연장하면 최종 만기 — 그 뒤엔 전액 상환뿐
    toast(`${lender.name}: 이미 연장해 최종 만기(총 ${Number(lender.base_months) + Number(lender.ext_months)}개월)입니다. 더 연장할 수 없고 전액 상환해야 합니다.`, "err");
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

/** 연장 버튼을 보여줄지 — 금융사 조건으로 아직 연장 전이거나, 조건이 없는 금융사(수동) */
export const canExtend = (l, lender) => l.status === "진행중" && (연장조건(l, lender).가능 || !(Number(lender?.ext_months) > 0));

/** 상환 — 상환일을 받아 상환완료 처리, 금융사 해지수수료(설정돼 있으면)도 기록. 성공하면 true */
export async function repayLoan(app, l) {
  const lender = app.lenders.find(x => x.id === l.lender_id);
  const v = window.prompt(`${lender?.name || ""} ${won(대출상태(l, today()).원금잔액)}원 상환일 (YYYY-MM-DD)`, today());
  if (!v) return false;
  const d = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast("날짜를 YYYY-MM-DD 로 넣어 주세요.", "err"); return false; }
  const fee = 해지수수료(l, lender, d);
  if (fee && !window.confirm(`상환해지수수료 ${won(fee)}원 (${lender.repay_fee_method} ${Number(lender.repay_fee_pct)}%) — 상환완료 처리할까요?`)) return false;
  return !!(await run(() => q(app.db.from("car_loans").update({ status: "상환완료", repaid_date: d, repay_fee: fee || null }).eq("id", l.id)), "상환완료 처리했습니다"));
}

/** 목록용 버튼: 연장할 수 있으면 '연장', 이미 연장했거나(최종 만기) 연장이 없으면 '상환' */
export function LoanAction({ app, l, lender, onDone }) {
  if (l.status !== "진행중" || app.profile.role === "dealer") return null;
  const go_ = async (e, f) => { e.stopPropagation(); if (await f(app, l)) onDone(); };
  const 연장 = html`<button class="btn sm" onClick=${e => go_(e, extendLoan)}>연장</button>`;
  const 상환 = html`<button class="btn sm primary" onClick=${e => go_(e, repayLoan)}>상환</button>`;
  if (연장조건(l, lender).가능) return 대출상태(l, today()).남은일 < 0 ? html`<span class="btnrow">${연장}${상환}</span>` : 연장;   // 아직 연장 전 (기본 만기 지났으면 둘 다)
  if (!(Number(lender?.ext_months) > 0)) return html`<span class="btnrow">${연장}${상환}</span>`;   // 조건 미입력 금융사: 둘 다
  return 상환;                                                       // 이미 연장 → 최종 만기, 상환만
}

/** 대출 한 건의 '다음 할 일' */
export function 할일(l, lender, t) {
  const s = 대출상태(l, t), c = 연장조건(l, lender);
  const 조건없음 = !(Number(lender?.ext_months) > 0);       // 연장 조건을 아직 안 넣은 금융사 (KB국민·신한 등)
  if (l.status !== "진행중") return { text: "상환완료", tone: "gray" };
  if (조건없음 && s.남은일 < 0) return { text: `만기 ${-s.남은일}일 지남 — 연장 또는 상환`, tone: "red" };
  if (조건없음 && s.남은일 <= 14) return { text: `D-${s.남은일} 만기 — 연장 또는 상환`, tone: "amber" };
  // 기본 만기는 지났는데 연장 기록이 없음 — 은행에서 이미 연장했으면 '연장'으로 기록, 아니면 상환
  if (s.남은일 < 0 && c.가능) return { text: `기본 만기 ${-s.남은일}일 지남 — 연장했으면 '연장' 기록, 아니면 상환`, tone: "red" };
  if (s.남은일 < 0) return { text: `최종 만기 ${-s.남은일}일 지남 — 전액 상환하세요`, tone: "red" };
  if (c.가능 && s.남은일 <= 14) return { text: `D-${s.남은일} 연장 필요${c.상환필요 ? ` — 원금 ${won(c.상환필요)} 먼저 상환` : ""}`, tone: "amber" };
  if (!c.가능 && s.남은일 <= 14) return { text: `D-${s.남은일} 최종 만기 — 상환 준비`, tone: s.남은일 <= 7 ? "red" : "amber" };
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
          <thead><tr><th>차량</th><th class="r">대출(잔액)</th><th>실행일</th><th>단계</th><th>만기</th><th class="r">이율</th><th class="r">오늘까지 이자</th><th class="r">지금 갚으면 해지수수료</th><th>다음 할 일</th><th></th></tr></thead>
          <tbody>${mine.map(l => { const s = 대출상태(l, t), h = 할일(l, x, t), c = car[l.car_id];
            return html`<tr onClick=${() => go(`/car/${c.id}/loans`)}><td><b>${c.plate}</b> <span class="small">${c.car_name}</span></td>
              ${W(s.원금잔액)}<td>${l.start_date}</td><td>${s.단계}</td><td>${s.만기}</td>
              <td class="r">${s.연장됨 && l.ext_rate != null ? `${Number(l.ext_rate)}%` : `${Number(l.lender_rate ?? 0)}%`}</td>
              ${W(재고금융이자(l, l.start_date, t))}${W(해지수수료(l, x, t))}<td><span class=${"badge " + h.tone}>${h.text}</span></td>
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
      ext_repay_pct: Number(f.ext_repay_pct) || 0, repay_fee_method: f.repay_fee_method, repay_fee_pct: Number(f.repay_fee_pct) || 0, rule_memo: f.rule_memo || null };
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
      <${Field} label="연장 조건: 먼저 갚을 원금 (%)" hint="예) JB우리 10 — 0이면 조건 없음"><input inputmode="decimal" value=${f.ext_repay_pct ?? 0} onInput=${setT("ext_repay_pct")} /><//>
    </div>
    <h3>상환해지수수료</h3>
    <div class="fgrid">
      <${Field} label="방식" hint=${f.repay_fee_method === "일할" ? "잔액 × 율 × 남은일수 ÷ 전체일수" : f.repay_fee_method === "정률" ? "잔액 × 율" : "확인되면 바꾸세요"}>
        <${Seg} value=${f.repay_fee_method} onChange=${set("repay_fee_method")} options=${["없음", "정률", "일할"]} /><//>
      ${f.repay_fee_method !== "없음" && html`<${Field} label="수수료율 (%)"><input inputmode="decimal" value=${f.repay_fee_pct ?? 0} onInput=${setT("repay_fee_pct")} /><//>`}
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
