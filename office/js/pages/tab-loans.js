import { html, useState, useEffect, Money, Field, Select, Seg, run, won, today, toast } from "../ui.js";
import { q } from "../db.js";
import { 대출이자, 미납이자, 대출상태, 연장조건, 해지수수료, 재고금융이자 } from "../calc.js";
import { 조건요약, 할일, extendLoan, canExtend } from "./lenders.js";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 36];
const addMonths = (d, m) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + Number(m)); return x.toISOString().slice(0, 10); };

export function LoansTab({ app, car, loans, reload, locked, office }) {
  const [adding, setAdding] = useState(false);
  const edit = office && !locked;
  const partnerCar = !!app.dealers.find(d => d.id === car.dealer_id)?.partner;   // 대표 차는 딜러 이자·이자마진이 없다
  const loanOf = l => ({ 대출금액: l.amount, 딜러이율: l.dealer_rate, 개월: l.months, 실행일: l.start_date,
    납입이자누계: l.payments.reduce((s, p) => s + Number(p.amount), 0) });

  const pay = async l => {
    const amt = Number(String(prompt("납입한 이자 금액 (원)", String(대출이자(l.amount, l.dealer_rate, 1).월이자)) || "").replace(/\D/g, ""));
    if (!amt) return;
    const date = prompt("납입일 (YYYY-MM-DD)", today()); if (!date) return;
    await run(() => q(app.db.from("loan_payments").insert({ loan_id: l.id, amount: amt, paid_date: date })), "이자납입을 등록했습니다");
    reload();
  };
  const setStatus = async (l, status) => {
    const lender = app.lenders.find(x => x.id === l.lender_id);
    const fee = status === "상환완료" ? 해지수수료(l, lender, today()) : null;
    if (fee && !confirm(`${lender.name} 상환해지수수료 ${won(fee)}원 (${lender.repay_fee_method} ${Number(lender.repay_fee_pct)}%)
상환완료 처리할까요?`)) return;
    await run(() => q(app.db.from("car_loans").update({ status, repaid_date: status === "상환완료" ? today() : null, repay_fee: fee }).eq("id", l.id)),
      status === "상환완료" ? "상환완료 처리했습니다" : "상환완료를 취소했습니다");
    reload();
  };
  const removePay = async p => {
    if (!confirm(`${p.paid_date} 이자납입 ${won(p.amount)}원 기록을 지울까요?`)) return;
    await run(() => q(app.db.from("loan_payments").delete().eq("id", p.id)), "납입 기록을 지웠습니다");
    reload();
  };
  const extend = async l => { if (await extendLoan(app, l)) reload(); };
  const remove = async l => {
    if (!confirm("이 재고금융을 삭제할까요? 이자납입 기록도 함께 지워집니다.")) return;
    await run(() => q(app.db.from("car_loans").delete().eq("id", l.id)), "삭제했습니다");
    reload();
  };

  return html`<div class="card">
    <div class="bar"><h3>재고금융</h3>
      ${locked && html`<span class="muted">정산완료된 차량입니다</span>`}<span class="grow"></span>
      ${edit && !adding && html`<button class="btn primary" onClick=${() => setAdding(true)}>+ 재고금융 등록</button>`}</div>
    ${adding && html`<${LoanForm} app=${app} car=${car} onDone=${() => { setAdding(false); reload(); }} />`}
    ${!loans.length && !adding ? html`<div class="empty">등록된 재고금융이 없습니다.</div>` : loans.map(l => {
      const lender = app.lenders.find(x => x.id === l.lender_id);
      const dl = 대출이자(l.amount, l.dealer_rate, l.months), cp = 대출이자(l.amount, l.lender_rate, l.months);
      const st = 대출상태(l, today()), todo = 할일(l, lender, today()), c = 연장조건(l, lender);
      const 쌓인이자 = 재고금융이자(l, l.start_date, l.repaid_date || today());
      const paid = l.payments.reduce((s, p) => s + Number(p.amount), 0);
      const due = l.status === "진행중" ? 미납이자(loanOf(l), today()) : 0;
      const done = l.status === "상환완료";
      return html`<div class="loan">
        <div class="loan-head"><b>${lender?.name}</b> · ${l.kind} · ${won(l.amount)}원 · ${l.start_date} ~ ${st.만기} (${l.months}개월${st.연장됨 ? `, ${st.기본만기}부터 연장` : ""})
          <span class=${"badge " + (done ? "green" : "blue")}>${l.status}</span> <span class=${"badge " + todo.tone}>${todo.text}</span></div>
        <div class="muted small">${조건요약(lender)}</div>
        <div class="kvrow">
          <div><span>캐피탈이율</span><b>${l.lender_rate ?? "-"}%${st.연장됨 && l.ext_rate != null && Number(l.ext_rate) !== Number(l.lender_rate) ? ` → ${Number(l.ext_rate)}%` : ""}</b><small>${done ? "낸" : "오늘까지"} 이자 ${won(쌓인이자)}</small></div>
          ${Number(l.principal_repaid) > 0 && html`<div><span>연장 때 상환</span><b>${won(l.principal_repaid)}</b><small>잔액 ${won(st.원금잔액)}</small></div>`}
          ${l.repay_fee != null && html`<div><span>상환해지수수료</span><b>${won(l.repay_fee)}</b></div>`}
          ${!partnerCar && html`<div><span>딜러이율</span><b>${l.dealer_rate}%</b><small>일 ${won(dl.일이자)} · 월 ${won(dl.월이자)} · 총 ${won(dl.총이자)}</small></div>
          <div><span>이자마진(총)</span><b>${won(dl.총이자 - cp.총이자)}</b></div>
          <div><span>납입이자</span><b>${won(paid)}</b><small>${l.payments.length}건</small></div>
          <div><span>오늘까지 미납</span><b class=${due ? "red" : ""}>${won(due)}</b></div>`}

        </div>
        ${l.payments.length > 0 && html`<div class="muted small">납입: ${l.payments.map((p, i) => html`${i ? " · " : ""}${p.paid_date} ${won(p.amount)}${edit && !done &&
          html` <button class="btn sm ghost" title="이 납입 기록 삭제" onClick=${() => removePay(p)}>✕</button>`}`)}</div>`}
        ${l.memo && html`<div class="muted small">메모: ${l.memo}</div>`}
        ${edit && html`<div class="actions">
          <button class="btn sm" disabled=${done} onClick=${() => pay(l)}>이자납입</button>
          <button class="btn sm" disabled=${done || !canExtend(l, lender)} title=${c.가능 ? `${c.개월}개월 연장${c.상환필요 ? ` · 원금 ${won(c.상환필요)} 상환` : ""}` : "금융사 조건상 연장 불가 — 수동 연장"} onClick=${() => extend(l)}>연장</button>
          ${done ? html`<button class="btn sm" onClick=${() => setStatus(l, "진행중")}>상환완료 취소</button>`
                 : html`<button class="btn sm" onClick=${() => setStatus(l, "상환완료")}>상환완료</button>`}
          <button class="btn sm danger" disabled=${done} title=${done ? "상환완료를 먼저 취소하세요" : ""} onClick=${() => remove(l)}>삭제</button>
        </div>`}
      </div>`;
    })}
  </div>`;
}

