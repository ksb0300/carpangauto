// 게시판 — 웍스 게시판 대체 (2026-10-19 웍스 화면을 보고 그대로 따라 만듦). 사무실(대표·직원)만.
//   왼쪽: 글쓰기 · 최신글/필독/중요/내 게시글 · 게시판 묶음(안 읽은 글 빨간 점) — 폰에선 위쪽 가로 메뉴
//   목록: 안 읽은 글 굵게+빨간 점, 작성자 · 읽음 N · 💬N, '1시간전' / 게시판마다 '새글 알림' 켜고 끄기
//   글: 이니셜 프로필 · 읽음 N(누르면 누가 읽었나) · ☆중요 · ▲▼ 이전·다음 글 · 리액션 · 댓글
//   송금요청·매도정보는 웍스 템플릿 같은 칸 카드(forms.js). 송금요청은 통장 출금과 자동 짝짓기(DB board_match_payments)
//   등록증 글은 그 차 첨부서류에도 사진이 붙는다. 파일은 car-files 버킷 board/<글id>/ (저장 경로는 영문만)
import { html, useState, useEffect, Loading, Empty, Badge, Seg, Field, Select, run, toast, ask, go, 검색맞음 } from "../ui.js";
import { q } from "../db.js";
import { 보내기 as 알림 } from "../push.js";
import { 모두줄이기 } from "../img.js";
import { 구성원, 이름표, Avatar, 언제, 날짜시각 } from "../people.js";
import { 송금읽기, 송금글, 매도읽기, 매도글, 금액, 원, 송금종류, 매도형태들, 번호판, 기한시각 } from "../forms.js";

