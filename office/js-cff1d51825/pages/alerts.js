// 환경설정 → 알림: 내 알림 기기(폰·PC, 기기별 끄기·시험 알림) + 알림 종류별 켜고 끄기(게시판별·할 일·일정).
// 기기 = 🔔 알림 켜기를 누른 브라우저마다 한 줄(push_subs). 종류 설정은 push_prefs(끈 것만 저장, 없으면 켜짐).
import { html, useState, useEffect, Loading, run, ask } from "../ui.js";
import { q } from "../db.js";
import { 상태, 켜기, 끄기, 보내기 } from "../push.js";
import { 언제 } from "../people.js";

const 종류 = [
  ["board:공지", "📌 게시판 · 공지"], ["board:매입등록증", "🚗 게시판 · 매입 등록증"], ["board:매도등록증", "🔑 게시판 · 매도 등록증"],
  ["board:송금요청", "💸 게시판 · 송금요청 (새 글·송금 완료)"], ["board:매도정보", "🤝 게시판 · 매도정보"], ["board:말소서류", "📄 게시판 · 말소서류"],
  ["board:자료", "📚 게시판 · 자료·매뉴얼"], ["board:자유", "💬 게시판 · 자유"],
  ["todo", "📋 할 일 (나에게 맡김·맡긴 일 완료)"], ["calendar", "📅 일정 (남이 내 일정을 넣음)"],
  ["att", "🕘 근태 (휴가·외근 신청과 승인 결과)"],
];
const 기기이름 = ua => {
  const s = String(ua || "");
  const os = /Android/.test(s) ? "안드로이드 폰" : /iPhone|iPad/.test(s) ? "아이폰" : /Windows/.test(s) ? "윈도우 PC" : /Mac OS/.test(s) ? "맥" : "기기";
  const br = /Edg\//.test(s) ? "엣지" : /SamsungBrowser/.test(s) ? "삼성 인터넷" : /CriOS|Chrome\//.test(s) ? "크롬" : /Safari/.test(s) ? "사파리" : "";
  return `${os}${br ? " · " + br : ""}`;
};

export function Alerts({ app }) {
  const [subs, setSubs] = useState(null);
  const [off, setOff] = useState(new Set());
  const [이기기, set이기기] = useState({ st: null, ep: null });
  const load = () => run(async () => {
    const [s, p] = await Promise.all([q(app.db.from("push_subs").select("id, endpoint, ua, created_at").order("created_at")), q(app.db.from("push_prefs").select("key, enabled"))]);
    setSubs(s); setOff(new Set(p.filter(x => !x.enabled).map(x => x.key)));
    const st = await 상태().catch(() => "안됨");
    let ep = null;
    try { const r = await navigator.serviceWorker?.getRegistration("./"); ep = (await r?.pushManager.getSubscription())?.endpoint || null; } catch {}
    set이기기({ st, ep });
  });
  useEffect(() => { load(); }, []);
  const 토글 = k => run(async () => { await q(app.db.from("push_prefs").upsert({ key: k, enabled: off.has(k) }, { onConflict: "user_id,key" })); load(); });
  const 시험 = () => run(async () => { await 보내기(app, { title: "🔔 시험 알림", body: "이 알림이 보이면 이 기기는 잘 받고 있습니다.", only_self: true }); }, "내 모든 기기로 시험 알림을 보냈습니다");
  const 지우기 = s => ask(`${기기이름(s.ua)} 알림을 끌까요?`) && run(async () => {
    if (s.endpoint === 이기기.ep) await 끄기(app); else await q(app.db.from("push_subs").delete().eq("id", s.id));
    load();
  }, "껐습니다");

  return html`<div class="card"><h3>🔔 내 알림 기기</h3>
      <p class="muted small">🔔 알림 켜기를 누른 폰·PC 가 여기 보입니다. 갤럭시·PC 는 크롬에서 허용만, 아이폰은 '홈 화면에 추가'한 업무관리 앱에서 켜야 합니다.</p>
      ${!subs ? html`<${Loading} />` : !subs.length ? html`<p class="muted">아직 알림을 받는 기기가 없습니다.</p>` : html`<ul class="todo">${subs.map(s => html`<li key=${s.id}>
        <span style="font-size:20px">${/Android|iPhone|iPad/.test(s.ua || "") ? "📱" : "💻"}</span>
        <div style="flex:1"><b>${기기이름(s.ua)}</b>${s.endpoint === 이기기.ep ? html` <span class="badge blue">지금 이 기기</span>` : ""}<div class="muted small">켠 때 ${언제(s.created_at)}</div></div>
        <button class="btn sm ghost" onClick=${() => 지우기(s)}>끄기</button></li>`)}</ul>`}
      <div class="bar" style="margin-top:10px">
        ${이기기.st === "꺼짐" && html`<button class="btn primary sm" onClick=${() => run(async () => { await 켜기(app); load(); }, "이 기기 알림을 켰습니다")}>이 기기도 알림 켜기</button>`}
        ${이기기.st === "설치필요" && html`<span class="muted small">아이폰: 사파리 공유 → 홈 화면에 추가 → 설치된 앱에서 켜기</span>`}
        ${이기기.st === "차단" && html`<span class="muted small">이 브라우저에서 알림이 막혀 있습니다 (주소창 자물쇠 → 알림 허용)</span>`}
        <span class="grow"></span>${subs?.length > 0 && html`<button class="btn sm" onClick=${시험}>시험 알림 보내기</button>`}</div>
    </div>
    <div class="card"><h3>알림 종류</h3>
      <p class="muted small">끈 종류는 내 모든 기기에서 안 울립니다. (게시판별 알림은 게시판 위 '새글 알림'으로도 끄고 켤 수 있습니다)</p>
      <ul class="todo">${종류.map(([k, l]) => html`<li key=${k}><span style="flex:1">${l}</span>
        <span class=${"toggle" + (off.has(k) ? "" : " on")} onClick=${() => 토글(k)}><i></i></span></li>`)}</ul>
    </div>`;
}
