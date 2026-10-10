// 통장 입출금: 계좌 등록, 거래내역 불러오기(팝빌 자동조회 또는 은행 엑셀), 입출금 ↔ 차량·딜러 매칭
import { html, useState, useEffect, useMemo, Field, Select, Seg, Loading, Empty, run, won, toast, ask, Period, initPeriod, W, downloadCsv, CarSearch } from "../ui.js";
import { q } from "../db.js";
import { popbill, PB_NOTE } from "../pb.js";
import { loadAll } from "./report-data.js";
import { 매칭후보, 자동확정, 거래내역정리, 거래키 } from "../report-calc.js";
import { repayLoan } from "./lenders.js";

const KINDS = ["차량매도대금", "차량매입대금", "재고금융", "재고금융이자", "상품화비", "자금이동", "운영비", "딜러정산지급", "알선", "상사매출", "기타"];
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";

/** 은행 엑셀(xls/xlsx) 또는 CSV(UTF-8·EUC-KR)를 행 배열로 */
async function readSheet(file) {
  const XLSX = await import(XLSX_URL);
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$|\.txt$/i.test(file.name)) {
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("euc-kr").decode(buf);
    wb = XLSX.read(text, { type: "string", raw: true });
  } else wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
}

export function BankPage({ app }) {
  const [accounts, setAccounts] = useState(null);
  const [acc, setAcc] = useState(null);          // 선택 계좌 id (null = 전체)
  const [txs, setTxs] = useState(null);
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState(initPeriod("월"));
  const [only, setOnly] = useState("전체");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null);        // 수동 매칭 중인 거래 id

  const [manage, setManage] = useState(false);   // 계좌 관리(등록·엑셀 올리기) 펼치기
  const [raw, setRaw] = useState({});            // 거래 id → 문자 원문
  const loadAcc = () => run(async () => {
    const a = await q(app.db.from("bank_accounts").select("*").order("created_at"));
    setAccounts(a);
    // 통장마다 따로 본다 — 처음엔 차량 통장(부산은행)
    if (!acc || !a.some(x => x.id === acc)) setAcc((a.find(x => x.purpose === "차량") || a[0])?.id || null);
  });
  const loadTx = () => run(async () => {
    let qq = app.db.from("bank_txs").select("*").gte("tx_date", period.from).lte("tx_date", period.to);
    if (acc) qq = qq.eq("account_id", acc);
    const t = await q(qq.order("tx_date", { ascending: false }).order("tx_time", { ascending: false }));
    setTxs(t);
    const ids = t.filter(x => x.source === "문자").map(x => x.id);
    if (ids.length) { const m = await q(app.db.from("bank_msgs").select("tx_id,text").in("tx_id", ids)); setRaw(Object.fromEntries(m.map(x => [x.tx_id, x.text]))); }
  });
  useEffect(() => { loadAcc(); run(async () => setData(await loadAll(app.db))); }, []);
  useEffect(() => { loadTx(); }, [acc, period.from, period.to]);

  const car = useMemo(() => Object.fromEntries((data?.cars || []).map(c => [c.id, c])), [data]);
  const dealer = Object.fromEntries(app.dealers.map(d => [d.id, d]));
  const shown = (txs || []).filter(t => only === "전체" || (only === "미매칭" ? !t.match_kind : only === "입금" ? t.deposit > 0 : t.withdraw > 0));
  // 내 통장끼리 이체를 찾으려면 같은 기간 모든 통장 거래가 필요
  const [allTxs, setAllTxs] = useState([]);
  useEffect(() => { run(async () => setAllTxs(await q(app.db.from("bank_txs").select("id,account_id,tx_date,tx_time,deposit,withdraw").gte("tx_date", period.from).lte("tx_date", period.to)))); }, [period.from, period.to, txs]);
  const cand = useMemo(() => data ? Object.fromEntries((txs || []).filter(t => !t.match_kind).map(t => [t.id, 매칭후보(t, data, { accounts, txs: allTxs })])) : {}, [txs, data, allTxs, accounts]);

  const setMatch = (t, m, by = "수동") => run(async () => {
    // 재고금융 상환과 연결하면 그 대출을 이 거래 날짜로 상환완료 (상환 비용도 기록)
    if (m?.repay && m.loan_id) {
      const loan = (data?.loans || []).find(l => l.id === m.loan_id);
      if (loan && loan.status === "진행중" && !(await repayLoan(app, loan, t.tx_date))) return;
    }
    await q(app.db.from("bank_txs").update({ match_kind: m?.kind || null, car_id: m?.car_id || null, dealer_id: m?.dealer_id || null,
      loan_id: m?.loan_id || null, matched_by: m ? by : null }).eq("id", t.id));
    setPick(null); loadTx();
    if (m?.repay) setData(await loadAll(app.db));
  });
  const editMemo = t => {
    const m = window.prompt("상세메모", t.memo || ""); if (m === null) return;
    run(async () => { await q(app.db.from("bank_txs").update({ memo: m.trim() || null }).eq("id", t.id)); loadTx(); }, "메모를 저장했습니다");
  };
  const autoAll = async () => {
    // 자동은 장부 표시만 — 재고금융 상환처럼 대출 상태를 바꾸는 건 사람이 [연결]을 눌러야
    const list = (txs || []).filter(t => !t.match_kind).map(t => [t, 자동확정(cand[t.id] || [])]).filter(([, m]) => m && !m.repay);
    if (!list.length) return toast("확실하게 맞는 거래가 없습니다. 후보를 보고 직접 연결하세요.");
    setBusy(true);
    await run(async () => { for (const [t, m] of list) await q(app.db.from("bank_txs").update({ match_kind: m.kind, car_id: m.car_id || null, dealer_id: m.dealer_id || null, loan_id: m.loan_id || null, matched_by: "자동" }).eq("id", t.id)); },
      `${list.length}건을 자동으로 연결했습니다`);
    setBusy(false); loadTx();
  };

  const sync = async a => {
    setBusy(true);
    const r = await run(() => popbill(app.db, "bank.sync", { account_id: a.id, from: period.from, to: period.to }));
    if (r) toast(`${a.bank_name}: ${r.fetched}건 조회, 새 거래 ${r.added}건`);
    setBusy(false); loadAcc(); loadTx();
  };
  const importPopbillAccounts = async () => {
    const r = await run(() => popbill(app.db, "bank.accounts"));
    if (r) toast(`팝빌 계좌 ${r.total}개 확인, 새로 ${r.added}개 추가`);
    loadAcc();
  };
  const upload = async (a, file) => {
    if (!file) return;
    setBusy(true);
    await run(async () => {
      const rows = 거래내역정리(await readSheet(file));
      if (!rows.length) throw new Error("거래를 찾지 못했습니다. 은행에서 받은 엑셀 원본인지 확인하세요.");
      const have = new Set((await q(app.db.from("bank_txs").select("tid").eq("account_id", a.id))).map(t => t.tid));
      const add = rows.map((t, i) => ({ ...t, tid: 거래키(t, i), account_id: a.id, source: "엑셀" })).filter(t => !have.has(t.tid));
      for (let i = 0; i < add.length; i += 500) await q(app.db.from("bank_txs").insert(add.slice(i, i + 500)));
      toast(`${file.name}: ${rows.length}건 중 새 거래 ${add.length}건을 넣었습니다 (${rows[0].tx_date} ~ ${rows[rows.length - 1].tx_date})`);
    });
    setBusy(false); loadTx();
  };

  if (!accounts) return html`<${Loading} />`;
  const sum = k => shown.reduce((t, x) => t + Number(x[k] || 0), 0);
  const curAcc = accounts.find(a => a.id === acc);

  return html`<div class="bar"><h2>자금관리</h2><span class="grow"></span>
      <button class="btn" onClick=${() => setManage(!manage)}>${manage ? "계좌 관리 닫기" : "계좌 관리"}</button></div>
    ${accounts.length > 0 && html`<nav class="tabs">${accounts.filter(a => a.active !== false).map(a => html`<a href="#" class=${acc === a.id ? "on" : ""} onClick=${e => { e.preventDefault(); setAcc(a.id); }}>
      ${a.bank_name}${a.purpose ? ` · ${a.purpose}` : a.alias ? ` · ${a.alias}` : ""}</a>`)}</nav>`}
    ${manage && html`<div class="bar"><span class="grow"></span><span class="muted small">${PB_NOTE}</span>
      <button class="btn" onClick=${importPopbillAccounts}>팝빌 등록계좌 가져오기</button>
      <button class="btn" onClick=${() => setAdding(true)}>+ 계좌 추가</button></div>`}
    ${adding && html`<${AccountForm} app=${app} onDone=${() => { setAdding(false); loadAcc(); }} />`}
    ${!accounts.length ? html`<${Empty}>등록된 계좌가 없습니다. 팝빌에 계좌를 등록했다면 '팝빌 등록계좌 가져오기', 아니면 '+ 계좌 추가' 후 은행 엑셀을 올리세요.<//>` : html`
    ${manage && html`<div class="card">
      <div class="table-wrap"><table class="grid">
        <thead><tr><th></th><th>은행</th><th>계좌번호</th><th>별칭</th><th>방식</th><th>마지막 조회</th><th></th></tr></thead>
        <tbody>${accounts.map(a => html`<tr>
          <td><input type="radio" name="acc" checked=${acc === a.id} onChange=${() => setAcc(a.id)} /></td>
          <td>${a.bank_name}</td><td>${a.account_no}</td><td>${a.alias || "-"}</td>
          <td>${a.popbill ? html`<span class="badge green">팝빌 자동조회</span>` : a.sms_keyword ? html`<span class="badge green" title="사무실 폰 문자 → 몇 초 안에 자동으로 들어옴">문자 자동</span>${a.purpose ? html` <span class="badge">${a.purpose}</span>` : ""}` : html`<span class="badge">엑셀</span>`}</td>
          <td class="small">${a.last_synced_at ? a.last_synced_at.slice(0, 16).replace("T", " ") : "-"}</td>
          <td class="nowrap">${a.popbill && html`<button class="btn sm primary" disabled=${busy} onClick=${() => sync(a)}>거래내역 불러오기</button>`}
            <label class="btn sm">엑셀 올리기<input type="file" hidden accept=".xls,.xlsx,.csv,.txt" onChange=${e => { upload(a, e.target.files[0]); e.target.value = ""; }} /></label></td>
        </tr>`)}
        <tr><td><input type="radio" name="acc" checked=${!acc} onChange=${() => setAcc(null)} /></td><td colspan="6" class="muted">전체 계좌</td></tr></tbody>
      </table></div>
      <p class="note">팝빌 자동조회는 기간을 정해 '거래내역 불러오기'를 누르면 은행에서 직접 가져옵니다. 이미 있는 거래는 다시 넣지 않습니다.
        엑셀은 인터넷뱅킹 '거래내역 조회 → 엑셀 저장' 파일을 그대로 올리면 됩니다(국민·신한·우리·하나·농협 등 머리글 자동 인식). 문자로 못 받은 거래를 채울 때 쓰세요.</p>
    </div>`}
    <div class="bar">
      <${Period} value=${period} onChange=${setPeriod} />
      <${Seg} value=${only} onChange=${setOnly} options=${["전체", "미매칭", "입금", "출금"]} />
      <span class="grow"></span>
      <button class="btn primary" disabled=${busy || !data} onClick=${autoAll}>AI 매칭</button>
      <button class="btn" disabled=${!shown.length} onClick=${() => downloadCsv("통장입출금", [["일자", "시간", "입금", "출금", "잔액", "적요", "매칭", "차량", "딜러", "메모"],
        ...shown.map(t => [t.tx_date, t.tx_time, t.deposit, t.withdraw, t.balance, t.remark, t.match_kind, car[t.car_id]?.plate, dealer[t.dealer_id]?.name, t.memo])])}>엑셀(CSV)</button>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>입금</span><b class="red">${sum("deposit") ? "+" : ""}${won(sum("deposit"))}</b><small>${shown.filter(t => t.deposit > 0).length}건</small></div>
      <div class="stat"><span>출금</span><b class="blue">${sum("withdraw") ? "-" : ""}${won(sum("withdraw"))}</b><small>${shown.filter(t => t.withdraw > 0).length}건</small></div>
      <div class=${"stat" + ((txs || []).some(t => !t.match_kind) ? " warn" : "")}><span>미매칭</span><b>${(txs || []).filter(t => !t.match_kind).length}</b><small>${curAcc ? curAcc.bank_name : "전체 계좌"}</small></div>
    </div>
    ${!txs ? html`<${Loading} />` : !shown.length ? html`<${Empty}>이 기간 거래가 없습니다.<//>` : html`
    <div class="table-wrap"><table class="grid banktx">
      <colgroup><col style="width:150px" /><col style="width:56px" /><col style="width:130px" /><col style="width:140px" /><col /><col style="width:300px" /><col style="width:170px" /></colgroup>
      <thead><tr><th>일자</th><th>구분</th><th class="r">금액</th><th class="r">잔액</th><th>내용 (보낸 사람·받는 곳)</th><th>연결</th><th></th></tr></thead>
      <tbody>${shown.map(t => {
        const c = cand[t.id] || [];
        return html`<tr class=${t.match_kind ? "matched" : ""}>
          <td class="nowrap">${t.tx_date} <span class="muted small">${(t.tx_time || "").slice(0, 5)}</span></td>
          ${t.deposit > 0 ? html`<td class="red">입금</td><td class="r red"><b>+${won(t.deposit)}</b></td>` : html`<td class="blue">출금</td><td class="r blue"><b>-${won(t.withdraw)}</b></td>`}<td class="r muted">${t.balance != null ? won(t.balance) : ""}</td>
          <td class="ellipsis" title=${raw[t.id] || t.remark}>${t.remark}${t.source === "문자" ? html` <span class="muted small" title=${raw[t.id] || ""}>문자</span>` : ""}${t.memo ? html`<br /><span class="muted small">📝 ${t.memo}</span>` : ""}</td>
          <td>${t.match_kind ? html`<span class="badge blue">${t.match_kind}</span> ${t.car_id ? html`<a href=${`#/car/${t.car_id}`}>${car[t.car_id]?.plate || ""}</a>` : ""}
                 ${t.dealer_id && !t.car_id ? dealer[t.dealer_id]?.name : ""} <span class="muted small">${t.matched_by}</span>`
            : c[0] ? html`<span class="small">후보: ${c[0].label} <span class="muted">(${c[0].score}점)</span></span>` : html`<span class="muted small">후보 없음</span>`}</td>
          <td class="nowrap"><button class="btn sm ghost" title="상세메모" onClick=${() => editMemo(t)}>메모</button>${t.match_kind ? html`<button class="btn sm ghost" onClick=${() => setMatch(t, null)}>해제</button>`
            : html`${c[0] && html`<button class="btn sm primary" onClick=${() => setMatch(t, c[0])}>연결</button>`}
                   <button class="btn sm" onClick=${() => setPick(pick === t.id ? null : t.id)}>직접</button>`}</td>
        </tr>
        ${pick === t.id && html`<tr class="sub"><td colspan="7"><${ManualMatch} cands=${c} cars=${data?.cars || []} dealers=${app.dealers}
          onPick=${m => setMatch(t, m)} onCancel=${() => setPick(null)} /></td></tr>`}`;
      })}</tbody>
    </table></div>`}`}`;
}

