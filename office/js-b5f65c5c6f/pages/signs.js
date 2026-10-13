// 서류: 고객이 tieronekorea.com/sign 에서 서명한 서류 (서버 함수 sign 이 여기 저장).
//   비사업용 사실확인서 (차를 파는 고객, 주민번호는 가린 값 — 대표만 원문을 넣어 인쇄)
//   3일 환불 약정서 (차를 사 가는 고객, /sign/refund — 약관 원문은 서명 때 그대로 terms 에)
// 목록 → 서류 보기·인쇄(PDF 저장).
import { html, useState, useEffect, Loading, Empty, Badge, run, toast, go, won, Money, Field } from "../ui.js";
import { q } from "../db.js";
import { 주행공제 } from "../calc.js";

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
const 환불 = r => r.kind === "3일환불";
const 대기 = r => !r.signature_path;                 // 사무실이 만들어 보냈고 고객이 아직 서명 안 함
const 서명시각 = r => r.signed_at || r.created_at;
const 종류 = r => 환불(r) ? "3일 환불" : "비사업용";
const 요일 = "일월화수목금토";
export const 기한글 = iso => { const k = new Date(Date.parse(iso) + 9 * 3600e3); return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${요일[k.getUTCDay()]}) ${k.getUTCHours()}시`; };
/** 3일 환불: 기한 안이면 '환불 가능' 표시 */
function 기한배지(r) {
  if (대기(r)) return html`<${Badge} tone="blue" title="링크를 보냈고 고객 서명을 기다립니다">서명 대기<//>`;
  if (!환불(r) || !r.deadline) return "";
  const left = Date.parse(r.deadline) - Date.now();
  return left > 0 ? html`<${Badge} tone=${left < 24 * 3600e3 ? "red" : "amber"} title="이 때까지 고객이 환불을 요청할 수 있습니다">환불 가능 ~${기한글(r.deadline)}<//>`
    : html`<${Badge} title="환불 기한이 지났습니다">기한 끝<//>`;
}

export function SignsPage({ app, id }) {
  return id ? html`<${SignView} app=${app} id=${id} />` : html`<${SignList} app=${app} />`;
}