// [값, 이름, 아이콘, 묶음]
const BOARDS = [
  ["공지", "공지", "📌", null],
  ["매입등록증", "매입 등록증", "🚗", "매입·매도 업무"], ["매도등록증", "매도 등록증", "🔑", "매입·매도 업무"],
  ["송금요청", "송금요청", "💸", "매입·매도 업무"], ["매도정보", "매도정보", "🤝", "매입·매도 업무"], ["3일환불제서류", "3일환불제 서류", "🧾", "매입·매도 업무"],
  ["말소서류", "말소서류", "📄", "매입·매도 업무"],
  ["자료", "자료·매뉴얼", "📚", null], ["자유", "자유", "💬", null],
];
const 이름 = Object.fromEntries(BOARDS.map(b => [b[0], b[1]]));
const 아이콘 = Object.fromEntries(BOARDS.map(b => [b[0], b[2]]));
const 빠른 = [["최신", "최신글"], ["필독", "필독"], ["중요", "중요"], ["내글", "내 게시글"]];
const CAR_KIND = { 매입등록증: "등록증", 매도등록증: "매도등록증" };      // car_files.kind
const 경로들 = [["엔카", "엔카"], ["헤이딜러", "헤딜"], ["개인", "개인"], ["기타", "기타"]];     // 칸이 좁아 '헤이딜러'는 '헤딜'로 보여 줌
const EMOJIS = ["👍", "✅", "🙏", "😂", "❤️", "🎉"];
const 완료말 = /(입완|입금\s*완료|송금\s*완료|완료|^\s*완\s*$)/;       // 사무장이 댓글로 '입완' → 송금요청 완료 (웍스 때 습관)
const MAX = 20 * 1024 * 1024;
const 저장이름 = name => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${((name.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0]).toLowerCase()}`;
const 번호 = s => String(s || "").replace(/\s/g, "");
const bucket = app => app.db.storage.from("car-files");
const 내것 = (app, x) => app.profile.role === "admin" || (!!x.created_by && x.created_by === app.user.id);    // 고치기·지우기
const PAGE = 100;

async function 전부(qb) {      // 서버는 한 번에 1000줄까지 — 끝까지 나눠 받기
  const out = [];
  for (let i = 0; ; i += 1000) { const r = await q(qb().range(i, i + 999)); out.push(...r); if (r.length < 1000) return out; }
}
async function 차찾기(app, plate) {     // 띄어쓰기 무시, 바뀌기 전 번호도
  const p = 번호(plate), tail = p.slice(-4);
  if (!/^\d{4}$/.test(tail)) return null;
  const rows = await q(app.db.from("cars").select("id, plate, plate_before, car_name").is("deleted_at", null).or(`plate.ilike.%${tail}%,plate_before.ilike.%${tail}%`));
  return rows.find(c => 번호(c.plate) === p || 번호(c.plate_before) === p) || null;
}
const 보기기억 = { get: () => { try { return sessionStorage.getItem("board-view") || "최신"; } catch { return "최신"; } }, set: v => { try { sessionStorage.setItem("board-view", v); } catch {} } };

export function BoardPage({ app, id }) {
  if (id === "new") return html`<${Write} app=${app} />`;
  return id ? html`<${Post} app=${app} id=${id} />` : html`<${List} app=${app} />`;
}

/* ───────── 왼쪽 (폰에선 위쪽) ───────── */
function Side({ app, v, setV, d }) {
  const 안읽음 = c => (d?.posts || []).some(p => (c === "최신" || p.category === c) && d.새(p));
  const 대기 = (d?.posts || []).filter(p => p.category === "송금요청" && !p.done_at).length;
  const 잔금 = (d?.posts || []).filter(p => p.category === "매도정보" && !p.done_at).length;
  const n = { 최신: (d?.posts || []).filter(p => d.새(p)).length, 필독: (d?.posts || []).filter(p => p.pinned).length,
    중요: d?.stars.size || 0, 내글: (d?.posts || []).filter(p => p.created_by === app.user.id).length };
  let 묶음 = null;
  return html`<aside class="bd-side">
    <button class="btn primary bd-write" onClick=${() => go("/board/new")}>✏️ 글쓰기</button>
    <div class="bd-quick">${빠른.map(([k, l]) => html`<button class=${v === k ? "on" : ""} onClick=${() => setV(k)}><b>${n[k] || 0}</b>${l}</button>`)}</div>
    <nav class="bd-tree">${BOARDS.map(([k, l, ic, g]) => {
      const head = g && g !== 묶음 ? html`<div class="grp">📁 ${g}</div>` : null; 묶음 = g;
      return html`${head}<a href="#" class=${(g ? "sub " : "") + (v === k ? "on" : "")} onClick=${e => { e.preventDefault(); setV(k); }}>
        <span>${ic}</span>${l}${안읽음(k) && html`<span class="dot"></span>`}${k === "송금요청" && 대기 ? html`<span class="n">⏳${대기}</span>` : ""}${k === "매도정보" && 잔금 ? html`<span class="n">⏳${잔금}</span>` : ""}</a>`;
    })}</nav>
  </aside>`;
}

/* ───────── 목록 ───────── */
function List({ app }) {
  const me = app.user.id;
  const [v, setV0] = useState(보기기억.get);
  const setV = x => { setV0(x); 보기기억.set(x); setMore(1); };
  const [d, setD] = useState(null);
  const [s, setS] = useState("");
  const [more, setMore] = useState(1);
  const [st, setSt] = useState("대기");          // 송금요청: 대기 / 완료 / 전체
  const load = () => run(async () => {
    const [p, c, r, f, star, prefs] = await Promise.all([
      전부(() => app.db.from("board_posts").select("id, category, title, body, author_name, created_by, created_at, pinned, plate, car_id, done_at, form, publish_at, ack_at").order("created_at", { ascending: false })),
      전부(() => app.db.from("board_comments").select("post_id")),
      전부(() => app.db.from("board_reads").select("post_id, user_id, seed")),
      전부(() => app.db.from("board_files").select("post_id")),
      q(app.db.from("board_stars").select("post_id")),
      q(app.db.from("push_prefs").select("key, enabled")),
    ]);
    const cnt = rows => { const n = {}; rows.forEach(x => { n[x.post_id] = (n[x.post_id] || 0) + 1; }); return n; };
    const mine = new Set(r.filter(x => x.user_id === me).map(x => x.post_id));
    const 가입 = Date.parse(app.user.created_at || 0) || 0;       // 계정을 만들기 전에 올라온 글은 읽은 것으로 (새 직원에게 옛 글이 전부 '안 읽음'으로 뜨지 않게)
    setD({ posts: p, cmt: cnt(c), readN: cnt(r.filter(x => !x.seed)), files: cnt(f), stars: new Set(star.map(x => x.post_id)),
      off: new Set(prefs.filter(x => !x.enabled).map(x => x.key)), 새: x => !mine.has(x.id) && x.created_by !== me && Date.parse(x.created_at) > 가입 });
  });
  useEffect(() => {
    load();
    // 은행 문자가 늦게 들어왔어도 열 때 한 번 더 송금요청(출금)·매도정보(입금) 짝짓기
    app.db.rpc("board_match_payments").then(({ data }) => { if (data?.length) load(); });
    app.db.rpc("board_match_sales").then(({ data }) => { if (data?.length) load(); });
  }, []);
  const 게시판 = !!이름[v];
  const 송금 = v === "송금요청" || v === "매도정보";       // 대기/완료 나눠 보는 게시판
  const 알림키 = "board:" + v, 알림켜짐 = !d?.off.has(알림키);
  const 알림토글 = () => run(async () => {
    await q(app.db.from("push_prefs").upsert({ key: 알림키, enabled: !알림켜짐 }, { onConflict: "user_id,key" }));
    load();
  }, 알림켜짐 ? `${이름[v]} 새글 알림을 껐습니다` : `${이름[v]} 새글 알림을 켰습니다`);
  const shown = (d?.posts || []).filter(p => (v === "최신" || (v === "필독" ? p.pinned : v === "중요" ? d.stars.has(p.id) : v === "내글" ? p.created_by === me : p.category === v))
    && 검색맞음(s, p.title, p.plate, p.author_name, p.body) && (!송금 || st === "전체" || (st === "대기" ? !p.done_at : !!p.done_at)))
    .sort((a, b) => (게시판 ? (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) : 0));
  const page = shown.slice(0, PAGE * more);
  const 대기 = (d?.posts || []).filter(p => p.category === v && !p.done_at).length;
  const 제목 = 게시판 ? `${아이콘[v]} ${이름[v]}` : (빠른.find(x => x[0] === v) || [, "최신글"])[1];

  return html`<div class="bd">
    <${Side} app=${app} v=${v} setV=${setV} d=${d} />
    <section>
      <div class="bd-head"><h2>${제목}</h2><span class="grow"></span>
        ${게시판 && d && html`<span class=${"toggle" + (알림켜짐 ? " on" : "")} onClick=${알림토글} title="이 게시판에 새 글이 오면 폰·PC 알림">새글 알림 <i></i></span>`}</div>
      ${송금 && html`<div style="margin:0 0 8px"><${Seg} value=${st} onChange=${x => { setSt(x); setMore(1); }} options=${[["대기", v === "매도정보" ? `잔금 남음 ${대기}` : `남은 요청 ${대기}`], ["완료", "완료"], ["전체", "전체"]]} /></div>`}
      <input class="search" style="width:100%;margin-bottom:10px" placeholder="차량번호·제목·작성자·내용 검색" value=${s} onInput=${e => { setS(e.target.value); setMore(1); }} />
      ${!d ? html`<${Loading} />` : !shown.length ? html`<${Empty}>${s ? "찾는 글이 없습니다." : v === "중요" ? "☆ 를 누른 글이 여기에 모입니다." : "글이 없습니다."}<//>` : html`<div class="bd-rows">
        ${page.map(p => { const 새 = d.새(p); return html`<div key=${p.id} class=${"bd-row" + (새 ? " new" : "") + (p.pinned && 게시판 ? " pin" : "")} onClick=${() => go("/board/" + p.id)}>
          <${Avatar} name=${p.author_name} size=${34} />
          <div class="bx">
            <div class="t">${새 && html`<span class="dot"></span>`}${p.pinned ? "📌 " : ""}${p.title}${d.files[p.id] ? html`<span title="첨부">📎</span>` : ""}
              ${p.publish_at && Date.parse(p.publish_at) > Date.now() && html`<${Badge} tone="blue">🕒 예약 ${날짜시각(p.publish_at).slice(6)}<//>`}
              ${p.category === "송금요청" && (p.done_at ? html`<${Badge} tone="green">✔ 완료<//>` : html`<${Badge} tone="amber">⏳ 대기<//>`)}
              ${p.category === "송금요청" && p.form?.kind === "매입대금" && !p.done_at && (p.ack_at ? html`<${Badge}>👀 확인<//>` : html`<${Badge} tone="red">🔔 미확인<//>`)}
              ${p.category === "송금요청" && !p.done_at && 대표담당(p.form) && html`<${Badge}>대표님 담당<//>`}
              ${p.category === "매도정보" && (p.done_at ? html`<${Badge} tone="green">✔ 잔금 완료<//>` : html`<${Badge} tone="amber">⏳ ${p.form?.deposit > 0 ? "잔금 대기" : "입금 대기"}<//>`)}
              ${!게시판 && html`<span class="muted small" style="font-weight:400">${아이콘[p.category]} ${이름[p.category]}</span>`}</div>
            <div class="m">${p.author_name || "-"} · 읽음 ${d.readN[p.id] || 0}${d.cmt[p.id] ? ` · 💬 ${d.cmt[p.id]}` : ""}${p.plate ? ` · ${p.plate}${p.car_id ? " ✓" : ""}` : ""}${p.form?.amount && p.category === "송금요청" ? ` · ${원(p.form.amount)}` : ""}${p.form?.amount && p.category === "매도정보" ? ` · ${p.form.type ? p.form.type + " " : ""}${원(p.form.amount)}` : ""}</div>
          </div>
          <div class="w">${언제(p.created_at)}</div></div>`; })}</div>
        ${shown.length > page.length && html`<div class="bar" style="justify-content:center;margin-top:8px"><button class="btn ghost" onClick=${() => setMore(more + 1)}>더 보기 (${shown.length - page.length}개 남음)</button></div>`}`}
    </section></div>`;
}

/* ───────── 양식 칸 (글쓰기·고치기 같이 씀) ───────── */
// 송금요청 받는 쪽 (사용자 2026-10-21): 개인·법인·사업자, 법인·사업자면 계산서 발행 되는지 꼭 체크
const 받는쪽들 = ["개인", "법인", "사업자"], 계산서들 = ["발행 가능", "발행 안 됨", "확인 필요"];
const 사업자 = t => t === "법인" || t === "사업자";
/** 고른 값, 안 골랐으면 예금주 이름으로 짐작 ((주)·주식회사 → 법인, 그 밖엔 개인) */
const 받는쪽 = f => f.payee_type || (/\(주\)|㈜|주식회사|\(유\)|유한회사|법인/.test(f.payee || "") ? "법인" : f.payee ? "개인" : "");
/** 송금요청 칸 확인 — 문제 있으면 알림 문구. 매입대금은 차량번호·차량명·예금주 필수(입금되면 재고로 올릴 때 씀), 수수료·업무비는 자유 */
const 송금확인 = form => !form.amount ? "송금할 금액을 입력하세요"
  : form.kind === "매입대금" && !form.plate ? "매입대금은 차량번호를 넣어 주세요"
  : form.kind === "매입대금" && !form.car_name ? "매입대금은 차량명을 넣어 주세요 (대충이라도)"
  : form.kind === "매입대금" && !form.payee ? "매입대금은 예금주를 넣어 주세요"
  : !form.payee_type ? "받는 쪽(개인·법인·사업자)을 고르세요"
  : 사업자(form.payee_type) && !form.invoice ? "법인·사업자는 계산서 발행이 되는지 골라 주세요" : null;
// 담당 (사용자 2026-10-21): 사무장(기본) / 김상혁 대표 — 대표면 시간 상관없이 대표에게만 재촉·조르기
const 담당들 = ["사무장", "김상혁 대표"];
const 대표담당 = f => f?.handler === "대표";
/** 담당이 대표면 그 계정 id 를 form 에 (tick·조르기가 이 사람에게만 보낸다) */
async function 담당정리(app, form) {
  if (!form) return form;
  form.handler_id = 대표담당(form) ? (await 구성원(app)).find(m => m.role === "admin" && m.name === "김상혁")?.user_id || null : null;
  return form;
}
function 송금칸({ f, set }) {
  const a = 금액(f.amountText ?? "") ?? (Number(String(f.amountText || "").replace(/[^\d]/g, "")) || null);
  const 차 = f.kind === "매입대금", 대표 = f.handler === "대표";
  return html`<div class="fgrid">
    <${Field} label="담당" hint=${대표 ? "대표님 담당 — 시간 상관없이 대표님께만 알림·재촉" : "사무장 — 근무시간(평일 8:30~17:00)에 알림·재촉"}>
      <${Seg} value=${대표 ? "김상혁 대표" : "사무장"} onChange=${v => set("handler", v === "김상혁 대표" ? "대표" : "사무장")} options=${담당들} /><//>
    <${Field} label="종류" hint=${차 ? `차대금 — ${대표 ? "대표님" : "사무장님"}이 [확인] 누를 때까지 재촉 알림` : "알림 한 번"}><${Seg} value=${f.kind} onChange=${v => set("kind", v)} options=${송금종류} /><//>
    ${f.kind !== "업무비" && html`<${Field} label="매입경로"><${Seg} value=${f.route || ""} onChange=${v => set("route", v)} options=${경로들} /><//>`}
    <${Field} label="차량번호" req=${차} hint=${f.kind === "업무비" ? "차에 쓴 돈이면 적어 주세요 (선택)" : ""}><input value=${f.plate || ""} placeholder="예: 54다8079" onInput=${e => set("plate", e.target.value)} /><//>
    <${Field} label="차량명" req=${차} hint=${차 ? "입금되면 재고로 올릴 때 씁니다 (대충이라도)" : ""}><input value=${f.car_name || ""} placeholder="예: 그랜저 IG 2.5" onInput=${e => set("car_name", e.target.value)} /><//>
    <${Field} label="금액" req hint=${a ? "= " + 원(a) : "1311만 · 13,110,000 · 15000원 다 됩니다"}><input value=${f.amountText ?? ""} onInput=${e => set("amountText", e.target.value)} /><//>
    <${Field} label="은행"><input value=${f.bank || ""} placeholder="우리은행" onInput=${e => set("bank", e.target.value)} /><//>
    <${Field} label="계좌번호"><input inputmode="numeric" value=${f.account || ""} onInput=${e => set("account", e.target.value)} /><//>
    <${Field} label="예금주" req hint="금액 + 예금주가 맞는 출금이 통장에 들어오면 자동으로 완료됩니다"><input value=${f.payee || ""} placeholder="(주)피알앤디컴퍼니 / 엔카닷컴 / 홍길동" onInput=${e => set("payee", e.target.value)} /><//>
    <${Field} label="받는 쪽" req><${Seg} value=${받는쪽(f)} onChange=${v => set("payee_type", v)} options=${받는쪽들} /><//>
    ${사업자(받는쪽(f)) && html`<${Field} label="계산서 발행" req hint="세금계산서·계산서를 받을 수 있는지 (부가세 공제·증빙)">
      <${Seg} value=${f.invoice || ""} onChange=${v => set("invoice", v)} options=${계산서들} /><//>`}
    <${Field} label="기한"><input value=${f.due || ""} placeholder="예: 10/19 10:30 탁송 출발" onInput=${e => set("due", e.target.value)} /><//>
    ${f.kind === "매입대금" && html`<${Field} label="고객 성함·주민번호"><input value=${f.customer || ""} onInput=${e => set("customer", e.target.value)} /><//>`}
  </div>`;
}
/** 차 값은 10만원 미만일 리 없다 — '3050'·'100' 처럼 만원 단위로 적은 것 */
const 만원보정 = n => n && n < 100000 ? n * 10000 : n;
const 매도금액 = t => 만원보정(금액(t ?? "") ?? (Number(String(t || "").replace(/[^\d]/g, "")) || null));
function 매도칸({ f, set }) {
  const a = 매도금액(f.amountText), dp = 만원보정(금액(f.depositText ?? ""));
  return html`<div class="fgrid">
    <${Field} label="매도형태"><${Seg} value=${f.type || ""} onChange=${v => set("type", v)} options=${매도형태들} /><//>
    <${Field} label="차량번호" req><input value=${f.plate || ""} placeholder="예: 102조9178" onInput=${e => set("plate", e.target.value)} /><//>
    <${Field} label="차명" req hint="대충이라도 (예: 미니쿠퍼)"><input value=${f.car_name || ""} onInput=${e => set("car_name", e.target.value)} /><//>
    <${Field} label="구매자 이름" hint="계약금·잔금 입금을 통장에서 찾는 데 씁니다"><input value=${f.buyer || ""} onInput=${e => set("buyer", e.target.value)} /><//>
    <${Field} label="구매자 전화"><input inputmode="tel" value=${f.phone || ""} onInput=${e => set("phone", e.target.value)} /><//>
    <${Field} label="매도 금액" req hint=${a ? "= " + 원(a) : ""}><input value=${f.amountText ?? ""} placeholder="3050만" onInput=${e => set("amountText", e.target.value)} /><//>
    <${Field} label="매도비" req><${Seg} value=${f.fee_included === true ? "포함" : f.fee_included === false ? "별도" : ""} onChange=${v => set("fee_included", v === "포함")} options=${["별도", "포함"]} /><//>
    <${Field} label="계약금" hint=${dp ? "= " + 원(dp) + " (받고 올리면 '잔금 대기')" : "한 번에 결제면 비워 두세요 ('입금 대기')"}><input value=${f.depositText ?? ""} placeholder="100만" onInput=${e => set("depositText", e.target.value)} /><//>
    <${Field} label="계약금 받은 날짜·시간"><input value=${f.deposit_when || ""} placeholder="10/13 14:00" onInput=${e => set("deposit_when", e.target.value)} /><//>
  </div>`;
}
/** 매도정보 제목은 쓰지 않고 칸에서 짓는다: 차번호 차명 매도 */
const 매도제목 = form => [form.plate, form.car_name, "매도"].filter(Boolean).join(" ");
/** 화면용 칸 값(문자) → 저장할 form */
function 양식정리(cat, f) {
  if (cat === "송금요청") {
    const amount = 금액(f.amountText ?? "") ?? (Number(String(f.amountText || "").replace(/[^\d]/g, "")) || null);
    return { kind: f.kind || "업무비", route: f.kind === "업무비" ? null : f.route || null, plate: 번호판(f.plate) || 번호(f.plate) || null, bank: f.bank || null,
      account: f.account || null, payee: (f.payee || "").trim() || null, payee_type: 받는쪽(f) || null, invoice: 사업자(받는쪽(f)) ? f.invoice || null : null,
      car_name: (f.car_name || "").trim() || null, handler: f.handler === "대표" ? "대표" : "사무장", handler_id: f.handler_id || null,
      amount, due: f.due || null, customer: f.customer || null, memo: f.memo || null, paste: f.paste || null };
  }
  if (cat === "매도정보") {
    const amount = 매도금액(f.amountText);
    const dt = (f.depositText ?? "").trim();
    return { type: f.type || null, plate: 번호판(f.plate) || 번호(f.plate) || null, car_name: f.car_name || null, buyer: f.buyer || null, phone: f.phone || null,
      amount, fee_included: f.fee_included ?? null, deposit: !dt ? null : /없음/.test(dt) ? 0 : 만원보정(금액(dt)), deposit_when: f.deposit_when || null, memo: f.memo || null };
  }
  return null;
}
/** 저장된 form → 화면용 칸 값 */
const 칸으로 = form => form ? { ...form, amountText: form.amount ? (form.amount % 10000 === 0 ? form.amount / 10000 + "만" : String(form.amount)) : "",
  depositText: form.deposit === 0 ? "없음" : form.deposit ? (form.deposit % 10000 === 0 ? form.deposit / 10000 + "만" : String(form.deposit)) : "" } : {};

/* ───────── 글쓰기 ───────── */
const 임시키 = app => "board-draft:" + app.user.id;
function Write({ app }) {
  const 처음 = (() => { const v = 보기기억.get(); return 이름[v] && v !== "공지" ? v : "자유"; })();
  const [cat, setCat] = useState(처음);
  const [t, setT] = useState({ title: "", body: "", pinned: false, plate: "" });
  const [f, setF] = useState({ kind: "매입대금", route: "", amountText: "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [복원, set복원] = useState(false);
  // 임시저장: 쓰는 대로 이 기기에 남겨 두고, 다시 열면 불러온다 (첨부 파일은 남지 않음)
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(임시키(app)) || "null"); if (s && (s.t?.title || s.t?.body || s.f?.amountText || s.f?.paste)) { setCat(s.cat); setT(s.t); setF(s.f); set복원(true); } } catch {}
  }, []);
  useEffect(() => { const h = setTimeout(() => { try { localStorage.setItem(임시키(app), JSON.stringify({ cat, t, f })); } catch {} }, 400); return () => clearTimeout(h); }, [cat, t, f]);
  const 버리기 = () => { try { localStorage.removeItem(임시키(app)); } catch {} setT({ title: "", body: "", pinned: false, plate: "" }); setF({ kind: "매입대금", route: "", amountText: "" }); set복원(false); };
  const setx = (k, v) => setT(x => ({ ...x, [k]: v }));
  const setf = (k, v) => setF(x => ({ ...x, [k]: v }));
  const 붙여넣은알림 = text => {       // 엔카·헤이딜러 알림을 붙여넣으면 칸이 채워진다
    const r = 송금읽기(text, { author: app.profile.name });
    setF(x => ({ ...x, paste: text, kind: r.kind, route: r.route || "", plate: r.plate || x.plate, bank: r.bank || "", account: r.account || "", payee: r.payee || "",
      amountText: r.amount ? (r.amount % 10000 === 0 ? r.amount / 10000 + "만" : String(r.amount)) : x.amountText, due: r.due || "", customer: r.customer || "" }));
  };
  const 추가 = list => { const arr = [...(list || [])]; if (arr.length) setFiles(x => [...x, ...arr]); };
  const 붙여넣기 = e => {
    const fs = [...(e.clipboardData?.files || [])];
    if (!fs.length) return;
    e.preventDefault();
    추가(fs.map((x, i) => /^image\.(png|jpe?g)$/i.test(x.name) ? new File([x], `캡처_${Date.now()}_${i + 1}.${x.name.split(".").pop()}`, { type: x.type }) : x));
  };
  const 등록증 = !!CAR_KIND[cat], 양식 = cat === "송금요청" || cat === "매도정보";
  const save = async () => {
    if (busy) return;
    const form = 양식정리(cat, { ...f, memo: t.body.trim() || null });
    if (cat === "송금요청" && 송금확인(form)) return toast(송금확인(form), "err");
    if (cat === "송금요청" && !form.payee) { if (!ask("예금주가 비어 있으면 통장에서 자동으로 찾지 못합니다. 그래도 올릴까요?")) return; }
    if (cat === "매도정보" && !form.plate) return toast("차량번호를 입력하세요", "err");
    if (cat === "매도정보" && !form.car_name) return toast("차명을 입력하세요 (대충이라도)", "err");
    if (cat === "매도정보" && !form.amount) return toast("매도 금액을 입력하세요", "err");
    if (cat === "매도정보" && form.fee_included == null) return toast("매도비 별도·포함을 고르세요", "err");
    const plate = 양식 ? form.plate : 번호판(t.plate) || 번호(t.plate);     // '33우4535말리부' 처럼 차명을 붙여 써도 번호판만
    if (등록증 && !plate) return toast("등록증은 차량번호를 입력하세요", "err");
    const title = cat === "매도정보" ? 매도제목(form) : t.title.trim() || (cat === "송금요청" ? `${form.plate || ""}${form.car_name ? " " + form.car_name : ""} ${form.kind}${form.route ? `(${form.route})` : ""} ${form.amount % 10000 === 0 ? form.amount / 10000 + "만원" : 원(form.amount)}`.trim()
      : 등록증 ? `${plate} ${이름[cat]}` : "");
    if (!title) return toast("제목을 입력하세요", "err");
    const body = cat === "송금요청" ? (form.paste || 송금글(form, form.memo || "")) : cat === "매도정보" ? 매도글(form, form.memo || "") : t.body;
    const 예약 = t.publish ? new Date(t.publish).toISOString() : null;
    if (예약 && Date.parse(예약) < Date.now() - 60e3) return toast("예약 시각이 이미 지났습니다", "err");
    const 차 = cat === "송금요청" && form.kind === "매입대금";      // 차대금: 알림·재촉은 서버(tick)가 — 받는 사람 근무시간(근태 → 관리 → 사람마다 근무시간), [확인]까지
    setBusy(true);
    await run(async () => {
      const 올릴 = await 모두줄이기(files);
      if (올릴.some(x => x.size > MAX)) throw new Error("20MB 넘는 파일은 올릴 수 없습니다.");
      const car = plate ? await 차찾기(app, plate) : null;
      if (cat === "송금요청") await 담당정리(app, form);
      const [p] = await q(app.db.from("board_posts").insert({ category: cat, title, body, plate: plate || null, car_id: car?.id || null,
        pinned: !!t.pinned, author_name: app.profile.name, form, publish_at: 예약,
        notified_at: 예약 || 차 ? null : new Date().toISOString(), due_at: cat === "송금요청" ? 기한시각(form.due) : null }).select("id"));
      for (const x of 올릴) {
        const path = `board/${p.id}/${저장이름(x.name)}`;
        const { error } = await bucket(app).upload(path, x, { contentType: x.type, upsert: false });
        if (error) throw new Error(error.message);
        await q(app.db.from("board_files").insert({ post_id: p.id, name: x.name, path, size: x.size, mime: x.type || null }));
        if (car && 등록증) await q(app.db.from("car_files").insert({ car_id: car.id, kind: CAR_KIND[cat], name: x.name, path, size: x.size, mime: x.type || null }));
      }
      try { localStorage.removeItem(임시키(app)); } catch {}
      if (!예약 && !차) await 알림(app, { title: `[${이름[cat]}] ${title}`, body: `${app.profile.name}${cat === "송금요청" && form.amount ? " · " + 원(form.amount) + (form.payee ? " → " + form.payee : "") : t.body ? " · " + t.body.trim().slice(0, 80) : ""}`,
        url: "/office/#/board/" + p.id, tag: "board-" + p.id, exclude_self: true, pref: "board:" + cat });
      if (예약) toast(`${날짜시각(예약)}에 올라가고 그때 알림이 갑니다.`);
      else if (차) toast("사무장님께 알림이 갑니다 — [확인]을 누를 때까지 재촉 (사무장 근무시간에만)");
      if (cat === "송금요청") {       // 이미 나간 돈이면 바로 짝지어 완료
        const { data } = await app.db.rpc("board_match_payments");
        if ((data || []).some(x => x.post_id === p.id)) toast("통장에 이미 나간 출금이 있어 '통장 확인'으로 완료했습니다.");
      }
      if (cat === "매도정보") {       // 이미 들어온 입금(계약금 등)을 붙이고, 다 들어왔으면 바로 완료
        const { data } = await app.db.rpc("board_match_sales");
        const m = (data || []).find(x => x.post_id === p.id);
        if (m) toast(m.done_now ? "통장에 이미 다 들어와 '잔금 완료'로 표시했습니다." : `통장에서 입금 ${원(m.received)}을 찾아 붙였습니다.`);
      }
      if (등록증 && plate && !car) toast(`${plate} 차를 업무관리에서 못 찾아, 게시판에만 올렸습니다.`, "err");
      else if (car && 등록증 && 올릴.length) toast(`${car.plate} 차 첨부서류에도 붙였습니다.`);
      보기기억.set(cat); go("/board/" + p.id);
    });
    setBusy(false);
  };
  return html`<div class="bar"><a href="#/board">← 게시판</a><span class="grow"></span>
      <span class="muted small">쓰는 내용은 이 기기에 임시저장됩니다</span></div>
    <div class="card" onPaste=${붙여넣기} onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop=${e => { e.preventDefault(); setDrag(false); 추가(e.dataTransfer?.files); }}>
      ${복원 && html`<p class="note">임시저장된 글을 불러왔습니다. <button class="linkbtn" onClick=${버리기}>버리고 새로 쓰기</button></p>`}
      <div class="fgrid">
        <${Field} label="게시판"><${Select} value=${cat} onChange=${setCat} options=${BOARDS.map(b => [b[0], `${b[2]} ${b[1]}`])} /><//>
        <${Field} label="필독"><span class=${"toggle" + (t.pinned ? " on" : "")} style="min-height:38px" onClick=${e => { e.preventDefault(); setx("pinned", !t.pinned); }}><i></i>목록 맨 위에 고정</span><//>
        <${Field} label="예약 게시 (선택)" hint=${t.publish ? "이 시각에 올라가고 그때 알림이 갑니다" : "비우면 바로 올라갑니다"}>
          <input type="datetime-local" value=${t.publish || ""} onInput=${e => setx("publish", e.target.value)} /><//>
      </div>
      ${cat !== "매도정보" && html`<${Field} label="제목" wide hint=${양식 || 등록증 ? "비워 두면 자동으로 지어집니다" : ""}><input value=${t.title} onInput=${e => setx("title", e.target.value)} /><//>`}
      ${cat === "송금요청" && html`<div class="tpl" style="max-width:none">
        <div class="tg">📄 템플릿 · 송금요청</div>
        <${Field} label="📋 알림 붙여넣기 (엔카·헤이딜러 문자를 그대로)" wide hint="붙여넣으면 아래 칸이 자동으로 채워집니다 · 직접 적어도 됩니다">
          <textarea rows="4" value=${f.paste || ""} placeholder="[ 차대금 입금 요청 ] …" onInput=${e => 붙여넣은알림(e.target.value)}></textarea><//>
        <${송금칸} f=${f} set=${setf} /></div>`}
      ${cat === "매도정보" && html`<div class="tpl" style="max-width:none"><div class="tg">📄 템플릿 · 매도정보</div><${매도칸} f=${f} set=${setf} /></div>`}
      ${등록증 && html`<${Field} label="차량번호" req hint="이 차의 첨부서류에도 사진이 붙습니다"><input value=${t.plate} placeholder="예: 54다8079" onInput=${e => setx("plate", e.target.value)} /><//>`}
      <${Field} label=${양식 ? "메모" : "내용"} wide><textarea rows=${양식 ? 2 : 6} value=${t.body} onInput=${e => setx("body", e.target.value)}></textarea><//>
      <div class="field wide"><span class="lab">사진·파일</span>
        <label class=${"dropzone" + (drag ? " on" : "")}>
          ${drag ? "여기에 놓으세요" : "여기로 끌어다 놓거나 눌러서 고르세요 · 캡처 화면은 Ctrl+V · 사진은 자동으로 줄여서 올립니다"}
          <input type="file" hidden multiple accept="image/*,.pdf,.hwp,.xlsx,.xls,.doc,.docx" onChange=${e => { 추가(e.target.files); e.target.value = ""; }} /></label>
        ${files.length > 0 && html`<div class="chips" style="margin-top:6px">${files.map((x, i) => html`<span class="chip" key=${i + x.name}>
          ${/^image\//.test(x.type) ? "🖼" : "📎"} ${x.name} <span class="muted small">${x.size > 1048576 ? (x.size / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(x.size / 1024)) + "KB"}</span>
          <button type="button" title="빼기" style="border:0;background:none;cursor:pointer;padding:0 0 0 4px;font:inherit" onClick=${() => setFiles(files.filter((_, j) => j !== i))}>✕</button></span>`)}</div>`}
      </div>
      <div class="bar"><span class="grow"></span><button class="btn ghost" onClick=${() => go("/board")}>취소</button>
        <button class="btn primary" disabled=${busy} onClick=${save}>${busy ? "올리는 중…" : "등록"}</button></div>
    </div>`;
}

/* ───────── 글 보기 ───────── */
function 송금카드({ f, p }) {
  const 복사 = () => run(async () => { await navigator.clipboard.writeText(String(f.account || "").replace(/[^\d-]/g, "")); }, "계좌번호를 복사했습니다");
  return html`<div class="tpl"><div class="tg">📄 송금요청 · ${f.kind || "-"}${f.route ? " · " + f.route : ""}</div>
    <div class="f"><b>금액</b><div><span class="big">${f.amount ? 원(f.amount) : "-"}</span></div></div>
    <div class="f"><b>받는 곳</b><div>${[f.bank, f.account, f.payee].filter(Boolean).join(" · ") || "-"}
      ${f.account && html`<button class="btn sm ghost" onClick=${복사}>계좌 복사</button>`}</div></div>
    ${f.payee_type && html`<div class="f"><b>받는 쪽</b><div>${f.payee_type}${사업자(f.payee_type) && html` · 계산서 <span class=${"badge " + (f.invoice === "발행 가능" ? "green" : f.invoice === "발행 안 됨" ? "red" : "amber")}>${f.invoice || "확인 안 함"}</span>`}</div></div>`}
    ${f.plate && html`<div class="f"><b>차량</b><div>${f.plate} ${p.car_id && html`<a href=${"#/car/" + p.car_id}>차 보기 →</a>`}</div></div>`}
    ${f.due && html`<div class="f"><b>기한</b><div>${f.due}</div></div>`}
    ${f.customer && html`<div class="f"><b>고객</b><div>${f.customer}</div></div>`}
    ${f.memo && html`<div class="f"><b>메모</b><div style="white-space:pre-wrap">${f.memo}</div></div>`}
  </div>`;
}
function 매도카드({ f, p }) {
  return html`<div class="tpl"><div class="tg">📄 매도정보</div>
    <div class="f"><b>매도형태</b><div>${f.type || "-"}</div></div>
    <div class="f"><b>차량</b><div>${[f.plate, f.car_name].filter(Boolean).join(" ") || "-"} ${p.car_id && html`<a href=${"#/car/" + p.car_id}>차 보기 →</a>`}</div></div>
    <div class="f"><b>구매자</b><div>${f.buyer || "-"} ${f.phone && html`<a href=${"tel:" + f.phone.replace(/[^\d]/g, "")}>📞 ${f.phone}</a>`}</div></div>
    <div class="f"><b>매도 금액</b><div><span class="big">${f.amount ? 원(f.amount) : "-"}</span>${f.fee_included != null && html`<span class="muted">매도비 ${f.fee_included ? "포함" : "별도"}</span>`}</div></div>
    <div class="f"><b>계약금</b><div>${f.deposit === 0 ? "없음" : [f.deposit_when, f.deposit ? 원(f.deposit) : ""].filter(Boolean).join(" · ") || "-"}</div></div>
    ${f.memo && html`<div class="f"><b>메모</b><div style="white-space:pre-wrap">${f.memo}</div></div>`}
  </div>`;
}

/* 첨부 저장·공유 (폰: 공유창으로 카톡 등에 바로, 저장은 파일로 내려받기) — 서명 주소에서 받아 원래 파일 이름으로 */
const 공유됨 = typeof navigator !== "undefined" && !!navigator.canShare && (() => { try { return navigator.canShare({ files: [new File(["x"], "x.png", { type: "image/png" })] }); } catch { return false; } })();
async function 받기(f, url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("파일을 받지 못했습니다. 새로고침 후 다시 눌러 주세요.");
  const b = await r.blob();
  return new File([b], f.name, { type: f.mime || b.type || "application/octet-stream" });
}
const 첨부저장 = (f, url) => run(async () => {
  const file = await 받기(f, url), a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: f.name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
const 첨부공유 = (list, title) => run(async () => {
  const files = await Promise.all(list.map(([f, url]) => 받기(f, url)));
  try { await navigator.share({ files, title }); }
  catch (e) { if (e?.name !== "AbortError") throw new Error("공유하지 못했습니다. [저장]으로 내려받아 보내 주세요."); }
});
function 첨부버튼({ f, url }) {
  if (!url) return "";
  return html`<span class="row" style="gap:6px;margin-top:4px">
    <button class="btn sm ghost" onClick=${() => 첨부저장(f, url)}>⬇️ 저장</button>
    ${공유됨 && html`<button class="btn sm ghost" onClick=${() => 첨부공유([[f, url]], f.name)}>📤 공유</button>`}</span>`;
}

/** 매도정보 진행: 계약금 받고 올린 글은 잔금 대기, 계약금 없으면 입금 대기 → 통장에 다 들어오면(DB board_match_sales) 잔금 완료 */
function 잔금줄({ p, ins, 완료 }) {
  const f = p.form, 받음 = ins.reduce((a, t) => a + Number(t.deposit), 0), 계약 = Number(f.deposit) || 0;
  const 계약금보임 = 계약 > 0 && ins.some(t => Number(t.deposit) === 계약);
  const 남음 = Math.max(0, f.amount - 받음 - (계약 > 0 && !계약금보임 ? 계약 : 0));
  const 입금들 = ins.length > 0 && html`<div class="small" style="width:100%;margin-top:4px">${ins.map(t => html`<div>· ${t.tx_date.slice(5).replace("-", "/")} ${t.tx_time || ""} ${t.counterparty || ""} <b>${원(t.deposit)}</b> 입금</div>`)}</div>`;
  if (p.done_at) return html`<div class="bank-ok" style="flex-wrap:wrap">✔ <b>잔금 완료</b> <span class="muted small">${p.done_by || ""} · ${날짜시각(p.done_at)}${받음 ? ` · 통장 입금 ${원(받음)}` : ""}</span><span class="grow"></span>
    <button class="btn sm ghost" onClick=${() => ask("잔금 완료를 취소할까요?") && 완료(false)}>완료 취소</button>${입금들}</div>`;
  return html`<div class="bank-ok bank-wait" style="flex-wrap:wrap">⏳ <b>${계약 > 0 ? "잔금 대기" : "입금 대기"}</b>
    <span class="small">매도 ${원(f.amount)}${계약 > 0 ? ` · 계약금 ${원(계약)}` : ""}${받음 ? ` · 통장 입금 ${원(받음)}` : ""} · <b>남은 ${원(남음)}</b></span>
    <span class="grow"></span><button class="btn sm primary" onClick=${() => 완료(true)}>✔ 잔금 완료</button>
    <div class="muted small" style="width:100%">구매자 이름(또는 번호판·캐피탈)으로 다 들어오면 자동으로 완료 · 댓글 '입완'으로도 완료</div>${입금들}</div>`;
}

function Post({ app, id }) {
  const me = app.user.id;
  const [p, setP] = useState(undefined);
  const [x, setX] = useState({ files: [], urls: {}, cs: [], reads: [], rx: [], star: false, tx: null, ids: [], members: [] });
  const [c, setC] = useState("");
  const [edit, setEdit] = useState(null);
  const [readers, setReaders] = useState(false);
  const load = () => run(async () => {
    const [[post], fl, cm, rd, rx, st, tx, members] = await Promise.all([
      q(app.db.from("board_posts").select("*").eq("id", id)),
      q(app.db.from("board_files").select("*").eq("post_id", id).order("created_at")),
      q(app.db.from("board_comments").select("*").eq("post_id", id).order("created_at")),
      q(app.db.from("board_reads").select("user_id, read_at, seed").eq("post_id", id)),
      q(app.db.from("board_reactions").select("user_id, emoji, name").eq("post_id", id)),
      q(app.db.from("board_stars").select("post_id").eq("post_id", id)),
      q(app.db.from("bank_txs").select("tx_date, tx_time, deposit, withdraw, counterparty, match_kind").eq("post_id", id).order("tx_date").order("tx_time")),
      구성원(app),
    ]);
    setP(post || null);
    if (!post) return;
    const ids = (await 전부(() => app.db.from("board_posts").select("id").eq("category", post.category).order("created_at", { ascending: false }))).map(r => r.id);
    const urls = {};
    if (fl.length) {
      const { data } = await bucket(app).createSignedUrls(fl.map(f => f.path), 600);
      (data || []).forEach((d, i) => { if (d.signedUrl) urls[fl[i].id] = d.signedUrl; });
    }
    setX({ files: fl, urls, cs: cm, reads: rd, rx, star: st.length > 0, tx: tx.find(t => t.withdraw > 0) || null, ins: tx.filter(t => t.deposit > 0), ids, members });
  });
  useEffect(() => {
    setP(undefined); setEdit(null); setReaders(false);
    // 읽음 기록 (처음 한 번)
    app.db.from("board_reads").upsert({ post_id: id }, { onConflict: "post_id,user_id", ignoreDuplicates: true }).then(() => load());
  }, [id]);
  useEffect(() => {      // 송금요청인데 통장 짝이 아직이면 한 번 찾아 본다
    if (p?.category === "송금요청" && !x.tx && p.form?.amount) app.db.rpc("board_match_payments").then(({ data }) => { if ((data || []).some(m => m.post_id === id)) load(); });
    if (p?.category === "매도정보" && !p.done_at && p.form?.amount) app.db.rpc("board_match_sales").then(({ data }) => { if ((data || []).some(m => m.post_id === id)) load(); });
  }, [p?.id]);
  if (p === undefined) return html`<${Loading} />`;
  if (!p) return html`<${Empty}>지워졌거나 없는 글입니다. <a href="#/board">목록으로</a><//>`;

  const 송금 = p.category === "송금요청";
  const 매도 = p.category === "매도정보", 완료이름 = 매도 ? "잔금 완료" : "송금 완료";
  const 관계자 = () => [p.created_by, ...x.cs.map(k => k.created_by)].filter(Boolean);
  const url = "/office/#/board/" + id;
  const i = x.ids.indexOf(id), 앞 = i > 0 ? x.ids[i - 1] : null, 뒤 = i >= 0 && i < x.ids.length - 1 ? x.ids[i + 1] : null;
  const 읽은 = x.reads.filter(r => !r.seed);
  const 안읽은 = x.members.filter(m => m.user_id !== p.created_by && !x.reads.some(r => r.user_id === m.user_id));
  // 조르기 받을 사람: 대표 담당이면 그 대표, 아니면 사무장(staff). 나 자신은 빼고
  const 조를사람 = (대표담당(p.form) ? x.members.filter(m => m.user_id === p.form.handler_id) : x.members.filter(m => m.role === "staff")).filter(m => m.user_id !== me);

  const addC = () => run(async () => {
    const body = c.trim();
    if (!body) return;
    await q(app.db.from("board_comments").insert({ post_id: id, body, author_name: app.profile.name }));
    const 완료됨 = (송금 || 매도) && !p.done_at && 완료말.test(body);
    if (완료됨) await q(app.db.rpc("board_mark_done", { p_id: id, p_done: true }));
    await 알림(app, { title: 완료됨 ? `✔ ${완료이름}: ${p.title}` : `💬 ${p.title}`, body: `${app.profile.name}: ${body.slice(0, 100)}`, url, tag: "board-c-" + id, to_users: 관계자() });
    setC(""); load();
  });
  const 완료 = v => run(async () => {
    await q(app.db.rpc("board_mark_done", { p_id: id, p_done: v }));
    if (v) await 알림(app, { title: `✔ ${완료이름}: ${p.title}`, body: `${app.profile.name} 처리`, url, tag: "board-c-" + id, to_users: 관계자() });
    load();
  }, v ? "완료로 표시했습니다" : "완료를 취소했습니다");
  const 확인 = () => run(async () => { await q(app.db.rpc("board_ack", { p_id: id })); load(); }, "확인했습니다 — 재촉 알림이 멈춥니다");
  // 🔔 조르기 (사용자 2026-10-21): 사무장님 폰으로 바로 알림 + 댓글로 남김. 3분 안 다시 누르면 안 보냄, 근무시간 밖이면 한 번 묻기
  const 조르기 = () => run(async () => {
    const 최근 = x.cs.filter(k => /^🔔 조르기/.test(k.body)).map(k => Date.parse(k.created_at)).sort().pop();
    if (최근 && Date.now() - 최근 < 3 * 60e3) throw new Error("방금 졸랐습니다. 3분 뒤에 다시 눌러 주세요");
    const 받을 = 조를사람;
    if (!받을.length) throw new Error("알림 받을 담당자가 없습니다");
    if (!대표담당(p.form)) {  // 대표 담당이면 시간 상관없이
      const 시간 = await q(app.db.from("att_people").select("user_id,start_time,end_time").in("user_id", 받을.map(m => m.user_id)));
      const k = new Date(Date.now() + 9 * 3600e3), hm = k.toISOString().slice(11, 16), 평일 = k.getUTCDay() >= 1 && k.getUTCDay() <= 5;
      const 근무중 = 받을.some(m => { const s = 시간.find(t => t.user_id === m.user_id); return 평일 && hm >= (s?.start_time || "09:00").slice(0, 5) && hm < (s?.end_time || "19:00").slice(0, 5); });
      if (!근무중 && !ask("사무장님 근무시간이 아닙니다. 그래도 알림을 보낼까요?")) return;
    }
    const f = p.form || {};
    await 알림(app, { title: `💸 ${대표담당(f) ? "대표님" : "사무장님"} 송금해주세요~`, body: `${p.title}${f.amount ? " · " + 원(f.amount) : ""}${f.payee ? " → " + f.payee : ""} (${app.profile.name})`,
      url, tag: "nudge-" + id + "-" + Date.now(), to_users: 받을.map(m => m.user_id), pref: "board:송금요청" });
    await q(app.db.from("board_comments").insert({ post_id: id, body: `🔔 조르기 — ${받을.map(m => m.name).join(", ")}님께 알림`, author_name: app.profile.name }));
    load(); toast(`${받을.map(m => m.name).join(", ")}님께 알림을 보냈습니다`);
  });
  const 별 = () => run(async () => {
    if (x.star) await q(app.db.from("board_stars").delete().eq("post_id", id).eq("user_id", me));
    else await q(app.db.from("board_stars").insert({ post_id: id }));
    load();
  });
  const 리액션 = e => run(async () => {
    if (x.rx.some(r => r.user_id === me && r.emoji === e)) await q(app.db.from("board_reactions").delete().eq("post_id", id).eq("user_id", me).eq("emoji", e));
    else await q(app.db.from("board_reactions").insert({ post_id: id, emoji: e, name: app.profile.name }));
    load();
  });
  const delC = k => ask("이 댓글을 지울까요?") && run(async () => { await q(app.db.from("board_comments").delete().eq("id", k.id)); load(); });
  const saveEdit = () => run(async () => {
    const 양식 = 송금 || p.category === "매도정보";
    const form = 양식 ? 양식정리(p.category, { ...edit.f, memo: edit.f.memo || null }) : p.form;
    if (매도 && (!form.plate || !form.car_name || !form.amount || form.fee_included == null)) throw new Error("차량번호·차명·매도 금액·매도비(별도/포함)는 꼭 넣어 주세요");
    if (송금 && 송금확인(form)) throw new Error(송금확인(form));
    if (송금) await 담당정리(app, form);
    const body = 송금 ? (form.paste || 송금글(form, form.memo || "")) : p.category === "매도정보" ? 매도글(form, form.memo || "") : edit.body;
    const 기한 = 송금 ? 기한시각(form.due) : null;
    await q(app.db.from("board_posts").update({ title: p.category === "매도정보" ? 매도제목(form) : edit.title.trim() || p.title, body, form, plate: 양식 ? form.plate : p.plate, updated_at: new Date().toISOString(),
      ...(송금 ? { due_at: 기한, ...(기한 !== p.due_at ? { due_warned_at: null } : {}) } : {}) }).eq("id", id));
    setEdit(null); load();
  }, "고쳤습니다");
  const del = () => ask("이 글을 지울까요? 첨부도 함께 지워집니다. (차에 붙인 등록증은 그대로 남습니다)") && run(async () => {
    const paths = x.files.map(f => f.path);
    const keep = paths.length ? (await q(app.db.from("car_files").select("path").in("path", paths))).map(f => f.path) : [];
    const gone = paths.filter(f => !keep.includes(f));
    if (gone.length) await bucket(app).remove(gone);
    await q(app.db.from("board_posts").delete().eq("id", id));
    go("/board");
  }, "지웠습니다");
  const imgs = x.files.filter(f => /^image\//.test(f.mime || "") && x.urls[f.id]), etc = x.files.filter(f => !imgs.includes(f));
  const 양식 = (송금 || p.category === "매도정보") && p.form;

  return html`<div class="card bd-post">
    <div class="bar"><a class="crumb" href="#/board" onClick=${() => 보기기억.set(p.category)}>${아이콘[p.category]} ${이름[p.category]}</a><span class="grow"></span>
      <button class="btn sm" onClick=${() => { 보기기억.set(p.category); go("/board"); }}>목록</button>
      <button class="btn sm" disabled=${!앞} title="이전 글(최신 쪽)" onClick=${() => go("/board/" + 앞)}>▲</button>
      <button class="btn sm" disabled=${!뒤} title="다음 글" onClick=${() => go("/board/" + 뒤)}>▼</button></div>
    <h1>${p.pinned ? "📌 " : ""}${p.title} <button class="linkbtn" style="font-size:22px;color:#f59e0b" title="중요" onClick=${별}>${x.star ? "★" : "☆"}</button></h1>
    <div class="bd-who" style="position:relative"><${Avatar} name=${p.author_name} size=${40} />
      <div><div class="nm">${p.author_name || "-"}</div>
        <div class="sm">${날짜시각(p.created_at)} · <button class="linkbtn" onClick=${() => setReaders(!readers)}>읽음 ${읽은.length}</button>${p.updated_at !== p.created_at ? " · 수정됨" : ""}</div></div>
      <span class="grow"></span>
      ${내것(app, p) && !edit && html`<button class="btn sm ghost" onClick=${() => setEdit({ title: p.title, body: p.body,
        f: { ...칸으로(p.form), paste: p.form?.paste || (송금 && p.src ? p.body : null) } })}>수정</button>`}
      ${내것(app, p) && html`<button class="btn sm danger" onClick=${del}>삭제</button>`}
      ${readers && html`<div class="pop" style="left:48px;top:44px">
        <div class="small muted">읽은 사람</div>${읽은.length ? 읽은.map(r => html`<div class="pr"><${Avatar} name=${이름표(x.members, r.user_id)} size=${22} />${이름표(x.members, r.user_id) || "?"} <span class="muted small">${언제(r.read_at)}</span></div>`) : html`<div class="pr muted">아직 없음</div>`}
        ${안읽은.length > 0 && html`<div class="small muted" style="margin-top:6px">안 읽은 사람</div>${안읽은.map(m => html`<div class="pr"><${Avatar} name=${m.name} size=${22} />${m.name}</div>`)}`}</div>`}
    </div>

    ${송금 && (x.tx ? html`<div class="bank-ok">✔ <b>통장 확인</b> ${x.tx.tx_date.slice(5).replace("-", "/")} ${x.tx.tx_time || ""} · ${x.tx.counterparty || ""} · ${원(x.tx.withdraw)} 출금
        <span class="muted small">(${x.tx.match_kind})</span><span class="grow"></span><a href="#/bank">자금관리 →</a></div>`
      : p.done_at ? html`<div class="bank-ok">✔ <b>송금 완료</b> <span class="muted small">${p.done_by || ""} · ${날짜시각(p.done_at)}</span><span class="grow"></span>
        <button class="btn sm ghost" onClick=${() => ask("송금 완료를 취소할까요?") && 완료(false)}>완료 취소</button></div>`
      : html`<div class="bank-ok bank-wait">⏳ <b>송금 대기</b>${대표담당(p.form) && html` <${Badge}>대표님 담당<//>`} <span class="muted small">금액·예금주가 맞는 출금이 통장에 들어오면 자동으로 완료 · 댓글 '입완'으로도 완료</span><span class="grow"></span>
        ${조를사람.length > 0 && html`<button class="btn sm" title=${(대표담당(p.form) ? "대표님" : "사무장님") + " 폰으로 바로 알림"} onClick=${조르기}>🔔 조르기</button>`}
        <button class="btn sm primary" onClick=${() => 완료(true)}>✔ 송금 완료</button></div>`)}
    ${송금 && p.form?.kind === "매입대금" && !p.done_at && html`<div class=${"bank-ok" + (p.ack_at ? "" : " bank-wait")}>${p.ack_at
      ? html`👀 <b>${p.ack_by || ""} 확인</b> <span class="muted small">${날짜시각(p.ack_at)} · 재촉 끝</span>`
      : 대표담당(p.form) ? html`🔔 <b>대표님 확인 전</b> <span class="muted small">[확인]을 누를 때까지 대표님께 재촉합니다 (시간 상관없이, 최대 3번)</span><span class="grow"></span>
        <button class="btn sm primary" onClick=${확인}>👀 확인했어요</button>`
      : html`🔔 <b>사무장 확인 전</b> <span class="muted small">[확인]을 누를 때까지 사무장 근무시간(평일 8:30~17:00)에 재촉합니다 (최대 3번)</span><span class="grow"></span>
        <button class="btn sm primary" onClick=${확인}>👀 확인했어요</button>`}</div>`}
    ${p.publish_at && Date.parse(p.publish_at) > Date.now() && html`<p class="note">🕒 ${날짜시각(p.publish_at)}에 올라가고 그때 알림이 갑니다. 지금은 쓴 사람과 대표만 보입니다.</p>`}
    ${매도 && p.form?.amount && html`<${잔금줄} p=${p} ins=${x.ins || []} 완료=${완료} />`}

    ${edit ? html`<div style="margin-top:14px">
        ${p.category !== "매도정보" && html`<${Field} label="제목" wide><input value=${edit.title} onInput=${e => setEdit({ ...edit, title: e.target.value })} /><//>`}
        ${송금 ? html`<${송금칸} f=${edit.f} set=${(k, v) => setEdit(s => ({ ...s, f: { ...s.f, [k]: v } }))} />`
          : p.category === "매도정보" ? html`<${매도칸} f=${edit.f} set=${(k, v) => setEdit(s => ({ ...s, f: { ...s.f, [k]: v } }))} />` : ""}
        <${Field} label=${양식 ? "메모" : "내용"} wide><textarea rows="5" value=${양식 ? edit.f.memo || "" : edit.body}
          onInput=${e => 양식 ? setEdit({ ...edit, f: { ...edit.f, memo: e.target.value } }) : setEdit({ ...edit, body: e.target.value })}></textarea><//>
        <div class="bar"><span class="grow"></span><button class="btn ghost" onClick=${() => setEdit(null)}>취소</button><button class="btn primary" onClick=${saveEdit}>저장</button></div></div>`
      : html`${양식 && (송금 ? html`<${송금카드} f=${p.form} p=${p} />` : html`<${매도카드} f=${p.form} p=${p} />`)}
        ${양식 ? (p.body && html`<details><summary class="small muted">원문 보기</summary><div class="bd-body">${p.body}</div></details>`) : p.body && html`<div class="bd-body">${p.body}</div>`}`}
    ${(m => m && html`<p><a class="btn primary sm" href=${"#/signs/" + m[1]}>📄 약정서 보기 (서명본)</a></p>`)(p.category === "3일환불제서류" && (p.body || "").match(/#\/signs\/([0-9a-f-]{36})/))}
    ${!양식 && p.plate && html`<p class="small">차량번호 <b>${p.plate}</b> ${p.car_id ? html`· <a href=${"#/car/" + p.car_id + "/files"}>차 첨부서류 보기 →</a>` : html`<span class="muted">· 업무관리에 없는 차</span>`}</p>`}
    ${imgs.length > 0 && html`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:12px">
      ${imgs.map(f => html`<div><a href=${x.urls[f.id]} target="_blank" rel="noopener"><img src=${x.urls[f.id]} alt=${f.name} style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid var(--line)" /></a>
        <${첨부버튼} f=${f} url=${x.urls[f.id]} /></div>`)}</div>`}
    ${etc.length > 0 && html`<ul class="todo" style="margin-top:10px">${etc.map(f => html`<li style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">📎 ${x.urls[f.id] ? html`<a href=${x.urls[f.id]} target="_blank" rel="noopener">${f.name}</a>` : f.name}
      <${첨부버튼} f=${f} url=${x.urls[f.id]} /></li>`)}</ul>`}
    ${x.files.length > 1 && 공유됨 && html`<div class="bar" style="margin-top:8px"><button class="btn sm" onClick=${() => 첨부공유(x.files.filter(f => x.urls[f.id]).map(f => [f, x.urls[f.id]]), p.title)}>📤 첨부 ${x.files.length}개 한꺼번에 공유</button></div>`}

    <div class="rx">${EMOJIS.map(e => { const who = x.rx.filter(r => r.emoji === e); const 나 = who.some(r => r.user_id === me);
      return html`<button class=${나 ? "on" : ""} title=${who.map(r => r.name).join(", ")} onClick=${() => 리액션(e)}>${e}${who.length ? " " + who.length : ""}</button>`; })}
      <span class="grow"></span><span class="muted small">💬 ${x.cs.length}</span></div>
    ${x.cs.map(k => html`<div class="cmt" key=${k.id}><${Avatar} name=${k.author_name} size=${32} />
      <div class="bx"><div class="hd"><b>${k.author_name}</b><span>${날짜시각(k.created_at)}</span></div><div class="tx">${k.body}</div></div>
      ${내것(app, k) && html`<button class="btn sm ghost" onClick=${() => delC(k)}>✕</button>`}</div>`)}
    <div class="row" style="margin-top:12px"><input value=${c} placeholder=${송금 && !p.done_at ? "댓글 쓰기 ('입완' 이라고 쓰면 송금 완료)" : 매도 && !p.done_at ? "댓글 쓰기 ('입완' 이라고 쓰면 잔금 완료)" : "댓글 쓰기"} onInput=${e => setC(e.target.value)}
      onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) addC(); }} /><button class="btn" onClick=${addC}>등록</button></div>
  </div>`;
}
