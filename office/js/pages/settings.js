import { html, useState, useEffect, Money, Field, Seg, Select, run, won, toast, ask } from "../ui.js";
import { q } from "../db.js";
import { DEMO } from "../config.js";
import { popbill, accounts } from "../pb.js";

const TABS = [["company", "상사정보"], ["ops", "운영설정"], ["dealers", "대표·딜러"], ["lenders", "재고금융사"], ["parking", "주차구역"],
  ["items", "항목"], ["popbill", "팝빌 연동"], ["accounts", "계정·권한"]];

export function Settings({ app, tab }) {
  const admin = app.profile.role === "admin";
  return html`<div class="bar"><h2>설정</h2></div>
    <nav class="tabs">${TABS.filter(([k]) => k !== "accounts" || admin).map(([k, l]) => html`<a class=${tab === k ? "on" : ""} href=${"#/settings/" + k}>${l}</a>`)}</nav>
    ${tab === "company" ? html`<${Company} app=${app} />` : tab === "items" ? html`<${Items} app=${app} />` : tab === "popbill" ? html`<${Popbill} app=${app} />`
      : tab === "dealers" ? html`<${Dealers} app=${app} />` : tab === "lenders" ? html`<${Lenders} app=${app} />`
      : tab === "parking" ? html`<${Parking} app=${app} />` : tab === "accounts" && admin ? html`<${Accounts} app=${app} />` : html`<${Ops} app=${app} />`}`;
}

function Ops({ app }) {
  const [f, setF] = useState({ ...app.settings });
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const save = () => run(async () => {
    const { id, updated_at, revenue_items, expense_items, ...row } = f;
    await q(app.db.from("settings").update(row).eq("id", 1));
    await app.reload();
  }, "저장했습니다");
  return html`<div class="card form">
    <div class="fgrid">
      <${Field} label="상사매입비" hint="차량 등록 때 기본값"><${Money} value=${f.purchase_fee} onInput=${set("purchase_fee")} /><//>
      <${Field} label="상사매입비 → 상품화비용 자동입력"><${Seg} value=${f.purchase_fee_to_cost ? "예" : "아니오"} onChange=${v => set("purchase_fee_to_cost")(v === "예")} options=${["예", "아니오"]} /><//>
      <${Field} label="취득세 → 상품화비용 자동입력"><${Seg} value=${f.acq_tax_to_cost ? "예" : "아니오"} onChange=${v => set("acq_tax_to_cost")(v === "예")} options=${["예", "아니오"]} /><//>
      <${Field} label="상사매도비" hint="매도 때 기본값 · 상사 매출"><${Money} value=${f.sale_fee} onInput=${set("sale_fee")} /><//>
      <${Field} label="딜러 정산 13.3% 처리" hint=${f.settle_method === "일괄" ? "마진에서 13.3% 일률 적용" : "10% 예수부가세 처리 후 나머지에서 3.3%"}>
        <${Seg} value=${f.settle_method} onChange=${set("settle_method")} options=${["일괄", "분할"]} /><//>
      <${Field} label="현금영수증 발행형태" hint="차량 → 매출증빙에서 발행대기를 만들 때"><${Seg} value=${f.cash_issue_form} onChange=${set("cash_issue_form")} options=${[["건별", "차량대금·매도비·보험료 각각"], ["합산", "합산 1장"]]} /><//>
    </div>
    <div class="actions"><button class="btn primary" onClick=${save}>저장</button></div>
  </div>`;
}

function Dealers({ app }) {
  const [edit, setEdit] = useState(null);
  return html`<div class="card">
    <div class="bar"><h3>대표·딜러 (매입담당)</h3><span class="grow"></span><button class="btn primary" onClick=${() => setEdit({ name: "", kind: "사업자", active: true, partner: false })}>+ 추가</button></div>
    ${edit && html`<${DealerForm} app=${app} d=${edit} onDone=${() => setEdit(null)} />`}
    <div class="table-wrap"><table class="grid click"><thead><tr><th>이름</th><th>역할</th><th>구분</th><th>주민번호</th><th>사업자번호</th><th>연락처</th><th>계좌</th><th>상태</th></tr></thead>
      <tbody>${app.dealers.map(d => html`<tr onClick=${() => setEdit(d)}><td><b>${d.name}</b></td><td>${d.partner ? html`<span class="badge blue">공동대표</span>` : "딜러"}</td><td>${d.kind}</td><td>${d.ssn_masked || "-"}</td>
        <td>${d.biz_no || "-"}</td><td>${d.phone || "-"}</td><td>${d.bank ? `${d.bank} ${d.account_no || ""}` : "-"}</td>
        <td>${d.active ? "사용" : html`<span class="muted">중지</span>`}</td></tr>`)}</tbody></table></div>
    <p class="note"><b>공동대표</b> 차는 상사매입비·원천징수·딜러 정산 없이 차량 손익이 본인 실적이 됩니다(회사 수익은 대표 수로 똑같이 나눔).
      <b>딜러</b> 차는 상사매입비와 딜러 정산이 적용되고, 구분이 <b>개인</b>이면 원천징수(13.3%)가 기본으로 켜집니다.</p>
  </div>`;
}