function LoanForm({ app, car, onDone }) {
  const active = app.lenders.filter(l => l.active);
  const partner = !!app.dealers.find(d => d.id === car.dealer_id)?.partner;     // 대표 차는 딜러 이자가 없다
  const def = l => ({ months: Number(l?.base_months) || 3, lender_rate: l?.base_rate != null ? String(Number(l.base_rate)) : "" });
  const [f, setF] = useState({ lender_id: active[0]?.id, kind: "신규", amount: 0, start_date: today(), ...def(active[0]), dealer_rate: partner ? "0" : "", memo: "" });
  const [used, setUsed] = useState({});
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  useEffect(() => { run(async () => {
    const rows = await q(app.db.from("car_loans").select("lender_id,amount").eq("status", "진행중"));
    setUsed(rows.reduce((m, r) => (m[r.lender_id] = (m[r.lender_id] || 0) + Number(r.amount), m), {}));
  }); }, []);
  const lender = app.lenders.find(l => l.id === f.lender_id);
  const usedAmt = (used[f.lender_id] || 0) + Number(lender?.existing_amount || 0);
  const left = Number(lender?.credit_limit || 0) - usedAmt;
  const dl = 대출이자(f.amount, f.dealer_rate, f.months), cp = 대출이자(f.amount, f.lender_rate, f.months);

  const save = async e => {
    e.preventDefault();
    if (!f.amount || f.dealer_rate === "") return toast("대출금액과 딜러이율은 꼭 입력하세요. (딜러에게 이자를 안 받으면 0)", "err");
    if (lender?.credit_limit && f.amount > left && !confirm(`잔여한도(${won(left)})를 넘습니다. 그래도 등록할까요?`)) return;
    const ok = await run(() => q(app.db.from("car_loans").insert({ ...f, car_id: car.id, lender_rate: f.lender_rate === "" ? null : Number(f.lender_rate),
      dealer_rate: Number(f.dealer_rate), memo: f.memo || null,
      base_months: Number(f.months), ext_rate: lender?.ext_rate ?? null })), "재고금융을 등록했습니다");
    if (ok) onDone();
  };
  return html`<form class="subform" onSubmit=${save}>
    <div class="fgrid">
      <${Field} label="재고금융사" req hint=${(lender?.credit_limit ? `한도 ${won(lender.credit_limit)} · 사용 ${won(usedAmt)} · 잔여 ${won(left)} · ` : "") + 조건요약(lender)}>
        <${Select} value=${f.lender_id} onChange=${v => setF(p => ({ ...p, lender_id: v, ...def(app.lenders.find(l => l.id === v)) }))} options=${active.map(l => [l.id, l.name])} /><//>
      <${Field} label="유형"><${Seg} value=${f.kind} onChange=${set("kind")} options=${["신규", "추가", "연장"]} /><//>
      <${Field} label="대출금액" req><${Money} value=${f.amount} onInput=${set("amount")} /><//>
      <${Field} label="실행일" req hint=${"만기 " + addMonths(f.start_date, f.months)}><input type="date" value=${f.start_date} onInput=${e => set("start_date")(e.target.value)} /><//>
      <${Field} label="대출기간(개월)" req><${Select} value=${f.months} onChange=${v => set("months")(Number(v))} options=${MONTHS.map(m => [m, m + "개월"])} /><//>
      <${Field} label="캐피탈이율(연 %)" hint=${f.lender_rate ? `월 ${won(cp.월이자)} · 총 ${won(cp.총이자)}` : "재고금융사가 상사에 받는 이율"}>
        <input inputmode="decimal" value=${f.lender_rate} onInput=${e => set("lender_rate")(e.target.value)} /><//>
      ${!partner && html`<${Field} label="딜러이율(연 %)" req hint=${f.dealer_rate ? `일 ${won(dl.일이자)} · 월 ${won(dl.월이자)} · 총 ${won(dl.총이자)}` : "딜러에게 적용하는 이율"}>
        <input inputmode="decimal" value=${f.dealer_rate} onInput=${e => set("dealer_rate")(e.target.value)} /><//>`}
      <${Field} label="메모" wide><input value=${f.memo} onInput=${e => set("memo")(e.target.value)} /><//>
    </div>
    <div class="actions"><button type="button" class="btn ghost" onClick=${onDone}>취소</button><button class="btn primary">등록</button></div>
  </form>`;
}
