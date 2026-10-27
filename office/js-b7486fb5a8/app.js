import { html, render, useState, useEffect, AppCtx, Toasts, Loading, run, toast, ask } from "./ui.js";
import { 상태 as 알림상태, 켜기 as 알림켜기, 끄기 as 알림끄기 } from "./push.js";
import { getDb, q } from "./db.js";
import { DEMO } from "./config.js";
import { CarList } from "./pages/cars.js";
import { CarForm } from "./pages/car-form.js";
import { CarDetail } from "./pages/car-detail.js";
import { Settlements } from "./pages/settlements.js";
import { Settings } from "./pages/settings.js";
import { Dashboard } from "./pages/dashboard.js";
import { IssuePage } from "./pages/issue.js";
import { BankPage } from "./pages/bank.js";
import { BrokeragePage } from "./pages/brokerage.js";
import { LedgerPage } from "./pages/ledger.js";
import { ReportsPage } from "./pages/reports.js";
import { PurchasesPage, CostsPage, LoansPage, SalesPage } from "./pages/lists.js";
import { LenderEdit } from "./pages/lenders.js";
import { CarEntryPage } from "./pages/car-entry.js";
import { StatsPage } from "./pages/stats.js";
import { SignsPage } from "./pages/signs.js";
import { ReservePage } from "./pages/reserve.js";
import { ChecksPage, CheckEdit } from "./pages/checks.js";
import { BoardPage } from "./pages/board.js";
import { ContactsPage } from "./pages/contacts.js";
import { TodosPage } from "./pages/todos.js";
import { CalendarPage } from "./pages/calendar.js";
import { AttendancePage } from "./pages/attendance.js";
import { AttWorksPage } from "./pages/att-works.js";
import { MyPage } from "./pages/me.js";
import { Avatar, 사진기억, 구성원 } from "./people.js";
import { startSync } from "./check-store.js";

function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || "/");
  // 듣기 시작하는 순간 한 번 더 읽는다 — 첫 화면을 그린 뒤 듣기 전 사이에 주소가 바뀌면(로딩 중 메뉴 클릭 등) 그 변화를 놓쳤다
  useEffect(() => { const f = () => setH(location.hash.slice(1) || "/"); addEventListener("hashchange", f); f(); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

function Login({ db, onDone }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true);
    const { error } = await db.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) toast("로그인 실패: " + (error.message.includes("Invalid") ? "이메일 또는 비밀번호가 맞지 않습니다" : error.message), "err");
    else onDone();
  };
  return html`<div class="login">
    <form class="login-box" onSubmit=${submit}>
      <h1>TierONE 업무관리</h1>
      <p class="sub">공동대표·사무장 전용 · 로그인이 필요합니다</p>
      ${DEMO ? html`
        <div class="demo-note">데모 모드입니다. 데이터는 이 브라우저에만 저장됩니다.</div>
        <div class="demo-roles">
          ${[["admin", "공동대표로 입장"], ["staff", "사무장으로 입장"]].map(([r, l]) =>
            html`<button type="button" class="btn" onClick=${async () => { await db.auth.signInDemo(r); onDone(); }}>${l}</button>`)}
        </div>` : html`
        <input type="email" placeholder="이메일" autocomplete="username" required value=${email} onInput=${e => setEmail(e.target.value)} />
        <input type="password" placeholder="비밀번호" autocomplete="current-password" required value=${pw} onInput=${e => setPw(e.target.value)} />
        <button class="btn primary" disabled=${busy}>${busy ? "확인 중…" : "로그인"}</button>
        <p class="muted small">비밀번호를 잊으셨으면 대표에게 초기화를 요청하세요.</p>`}
    </form>
  </div>`;
}