function DealerForm({ app, d, onDone }) {
  const [f, setF] = useState({ ...d });
  const [ssn, setSsn] = useState("");
  const set = k => e => setF(p => ({ ...p, [k]: e.target ? e.target.value : e }));
  const save = async e => {
    e.preventDefault();
    if (!f.name.trim()) return toast("이름을 입력하세요.", "err");
    const ok = await run(async () => {
      const row = { name: f.name.trim(), kind: f.kind, biz_no: f.biz_no || null, phone: f.phone || null, email: f.email || null,
        bank: f.bank || null, account_no: f.account_no || null, address: f.address || null, active: f.active, partner: !!f.partner };
      const id = f.id ? (await q(app.db.from("dealers").update(row).eq("id", f.id).select("id").single())).id
                      : (await q(app.db.from("dealers").insert(row).select("id").single())).id;
      if (ssn.trim()) await q(app.db.rpc("set_ssn", { p_target: "dealer", p_id: id, p_ssn: ssn.trim() }));
      await app.reload(); return true;
    }, "저장했습니다");
    if (ok) onDone();
  };
  return html`<form class="subform" onSubmit=${save}><div class="fgrid">
    <${Field} label="이름" req><input value=${f.name} onInput=${set("name")} /><//>
    <${Field} label="역할" hint="공동대표: 상사매입비·원천징수 없음, 손익이 본인 실적"><${Seg} value=${f.partner ? "공동대표" : "딜러"} onChange=${v => setF(p => ({ ...p, partner: v === "공동대표" }))} options=${["공동대표", "딜러"]} /><//>
    <${Field} label="구분"><${Seg} value=${f.kind} onChange=${v => setF(p => ({ ...p, kind: v }))} options=${["사업자", "개인"]} /><//>
    <${Field} label="주민등록번호" hint=${f.ssn_masked ? `저장됨 ${f.ssn_masked}` : "암호화 저장"}><input autocomplete="off" value=${ssn} placeholder=${f.ssn_masked || ""} onInput=${e => setSsn(e.target.value)} /><//>
    <${Field} label="사업자등록번호"><input value=${f.biz_no || ""} onInput=${set("biz_no")} /><//>
    <${Field} label="휴대폰"><input value=${f.phone || ""} onInput=${set("phone")} /><//>
    <${Field} label="이메일"><input value=${f.email || ""} onInput=${set("email")} /><//>
    <${Field} label="은행"><input value=${f.bank || ""} onInput=${set("bank")} /><//>
    <${Field} label="계좌번호"><input value=${f.account_no || ""} onInput=${set("account_no")} /><//>
    <${Field} label="주소" wide><input value=${f.address || ""} onInput=${set("address")} /><//>
    <${Field} label="상태"><${Seg} value=${f.active ? "사용" : "중지"} onChange=${v => setF(p => ({ ...p, active: v === "사용" }))} options=${["사용", "중지"]} /><//>
  </div><div class="actions"><button type="button" class="btn ghost" onClick=${onDone}>닫기</button><button class="btn primary">저장</button></div></form>`;
}

