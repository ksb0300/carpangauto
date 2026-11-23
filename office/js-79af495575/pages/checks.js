// 차량 검수 — 아이패드·갤럭시탭에서 들고 다니며 쓰는 점검표. 매입 / 대차 고객 차 / 상품화 / 출고 전.
// 입력은 먼저 기기에 저장(check-store.js)하고 인터넷이 되면 올린다 → 와이파이 전용 태블릿도 고객 차 앞에서 끊김 없이.
// 고객 링크(tieronekorea.com/check/?t=)는 서버 함수 check 가 고객용 값만 보여 준다 (메모·판정·고객정보 제외).
import { html, useState, useEffect, useRef, Loading, Money, run, toast, go, ask, 검색맞음 } from "../ui.js";
import { q } from "../db.js";
import { 구역, 구역설명, 점검항목, 상태이름, 기호, 기호색, 가장나쁜색, 외판, 랭크이름, 골격, 골격기호, 타이어위치, 필수컷,
  종류, 판정목록, 판정색, 연료, 펜색, 선점, 빈검수data, 검수정리, 타이어상태, 타이어연수, 진행, 사고판단, 기타외판, 문제목록, 사진수, 판정이름, 요약글 } from "../shared/check-calc.js";
import { saveLocal, getLocal, listLocal, keepLocal, dropLocal, pendingFor, queuePhoto, localPhoto, dropPhoto, sync, onSync, shrink } from "../check-store.js";

const 시각 = iso => { if (!iso) return ""; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const 날짜 = iso => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };
const km = v => { const n = parseInt(String(v ?? "").replace(/\D/g, ""), 10); return isNaN(n) ? "" : n.toLocaleString("ko-KR"); };
// https 가 아닌 주소(사무실 PC 미리보기 등)에선 randomUUID 가 없어 직접 만든다
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
const Plate = ({ p, sm }) => p ? html`<span class=${"ck-plate" + (sm ? " sm" : "")}>${p}</span>` : html`<span class=${"ck-plate empty" + (sm ? " sm" : "")}>번호 미입력</span>`;

/** 새 검수 — 기기에 먼저 만들고 바로 연다 (인터넷 없어도 시작 가능). car 를 주면 그 차 정보로 채운다 */
export async function 새검수(app, kind, car) {
  const now = new Date().toISOString();
  const row = { id: uuid(), plate: car?.plate || "", car_name: car?.car_name || "", kind, status: "진행",
    data: 빈검수data(app.profile.name || ""), completed_at: null, created_at: now, updated_at: now };
  if (car) {
    row.car_id = car.id;
    Object.assign(row.data.info, { km: car.mileage ?? "", vin: car.vin || "", year: car.model_year ? String(car.model_year) : "", fuel: car.fuel || "" });
  }
  await saveLocal(row); sync();
  go("/check/" + row.id);
}

async function 링크보내기(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(url); toast("링크를 복사했습니다 — 카톡에 붙여 넣으세요"); } catch { window.prompt("이 주소를 복사해 고객에게 보내세요", url); }
}

/** 화면 위 저장 상태 (기기에만 / 올리는 중 / 저장됨) */
function SyncChip() {
  const [s, setS] = useState(null);
  useEffect(() => onSync(setS), []);
  if (!s) return null;
  const wait = s.pending + s.photos;
  if (s.syncing) return html`<span class="ck-sync up">올리는 중…</span>`;
  if (wait) return html`<span class="ck-sync off" title=${s.error || ""}>${s.online ? "기기에 저장됨 · 곧 올림" : "인터넷 없음 · 기기에 저장됨"} (${s.pending ? `검수 ${s.pending}` : ""}${s.pending && s.photos ? " · " : ""}${s.photos ? `사진 ${s.photos}` : ""})</span>`;
  return html`<span class="ck-sync ok">서버에 저장됨</span>`;
}