function ManualMatch({ cands, cars, dealers, onPick, onCancel }) {
  const [kind, setKind] = useState(cands[0]?.kind || "기타");
  const [carId, setCarId] = useState(null);
  const [dealerId, setDealerId] = useState(null);
  return html`<div class="row manualmatch" style="flex-wrap:wrap">
    ${cands.map(c => html`<button class="btn sm" onClick=${() => onPick(c)}>${c.label} (${c.score})</button>`)}
    <span class="muted small">종류</span><${Select} value=${kind} onChange=${setKind} options=${KINDS} />
    <span class="muted small">차량</span>
    <${CarSearch} cars=${cars} value=${carId} onPick=${c => setCarId(c.id)} />${carId && html`<button class="btn sm ghost" title="차량 빼기" onClick=${() => setCarId(null)}>✕</button>`}
    ${dealers.some(d => d.active && !d.partner) && html`<${Select} value=${dealerId} onChange=${setDealerId} empty="딜러 없음" options=${dealers.filter(d => !d.partner).map(d => [d.id, d.name])} />`}
    <button class="btn sm primary" onClick=${() => onPick({ kind, car_id: carId, dealer_id: dealerId || cars.find(c => c.id === carId)?.dealer_id })}>이걸로 연결</button>
    <button class="btn sm ghost" onClick=${onCancel}>닫기</button></div>`;
}