function Lenders({ app }) {
  const [rows, setRows] = useState(app.lenders.map(l => ({ ...l })));
  const [used, setUsed] = useState({});
  useEffect(() => { run(async () => {
    const r = await q(app.db.from("car_loans").select("lender_id,amount").eq("status", "진행중"));
    setUsed(r.reduce((m, x) => (m[x.lender_id] = (m[x.lender_id] || 0) + Number(x.amount), m), {}));
  }); }, []);
  const upd = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const save = () => run(async () => {
    for (const r of rows) {
      const row = { name: r.name, credit_limit: r.credit_limit || 0, existing_amount: r.existing_amount || 0,
        interest_day: r.interest_day ? Number(r.interest_day) : null, active: r.active, sort: r.sort || 0 };
      if (r.id) await q(app.db.from("lenders").update(row).eq("id", r.id)); else if (r.name) await q(app.db.from("lenders").insert(row));
    }
    await app.reload();
  }, "저장했습니다");
  return html`<div class="card">
    <div class="bar"><h3>재고금융사</h3><span class="grow"></span>
      <button class="btn" onClick=${() => setRows(r => [...r, { name: "", credit_limit: 0, existing_amount: 0, active: true, sort: 50 }])}>+ 추가</button>
      <button class="btn primary" onClick=${save}>저장</button></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>금융사</th><th class="r">총 한도</th><th class="r">외부 기존대출</th><th class="r">사용중(여기)</th><th class="r">잔여</th><th>이자지급일</th><th>사용</th></tr></thead>
      <tbody>${rows.map((r, i) => {
        const u = (used[r.id] || 0) + Number(r.existing_amount || 0), left = Number(r.credit_limit || 0) - u;
        return html`<tr><td><input value=${r.name} onInput=${e => upd(i, "name", e.target.value)} /></td>
          <td class="r"><${Money} value=${r.credit_limit} onInput=${v => upd(i, "credit_limit", v)} /></td>
          <td class="r"><${Money} value=${r.existing_amount} onInput=${v => upd(i, "existing_amount", v)} /></td>
          <td class="r">${won(used[r.id] || 0)}</td><td class=${"r" + (left < 0 ? " red" : "")}>${r.credit_limit ? won(left) : "-"}</td>
          <td><input class="w80" inputmode="numeric" placeholder="일" value=${r.interest_day || ""} onInput=${e => upd(i, "interest_day", e.target.value)} /></td>
          <td><input type="checkbox" checked=${r.active} onChange=${e => upd(i, "active", e.target.checked)} /></td></tr>`;
      })}</tbody></table></div>
  </div>`;
}

function Parking({ app }) {
  const [rows, setRows] = useState(app.parking.map(p => ({ ...p })));
  const save = () => run(async () => {
    for (const [i, r] of rows.entries()) {
      const row = { name: r.name, memo: r.memo || null, sort: i };
      if (r.id) await q(app.db.from("parking_zones").update(row).eq("id", r.id)); else if (r.name) await q(app.db.from("parking_zones").insert(row));
    }
    await app.reload();
  }, "저장했습니다");
  return html`<div class="card">
    <div class="bar"><h3>주차구역</h3><span class="grow"></span>
      <button class="btn" onClick=${() => setRows(r => [...r, { name: "", memo: "" }])}>+ 추가</button><button class="btn primary" onClick=${save}>저장</button></div>
    ${rows.map((r, i) => html`<div class="row line"><input class="w80" value=${r.name} onInput=${e => setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
      <input placeholder="설명" value=${r.memo || ""} onInput=${e => setRows(rs => rs.map((x, j) => j === i ? { ...x, memo: e.target.value } : x))} /></div>`)}
  </div>`;
}

const ROLES = [["admin", "공동대표(전체·주민번호·계정관리)"], ["staff", "사무장(전체, 계정관리 제외)"], ["dealer", "권한 없음(접근 금지)"]];
const tempPw = () => "Cp" + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89) + "!";