// ───────── 목록 ─────────
export function ChecksPage({ app }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [qs, setQs] = useState("");
  const [f, setF] = useState("진행");
  const [pick, setPick] = useState(false);
  const load = async () => {
    const local = await listLocal().catch(() => []);
    let server = null;
    try {
      server = await q(app.db.from("car_checks").select("id,car_id,plate,car_name,kind,status,data,token,created_at,updated_at,completed_at").order("updated_at", { ascending: false }).limit(300));
      setErr("");
    } catch (e) { setErr(navigator.onLine ? e.message : "인터넷 연결이 없어 이 기기에 저장된 검수만 보입니다."); }
    const m = new Map((server || []).map(r => [r.id, r]));
    for (const l of local) if (l.dirty || !server) m.set(l.id, { ...l.row, _local: l.dirty });
    setRows([...m.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))));
  };
  useEffect(() => {
    load();
    let was = false;
    return onSync(s => { if (was && !s.syncing) load(); was = s.syncing; });
  }, []);

  const list = (rows || []).filter(r => f === "전체" || r.status === f)
    .filter(r => 검색맞음(qs, r.plate, r.car_name, r.data?.info?.vin, r.data?.info?.customer) > 0);
  return html`<div class="ck-page">
    <div class="bar"><h2>차량 검수</h2><${SyncChip} /><span class="grow"></span>
      <button class="btn primary ck-big" onClick=${() => setPick(!pick)}>+ 새 검수</button></div>
    ${pick && html`<div class="card ck-kinds"><b>어떤 검수인가요?</b>
      <div class="ck-kindgrid">${Object.entries(종류).map(([k, l]) => html`<button class="btn" onClick=${() => run(() => 새검수(app, k))}>${l}</button>`)}</div>
      <p class="note">차 화면에서 시작하면 번호·차명·주행거리가 미리 채워집니다. 매입이 결정된 검수는 '제시차량으로 등록'을 누르면 차량 등록으로 이어집니다.</p></div>`}
    ${err && html`<div class="ck-warn">${err}</div>`}
    <div class="bar"><input class="search" placeholder="차량번호·차명·고객 이름" value=${qs} onInput=${e => setQs(e.target.value)} />
      <div class="seg">${["진행", "완료", "전체"].map(v => html`<button type="button" class=${f === v ? "on" : ""} onClick=${() => setF(v)}>${v}</button>`)}</div></div>
    ${!rows ? html`<${Loading} />` : !list.length ? html`<div class="card empty">${rows.length ? "조건에 맞는 검수가 없습니다." : "아직 검수 기록이 없습니다. ‘+ 새 검수’를 눌러 시작하세요."}</div>`
      : html`<div class="ck-cards">${list.map(r => html`<${Card} r=${r} />`)}</div>`}
  </div>`;
}
function Card({ r }) {
  const d = 검수정리(r.data), st = 진행(d), acc = 사고판단(d), i = d.info;
  const v = 판정이름(r.kind, d.verdict);
  return html`<a class="ck-card" href=${"#/check/" + r.id}>
    <div class="ck-card-top"><${Plate} p=${r.plate} /><span class="ck-pills">
      ${acc.short && html`<span class=${"ck-pill t-" + acc.tone}>${acc.short}</span>`}
      ${r.status === "완료" ? html`<span class=${"ck-pill t-" + (판정색[d.verdict] || "muted")}>${v || "완료"}</span>` : html`<span class="ck-pill t-pri">진행중</span>`}</span></div>
    <b class="ck-card-name">${r.car_name || "차명 미입력"}</b>
    <span class="muted small">${[종류[r.kind], i.year, i.km ? km(i.km) + "km" : "", i.customer].filter(Boolean).join(" · ")}</span>
    <div class="ck-bar"><i style=${`width:${Math.round(st.done / st.total * 100)}%`}></i></div>
    <span class="ck-card-foot small"><span>${st.done}/${st.total} 확인</span>
      ${st.bad > 0 && html`<b class="red">불량 ${st.bad}</b>`}${st.warn > 0 && html`<b class="ck-amber">주의 ${st.warn}</b>`}
      ${r.token && html`<span class="muted">고객 링크</span>`}${r._local && html`<span class="ck-amber">기기에만</span>`}
      <span class="muted grow r">${시각(r.updated_at)}${i.inspector ? " · " + i.inspector : ""}</span></span>
  </a>`;
}

// ───────── 차 화면에 붙는 카드 ─────────
export function CarChecks({ app, car }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { run(async () => setRows(await q(app.db.from("car_checks").select("id,kind,status,data,updated_at,token").eq("car_id", car.id).order("updated_at", { ascending: false })))); }, [car.id]);
  if (!rows) return null;
  return html`<div class="card no-print"><div class="bar"><h3 style="margin:0">차량 검수</h3><span class="grow"></span>
      <button class="btn sm" onClick=${() => run(() => 새검수(app, "상품화", car))}>상품화 점검 시작</button>
      <button class="btn sm" onClick=${() => run(() => 새검수(app, "출고", car))}>출고 전 점검 시작</button></div>
    ${!rows.length ? html`<p class="muted small" style="margin:0">이 차의 검수 기록이 없습니다. 번호판이 같은 검수는 자동으로 여기에 붙습니다.</p>`
      : html`<div class="ck-mini">${rows.map(r => { const d = 검수정리(r.data), acc = 사고판단(d), st = 진행(d);
        return html`<a href=${"#/check/" + r.id}><b>${종류[r.kind]}</b> <span class="muted">${시각(r.updated_at)}</span>
          ${acc.short && html`<span class=${"ck-pill t-" + acc.tone}>${acc.short}</span>`}
          <span class=${"ck-pill t-" + (r.status === "완료" ? 판정색[d.verdict] || "muted" : "pri")}>${r.status === "완료" ? 판정이름(r.kind, d.verdict) || "완료" : "진행중"}</span>
          <span class="small">${st.bad ? `불량 ${st.bad} · ` : ""}${st.warn ? `주의 ${st.warn}` : ""}</span></a>`; })}</div>`}
  </div>`;
}

