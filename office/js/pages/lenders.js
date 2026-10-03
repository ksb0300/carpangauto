// 재고금융관리 → 금융사별 현황 · 금융사 조건 설정. 금융사마다 기본기간·연장·이율·연장 조건·상환해지수수료가 다르다.
import { html, useState, useEffect, Money, Field, Seg, Loading, Empty, run, won, go, today, W } from "../ui.js";
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

/** 대출 한 건의 '다음 할 일' */
export function 할일(l, lender, t) {
  const s = 대출상태(l, t), c = 연장조건(l, lender);
  if (l.status !== "진행중") return { text: "상환완료", tone: "gray" };
  if (s.남은일 < 0) return { text: `만기 ${-s.남은일}일 지남 — 상환하세요`, tone: "red" };
  if (c.가능 && s.남은일 <= 14) return { text: `D-${s.남은일} 연장 필요${c.상환필요 ? ` — 원금 ${won(c.상환필요)} 먼저 상환` : ""}`, tone: "amber" };
  if (!c.가능 && s.남은일 <= 14) return { text: `D-${s.남은일} 최종 만기 — 상환 준비`, tone: s.남은일 <= 7 ? "red" : "amber" };
  return { text: `${s.단계} · D-${s.남은일}`, tone: "green" };
}

export function LenderOverview({ app }) {
  const [d, setD] = useState(null);
  useEffect(() => { run(async () => setD(await loadAll(app.db))); }, []);
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
    ${lenders.map(x => {
      const mine = act.filter(l => l.lender_id === x.id).sort((a, b) => 대출상태(a, t).만기.localeCompare(대출상태(b, t).만기));
      const used = mine.reduce((s, l) => s + n(l.amount) - n(l.principal_repaid), 0) + n(x.existing_amount), lim = n(x.credit_limit);
      return html`<div class="card lender">
        <div class="bar"><h3>${x.name}</h3>${!x.active && html`<span class="badge gray">사용 안 함</span>`}<span class="grow"></span>
          <span class="muted small">${lim ? `한도 ${won(lim)} · 사용 ${won(used)} · 잔여 ` : `사용 ${won(used)}`}${lim ? html`<b class=${lim - used < 0 ? "red" : ""}>${won(lim - used)}</b>` : ""}</span>
          <button class="btn sm" onClick=${() => go(`/loans/lender/${x.id}`)}>조건 설정</button></div>
        <p class="note" style="margin-top:0">${조건요약(x)}${x.rule_memo ? ` — ${x.rule_memo}` : ""}</p>
        ${!mine.length ? html`<p class="muted small">진행중 대출 없음</p>` : html`<div class="table-wrap"><table class="grid click">
          <thead><tr><th>차량</th><th class="r">대출(잔액)</th><th>실행일</th><th>단계</th><th>만기</th><th class="r">이율</th><th class="r">오늘까지 이자</th><th class="r">지금 갚으면 해지수수료</th><th>다음 할 일</th></tr></thead>
          <tbody>${mine.map(l => { const s = 대출상태(l, t), h = 할일(l, x, t), c = car[l.car_id];
            return html`<tr onClick=${() => go(`/car/${c.id}/loans`)}><td><b>${c.plate}</b> <span class="small">${c.car_name}</span></td>
              ${W(s.원금잔액)}<td>${l.start_date}</td><td>${s.단계}</td><td>${s.만기}</td>
              <td class="r">${s.연장됨 && l.ext_rate != null ? `${Number(l.ext_rate)}%` : `${Number(l.lender_rate ?? 0)}%`}</td>
              ${W(재고금융이자(l, l.start_date, t))}${W(해지수수료(l, x, t))}<td><span class=${"badge " + h.tone}>${h.text}</span></td></tr>`; })}</tbody></table></div>`}
      </div>`;
    })}
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
