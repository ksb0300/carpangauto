// 서류: 고객이 tieronekorea.com/sign 에서 서명한 비사업용 사실확인서 (예전 구글 앱스스크립트 → 이제 서버 함수 sign 이 여기 저장).
// 목록 → 확인서 보기·인쇄(PDF 저장). 주민번호는 가린 값으로 보이고, 대표만 원문을 넣어 인쇄할 수 있다.
import { html, useState, useEffect, Loading, Empty, Badge, run, toast, go } from "../ui.js";
import { q } from "../db.js";

const 매수자 = "김상혁 (티어원)", 매수자주소 = "부산광역시 기장군 장안읍 반룡산단3로 95, 604호, 605호(경동오토필드)";
const 조항 = [
  "본인은 당초 상기 매각차량의 구입과 관련하여 매입세금계산서를 비사업자로 수취하였습니다.",
  "본인은 본인이 운영하고 있는 사업장의 부가가치세 신고시 상기 매각차량의 구입과 관련하여 매입세액으로 공제받은 사실이 없습니다.",
  "상기 매각차량은 본인이 운영하고 있는 사업장과는 아무런 관련이 없이 본인개인용도의 가정용으로 사용하였으며, 이에 따라 상기 매각차량을 " +
  "사업자 장부에 등재하거나 관련 감가상각비 및 기타 운행경비를 사업장 장부에 반영한 사실이 없습니다. 만일 위 사실과 관련하여 허위기재로 인한 " +
  "귀하의 불이익이 발생할 경우 본인이 책임지겠음을 각서하며 이에 비사업용 사실확인서를 제출합니다."];
// 연결된 우리 차 (번호판·상태) — 데모 DB 는 표 묶어 읽기를 못 해서 따로 읽어 붙인다
async function withCars(db, rows) {
  const ids = [...new Set(rows.map(r => r.car_id).filter(Boolean))];
  const cars = ids.length ? await q(db.from("cars").select("id,plate,status").in("id", ids)) : [];
  return rows.map(r => ({ ...r, cars: cars.find(c => c.id === r.car_id) || null }));
}
const kst = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 16);

export function SignsPage({ app, id }) {
  return id ? html`<${SignView} app=${app} id=${id} />` : html`<${SignList} app=${app} />`;
}