function Accounts({ app }) {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState({});
  const [adding, setAdding] = useState(null);
  const [shown, setShown] = useState(null);            // 방금 만든/초기화한 임시 비밀번호 (한 번만 보여줌)
  const load = () => run(async () => {
    setRows(await q(app.db.from("profiles").select("*").order("created_at")));
    const list = await accounts(app.db, "list");
    setUsers(Object.fromEntries(list.map(u => [u.id, u])));
  });
  useEffect(() => { load(); }, []);
  const save = r => run(async () => {
    await q(app.db.from("profiles").update({ name: r.name, role: r.role, dealer_id: r.role === "admin" ? r.dealer_id : null }).eq("user_id", r.user_id));
    load();
  }, "권한을 바꿨습니다");
  const reset = async r => {
    const pw = tempPw();
    if (!ask(`${r.name}의 비밀번호를 임시 비밀번호로 바꿀까요?\n다음 로그인 때 본인이 새로 정해야 합니다.`)) return;
    if (await run(() => accounts(app.db, "reset", { user_id: r.user_id, password: pw }))) setShown({ name: r.name, email: users[r.user_id]?.email, pw });
    load();
  };
  const toggle = async (r, on) => {
    if (!ask(on ? `${r.name} 계정을 사용 중지할까요? (로그인 불가)` : `${r.name} 계정을 다시 쓰게 할까요?`)) return;
    await run(() => accounts(app.db, "disable", { user_id: r.user_id, on }), on ? "사용 중지했습니다" : "다시 쓸 수 있습니다");
    load();
  };
  const upd = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  if (!rows) return null;
  return html`<div class="card">
    <div class="bar"><h3>계정·권한</h3><span class="grow"></span>
      <button class="btn primary" onClick=${() => setAdding({ email: "", name: "", role: "staff", dealer_id: null, password: tempPw() })}>+ 계정 만들기</button></div>
    <p class="note">${DEMO ? "데모에서는 로그인 화면의 역할 버튼으로 들어갑니다. 계정 만들기는 흉내만 냅니다."
      : "아무나 가입하는 기능은 꺼져 있습니다. 대표가 여기서 계정을 만들고 임시 비밀번호를 알려 주면, 첫 로그인 때 본인이 새 비밀번호로 바꿉니다."}</p>
    ${shown && html`<div class="demo-note">${shown.name} (${shown.email}) 임시 비밀번호: <b style="font-size:16px;letter-spacing:.5px">${shown.pw}</b>
      — 지금 전달하세요. 이 화면을 벗어나면 다시 볼 수 없습니다. <button class="btn sm" onClick=${() => setShown(null)}>전달했어요</button></div>`}
    ${adding && html`<${NewAccount} app=${app} init=${adding} onDone=${made => { setAdding(null); if (made) setShown(made); load(); }} />`}
    <div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>본인(대표)</th><th>상태</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => { const u = users[r.user_id] || {}; const me = r.user_id === app.user.id;
        return html`<tr>
        <td><input value=${r.name} onInput=${e => upd(i, "name", e.target.value)} /></td>
        <td class="small">${u.email || "-"}</td>
        <td><${Select} value=${r.role} onChange=${v => upd(i, "role", v)} options=${ROLES} /></td>
        <td>${r.role === "admin" ? html`<${Select} value=${r.dealer_id} onChange=${v => upd(i, "dealer_id", v)} empty="선택" options=${app.dealers.filter(d => d.partner).map(d => [d.id, d.name])} />` : "-"}</td>
        <td class="small">${u.disabled ? html`<span class="badge red">중지</span>` : u.must_change ? html`<span class="badge amber">임시 비밀번호</span>` : html`<span class="badge green">사용</span>`}
          ${u.last_sign_in_at && html`<br /><span class="muted">${u.last_sign_in_at.slice(0, 16).replace("T", " ")}</span>`}</td>
        <td class="nowrap"><button class="btn sm" disabled=${me && r.role !== "admin"} onClick=${() => save(r)}>저장</button>
          ${!me && html`<button class="btn sm" onClick=${() => reset(r)}>비밀번호 초기화</button>
            <button class="btn sm ${u.disabled ? "" : "danger"}" onClick=${() => toggle(r, !u.disabled)}>${u.disabled ? "다시 사용" : "사용 중지"}</button>`}</td></tr>`; })}</tbody></table></div>
  </div>`;
}