function SignList({ app }) {
  const [rows, setRows] = useState(null);
  const [only, setOnly] = useState("전체");
  const [kind, setKind] = useState("전체 종류");
  useEffect(() => { run(async () => setRows(await withCars(app.db, await q(app.db.from("sign_docs").select("*").order("created_at", { ascending: false }))))); }, []);
  if (!rows) return html`<${Loading} />`;
  const 새것 = r => !r.checked_at && !대기(r);
  const list = rows.filter(r => (only === "전체" || 새것(r)) && (kind === "전체 종류" || 종류(r) === kind));
  return html`<div class="bar"><h2>서류 접수</h2><span class="muted small">고객 작성 주소: 비사업용 <a href="/sign/" target="_blank">tieronekorea.com/sign</a>
      · 3일 환불 <a href="/sign/refund/" target="_blank">tieronekorea.com/sign/refund</a></span>
      <span class="grow"></span>
      <div class="seg">${["전체 종류", "비사업용", "3일 환불"].map(k => html`<button class=${kind === k ? "on" : ""} onClick=${() => setKind(k)}>${k}</button>`)}</div>
      <div class="seg">${["전체", "새 서류"].map(k => html`<button class=${only === k ? "on" : ""} onClick=${() => setOnly(k)}>${k}${k === "새 서류" ? ` ${rows.filter(새것).length}` : ""}</button>`)}</div></div>
    ${!list.length ? html`<${Empty}>${rows.length ? "새로 들어온 서류가 없습니다." : "아직 접수된 서류가 없습니다. 고객에게 tieronekorea.com/sign 주소를 보내면 여기에 쌓입니다."}<//>`
      : html`<div class="table-wrap"><table class="grid click">
        <thead><tr><th>접수일시</th><th>종류</th><th>차량번호</th><th>차명</th><th>성명</th><th>주민번호·생년월일</th><th>전화번호</th><th>사업자번호</th><th>우리 차</th><th>상태</th></tr></thead>
        <tbody>${list.map(r => html`<tr key=${r.id} onClick=${() => go("/signs/" + r.id)}>
          <td>${kst(서명시각(r))}</td><td>${종류(r)}</td><td><b>${r.car_no}</b></td><td class="ellipsis">${r.car_name}</td><td>${r.name || "-"}</td><td>${r.ssn_masked || r.birth || "-"}</td>
          <td>${r.phone || "-"}</td><td>${r.biz_no || "-"}</td>
          <td onClick=${e => e.stopPropagation()}>${r.car_id ? html`<a href=${"#/car/" + r.car_id}>${r.cars?.plate} (${r.cars?.status})</a>` : html`<span class="muted">-</span>`}</td>
          <td class="nowrap">${대기(r) ? "" : r.checked_at ? html`<${Badge} tone="green">확인<//>` : html`<${Badge} tone="amber">새 서류<//>`} ${기한배지(r)}</td></tr>`)}</tbody></table></div>`}
    <p class="note">고객이 휴대폰으로 서명하면 여기에 쌓입니다. 서류를 열어 인쇄하거나 PDF 로 저장합니다. 번호판이 같은 우리 차가 있으면 자동으로 연결됩니다.
      3일 환불 약정서는 차 화면 '고객에게 보내기'에서 차량 정보가 채워진 링크로 보낼 수 있습니다.</p>`;
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
    if (!confirm(`${r.car_no} ${r.name} ${종류(r)} 서류를 지울까요? 서명${환불(r) ? "" : "·주민번호"}도 같이 지워지고 되돌릴 수 없습니다.`)) return;
    run(async () => {
      if (r.signature_path) await app.db.storage.from("car-files").remove([r.signature_path]);
      await q(app.db.from("sign_docs").delete().eq("id", id));
      toast("지웠습니다"); go("/signs");
    });
  };
  const t = new Date(Date.parse(서명시각(r)) + 9 * 3600e3), 날짜 = `${t.getUTCFullYear()}년  ${t.getUTCMonth() + 1}월  ${t.getUTCDate()}일`;
  const TR = (k, v) => html`<tr><th>${k}</th><td>${v}</td></tr>`;
  if (대기(r)) return html`<div class="bar"><a class="btn ghost" href="#/signs">← 목록</a><h2>${r.car_no} · 3일 환불 약정서</h2>${기한배지(r)}<span class="grow"></span>
      ${r.car_id && html`<a class="btn" href=${"#/car/" + r.car_id}>차 화면 (${r.cars?.plate})</a>`}
      ${admin && html`<button class="btn danger" onClick=${remove}>삭제</button>`}</div>
    <div class="card"><p>${kst(r.created_at)}에 만든 링크입니다. 고객이 아직 서명하지 않았습니다.</p>
      <p class="small muted">링크 다시 보내기는 차 화면 → 고객에게 보내기 → 3일 환불 약정서에서 할 수 있습니다. 링크는 만든 뒤 14일 동안 열립니다.</p>
      ${r.prepared && html`<div class="sign-paper" style="margin-top:12px"><${고지표} p=${r.prepared} /></div>`}</div>`;
  return html`<div class="bar no-print"><a class="btn ghost" href="#/signs">← 목록</a><h2>${r.car_no} · ${r.name}</h2>
      ${r.checked_at ? html`<${Badge} tone="green">확인 ${kst(r.checked_at).slice(0, 10)}<//>` : html`<${Badge} tone="amber">새 서류<//>`} ${기한배지(r)}<span class="grow"></span>
      ${r.car_id && html`<a class="btn" href=${"#/car/" + r.car_id}>차 화면 (${r.cars?.plate})</a>`}
      ${admin && !ssn && !환불(r) && html`<button class="btn" onClick=${reveal} title="대표만 · 열람 기록이 남습니다">주민번호 원문 넣기</button>`}
      <button class="btn" onClick=${check}>${r.checked_at ? "확인 취소" : "확인함"}</button>
      <button class="btn primary" onClick=${() => window.print()}>인쇄·PDF 저장</button>
      ${admin && html`<button class="btn danger" onClick=${remove}>삭제</button>`}</div>
    ${환불(r) && html`<${환불계산} r=${r} />`}
    ${환불(r) ? html`<${RefundPaper} r=${r} sig=${sig} 날짜=${날짜} TR=${TR} />` : html`<div class="sign-paper">
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
    </div>`}
    <p class="note no-print">인쇄 창에서 'PDF로 저장'을 고르면 파일로 보관됩니다.${환불(r) ? " 약관은 고객이 서명할 때 본 원문 그대로입니다." : " 주민번호 원문은 대표만 넣을 수 있고, 넣을 때마다 열람 기록이 남습니다."}</p>`;
}

/** 인도 때 안내 사항 표 — 고객 페이지(/sign/refund 의 고지html)와 같은 내용 */
function 고지표({ p }) {
  const costs = (p.costs || []).filter(c => Number(c[1]) > 0), sum = costs.reduce((a, c) => a + Number(c[1]), 0);
  const TR = (k, v) => html`<tr><th>${k}</th><td>${v}</td></tr>`;
  return html`<table>${TR("판매금액", won(p.price) + "원")}${TR("성능·상태점검기록부", "교부함")}${TR("압류·저당", p.lien || "없음")}
      ${TR("성능보험", Number(p.insurance) > 0 ? `가입 (보험료 ${won(p.insurance)}원)` : "미가입")}${TR("차량 키", `${p.keys || 0}개`)}${(p.dest || p.move_km) && TR("인도 장소까지", [p.dest, p.move_km ? `${Number(p.move_km).toLocaleString()}km (TMAP 기준)` : ""].filter(Boolean).join(" · "))}${p.note && TR("특약", p.note)}</table>
    ${costs.length > 0 && html`<div class="sec">환불 때 돌려받지 못하는 비용 (예상)</div>
      <table>${costs.map(c => TR(c[0], won(c[1]) + "원"))}${TR(html`<b>합계</b>`, html`<b>${won(sum)}원</b>`)}</table>`}`;
}

function 환불계산({ r }) {
  const p = r.prepared || {};
  const [반납, set반납] = useState("");
  const km = Number(String(반납).replace(/[^\d]/g, "")) || 0;
  const x = km ? 주행공제({ 차량대금: p.price, 인도전: r.mileage, 반납: km, 이동: p.move_km, 기준: r.terms?.km_limit || 300 }) : null;
  return html`<div class="card no-print"><b>환불 계산</b> <span class="muted small">반납 때 계기판 주행거리를 넣으면 약관 제3조 ③ 주행거리 공제가 나옵니다</span>
    <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap;align-items:center">
      <input inputmode="numeric" placeholder="반납 때 주행거리 (km)" value=${반납} onInput=${e => set반납(e.target.value)} style="width:180px" />
      ${x && html`<span>인도 후 주행 <b>${won(x.주행)}km</b> (${won(km)} − 인도 전 ${won(r.mileage)}${p.move_km ? ` − 이동 ${won(p.move_km)}` : ""})
        · 초과 ${won(x.초과)}km${x.구간 ? ` → ${x.구간}구간` : ""} · <b class=${x.공제 ? "red" : "green"}>공제 ${won(x.공제)}원</b>
        ${p.price ? html`<span class="muted small"> (차량대금 ${won(p.price)}원 기준)</span>` : html`<span class="red small"> 차량대금 정보 없음</span>`}</span>`}
    </div></div>`;
}

/** 3일 환불 약정서 — 고객 사본(/sign/refund)과 같은 양식, 약관은 서명 때 원문(terms) */
function RefundPaper({ r, sig, 날짜, TR }) {
  const t = r.terms || { title: "3일 환불 약정서", clauses: [], seller: "TierONE (티어원)" };
  const k = r.deadline ? new Date(Date.parse(r.deadline) + 9 * 3600e3) : null;
  const 기한 = k ? `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 (${요일[k.getUTCDay()]}) ${k.getUTCHours()}시까지` : "-";
  return html`<div class="sign-paper">
    <h1>${t.title}</h1>
    <div class="sec">※ 매매 차량</div>
    <table>${TR("차량번호", r.car_no)}${TR("차명", r.car_name)}${TR("주행거리", r.mileage != null ? `${Number(r.mileage).toLocaleString()} km (인도 전 계기판)` : "-")}${TR("환불기한", 기한)}</table>
    ${r.prepared && html`<div class="sec">※ 인도 때 안내 사항</div><${고지표} p=${r.prepared} />`}
    <p>매도인 ${t.seller}(이하 '매도인')과 매수인은 위 차량의 매매에 관하여 다음과 같이 3일 환불을 약정합니다.</p>
    <ol class="terms">${t.clauses.map(([h, b], i) => html`<li><b>제${i + 1}조 (${h})</b><br />${b.split(String.fromCharCode(10)).map((x, j) => html`${j ? html`<br />` : ""}${x}`)}</li>`)}</ol>
    <p class="date">${날짜}</p>
    <div class="sec">※ 매수인</div>
    <table><tr><th>성명</th><td class="owner">${r.name}<span class="sigwrap"><span class="sigmark">(서명)</span>${sig && html`<img class="sig" src=${sig} />`}</span></td></tr>
      ${TR("생년월일", r.birth)}${TR("주소", r.address)}${TR("전화번호", r.phone)}</table>
    <div class="buyer">매도인 : ${t.seller}${t.seller_addr ? ` · ${t.seller_addr}` : ""}${t.seller_tel ? ` · ${t.seller_tel}` : ""}<br />
      전자서명 접수 : ${kst(서명시각(r))} · ${r.prepared ? "안내 사항·" : ""}약관 확인 체크 ${r.agreed ? "완료" : "없음"}${t.ver ? ` · 약관 ${t.ver}` : ""}</div>
  </div>`;
}

/** 대시보드 위젯: 아직 확인 안 한 서류 */
export function SignsWidget({ app }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { run(async () => setRows((await q(app.db.from("sign_docs").select("id,kind,car_no,name,created_at,signed_at,deadline,signature_path").is("checked_at", null).order("created_at", { ascending: false }).limit(30))).filter(r => !대기(r)).slice(0, 8))); }, []);
  return html`<div class="card"><div class="bar"><h3>새 서류 ${rows ? `— ${rows.length}건` : ""}</h3><span class="grow"></span><a class="btn sm" href="#/signs">서류</a></div>
    ${!rows ? html`<${Loading} />` : !rows.length ? html`<p class="muted small">새로 들어온 서류가 없습니다.</p>`
      : html`<table class="grid click"><tbody>${rows.map(r => html`<tr onClick=${() => go("/signs/" + r.id)}><td><b>${r.car_no}</b></td><td>${r.name}</td><td class="small">${종류(r)}</td><td class="r small">${kst(서명시각(r))}</td></tr>`)}</tbody></table>`}</div>`;
}

/** 차 화면 '고객에게 보내기' 아래: 3일 환불 약정서 — 인도 때 고지 사항을 채워 고객 링크를 만든다.
 *  고객은 링크에서 이 내용을 고치지 못하고 확인·서명만 한다 (성능지도 그 화면에서 볼 수 있다). */
export function RefundPrep({ app, car, sale, shareLink, onClose }) {
  const [docs, setDocs] = useState(null);
  const [f, setF] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const load = () => run(async () => setDocs(await q(app.db.from("sign_docs").select("id,token,created_at,signed_at,signature_path,name,deadline")
    .eq("car_id", car.id).eq("kind", "3일환불").order("created_at", { ascending: false }))));
  useEffect(() => { load(); run(async () => {
    const [loans, ins] = await Promise.all([
      q(app.db.from("car_loans").select("id").eq("car_id", car.id).eq("status", "진행중")),
      q(app.db.from("car_inspections").select("insur_price,recept_date").eq("car_id", car.id).order("recept_date", { ascending: false }).limit(1))]);
    const price = Number(sale?.sale_amount || car.ad_price || car.list_price || 0), insurance = Number(ins[0]?.insur_price || 0);
    setF({ price, mileage: car.mileage ?? "", keys: 2, insurance, note: "", dest: "", move_km: "",
      lien: loans.length ? "재고금융 저당 있음 — 대금을 받은 뒤 해지" : "없음",
      매도비: 440000, 성능보험료: insurance, 탁송비: 0 });
  }); }, [car.id]);
  const url = t => `${location.origin}/sign/refund/?t=${t}`;
  const make = () => run(async () => {
    if (!f.price) throw new Error("판매금액을 넣어 주세요");
    if (f.mileage === "" || f.mileage == null) throw new Error("인도 전 주행거리를 넣어 주세요");
    const token = crypto.randomUUID().replace(/-/g, "");
    const prepared = { price: f.price, keys: Number(f.keys) || 0, lien: f.lien.trim() || "없음", insurance: Number(f.insurance) || 0, note: f.note.trim(), dest: f.dest.trim(), move_km: Number(f.move_km) || 0,
      costs: [["매도비", f.매도비], ["성능보험료", f.성능보험료], ["탁송비", f.탁송비]].filter(c => Number(c[1]) > 0) };
    await q(app.db.from("sign_docs").insert({ kind: "3일환불", car_id: car.id, car_no: car.plate, car_name: car.car_name, mileage: Number(String(f.mileage).replace(/[^\d]/g, "")),
      prepared, token, prepared_by: app.user.id, signed_at: null, agreed: false }));
    load();
    await shareLink(url(token), `${car.plate} 3일 환불 약정서`);
  });
  const N = (k, label, hint) => html`<${Field} label=${label} hint=${hint}><${Money} value=${f[k]} onInput=${v => set(k, v)} /><//>`;
  return html`<div class="card refundprep no-print">
    <div class="bar"><h3>3일 환불 약정서</h3><span class="muted small">인도 때 안내할 내용을 채워 고객에게 링크를 보냅니다. 고객은 고치지 못하고 확인·서명만 합니다.</span>
      <span class="grow"></span><button class="btn ghost sm" onClick=${onClose}>닫기</button></div>
    ${docs && docs.length > 0 && html`<table class="grid"><tbody>${docs.map(d => html`<tr>
      <td>${new Date(Date.parse(d.signed_at || d.created_at) + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}</td>
      <td>${d.signature_path ? html`<${Badge} tone="green">서명 완료<//> ${d.name}` : html`<${Badge} tone="blue">서명 대기<//>`}</td>
      <td class="r">${d.signature_path ? html`<a class="btn sm" href=${"#/signs/" + d.id}>약정서 보기</a>`
        : html`<button class="btn sm" onClick=${() => shareLink(url(d.token), `${car.plate} 3일 환불 약정서`)}>링크 다시 보내기</button>`}</td></tr>`)}</tbody></table>`}
    ${!f ? html`<${Loading} />` : html`<div class="fgrid">
      <${Field} label="판매금액 (차량대금)"><${Money} value=${f.price} onInput=${v => set("price", v)} /><//>
      <${Field} label="인도 전 주행거리 (km)" hint="매장에서 출발하기 전 계기판"><input inputmode="numeric" value=${f.mileage} onInput=${e => set("mileage", e.target.value.replace(/[^\d]/g, ""))} /><//>
      <${Field} label="인도 장소 (있으면)"><input value=${f.dest} placeholder="예: 고객 자택 (부산 해운대구)" onInput=${e => set("dest", e.target.value)} /><//>
      <${Field} label="인도 장소까지 거리 (TMAP, km)" hint="환불 조건 주행거리에서 빼는 거리"><input inputmode="numeric" value=${f.move_km} onInput=${e => set("move_km", e.target.value.replace(/[^\d]/g, ""))} /><//>
      <${Field} label="차량 키 (개)"><input inputmode="numeric" value=${f.keys} onInput=${e => set("keys", e.target.value.replace(/[^\d]/g, ""))} /><//>
      <${Field} label="압류·저당"><input value=${f.lien} onInput=${e => set("lien", e.target.value)} /><//>
      ${N("insurance", "성능보험료", "0이면 '미가입'으로 나옵니다")}
      <${Field} label="특약 (있으면)" wide><input value=${f.note} placeholder="예: 블랙박스 SD카드 별도 · 스마트키 1개는 다음 주 전달" onInput=${e => set("note", e.target.value)} /><//>
    </div>
    <div class="sec small"><b>환불 때 돌려받지 못하는 비용 (예상)</b> — 0원인 항목은 약정서에 안 나옵니다</div>
    <div class="fgrid">
      ${N("매도비", "매도비")}${N("성능보험료", "성능보험료")}${N("탁송비", "탁송비")}
    </div>
    <div class="bar"><span class="grow"></span><button class="btn primary" onClick=${make}>링크 만들어 보내기</button></div>`}
  </div>`;
}