function AccountForm({ app, onDone }) {
  const [f, setF] = useState({ bank_name: "국민은행", account_no: "", alias: "" });
  const BANK_NAMES = ["국민은행", "신한은행", "우리은행", "하나은행", "농협은행", "기업은행", "부산은행", "경남은행", "대구은행", "SC제일은행", "카카오뱅크", "토스뱅크", "케이뱅크", "새마을금고", "신협", "우체국", "수협은행"];
  const save = async () => {
    if (!f.account_no.trim()) return toast("계좌번호를 입력하세요.", "err");
    const ok = await run(() => q(app.db.from("bank_accounts").insert({ bank_name: f.bank_name, account_no: f.account_no.trim(), alias: f.alias || null })), "계좌를 추가했습니다");
    if (ok) onDone();
  };
  return html`<div class="subform"><div class="fgrid">
    <${Field} label="은행"><${Select} value=${f.bank_name} onChange=${v => setF(p => ({ ...p, bank_name: v }))} options=${BANK_NAMES} /><//>
    <${Field} label="계좌번호" req><input value=${f.account_no} onInput=${e => setF(p => ({ ...p, account_no: e.target.value }))} /><//>
    <${Field} label="별칭"><input value=${f.alias} placeholder="예) 주거래, 매입전용" onInput=${e => setF(p => ({ ...p, alias: e.target.value }))} /><//>
  </div><div class="actions"><button class="btn ghost" onClick=${onDone}>닫기</button><button class="btn primary" onClick=${save}>추가</button></div>
  <p class="note">팝빌 자동조회를 쓰려면 설정 → 팝빌 → '계좌 등록' 화면에서 은행 인증정보를 등록한 뒤 '팝빌 등록계좌 가져오기'를 누르세요.</p></div>`;
}