function NewAccount({ app, init, onDone }) {
  const [f, setF] = useState(init);
  const set = k => v => setF(p => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const save = async e => {
    e.preventDefault();
    const ok = await run(() => accounts(app.db, "create", { ...f, email: f.email.trim(), name: f.name.trim() || f.email.trim() }), "계정을 만들었습니다");
    if (ok) onDone({ name: f.name || f.email, email: f.email, pw: f.password });
  };
  return html`<form class="subform" onSubmit=${save}><div class="fgrid">
    <${Field} label="이메일 (로그인 아이디)" req><input type="email" autocomplete="off" value=${f.email} onInput=${set("email")} /><//>
    <${Field} label="이름" req><input value=${f.name} onInput=${set("name")} /><//>
    <${Field} label="역할" hint="공동대표: 상사매입비·원천징수 없음, 손익이 본인 실적"><${Seg} value=${f.partner ? "공동대표" : "딜러"} onChange=${v => setF(p => ({ ...p, partner: v === "공동대표" }))} options=${["공동대표", "딜러"]} /><//>
    <${Field} label="역할"><${Select} value=${f.role} onChange=${set("role")} options=${ROLES} /><//>
    ${f.role === "admin" && html`<${Field} label="본인(대표)" hint="대시보드 '내 실적'에 쓰입니다"><${Select} value=${f.dealer_id} onChange=${set("dealer_id")} empty="선택" options=${app.dealers.filter(d => d.partner).map(d => [d.id, d.name])} /><//>`}
    <${Field} label="임시 비밀번호" hint="첫 로그인 때 본인이 바꿉니다"><input autocomplete="off" value=${f.password} onInput=${set("password")} /><//>
  </div><div class="actions"><button type="button" class="btn ghost" onClick=${() => onDone(null)}>닫기</button><button class="btn primary">만들기</button></div></form>`;
}

function saveSettings(app, patch, msg = "저장했습니다") {
  return run(async () => { await q(app.db.from("settings").update(patch).eq("id", 1)); await app.reload(); }, msg);
}

function Company({ app }) {
  const keys = ["company_name", "biz_no", "ceo_name", "biz_type", "biz_item", "tel", "fax", "email", "address", "association_code", "sms_sender"];
  const [f, setF] = useState(Object.fromEntries(keys.map(k => [k, app.settings[k] || ""])));
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const save = () => {
    const biz = f.biz_no.replace(/\D/g, "");
    if (biz && biz.length !== 10) return toast("사업자등록번호는 10자리입니다.", "err");
    return saveSettings(app, Object.fromEntries(keys.map(k => [k, f[k].trim() || (k === "company_name" ? "TierONE" : null)])));
  };
  const L = [["company_name", "상호", "TierONE"], ["biz_no", "사업자등록번호", "000-00-00000"], ["ceo_name", "대표자"], ["biz_type", "업태", "도소매"],
    ["biz_item", "종목", "중고자동차"], ["tel", "전화"], ["fax", "팩스"], ["email", "이메일"], ["association_code", "조합상사코드"], ["sms_sender", "문자 발신번호", "팝빌에 등록한 번호"]];
  return html`<div class="card form">
    <div class="fgrid">${L.map(([k, l, ph]) => html`<${Field} label=${l}><input value=${f[k]} placeholder=${ph || ""} onInput=${set(k)} /><//>`)}
      <${Field} label="주소" wide><input value=${f.address} onInput=${set("address")} /><//></div>
    <p class="note">현금영수증·세금계산서의 공급자 정보와 정산내역서·매입장 머리글에 쓰입니다. 사업자등록번호는 팝빌 연동회원 번호와 같아야 합니다.</p>
    <div class="actions"><button class="btn primary" onClick=${save}>저장</button></div></div>`;
}

function Items({ app }) {
  const [rev, setRev] = useState((app.settings.revenue_items || []).join("\n"));
  const [exp, setExp] = useState((app.settings.expense_items || []).join("\n"));
  const list = s => [...new Set(s.split("\n").map(x => x.trim()).filter(Boolean))];
  return html`<div class="card form"><div class="two">
    <${Field} label="상사매출 항목" hint="한 줄에 하나"><textarea rows="10" value=${rev} onInput=${e => setRev(e.target.value)}></textarea><//>
    <${Field} label="상사지출·운영비 항목" hint="한 줄에 하나"><textarea rows="10" value=${exp} onInput=${e => setExp(e.target.value)}></textarea><//></div>
    <p class="note">차량매입·매도·상사매도비·성능보험료·상사매입비·상품화비·원천징수·알선은 자동 항목이라 여기 넣지 않아도 됩니다.</p>
    <div class="actions"><button class="btn primary" onClick=${() => saveSettings(app, { revenue_items: list(rev), expense_items: list(exp) })}>저장</button></div></div>`;
}

function Popbill({ app }) {
  const admin = app.profile.role === "admin";
  const [st, setSt] = useState(null);
  const [join, setJoin] = useState(null);
  const [uid, setUid] = useState(app.settings.popbill_user_id || "");
  const check = () => run(async () => setSt(await popbill(app.db, "status")));
  const openUrl = action => run(async () => { const r = await popbill(app.db, action); window.open(r.url, "_blank", "noopener"); });
  const setJ = k => e => setJoin(p => ({ ...p, [k]: e.target.value }));
  const doJoin = async e => {
    e.preventDefault();
    const s = app.settings;
    const ok = await run(() => popbill(app.db, "member.join", { form: { ...join, company_name: s.company_name, ceo_name: s.ceo_name,
      address: s.address, biz_type: s.biz_type, biz_item: s.biz_item } }), "연동회원 가입 요청을 보냈습니다");
    if (ok) { await saveSettings(app, { popbill_user_id: join.id }, "팝빌 아이디를 저장했습니다"); setJoin(null); check(); }
  };
  return html`<div class="card">
    <h3>팝빌 연동 — 현금영수증·전자세금계산서·계좌조회·문자</h3>
    ${DEMO && html`<p class="demo-note">데모 모드에서는 팝빌 대신 모의 응답을 씁니다. 국세청·은행으로 아무것도 나가지 않습니다.</p>`}
    <ol class="note" style="line-height:1.9">
      <li>팝빌 개발자센터(developers.popbill.com)에서 <b>연동신청</b> → 링크아이디·비밀키를 받습니다 (테스트용은 무료).</li>
      <li>Supabase → Edge Functions → Secrets 에 <code>POPBILL_LINK_ID</code>, <code>POPBILL_SECRET_KEY</code>, <code>POPBILL_IS_TEST</code>(테스트면 true)를 넣습니다.
        <b>비밀키는 브라우저·DB에 두지 않습니다.</b></li>
      <li>상사정보 탭에 사업자등록번호·대표자·주소·업태·종목을 넣고, 아래에서 <b>상태 확인</b> → 회원이 아니면 연동회원 가입.</li>
      <li>공동인증서(세금계산서용) 등록, 계좌조회용 계좌 등록, 문자 발신번호 등록은 아래 버튼이 팝빌 화면을 엽니다.</li>
    </ol>
    <div class="actions" style="justify-content:flex-start">
      <button class="btn primary" onClick=${check}>상태 확인</button>
      <button class="btn" onClick=${() => openUrl("url.cert")}>인증서 등록</button>
      <button class="btn" onClick=${() => openUrl("url.bank")}>계좌 등록</button>
      <button class="btn" onClick=${() => openUrl("url.sender")}>문자 발신번호 등록</button>
      ${admin && html`<button class="btn" onClick=${() => setJoin({ id: "", password: "", contact_name: app.settings.ceo_name || "",
        contact_email: app.settings.email || "", contact_tel: app.settings.tel || "" })}>연동회원 가입</button>`}
    </div>
    ${st && html`<div class="kvgrid" style="margin-top:12px">
      <div><span>연동회원</span><b>${st.member ? "가입됨" : html`<span class="red">아님</span>`}</b></div>
      <div><span>서버</span><b>${st.demo ? "데모(모의)" : st.test ? "테스트" : "운영"}</b></div>
      ${st.member && html`<div><span>잔여 포인트</span><b>${typeof st.balance === "number" ? won(st.balance) : st.balance}</b></div>
        <div><span>인증서 만료</span><b>${st.certExpire || html`<span class="red">미등록</span>`}</b></div>`}</div>`}
    <div class="fgrid" style="margin-top:14px"><${Field} label="팝빌 사용자 아이디" hint="팝빌 화면 열기·발행 기록에 쓰입니다"><div class="row">
      <input value=${uid} onInput=${e => setUid(e.target.value)} /><button class="btn" onClick=${() => saveSettings(app, { popbill_user_id: uid || null })}>저장</button></div><//></div>
    ${join && html`<form class="subform" onSubmit=${doJoin}><h4>연동회원 가입 (상사정보 탭의 내용으로 가입합니다)</h4><div class="fgrid">
      <${Field} label="팝빌 아이디" req><input value=${join.id} onInput=${setJ("id")} /><//>
      <${Field} label="비밀번호" req hint="8~20자, 영문·숫자·특수문자"><input type="password" autocomplete="new-password" value=${join.password} onInput=${setJ("password")} /><//>
      <${Field} label="담당자"><input value=${join.contact_name} onInput=${setJ("contact_name")} /><//>
      <${Field} label="담당자 이메일"><input value=${join.contact_email} onInput=${setJ("contact_email")} /><//>
      <${Field} label="담당자 연락처"><input value=${join.contact_tel} onInput=${setJ("contact_tel")} /><//>
    </div><div class="actions"><button type="button" class="btn ghost" onClick=${() => setJoin(null)}>닫기</button><button class="btn primary">가입</button></div></form>`}
  </div>`;
}