/** 비밀번호 바꾸기 — 임시 비밀번호로 첫 로그인했을 때는 이 화면만 보인다 */
export function ChangePassword({ db, forced, onDone }) {
  const [a, setA] = useState(""), [b, setB] = useState(""), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (a.length < 8) return toast("8자 이상으로 정하세요.", "err");
    if (a !== b) return toast("두 번 입력한 비밀번호가 다릅니다.", "err");
    setBusy(true);
    const { error } = await db.auth.updateUser({ password: a, data: { must_change_password: false } });
    setBusy(false);
    if (error) return toast(/different|same/i.test(error.message) ? "지금 비밀번호와 다르게 정하세요." : error.message, "err");
    toast("비밀번호를 바꿨습니다"); onDone();
  };
  return html`<div class=${forced ? "login" : ""}>
    <form class=${forced ? "login-box" : "card form"} style=${forced ? "" : "max-width:420px"} onSubmit=${submit}>
      <h2>${forced ? "새 비밀번호 정하기" : "비밀번호 변경"}</h2>
      ${forced && html`<p class="sub">임시 비밀번호로 들어오셨습니다. 본인만 아는 비밀번호로 바꿔야 쓸 수 있습니다.</p>`}
      <input type="password" placeholder="새 비밀번호 (8자 이상)" autocomplete="new-password" value=${a} onInput=${e => setA(e.target.value)} />
      <input type="password" placeholder="한 번 더" autocomplete="new-password" value=${b} onInput=${e => setB(e.target.value)} />
      <button class="btn primary" disabled=${busy}>${busy ? "바꾸는 중…" : "바꾸기"}</button>
      ${forced && html`<button type="button" class="btn ghost" onClick=${async () => { await db.auth.signOut(); location.reload(); }}>로그아웃</button>`}
    </form></div>`;
}

/** 🔔 이 기기 폰 알림 켜기·끄기 (갤럭시: 허용만 / 아이폰: 홈 화면에 추가한 앱에서) */
function Bell({ app }) {
  const [st, setSt] = useState(null);
  useEffect(() => { 알림상태().then(setSt).catch(() => setSt("안됨")); }, []);
  if (!st || st === "안됨") return null;
  const click = () => run(async () => {
    if (st === "설치필요") return toast("아이폰은 사파리 공유 버튼 → '홈 화면에 추가'로 설치한 뒤, 설치된 업무관리 앱에서 🔔를 눌러 주세요.", "err");
    if (st === "차단") return toast("이 브라우저에서 알림이 막혀 있습니다. 주소창 왼쪽 자물쇠 → 권한 → 알림 → 허용으로 바꾼 뒤 다시 눌러 주세요.", "err");
    if (st === "켜짐") { if (ask("이 기기의 알림을 끌까요?")) { await 알림끄기(app); setSt("꺼짐"); toast("이 기기 알림을 껐습니다"); } return; }
    await 알림켜기(app); setSt("켜짐"); toast("알림을 켰습니다 — 곧 시험 알림이 옵니다");
  });
  return html`<button type="button" class=${"btn sm " + (st === "켜짐" ? "ghost" : "primary")} title="이 기기로 업무관리 알림 받기" onClick=${click}>${st === "켜짐" ? "🔔 알림 켜짐" : "🔕 알림 켜기"}</button>`;
}