function SignList({ app }) {
  const [rows, setRows] = useState(null);
  const [only, setOnly] = useState("전체");
  useEffect(() => { run(async () => setRows(await withCars(app.db, await q(app.db.from("sign_docs").select("*").order("created_at", { ascending: false }))))); }, []);
  if (!rows) return html`<${Loading} />`;
  const list = rows.filter(r => only === "전체" || !r.checked_at);
  return html`<div class="bar"><h2>서류 접수</h2><span class="muted small">비사업용 사실확인서 · 고객 작성 주소 <a href="/sign/" target="_blank">tieronekorea.com/sign</a></span>
      <span class="grow"></span>
      <div class="seg">${["전체", "새 서류"].map(k => html`<button class=${only === k ? "on" : ""} onClick=${() => setOnly(k)}>${k}${k === "새 서류" ? ` ${rows.filter(r => !r.checked_at).length}` : ""}</button>`)}</div></div>
    ${!list.length ? html`<${Empty}>${rows.length ? "새로 들어온 서류가 없습니다." : "아직 접수된 서류가 없습니다. 고객에게 tieronekorea.com/sign 주소를 보내면 여기에 쌓입니다."}<//>`
      : html`<div class="table-wrap"><table class="grid click">
        <thead><tr><th>접수일시</th><th>차량번호</th><th>차명</th><th>성명</th><th>주민번호</th><th>전화번호</th><th>사업자번호</th><th>우리 차</th><th>상태</th></tr></thead>
        <tbody>${list.map(r => html`<tr key=${r.id} onClick=${() => go("/signs/" + r.id)}>
          <td>${kst(r.created_at)}</td><td><b>${r.car_no}</b></td><td class="ellipsis">${r.car_name}</td><td>${r.name}</td><td>${r.ssn_masked}</td>
          <td>${r.phone}</td><td>${r.biz_no || "-"}</td>
          <td onClick=${e => e.stopPropagation()}>${r.car_id ? html`<a href=${"#/car/" + r.car_id}>${r.cars?.plate} (${r.cars?.status})</a>` : html`<span class="muted">-</span>`}</td>
          <td>${r.checked_at ? html`<${Badge} tone="green">확인<//>` : html`<${Badge} tone="amber">새 서류<//>`}</td></tr>`)}</tbody></table></div>`}
    <p class="note">예전에는 구글 드라이브·시트에 쌓이고 메일로 왔습니다. 이제는 여기서 보고, 확인서를 열어 인쇄하거나 PDF 로 저장합니다. 번호판이 같은 우리 차가 있으면 자동으로 연결됩니다.</p>`;
}

function SignView({ app, id }) {
  const [r, setR] = useState(null);
  const [sig, setSig] = useState(null);
  const [ssn, setSsn] = useState(null);         // 대표가 원문을 불러오면 확인서에 그대로
  const admin = app.profile.role === "admin";
  const load = () => run(async () => {
    const x = (await withCars(app.db, await q(app.db.from("sign_docs").select("*").eq("id", id))))[0];
    setR(x || false);
    if (x?.signature_path) { const { data } = await app.db.storage.from("car-files").createSignedUrl(x.signature_path, 3600); setSig(data?.signedUrl || null); }
  });
  useEffect(() => { load(); }, [id]);
  if (r === null) return html`<${Loading} />`;
  if (!r) return html`<div class="card empty">서류를 찾을 수 없습니다. <a href="#/signs">목록으로</a></div>`;
  const reveal = () => run(async () => { const { data, error } = await app.db.rpc("reveal_ssn", { p_target: "sign_doc", p_id: id }); if (error) throw new Error(error.message); setSsn(data); });
  const check = () => run(async () => { await q(app.db.from("sign_docs").update({ checked_at: r.checked_at ? null : new Date().toISOString(), checked_by: r.checked_at ? null : (await app.db.auth.getSession()).data.session?.user?.id || null }).eq("id", id)); load(); });
  const remove = () => {
    if (!confirm(`${r.car_no} ${r.name} 확인서를 지울까요? 서명·주민번호도 같이 지워지고 되돌릴 수 없습니다.`)) return;
    run(async () => {
      if (r.signature_path) await app.db.storage.from("car-files").remove([r.signature_path]);
      await q(app.db.from("sign_docs").delete().eq("id", id));
      toast("지웠습니다"); go("/signs");
    });
  };
  const t = new Date(Date.parse(r.created_at) + 9 * 3600e3), 날짜 = `${t.getUTCFullYear()}년  ${t.getUTCMonth() + 1}월  ${t.getUTCDate()}일`;
  const TR = (k, v) => html`<tr><th>${k}</th><td>${v}</td></tr>`;
  return html`<div class="bar no-print"><a class="btn ghost" href="#/signs">← 목록</a><h2>${r.car_no} · ${r.name}</h2>
      ${r.checked_at ? html`<${Badge} tone="green">확인 ${kst(r.checked_at).slice(0, 10)}<//>` : html`<${Badge} tone="amber">새 서류<//>`}<span class="grow"></span>
      ${r.car_id && html`<a class="btn" href=${"#/car/" + r.car_id}>차 화면 (${r.cars?.plate})</a>`}
      ${admin && !ssn && html`<button class="btn" onClick=${reveal} title="대표만 · 열람 기록이 남습니다">주민번호 원문 넣기</button>`}
      <button class="btn" onClick=${check}>${r.checked_at ? "확인 취소" : "확인함"}</button>
      <button class="btn primary" onClick=${() => window.print()}>인쇄·PDF 저장</button>
      ${admin && html`<button class="btn danger" onClick=${remove}>삭제</button>`}</div>
    <div class="sign-paper">
      <h1>비사업용 사실확인서</h1>
      <div class="sec">※ 매각차량</div>
      <table>${TR("차량번호", r.car_no)}${TR("차명", r.car_name)}${TR("소유자", r.name)}</table>
      <p>본인은 상기 차량을 귀 자동차매매상사에 판매함에 있어 다음사항에 대해 확인드립니다.</p>
      <p class="daum">- 다 음 -</p>
      <ol>${조항.map(x => html`<li>${x}</li>`)}</ol>
      <p class="date">${날짜}</p>
      <div class="sec">※ 차량소유자</div>
      <table><tr><th>성명</th><td class="owner">${r.name}<span class="sigwrap"><span class="sigmark">(서명)</span>${sig && html`<img class="sig" src=${sig} />`}</span></td></tr>
        ${TR("주민등록번호", ssn || r.ssn_masked)}${TR("주소", r.address)}${TR("전화번호", r.phone)}${r.biz_no && TR("사업자등록번호", r.biz_no)}</table>
      <div class="buyer">매수자 : ${매수자} · ${매수자주소}<br />전자서명 접수 : ${kst(r.created_at)} · 1·2·3항 확인 체크 ${r.agreed ? "완료" : "없음"}</div>
    </div>
    <p class="note no-print">인쇄 창에서 'PDF로 저장'을 고르면 파일로 보관됩니다. 주민번호 원문은 대표만 넣을 수 있고, 넣을 때마다 열람 기록이 남습니다.</p>`;
}

/** 대시보드 위젯: 아직 확인 안 한 서류 */
export function SignsWidget({ app }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { run(async () => setRows(await q(app.db.from("sign_docs").select("id,car_no,name,created_at").is("checked_at", null).order("created_at", { ascending: false }).limit(8)))); }, []);
  return html`<div class="card"><div class="bar"><h3>새 서류 ${rows ? `— ${rows.length}건` : ""}</h3><span class="grow"></span><a class="btn sm" href="#/signs">서류</a></div>
    ${!rows ? html`<${Loading} />` : !rows.length ? html`<p class="muted small">새로 들어온 비사업용 확인서가 없습니다.</p>`
      : html`<table class="grid click"><tbody>${rows.map(r => html`<tr onClick=${() => go("/signs/" + r.id)}><td><b>${r.car_no}</b></td><td>${r.name}</td><td class="r small">${kst(r.created_at)}</td></tr>`)}</tbody></table>`}</div>`;
}