// ───────── 사진 한 장 (기기에 남은 건 바로, 서버 건 임시 주소로) ─────────
const urlCache = new Map();
function usePhoto(app, path) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true, made = null;
    (async () => {
      if (!path) return setSrc(null);
      const l = await localPhoto(path).catch(() => null);
      if (l) { made = URL.createObjectURL(l.blob); if (alive) setSrc(made); return; }
      if (urlCache.has(path)) { if (alive) setSrc(urlCache.get(path)); return; }
      const { data } = await app.db.storage.from("car-files").createSignedUrl(path, 3600);
      if (data?.signedUrl) { urlCache.set(path, data.signedUrl); if (alive) setSrc(data.signedUrl); }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  return src;
}
function Shot({ app, label, path, mark, busy, onPick, onDel, onView, cap, onCap }) {
  const src = usePhoto(app, path);
  if (busy) return html`<div class="ck-shot"><div class="ck-shot-box">사진 넣는 중…</div><div class="ck-shot-bar"><span>${label}</span></div></div>`;
  if (!path) return html`<div class="ck-shot"><button type="button" class="ck-shot-box add" onClick=${onPick}><b>+</b><span>${label}</span></button></div>`;
  return html`<div class="ck-shot">
    <button type="button" class="ck-shot-box img" title="크게 보기 · 펜으로 표시" onClick=${onView}>${src ? html`<img src=${src} alt=${label} loading="lazy" />
      ${mark?.s?.length ? html`<svg class="ck-markov" viewBox=${`0 0 ${mark.w} ${mark.h}`} preserveAspectRatio="xMidYMid slice"><${Strokes} list=${mark.s} /></svg>` : ""}` : "불러오는 중…"}
      ${mark?.s?.length ? html`<span class="ck-markbadge">✎ 표시</span>` : ""}</button>
    <div class="ck-shot-bar"><span>${label}</span><button type="button" class="btn sm" onClick=${onPick}>다시</button><button type="button" class="btn sm ghost" onClick=${onDel}>삭제</button></div>
    ${onCap && html`<input class="ck-cap" placeholder="설명 (예: 운전석 도어 찍힘)" value=${cap || ""} onInput=${e => onCap(e.target.value)} />`}
  </div>`;
}

// ───────── 펜으로 그리기 (애플펜슬·S펜) ─────────
// on 이면 누르고 끄는 대로 선이 그어진다. 펜을 한 번 쓰면 그 뒤로는 손가락·손바닥 터치는 무시 (손바닥이 닿아도 선이 안 생김).
// 그리는 중엔 화면을 다시 그리지 않고 선 하나만 직접 고친다 (펜은 초당 120번 넘게 움직임을 보낸다) → 손을 떼면 onStroke 로 한 번에.
const Strokes = ({ list }) => (list || []).map(x => html`<polyline class="pen" points=${선점(x.p)} stroke=${x.c} stroke-width=${x.w} />`);
function PenSvg({ vb, par = "xMidYMid meet", cls = "", on, color, width, strokes, onStroke, label, children }) {
  const svgRef = useRef(null), lineRef = useRef(null), cur = useRef(null), penSeen = useRef(false);
  const gap = vb[0] / 400, round = vb[0] > 800 ? 1 : 10;
  const pt = e => {
    const s = svgRef.current, m = s?.getScreenCTM(); if (!m) return null;
    const q = s.createSVGPoint(); q.x = e.clientX; q.y = e.clientY;
    const r = q.matrixTransform(m.inverse());
    return [Math.round(r.x * round) / round, Math.round(r.y * round) / round];
  };
  const down = e => {
    if (!on) return;
    if (e.pointerType === "pen") penSeen.current = true;
    else if (e.pointerType === "touch" && penSeen.current) return;
    if (cur.current) return;
    e.preventDefault();
    try { svgRef.current.setPointerCapture(e.pointerId); } catch {}
    const p = pt(e); if (!p) return;
    cur.current = { id: e.pointerId, p: [...p] };
    const l = lineRef.current; l.setAttribute("stroke", color); l.setAttribute("stroke-width", width); l.setAttribute("points", 선점(cur.current.p));
  };
  const move = e => {
    const c = cur.current; if (!c || e.pointerId !== c.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const p = pt(ev); if (!p) continue;
      const n = c.p.length;
      if (Math.hypot(p[0] - c.p[n - 2], p[1] - c.p[n - 1]) >= gap) c.p.push(p[0], p[1]);
    }
    lineRef.current.setAttribute("points", 선점(c.p));
  };
  const up = e => {
    const c = cur.current; if (!c || e.pointerId !== c.id) return;
    cur.current = null; lineRef.current.setAttribute("points", "");
    if (c.p.length === 2) c.p.push(c.p[0] + gap, c.p[1]);       // 콕 찍은 점도 보이게
    onStroke({ c: color, w: width, p: c.p });
  };
  return html`<svg ref=${svgRef} viewBox=${`0 0 ${vb[0]} ${vb[1]}`} preserveAspectRatio=${par} class=${cls + (on ? " drawing" : "")} role="group" aria-label=${label}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    ${children}<${Strokes} list=${strokes} /><polyline ref=${lineRef} class="pen" points="" />
  </svg>`;
}
/** 색·굵기·되돌리기·지우기 */
function PenTools({ color, setColor, wi, setWi, onUndo, onClear, can }) {
  return html`<div class="ck-pentools">
    ${펜색.map(([c, n]) => html`<button type="button" class=${"ck-swatch" + (color === c ? " on" : "")} style=${`--sw:${c}`} aria-label=${n} aria-pressed=${color === c} onClick=${() => setColor(c)}></button>`)}
    <span class="ck-sep"></span>
    ${["가늘게", "보통", "굵게"].map((n, i) => html`<button type="button" class=${"ck-wbtn" + (wi === i ? " on" : "")} aria-pressed=${wi === i} onClick=${() => setWi(i)}><i style=${`height:${2 + i * 3}px`}></i>${n}</button>`)}
    <span class="ck-sep"></span>
    <button type="button" class="btn" disabled=${!can} onClick=${onUndo}>되돌리기</button>
    <button type="button" class="btn ghost" disabled=${!can} onClick=${onClear}>모두 지우기</button>
  </div>`;
}
/** 사진 크게 보기 + 펜으로 표시. 원본 사진은 그대로, 선만 따로 저장 */
function PhotoPen({ app, path, label, mark, onSave, onClose }) {
  const src = usePhoto(app, path);
  const [size, setSize] = useState(mark?.w ? [mark.w, mark.h] : null);
  const [list, setList] = useState(mark?.s || []);
  const [color, setColor] = useState(펜색[0][0]);
  const [wi, setWi] = useState(1);
  useEffect(() => { if (!src || size) return; const im = new Image(); im.onload = () => setSize([im.naturalWidth, im.naturalHeight]); im.src = src; }, [src]);
  const base = size ? Math.max(size[0], size[1]) : 1600;
  const width = Math.round(base * [0.004, 0.008, 0.014][wi]);
  const changed = JSON.stringify(list) !== JSON.stringify(mark?.s || []);
  const close = () => { if (changed && !ask("표시한 내용을 저장하지 않고 닫을까요?")) return; onClose(); };
  return html`<div class="ck-pen">
    <div class="ck-pen-bar"><b>${label}</b><span class="muted small">펜으로 손상 위치를 동그라미 치세요</span><span class="grow"></span>
      <button type="button" class="btn" onClick=${close}>닫기</button>
      <button type="button" class="btn primary" disabled=${!changed || !size} onClick=${() => onSave(list.length ? { w: size[0], h: size[1], s: list } : null)}>저장</button></div>
    <${PenTools} color=${color} setColor=${setColor} wi=${wi} setWi=${setWi} can=${list.length > 0} onUndo=${() => setList(l => l.slice(0, -1))} onClear=${() => setList([])} />
    <div class="ck-pen-area">${src && size ? html`<${PenSvg} vb=${size} on color=${color} width=${width} strokes=${list} label=${label + " 표시"} onStroke=${x => setList(l => [...l, x])}>
        <image href=${src} x="0" y="0" width=${size[0]} height=${size[1]} /><//>` : html`<span class="muted">사진 불러오는 중…</span>`}</div>
  </div>`;
}

// ───────── 검수 화면 ─────────
export function CheckEdit({ app, id }) {
  const [row, setRow] = useState(undefined);
  const [sec, setSec] = useState("basic");
  const [sel, setSel] = useState("hood");
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState({});
  const [penPhoto, setPenPhoto] = useState(null);           // 펜으로 표시 중인 사진 { path, label }
  const [pen, setPen] = useState({ on: false, c: 펜색[0][0], wi: 1 });    // 외판 도면 그리기
  const [copyText, setCopyText] = useState("");
  const rowRef = useRef(null), timer = useRef(null), fileRef = useRef(null), slotRef = useRef(null);
  rowRef.current = row;

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await getLocal(id).catch(() => null);
      if (local?.dirty) { if (alive) setRow(local.row); return; }
      try {
        const s = await q(app.db.from("car_checks").select("*").eq("id", id).maybeSingle());
        if (s) { await keepLocal(s).catch(() => {}); if (alive) setRow(s); return; }
      } catch {}
      if (alive) setRow(local ? local.row : null);
    })();
    return () => { alive = false; };
  }, [id]);
  // 나갈 때 남은 저장을 바로
  const flush = async () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; await saveLocal(rowRef.current); } };
  useEffect(() => () => { flush().then(() => sync()); }, []);
  // 검수하는 동안 화면이 꺼지지 않게 (안 되는 기기는 그냥 넘어감)
  useEffect(() => {
    let lock = null;
    const get = async () => { try { if (document.visibilityState === "visible" && navigator.wakeLock) lock = await navigator.wakeLock.request("screen"); } catch {} };
    const vis = () => { if (document.visibilityState === "hidden") flush(); else get(); };
    get(); document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); try { lock?.release(); } catch {} };
  }, []);

  if (row === undefined) return html`<${Loading} />`;
  if (row === null) return html`<div class="card empty">검수를 찾을 수 없습니다. 다른 기기에서 만들고 아직 안 올렸을 수 있습니다. <a href="#/checks">목록으로</a></div>`;

  const d = 검수정리(row.data);
  const 매입류 = row.kind === "매입" || row.kind === "대차";
  /** 고치기: data 를 복사해 fn 으로 바꾸고, 0.4초 쉬면 기기에 저장 → 올리기 */
  const upd = fn => setRow(prev => {
    const n = { ...prev, data: 검수정리(JSON.parse(JSON.stringify(prev.data || {}))) };
    fn(n.data, n);
    n.updated_at = new Date().toISOString();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      saveLocal(rowRef.current).then(() => sync()).catch(e => toast("기기에 저장하지 못했습니다: " + e.message, "err"));
    }, 400);
    return n;
  });
  const goSec = k => { setSec(k); setNotes({}); window.scrollTo(0, 0); };

  // ── 점검 항목 한 줄 ──
  const Item = ([k, name, hint]) => {
    const v = d.items[k] || {}, open = v.note || v.s === "warn" || v.s === "bad" || notes[k];
    return html`<div class=${"ck-item" + (v.s ? " is-" + v.s : "")} key=${k}>
      <div class="ck-item-t"><div class="ck-name">${name}</div><div class="ck-hint">${hint}</div></div>
      <div class="ck-ctl">
        <div class="ck-seg" role="group" aria-label=${name}>${["ok", "warn", "bad"].map(s => html`<button type="button" class=${"s-" + s + (v.s === s ? " on" : "")} aria-pressed=${v.s === s}
          onClick=${() => upd(x => { const it = x.items[k] || (x.items[k] = {}); if (it.s === s) delete it.s; else it.s = s; })}>${상태이름[s]}</button>`)}</div>
        ${!open && html`<button type="button" class="ck-memo" onClick=${() => setNotes({ ...notes, [k]: true })}>메모</button>`}
      </div>
      ${open && html`<textarea class="ck-note" rows="2" placeholder=${v.s === "bad" ? "어떤 문제인지 (위치, 정도, 예상 비용)" : "메모"} value=${v.note || ""}
        onInput=${e => { const t = e.target.value; upd(x => { (x.items[k] || (x.items[k] = {})).note = t; }); }} />`}
    </div>`;
  };
  const Group = (title, arr) => html`<div class="ck-group">${title && html`<div class="ck-group-h">${title}</div>`}${arr.map(Item)}</div>`;
  const setInfo = k => e => { const t = e.target.value; upd(x => { x.info[k] = t; }); };

  // ── 구역별 화면 ──
  const basic = () => html`
    <div class="ck-group"><div class="ck-group-h">차량 정보 <span class="muted">· 검수 시작 ${시각(row.created_at)}</span></div>
      <div class="ck-form">
        <label class="ck-f"><span>차량번호</span><input class="ck-plate-in" placeholder="123가4567" value=${row.plate} autocomplete="off"
          onInput=${e => { const t = e.target.value.replace(/\s/g, ""); upd((x, r) => { r.plate = t; }); }} /></label>
        <label class="ck-f w2"><span>차명</span><input placeholder="예: 그랜저 IG 3.0 익스클루시브" value=${row.car_name} autocomplete="off"
          onInput=${e => { const t = e.target.value; upd((x, r) => { r.car_name = t; }); }} /></label>
        <label class="ck-f"><span>연식 (최초등록)</span><input placeholder="2019.03" value=${d.info.year} onInput=${setInfo("year")} /></label>
        <label class="ck-f"><span>주행거리 (km)</span><input inputmode="numeric" placeholder="82000" value=${d.info.km}
          onInput=${e => { const t = e.target.value.replace(/\D/g, ""); e.target.value = t; upd(x => { x.info.km = t; }); }} /><small>${d.info.km ? km(d.info.km) + " km" : "계기판 숫자 그대로"}</small></label>
        <label class="ck-f"><span>색상</span><input placeholder="흰색" value=${d.info.color} onInput=${setInfo("color")} /></label>
        <label class="ck-f w3"><span>차대번호 (VIN)</span><input class="ck-vin" maxlength="17" autocapitalize="characters" spellcheck="false" placeholder="KMHxxxxxxxxxxxxxx" value=${d.info.vin}
          onInput=${e => { const t = e.target.value.toUpperCase().replace(/\s/g, ""); upd(x => { x.info.vin = t; }); }} />
          <small>${(d.info.vin || "").length}/17자${d.info.vin && d.info.vin.length !== 17 ? " · 17자리인지 확인" : ""}</small></label>
        <div class="ck-f w3"><span>연료</span><div class="ck-choice">${연료.map(v => html`<button type="button" class=${d.info.fuel === v ? "on" : ""} onClick=${() => upd(x => { x.info.fuel = x.info.fuel === v ? "" : v; })}>${v}</button>`)}</div></div>
        <div class="ck-f w3"><span>검수 종류</span><div class="ck-choice">${Object.entries(종류).map(([k, l]) => html`<button type="button" class=${row.kind === k ? "on" : ""}
          onClick=${() => upd((x, r) => { if (r.kind !== k) { r.kind = k; x.verdict = ""; } })}>${l}</button>`)}</div></div>
        ${매입류 && html`<label class="ck-f"><span>고객 이름</span><input placeholder="매도 고객" value=${d.info.customer} onInput=${setInfo("customer")} /></label>
          <label class="ck-f"><span>고객 연락처</span><input inputmode="tel" placeholder="010-0000-0000" value=${d.info.phone} onInput=${setInfo("phone")} /></label>`}
        <label class="ck-f"><span>검수자</span><input value=${d.info.inspector} onInput=${setInfo("inspector")} /></label>
        <label class="ck-f"><span>검수 장소</span><input placeholder="예: 경동오토필드, 고객 자택" value=${d.info.place} onInput=${setInfo("place")} /></label>
        <div class="ck-f"><span>스마트키 개수</span><div class="ck-step">
          <button type="button" onClick=${() => upd(x => { x.info.keys = Math.max(0, (+x.info.keys || 0) - 1); })}>−</button><b>${d.info.keys}</b>
          <button type="button" onClick=${() => upd(x => { x.info.keys = Math.min(5, (+x.info.keys || 0) + 1); })}>+</button></div></div>
      </div></div>
    ${Group("서류 확인", 점검항목.basic)}`;

  const body = () => {
    const acc = 사고판단(d), p = 외판.find(x => x.k === sel), codes = d.panels[sel] || [];
    const toggle = (g, k, c) => upd(x => {
      const arr = (x[g][k] || []).slice(), i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1); else arr.push(c);
      const order = Object.keys(기호); arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      if (arr.length) x[g][k] = arr; else delete x[g][k];
    });
    return html`
      <div class=${"ck-acc t-" + acc.tone}><b>${acc.label}</b><span>${acc.parts.length ? acc.parts.join(" · ") : "외판 교환·판금이나 골격 수리 표시가 없습니다."}</span></div>
      <div class="ck-body">
        <div class="ck-diagram">
          <${PenSvg} vb=${[340, 600]} cls="ck-car" on=${pen.on} color=${pen.c} width=${[2, 3.5, 6][pen.wi]} strokes=${d.sketch} label="차량 외판 도면, 위가 앞쪽"
            onStroke=${x => upd(y => { y.sketch.push(x); })}>
            ${[[8, 96], [8, 452], [318, 96], [318, 452]].map(([x, y]) => html`<rect class="wheel" x=${x} y=${y} width="14" height="58" rx="4" />`)}
            <path class="glass" d="M106 196 H234 L226 236 H114 Z" /><path class="glass" d="M114 386 H226 L234 420 H106 Z" />
            ${외판.map(x => {
              const c = d.panels[x.k] || [], t = 가장나쁜색(c), sill = x.k.startsWith("sill"), label = x.s ?? x.n;
              return html`<g key=${x.k}>
                <path class=${`pnl${t ? " t-" + t : ""}${sel === x.k ? " sel" : ""}`} d=${x.d} tabindex="0" role="button"
                  aria-label=${x.n + (c.length ? " " + c.map(k => 기호[k]).join(", ") : " 이상 없음")}
                  onClick=${() => setSel(x.k)} onKeyDown=${e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(x.k))} />
                ${c.length ? html`<text class=${"pcode t-" + t} x=${x.cx} y=${sill ? x.cy + 5 : x.cy + 2} font-size=${sill ? 11 : 15}>${sill ? c[0] : c.join("")}</text>
                  ${label && !sill ? html`<text class="plbl" x=${x.cx} y=${x.cy + 18}>${label}</text>` : null}`
                  : label ? html`<text class="plbl" x=${x.cx} y=${x.cy + 4}>${label}</text>` : null}
              </g>`;
            })}
          <//>
          <div class="ck-cap-row"><span>← 좌 (운전석)</span><span>▲ 앞</span><span>우 (조수석) →</span></div>
          <div class="ck-drawbar">
            <button type="button" class=${"btn" + (pen.on ? " primary" : "")} onClick=${() => setPen(p => ({ ...p, on: !p.on }))}>${pen.on ? "그리기 끝" : "✎ 펜으로 그리기"}</button>
            ${pen.on ? html`<${PenTools} color=${pen.c} setColor=${c => setPen(p => ({ ...p, c }))} wi=${pen.wi} setWi=${wi => setPen(p => ({ ...p, wi }))} can=${d.sketch.length > 0}
                onUndo=${() => upd(y => { y.sketch.pop(); })} onClear=${() => ask("도면에 그린 것을 모두 지울까요?") && upd(y => { y.sketch = []; })} />`
              : html`<span class="muted small">${d.sketch.length ? `그림 ${d.sketch.length}획 · ` : ""}그리는 동안엔 부위 선택이 안 됩니다</span>`}
          </div>
        </div>
        <div class="ck-side">
          <div class="ck-pedit">
            <div class="ck-pedit-h"><b>${p.n}</b><span>${랭크이름[p.rank]}</span></div>
            <div class="ck-codes">${Object.entries(기호).map(([c, n]) => html`<button type="button" class=${"t-" + 기호색(c) + (codes.includes(c) ? " on" : "")} aria-pressed=${codes.includes(c)}
              onClick=${() => toggle("panels", p.k, c)}><b>${c}</b>${n}</button>`)}</div>
            <button type="button" class="btn" disabled=${!codes.length} onClick=${() => upd(x => { delete x.panels[p.k]; })}>이상 없음으로 되돌리기</button>
          </div>
          <div class="ck-pchips">${외판.map(x => { const c = d.panels[x.k] || [], t = 가장나쁜색(c);
            return html`<button type="button" class=${"ck-pchip" + (c.length ? " marked t-" + t : "") + (sel === x.k ? " sel" : "")} onClick=${() => setSel(x.k)}>${x.n}${c.length ? html` <b>${c.join("")}</b>` : ""}</button>`; })}</div>
        </div>
      </div>
      <div class="ck-group"><div class="ck-group-h">주요골격 · 라디에이터 서포트 <span class="muted">X 교환 · W 판금·용접 · C 부식 · T 손상</span></div>
        <div class="ck-frame">${골격.map(f => { const c = d.frame[f.k] || [];
          return html`<div class="ck-frow"><span>${f.n}<small>${f.rank === "1" ? "외판" : f.rank}</small></span>
            <div class="ck-fcodes">${골격기호.map(x => html`<button type="button" class=${"t-" + 기호색(x) + (c.includes(x) ? " on" : "")} aria-pressed=${c.includes(x)} aria-label=${f.n + " " + 기호[x]}
              onClick=${() => toggle("frame", f.k, x)}>${x}</button>`)}</div></div>`; })}</div>
        <p class="ck-legend">사고 이력은 주요골격의 교환·판금·용접, 그리고 쿼터·루프·사이드실의 절단·용접일 때로 봅니다. 최종 표기는 성능점검기록부 기준을 따르세요.</p>
      </div>
      ${Group("판별 단서", 점검항목.body)}`;
  };

  const under = () => html`
    <div class="ck-group"><div class="ck-group-h">타이어 <span class="muted">1.6mm 미만 불량 · 3mm 미만 주의 · 생산 6년 이상 주의</span></div>
      <div class="ck-tires">${타이어위치.map(([p, label]) => { const t = d.tires[p], s = 타이어상태(t), age = 타이어연수(t.dot);
        return html`<div class="ck-tire"><div class="ck-tire-h"><b>${label}</b>${s ? html`<span class=${"ck-pill t-" + s}>${상태이름[s]}${age != null ? ` · ${Math.floor(age)}년` : ""}</span>` : html`<span class="ck-pill t-muted">미입력</span>`}</div>
          <div class="ck-tire-in">
            <label>트레드 (mm)<input inputmode="decimal" placeholder="4.5" value=${t.mm} onInput=${e => { const v = e.target.value; upd(x => { x.tires[p].mm = v; }); }} /></label>
            <label>생산 주차 (DOT)<input inputmode="numeric" maxlength="4" placeholder="2423" value=${t.dot} onInput=${e => { const v = e.target.value.replace(/\D/g, ""); upd(x => { x.tires[p].dot = v; }); }} /></label>
          </div></div>`; })}</div></div>
    ${Group("하체", 점검항목.under)}`;

  // ── 사진 ──
  const pickPhoto = (slot, multiple) => { slotRef.current = slot; fileRef.current.multiple = !!multiple; fileRef.current.click(); };
  const 지우기 = async path => {
    if (!path) return;
    if (await localPhoto(path).catch(() => null)) return dropPhoto(path);
    app.db.storage.from("car-files").remove([path]).catch(() => {});     // 인터넷이 없으면 파일만 남는다 (기록에서는 빠짐)
  };
  const onFiles = async files => {
    const slot = slotRef.current, cid = row.id;
    if (!files.length) return;
    setBusy(b => ({ ...b, [slot]: true }));
    for (const f of files) {
      try {
        const blob = await shrink(f);
        const path = `check/${cid}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
        await queuePhoto(path, blob, cid);
        const was = 검수정리(rowRef.current.data);       // 바꾸기 전 사진 (상태 갱신은 늦게 돌 수 있어 미리 본다)
        const old = slot === "+" ? null : slot.startsWith("x") ? was.extra[+slot.slice(1)]?.path : was.photos[slot];
        upd(x => {
          if (slot === "+") x.extra.push({ path, cap: "" });
          else if (slot.startsWith("x")) { const n = +slot.slice(1); x.extra[n] = { ...x.extra[n], path }; }
          else x.photos[slot] = path;
        });
        if (old) { 지우기(old); upd(x => { delete x.marks[old]; }); }
      } catch (e) { toast("사진을 넣지 못했습니다: " + (e.message || e), "err"); }
    }
    setBusy(b => { const n = { ...b }; delete n[slot]; return n; });
    sync();
  };
  const photos = () => html`
    <div class="ck-group"><div class="ck-group-h">필수 컷 <span class="muted">${사진수(d)}/${필수컷.length}</span></div>
      <div class="ck-shots">${필수컷.map(([k, l]) => html`<${Shot} app=${app} label=${l} path=${d.photos[k]} mark=${d.marks[d.photos[k]]} busy=${busy[k]} onView=${() => setPenPhoto({ path: d.photos[k], label: l })}
        onPick=${() => pickPhoto(k)} onDel=${() => { if (!ask(l + " 사진을 지울까요?")) return; const p = d.photos[k]; upd(x => { delete x.photos[k]; delete x.marks[p]; }); 지우기(p); }} />`)}</div></div>
    <div class="ck-group"><div class="ck-group-h">문제 부위 · 추가 사진 <span class="muted">${d.extra.length}장</span></div>
      <div class="ck-shots">${d.extra.map((x, n) => html`<${Shot} app=${app} label=${x.cap || "추가 사진 " + (n + 1)} path=${x.path} mark=${d.marks[x.path]} busy=${busy["x" + n]} onView=${() => setPenPhoto({ path: x.path, label: x.cap || "추가 사진 " + (n + 1) })} cap=${x.cap}
          onCap=${t => upd(y => { y.extra[n].cap = t; })} onPick=${() => pickPhoto("x" + n)}
          onDel=${() => { if (!ask("이 사진을 지울까요?")) return; upd(y => { y.extra.splice(n, 1); delete y.marks[x.path]; }); 지우기(x.path); }} />`)}
        ${busy["+"] && html`<div class="ck-shot"><div class="ck-shot-box">사진 넣는 중…</div></div>`}
        <div class="ck-shot"><button type="button" class="ck-shot-box add" onClick=${() => pickPhoto("+", true)}><b>+</b><span>사진 추가 (여러 장)</span></button></div></div></div>`;

  // ── 종합 ──
  const share = () => run(async () => {
    if (!navigator.onLine) throw new Error("고객 링크는 인터넷이 연결돼야 만들 수 있습니다.");
    await flush(); await sync();
    if (await pendingFor(id)) throw new Error("아직 서버에 못 올린 내용이 있습니다. 잠시 후 다시 눌러 주세요.");
    const t = rowRef.current.token || uuid().replace(/-/g, "");
    await q(app.db.from("car_checks").update({ token: t, shared_at: new Date().toISOString() }).eq("id", id).select("id"));    // 보낼 때마다 30일 다시
    setRow(r => ({ ...r, token: t }));
    await 링크보내기(`${location.origin}/check/?t=${t}`, `${row.plate || ""} 차량 검수 결과`.trim());
  });
  const unshare = () => run(async () => {
    if (!ask("고객 링크를 끌까요? 이미 보낸 링크는 더 열리지 않습니다.")) return;
    await q(app.db.from("car_checks").update({ token: null, shared_at: null }).eq("id", id).select("id"));
    setRow(r => ({ ...r, token: null }));
  }, "고객 링크를 껐습니다");
  const copy = async () => {
    const text = 요약글(row, d, 시각(row.created_at));
    try { await navigator.clipboard.writeText(text); setCopyText(""); toast("요약을 복사했습니다"); } catch { setCopyText(text); }
  };
  const remove = () => run(async () => {
    if (!ask(`${row.plate || "이"} 검수 기록과 사진을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
    clearTimeout(timer.current); timer.current = null;
    const paths = [...Object.values(d.photos), ...d.extra.map(x => x.path)].filter(Boolean);
    await q(app.db.from("car_checks").delete().eq("id", id).select("id"));
    const server = [];
    for (const p of paths) { if (await localPhoto(p).catch(() => null)) await dropPhoto(p); else server.push(p); }
    if (server.length) await app.db.storage.from("car-files").remove(server);
    await dropLocal(id);
    toast("검수를 지웠습니다"); go("/checks");
  });
  const summary = () => {
    const st = 진행(d), acc = 사고판단(d), iss = 문제목록(d), etc = 기타외판(d), done = row.status === "완료";
    return html`
      <div class="ck-sum">
        <div class=${"ck-sumbox t-" + acc.tone}><span>사고 판단</span><b>${acc.label}</b><small>${acc.parts.join(" · ") || "외판 교환·골격 수리 없음"}</small></div>
        <div class="ck-sumbox"><span>점검 진행</span><b>${st.done}/${st.total}</b><small>${st.total - st.done ? `${st.total - st.done}개 미확인` : "모든 항목 확인"}</small></div>
        <div class=${"ck-sumbox t-" + (st.bad ? "bad" : st.warn ? "warn" : "ok")}><span>불량 · 주의</span><b>${st.bad} · ${st.warn}</b><small>사진 ${사진수(d)}/${필수컷.length}컷</small></div>
      </div>
      <div class="ck-group"><div class="ck-group-h">확인 필요 항목 <span class="muted">누르면 그 구역으로</span></div>
        ${iss.length || etc.length ? html`${iss.map(x => html`<button type="button" class="ck-issue" onClick=${() => goSec(x.sec)}><span class=${"ck-pill t-" + x.tone}>${상태이름[x.tone]}</span>
            <span class="grow"><b>${x.name}</b>${x.note && html`<small>${x.note}</small>`}</span><small class="muted">${구역.find(s => s[0] === x.sec)[1]}</small></button>`)}
          ${etc.map(t => html`<button type="button" class="ck-issue" onClick=${() => goSec("body")}><span class="ck-pill t-minor">외판</span><span class="grow"><b>${t}</b></span><small class="muted">외판·골격</small></button>`)}`
          : html`<p class="muted" style="padding:14px 16px;margin:0">불량·주의로 표시한 항목이 없습니다.</p>`}
      </div>
      <div class="ck-group"><div class="ck-group-h">판정 <span class="muted">${종류[row.kind]}</span></div>
        <div class="ck-form">
          <div class="ck-f w3"><div class="ck-verdict">${판정목록(row.kind).map(([k, l]) => html`<button type="button" class=${"t-" + 판정색[k] + (d.verdict === k ? " on" : "")}
            onClick=${() => upd(x => { x.verdict = x.verdict === k ? "" : k; })}>${l}</button>`)}</div></div>
          <label class="ck-f"><span>예상 상품화 비용 (원)</span><${Money} value=${d.cost} onInput=${v => upd(x => { x.cost = v; })} /><small>고객 링크에 보입니다</small></label>
          <label class="ck-f"><span>${매입류 ? "제시 매입가 (원)" : "판매가 (원)"}</span><${Money} value=${d.price} onInput=${v => upd(x => { x.price = v; })} /><small>${매입류 ? "고객 링크에 보입니다" : ""}</small></label>
          <label class="ck-f w3"><span>종합 메모 (사무실만)</span><textarea rows="3" placeholder="고객 요구사항, 협의 내용, 상품화 계획" value=${d.memo} onInput=${e => { const t = e.target.value; upd(x => { x.memo = t; }); }} /></label>
        </div></div>
      <div class="ck-actions">
        ${done ? html`<button class="btn" onClick=${() => upd((x, r) => { r.status = "진행"; r.completed_at = null; })}>다시 검수 중으로</button>`
          : html`<button class="btn primary" onClick=${() => { upd((x, r) => { r.status = "완료"; r.completed_at = new Date().toISOString(); }); toast("검수 완료로 저장했습니다"); }}>검수 완료</button>`}
        <button class="btn" onClick=${share}>${row.token ? "고객 링크 다시 보내기" : "고객에게 결과 보내기"}</button>
        <button class="btn" onClick=${copy}>요약 복사</button>
        ${매입류 && !row.car_id && html`<button class="btn" onClick=${async () => { await flush(); await sync(); go("/cars/new?check=" + id); }}>제시차량으로 등록</button>`}
        ${row.car_id && html`<a class="btn" href=${"#/car/" + row.car_id}>차량 화면으로</a>`}
      </div>
      ${row.token && html`<p class="note">고객 링크가 켜져 있습니다 (보낸 날부터 30일). 고객은 점검 결과·사진·불량 메모·상품화 비용${매입류 ? "·제시 매입가" : ""}만 봅니다. <a href="#" onClick=${e => { e.preventDefault(); unshare(); }}>링크 끄기</a></p>`}
      ${copyText && html`<label class="ck-f"><span>자동 복사가 막혀 있습니다. 아래 글을 길게 눌러 복사하세요.</span><textarea rows="10" readonly value=${copyText} /></label>`}
      ${done && html`<p class="note">${시각(row.completed_at)} 검수 완료</p>`}
      <div class="ck-danger"><span class="muted small">검수 기록과 사진을 모두 지웁니다.</span><button class="btn danger sm" onClick=${remove}>이 검수 삭제</button></div>`;
  };

  const idx = 구역.findIndex(s => s[0] === sec), prev = 구역[idx - 1], next = 구역[idx + 1];
  const content = sec === "basic" ? basic() : sec === "body" ? body() : sec === "under" ? under() : sec === "photos" ? photos() : sec === "summary" ? summary() : Group(null, 점검항목[sec]);
  const navCount = k => {
    if (점검항목[k]) {
      const st = 진행(d, k), acc = k === "body" ? 사고판단(d) : null;
      const tone = st.bad || acc?.tone === "bad" ? "bad" : st.warn || acc?.tone === "warn" ? "warn" : "";
      return html`${tone ? html`<i class=${"dot t-" + tone}></i>` : ""}<small>${st.done}/${st.total}</small>`;
    }
    if (k === "photos") return html`<small>${사진수(d)}/${필수컷.length}</small>`;
    if (k === "summary" && d.verdict) return html`<i class=${"dot t-" + 판정색[d.verdict]}></i>`;
    return "";
  };
  return html`<div class="ck-page ck-edit">
    <div class="ck-head">
      <a class="back" href="#/checks">← 검수 목록</a>
      <div class="ck-head-id"><${Plate} p=${row.plate} /><b>${row.car_name}</b><span class="ck-pill t-pri">${종류[row.kind]}</span></div>
      <${SyncChip} />
    </div>
    <div class="ck-sechead"><h2>${구역[idx][1]}</h2><p>${구역설명[sec]}</p></div>
    ${content}
    <div class="ck-secfoot">${prev && html`<button class="btn" onClick=${() => goSec(prev[0])}>이전</button>`}${next && html`<button class="btn primary" onClick=${() => goSec(next[0])}>다음 · ${next[1]}</button>`}</div>
    <nav class="ck-dock" aria-label="검수 구역">${구역.map(([k, l]) => html`<button type="button" class=${sec === k ? "on" : ""} onClick=${() => goSec(k)}><span>${l}</span><span class="ck-dock-c">${navCount(k)}</span></button>`)}</nav>
    <input type="file" accept="image/*" hidden ref=${fileRef} onChange=${e => { const fs = [...e.target.files]; e.target.value = ""; onFiles(fs); }} />
    ${penPhoto && html`<${PhotoPen} app=${app} path=${penPhoto.path} label=${penPhoto.label} mark=${d.marks[penPhoto.path]} onClose=${() => setPenPhoto(null)}
      onSave=${m => { const p = penPhoto.path; upd(x => { if (m) x.marks[p] = m; else delete x.marks[p]; }); setPenPhoto(null); toast("사진 표시를 저장했습니다"); }} />`}
  </div>`;
}