function Shell({ app, children, path }) {
  const { profile, db } = app;
  const office = profile.role !== "dealer";
  const nav = office
    // 매도차량은 메뉴에서만 뺌 — 리스트의 '매도' 보기로 들어간다 (사용자 2026-10-22). 주소(#/sales)로는 그대로 열린다
    ? [["/purchases", "리스트"], ["/entry", "차량입력"], ["/loans", "재고금융"],
       ["/bank", "자금관리"], ["/board", "게시판"]]
    : [["/purchases", "내 제시차량"], ["/sales", "매도차량"], ["/settlements", "정산내역"], ["/brokerage", "알선"], ["/reports", "내 실적"]];
  // 펼침 메뉴 (화면은 그대로 있고 메뉴줄에서만 묶는다)
  //   업무: 웍스 대신 쓰는 것 (2026-10-20 테스트 → 정식, 게시판은 맨 위 메뉴로) / 기타: 지금 잘 안 쓰는 것 (사용자 2026-10-05)
  const groups = office ? [
    ["업무", [["/todos", "할 일"], ["/calendar", "일정"], ["/attendance", "근태 (시험)"], ["/att-works", "근태(웍스테스트)"], ["/contacts", "연락처"], ["/checks", "차량검수"]]],
    // 정산내역·매출관리·서류·타상사알선은 메뉴에서만 숨김 (사용자 2026-10-20) — 주소로는 그대로 열리고, 서류는 대시보드 '새 서류'·차 화면에서 들어간다
    // 종합업무현황·통계·환경설정도 기타로 (사용자 2026-10-22)
    ["기타", [["/reserve", "광고장 예약"], ["/reports", "종합업무현황"], ["/stats", "통계"], ["/settings", "환경설정"]]],
  ] : [];
  const 켜짐 = p => path.startsWith(p) || (p === "/checks" && path.startsWith("/check/"));
  const [menu, setMenu] = useState(null);         // 펼친 메뉴 { name, left, top } (메뉴줄이 가로 스크롤이라 밖에 띄운다)
  useEffect(() => { setMenu(null); }, [path]);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); addEventListener("click", close); addEventListener("scroll", close, true);
    return () => { removeEventListener("click", close); removeEventListener("scroll", close, true); }; }, [menu]);
  const 펼친 = menu && groups.find(([n]) => n === menu.name);
  return html`<div class="shell">
    <header class="top">
      <a class="brand" href="#/">TierONE <span>업무관리</span></a>
      <nav>${nav.map(([p, l]) => html`<a href=${"#" + p} class=${path.startsWith(p) || (p === "/purchases" && (path.startsWith("/car/") || path.startsWith("/cars"))) || (p === "/dashboard" && path === "/") ? "on" : ""}>${l}</a>`)}
        ${groups.map(([name, items]) => html`<a href="#" class=${items.some(([p]) => 켜짐(p)) ? "on" : ""} onClick=${e => { e.preventDefault(); e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.name === name ? null : { name, left: r.left, top: r.bottom + 4 }); }}>${name} ▾</a>`)}</nav>
      ${펼친 && html`<div class="etc-menu" style=${`left:${Math.min(menu.left, innerWidth - 170)}px;top:${menu.top}px`}>
        ${펼친[1].map(([p, l]) => html`<a href=${"#" + p} class=${켜짐(p) ? "on" : ""}>${l}</a>`)}</div>`}
      <div class="me">
        ${DEMO && html`<span class="badge amber">데모</span>`}
        <a class="me-name" href="/" title="홈페이지(매물)로">홈페이지</a>
        ${office && html`<a class="me-name" href="https://mail.google.com/mail/u/?authuser=tierone@tieronekorea.com" target="_blank" rel="noopener" title="tierone@tieronekorea.com 메일 (Gmail)">✉️ 메일</a>`}
        ${office && !DEMO && html`<${Bell} app=${app} />`}
        <a class="me-name" href="#/me" title="내 정보 (프로필 사진·비밀번호)" style="display:inline-flex;align-items:center;gap:6px"><${Avatar} name=${profile.name} id=${app.user.id} size=${24} />${profile.name} · ${{ admin: "공동대표", staff: "사무장", dealer: "권한 없음" }[profile.role]}</a>
        <button class="btn ghost sm" onClick=${async () => { await db.auth.signOut(); location.reload(); }}>로그아웃</button>
      </div>
    </header>
    <main class="page">${children}</main>
  </div>`;
}

function Router({ app }) {
  const path = useHash();
  const [, a, b, c] = path.split("?")[0].split("/");
  const office = app.profile.role !== "dealer";
  const officeOnly = ["settings", "dashboard", "issue", "bank", "ledger", "signs", "reserve", "board", "contacts", "todos", "calendar", "attendance", "att-works", "entry"];
  let page;
  if (!office && (officeOnly.includes(a) || (a === "cars" && b === "new") || c === "edit")) page = html`<div class="card empty">딜러 계정은 볼 수 없는 화면입니다. <a href="#/cars">차량 목록으로</a></div>`;
  else if (a === "cars" && b === "new") page = html`<${CarForm} app=${app} />`;
  else if (a === "car" && c === "edit") page = html`<${CarForm} app=${app} id=${b} />`;
  else if (a === "car") page = html`<${CarDetail} app=${app} id=${b} tab=${c || "info"} />`;
  else if (a === "purchases") page = html`<${PurchasesPage} app=${app} />`;
  else if (a === "entry") page = html`<${CarEntryPage} app=${app} />`;
  else if (a === "costs") page = html`<${CostsPage} app=${app} tab=${b || "car"} />`;
  else if (a === "signs") page = html`<${SignsPage} app=${app} id=${b} />`;
  else if (a === "checks") page = html`<${ChecksPage} app=${app} />`;
  else if (a === "check") page = html`<${CheckEdit} app=${app} id=${b} />`;
  else if (a === "reserve") page = html`<${ReservePage} app=${app} />`;
  else if (a === "board") page = html`<${BoardPage} app=${app} id=${b} />`;
  else if (a === "contacts") page = html`<${ContactsPage} app=${app} />`;
  else if (a === "todos") page = html`<${TodosPage} app=${app} />`;
  else if (a === "calendar") page = html`<${CalendarPage} app=${app} />`;
  else if (a === "attendance") page = html`<${AttendancePage} app=${app} />`;
  else if (a === "att-works") page = html`<${AttWorksPage} app=${app} tab=${b} />`;
  else if (a === "stats") page = html`<${StatsPage} app=${app} />`;
  else if (a === "loans" && b === "lender") page = html`<${LenderEdit} app=${app} id=${c} />`;
  else if (a === "loans") page = html`<${LoansPage} app=${app} tab=${b || "lenders"} />`;
  else if (a === "sales") page = html`<${SalesPage} app=${app} />`;
  else if (a === "settlements") page = html`<${Settlements} app=${app} />`;
  else if (a === "settings") page = html`<${Settings} app=${app} tab=${b || "company"} />`;
  else if (a === "dashboard" || (a === "" && office)) page = html`<${Dashboard} app=${app} />`;
  else if (a === "issue") page = html`<${IssuePage} app=${app} tab=${b || "wait"} />`;
  else if (a === "bank") page = html`<${BankPage} app=${app} />`;
  else if (a === "brokerage") page = html`<${BrokeragePage} app=${app} />`;
  else if (a === "ledger") page = html`<${LedgerPage} app=${app} tab=${decodeURIComponent(b || "지출")} />`;
  else if (a === "reports") page = html`<${ReportsPage} app=${app} tab=${b} />`;
  else if (a === "me" || a === "password") page = html`<${MyPage} app=${app} />`;
  else page = html`<${PurchasesPage} app=${app} />`;
  return html`<${Shell} app=${app} path=${path}>${page}</${Shell}>`;
}

function App() {
  const [db, setDb] = useState(null);
  const [app, setApp] = useState(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [mustPw, setMustPw] = useState(false);
  const [err, setErr] = useState(null);

  const load = async d => {
    const { data: { session } } = await d.auth.getSession();
    if (!session) { setNeedLogin(true); setApp(null); return; }
    if (!DEMO) {
      const { data: { user } } = await d.auth.getUser();          // 서버에서 최신 정보 (임시 비밀번호 여부)
      if (user?.user_metadata?.must_change_password) { setNeedLogin(false); setMustPw(true); return; }
    }
    setMustPw(false);
    const profile = await q(d.from("profiles").select("*").eq("user_id", session.user.id).maybeSingle());
    if (!profile) { setErr("이 계정은 아직 권한이 없습니다. 대표에게 역할 지정을 요청하세요."); return; }
    // 업무관리는 공동대표·사무장만. 딜러(권한 없음) 계정은 들어올 수 없다
    if (profile.role === "dealer") { setErr("업무관리 접근 권한이 없는 계정입니다. 공동대표에게 문의하세요."); return; }
    const [settings, dealers, lenders, parking] = await Promise.all([
      q(d.from("settings").select("*").eq("id", 1).single()),
      q(d.from("dealers").select("*").order("name")),
      q(d.from("lenders").select("*").order("sort")),
      profile.role === "dealer" ? [] : q(d.from("parking_zones").select("*").order("sort")),
    ]);
    const next = { db: d, user: session.user, profile, settings, dealers, lenders, parking };
    next.reload = () => load(d);
    사진기억(session.user.id, profile.name, profile.avatar_path);
    setNeedLogin(false); setApp(next); startSync(next);
    if (!DEMO) 구성원(next).catch(() => {});                   // 다른 사람 프로필 사진 미리 (기다리지 않음)
    if (sessionStorage.getItem("carpang-demo-upgraded")) { sessionStorage.removeItem("carpang-demo-upgraded"); toast("새 버전이라 데모 데이터를 처음 상태로 다시 만들었습니다."); }
  };

  useEffect(() => { run(async () => { const d = await getDb(); setDb(d); await load(d); }); }, []);

  if (err) return html`<div class="login"><div class="login-box"><h1>TierONE 업무관리</h1><p>${err}</p>
    <button class="btn" onClick=${async () => { await db.auth.signOut(); location.reload(); }}>다른 계정으로</button></div></div>`;
  if (needLogin && db) return html`<${Login} db=${db} onDone=${() => run(() => load(db))} />`;
  if (mustPw && db) return html`<${ChangePassword} db=${db} forced onDone=${() => run(() => load(db))} />`;
  if (!app) return html`<${Loading} text=${DEMO ? "데모 DB 준비 중… (처음 한 번 몇 초 걸립니다)" : "불러오는 중…"} />`;
  return html`<${AppCtx.Provider} value=${app}><${Router} app=${app} /></${AppCtx.Provider}>`;
}

render(html`<${App} /><${Toasts} />`, document.getElementById("app"));
