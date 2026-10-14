// 차량 검수 — 점검표 정의와 판단 계산. 화면·고객 페이지·서버 함수가 같이 쓴다 (DOM 없음).
//   업무관리: build.mjs 가 web/js/shared/ 로 복사   고객 페이지(tieronekorea.com/check): --deploy 가 check/ 로 복사
//   서버 함수 check: 고객에게 보낼 값만 골라내는 고객용() 을 여기서 가져간다
// 외판·골격 기호와 사고 판단은 성능·상태점검기록부 기준을 따른다.

export const 구역 = [
  ["basic", "기본정보·서류"], ["body", "외판·골격"], ["engine", "엔진룸"], ["under", "하체·타이어"],
  ["interior", "실내·전장"], ["drive", "시운전"], ["photos", "사진"], ["summary", "종합 판정"],
];
export const 구역설명 = {
  basic: "차량 정보를 입력하고 서류를 대조합니다.",
  body: "도면에서 부위를 누르고 상태 기호를 고르세요. 기호는 성능상태점검기록부와 같습니다.",
  engine: "가능하면 엔진이 식은 상태에서 시동부터 확인하세요.",
  under: "리프트가 없으면 보이는 곳까지만 확인합니다. 트레드는 가장 얕은 홈을 잽니다.",
  interior: "침수 흔적은 안전벨트를 끝까지 당겨 보면 가장 빨리 보입니다.",
  drive: "저속·고속·제동·요철을 한 번씩 지나가 보세요.",
  photos: "칸을 누르면 카메라나 사진 보관함이 열립니다. 사진은 줄여서 올라갑니다.",
  summary: "불량·주의 항목을 모아 보고 판정을 남깁니다.",
};

// [키, 이름, 확인 방법]
export const 점검항목 = {
  basic: [
    ["vin_match", "차대번호 일치", "등록증 VIN과 차체 각인·앞유리 하단 표기가 같은지"],
    ["lien", "압류·저당", "자동차 등록원부로 압류·저당 건수 확인"],
    ["history", "보험 이력", "카히스토리 내차피해·전손·침수·용도변경 기록"],
    ["service", "정비 이력", "정비 수첩·영수증, 엔진오일 교환 주기"],
    ["recall", "리콜 이행", "미이행 리콜이 있으면 메모"],
    ["smartkey", "스마트키 작동", "잠금·해제·트렁크 버튼, 키 배터리"],
  ],
  body: [
    ["bolts", "볼트 공구 자국", "후드·휀더·도어·트렁크 힌지 볼트의 도색이 깨졌는지"],
    ["sealer", "실러 재작업", "트렁크 바닥·엔진룸 실러 모양이 공장 상태와 다른지"],
    ["gap", "단차·색 차이", "패널 사이 틈이 고른지, 빛에 비춰 도장 색이 다른지"],
    ["glass", "유리 연도", "유리 마크 생산연도가 차량 연식과 맞는지"],
    ["lamps", "램프류", "헤드·테일램프 파손, 습기, 좌우 연식 차이"],
    ["wheels", "휠 상태", "휠 4개 긁힘·크랙·변형"],
  ],
  engine: [
    ["start", "시동", "냉간 시동, 시동 시 잡소리·지연"],
    ["idle", "공회전", "떨림, RPM이 고르게 유지되는지"],
    ["oil", "엔진오일", "양과 오염도, 오일캡 안쪽 슬러지·유화"],
    ["oil_leak", "엔진 누유", "헤드커버·오일팬·타이밍커버 주변"],
    ["coolant", "냉각수", "양·색, 라디에이터·호스·워터펌프 누수"],
    ["belt", "벨트·풀리", "갈라짐, 회전 소음"],
    ["smoke", "배기 연기", "흰 연기(냉각수)·파란 연기(오일)·검은 연기(연료)"],
    ["atf", "미션 누유", "미션 케이스·쿨러 라인"],
    ["battery", "배터리", "전압, 제조일, 단자 부식"],
    ["mounts", "엔진 마운트", "시동·변속 시 엔진 출렁임"],
  ],
  under: [
    ["brake", "브레이크", "패드 잔량, 디스크 단차·녹"],
    ["shock", "쇼크업소버", "4곳 누유, 눌렀을 때 복원"],
    ["boot", "등속조인트 부트", "찢어짐, 그리스 비산"],
    ["rust", "하체 부식", "서브프레임·머플러·브레이크 라인 녹"],
    ["steering", "조향 장치", "스티어링 기어·랙 부트 누유, 유격"],
    ["uneven", "타이어 편마모", "한쪽만 닳았으면 얼라인먼트 확인"],
  ],
  interior: [
    ["warning", "계기판 경고등", "시동 후 꺼지지 않는 경고등"],
    ["aircon", "에어컨·히터", "찬바람·더운바람, 풍량 단계, 냄새"],
    ["seats", "시트", "오염·찢어짐·꺼짐, 전동 조절"],
    ["heat", "열선·통풍", "시트·핸들 열선, 통풍 시트"],
    ["media", "디스플레이·오디오", "내비, 블루투스, 스피커 잡음"],
    ["camera", "카메라·센서", "후방카메라, 360뷰, 주차 센서"],
    ["windows", "창문·미러", "파워윈도우 4개, 사이드미러 폴딩·조절"],
    ["sunroof", "선루프", "열림·닫힘, 천장 물 자국"],
    ["smell", "냄새", "담배·곰팡이, 방향제로 덮은 냄새"],
    ["flood", "침수 흔적", "안전벨트 끝 진흙, 시트레일·바닥 매트 아래 녹"],
    ["headliner", "천장·내장재", "헤드라이닝 처짐, 내장 트림 파손"],
    ["trunk_in", "트렁크 내부", "매트 아래 물고임, 스페어·리페어 킷"],
  ],
  drive: [
    ["shift", "변속", "변속 충격, 지연, 슬립"],
    ["accel", "가속", "출력 부족, 가속 시 이상음"],
    ["straight", "직진성", "핸들을 살짝 놓았을 때 한쪽으로 쏠림"],
    ["braking", "제동", "제동 시 쏠림, 페달 떨림"],
    ["vibration", "핸들 떨림", "80km/h 이상에서 핸들·차체 떨림"],
    ["noise", "하체 소음", "과속방지턱·요철 통과 시 잡소리"],
    ["adas", "주행 보조", "크루즈, 차선 유지, 전방 경고"],
    ["drive_warn", "주행 중 경고등", "주행 중 새로 켜지는 경고등"],
  ],
};
export const 항목찾기 = {};
for (const [sec, arr] of Object.entries(점검항목)) for (const [k, n] of arr) 항목찾기[k] = { sec, name: n };

export const 상태이름 = { ok: "양호", warn: "주의", bad: "불량" };
export const 기호 = { X: "교환", W: "판금·용접", A: "흠집", U: "요철", C: "부식", T: "손상" };
export const 기호색 = c => c === "X" ? "bad" : c === "W" ? "warn" : "minor";
export const 가장나쁜색 = arr => !arr || !arr.length ? "" : arr.includes("X") ? "bad" : arr.includes("W") ? "warn" : "minor";

// 외판 도면 (viewBox 0 0 340 600, 위가 차량 앞쪽, 왼쪽이 운전석). rank: E 범퍼, 1·2 외판 랭크
export const 외판 = [
  { k: "bumper_f", n: "앞범퍼", rank: "E", d: "M62 54 Q62 20 122 16 H218 Q278 20 278 54 Z", cx: 170, cy: 40 },
  { k: "hood", n: "후드", rank: "1", d: "M112 62 H228 Q234 62 234 68 L236 188 H104 L106 68 Q106 62 112 62 Z", cx: 170, cy: 128 },
  { k: "fender_fl", n: "앞휀더 좌", s: "앞휀더", rank: "1", d: "M44 92 Q44 64 72 62 H98 V188 H44 Z", cx: 71, cy: 128 },
  { k: "fender_fr", n: "앞휀더 우", s: "앞휀더", rank: "1", d: "M296 92 Q296 64 268 62 H242 V188 H296 Z", cx: 269, cy: 128 },
  { k: "door_fl", n: "앞도어 좌", s: "앞도어", rank: "1", d: "M44 196 H98 V306 H44 Z", cx: 71, cy: 254 },
  { k: "door_fr", n: "앞도어 우", s: "앞도어", rank: "1", d: "M242 196 H296 V306 H242 Z", cx: 269, cy: 254 },
  { k: "door_rl", n: "뒷도어 좌", s: "뒷도어", rank: "1", d: "M44 312 H98 V420 H44 Z", cx: 71, cy: 369 },
  { k: "door_rr", n: "뒷도어 우", s: "뒷도어", rank: "1", d: "M242 312 H296 V420 H242 Z", cx: 269, cy: 369 },
  { k: "roof", n: "루프", rank: "2", d: "M116 242 H224 Q232 242 232 250 V372 Q232 380 224 380 H116 Q108 380 108 372 V250 Q108 242 116 242 Z", cx: 170, cy: 314 },
  { k: "trunk", n: "트렁크리드", s: "트렁크", rank: "1", d: "M104 428 H236 L234 522 Q234 530 226 530 H114 Q106 530 106 522 Z", cx: 170, cy: 482 },
  { k: "quarter_l", n: "뒷휀더(쿼터) 좌", s: "뒷휀더", rank: "2", d: "M44 428 H98 V530 H72 Q44 528 44 502 Z", cx: 71, cy: 482 },
  { k: "quarter_r", n: "뒷휀더(쿼터) 우", s: "뒷휀더", rank: "2", d: "M296 428 H242 V530 H268 Q296 528 296 502 Z", cx: 269, cy: 482 },
  { k: "sill_l", n: "사이드실 좌", s: "", rank: "2", d: "M24 196 H38 V420 H24 Z", cx: 31, cy: 308 },
  { k: "sill_r", n: "사이드실 우", s: "", rank: "2", d: "M302 196 H316 V420 H302 Z", cx: 309, cy: 308 },
  { k: "bumper_r", n: "뒷범퍼", rank: "E", d: "M62 540 H278 Q278 574 218 580 H122 Q62 574 62 540 Z", cx: 170, cy: 562 },
];
export const 랭크이름 = { E: "범퍼 · 볼트 체결", 1: "외판 1랭크", 2: "외판 2랭크 · 절단·용접 시 사고", A: "주요골격 A랭크", B: "주요골격 B랭크", C: "주요골격 C랭크" };
export const 골격 = [
  { k: "radiator", n: "라디에이터 서포트", rank: "1" },
  { k: "front_panel", n: "프론트 패널", rank: "A" }, { k: "cross", n: "크로스 멤버", rank: "A" },
  { k: "inside_l", n: "인사이드 패널 좌", rank: "A" }, { k: "inside_r", n: "인사이드 패널 우", rank: "A" },
  { k: "rear_panel", n: "리어 패널", rank: "A" }, { k: "trunk_floor", n: "트렁크 플로어", rank: "A" },
  { k: "sm_fl", n: "사이드멤버 앞 좌", rank: "B" }, { k: "sm_fr", n: "사이드멤버 앞 우", rank: "B" },
  { k: "sm_rl", n: "사이드멤버 뒤 좌", rank: "B" }, { k: "sm_rr", n: "사이드멤버 뒤 우", rank: "B" },
  { k: "wh_fl", n: "휠하우스 앞 좌", rank: "B" }, { k: "wh_fr", n: "휠하우스 앞 우", rank: "B" },
  { k: "wh_rl", n: "휠하우스 뒤 좌", rank: "B" }, { k: "wh_rr", n: "휠하우스 뒤 우", rank: "B" },
  { k: "pa_l", n: "A필러 좌", rank: "B" }, { k: "pa_r", n: "A필러 우", rank: "B" },
  { k: "pb_l", n: "B필러 좌", rank: "B" }, { k: "pb_r", n: "B필러 우", rank: "B" },
  { k: "pc_l", n: "C필러 좌", rank: "B" }, { k: "pc_r", n: "C필러 우", rank: "B" },
  { k: "package", n: "패키지 트레이", rank: "B" },
  { k: "dash", n: "대쉬 패널", rank: "C" }, { k: "floor", n: "플로어 패널", rank: "C" },
];
export const 골격기호 = ["X", "W", "C", "T"];

export const 타이어위치 = [["fl", "앞 좌"], ["fr", "앞 우"], ["rl", "뒤 좌"], ["rr", "뒤 우"]];
export const 필수컷 = [
  ["front", "전면 45°"], ["rear", "후면 45°"], ["left", "좌측면"], ["right", "우측면"],
  ["dash", "계기판 주행거리"], ["engine", "엔진룸"], ["vin", "차대번호 각인"], ["seat_f", "앞좌석"],
  ["seat_r", "뒷좌석"], ["trunk", "트렁크"], ["tire", "타이어 트레드"], ["under", "하체"],
];
export const 종류 = { 매입: "매입 검수", 대차: "대차 고객 차", 상품화: "상품화 점검", 출고: "출고 전 점검" };
export const 판정목록 = kind => kind === "매입" || kind === "대차"
  ? [["go", "매입"], ["cond", "조건부 매입"], ["hold", "보류"], ["no", "매입 안 함"]]
  : [["go", "출고 가능"], ["cond", "수리 후 출고"], ["hold", "보류"], ["no", "출고 불가"]];
export const 판정색 = { go: "ok", cond: "warn", hold: "muted", no: "bad" };
export const 연료 = ["가솔린", "디젤", "LPG", "하이브리드", "전기"];

// 펜 그림 — 선 하나 = { c: 색, w: 굵기, p: [x, y, x, y, …] }. 사진 표시는 사진 원본 픽셀 좌표, 도면 그림은 도면 좌표(340×600).
//   data.marks = { [사진 경로]: { w, h, s: [선…] } }   data.sketch = [선…]   원본 사진은 그대로 두고 위에 겹쳐 그린다.
export const 펜색 = [["#ff2d2d", "빨강"], ["#ffd400", "노랑"], ["#2f7bff", "파랑"]];
export const 선점 = p => { let s = ""; for (let i = 0; i + 1 < p.length; i += 2) s += p[i] + "," + p[i + 1] + " "; return s.trim(); };
const 선정리 = arr => (Array.isArray(arr) ? arr : []).filter(x => x && Array.isArray(x.p) && x.p.length >= 2)
  .map(x => ({ c: /^#[0-9a-f]{6}$/i.test(x.c) ? x.c : "#ff2d2d", w: Math.min(Math.max(Number(x.w) || 2, 0.5), 200), p: x.p.slice(0, 4000).map(Number) }));

/** 새 검수의 data (표 칸 plate·car_name·kind·status 는 따로) */
export function 빈검수data(inspector = "") {
  const tires = {}; for (const [p] of 타이어위치) tires[p] = { mm: "", dot: "" };
  return { info: { year: "", km: "", fuel: "", color: "", vin: "", inspector, place: "", keys: 2, customer: "", phone: "" },
    items: {}, panels: {}, frame: {}, tires, photos: {}, extra: [], marks: {}, sketch: [], verdict: "", cost: 0, price: 0, memo: "" };
}
/** 저장된 data 를 빠진 칸 없이 (옛 기록·다른 기기에서 온 기록) */
export function 검수정리(d) {
  const b = 빈검수data(), x = d && typeof d === "object" ? d : {};
  const out = { ...b, ...x, info: { ...b.info, ...(x.info || {}) }, tires: {} };
  for (const [p] of 타이어위치) out.tires[p] = { ...b.tires[p], ...((x.tires || {})[p] || {}) };
  for (const k of ["items", "panels", "frame", "photos", "marks"]) out[k] = x[k] && typeof x[k] === "object" && !Array.isArray(x[k]) ? x[k] : {};
  out.extra = Array.isArray(x.extra) ? x.extra : [];
  out.sketch = Array.isArray(x.sketch) ? x.sketch : [];
  return out;
}

/** 타이어 생산 후 지난 해 (DOT 4자리 = 주차 2 + 연도 2, 예: 2423 = 2023년 24주) */
export function 타이어연수(dot, now = Date.now()) {
  if (!/^\d{4}$/.test(dot || "")) return null;
  const wk = +dot.slice(0, 2), yr = 2000 + +dot.slice(2);
  if (wk < 1 || wk > 53) return null;
  return (now - Date.UTC(yr, 0, 1 + (wk - 1) * 7)) / (365.25 * 864e5);
}
/** 트레드 1.6mm 미만 불량(법정 한계) · 3mm 미만 주의 · 생산 6년 이상 주의. 깊이를 안 넣었으면 "" */
export function 타이어상태(t, now = Date.now()) {
  const mm = parseFloat(String(t?.mm ?? "").replace(",", "."));
  if (isNaN(mm)) return "";
  let s = mm < 1.6 ? "bad" : mm < 3 ? "warn" : "ok";
  const age = 타이어연수(t.dot, now);
  if (s === "ok" && age != null && age >= 6) s = "warn";
  return s;
}

/** 점검 항목(+타이어) 진행: 전체 / 확인 / 불량 / 주의. sec 를 주면 그 구역만 */
export function 진행(d, sec) {
  let total = 0, done = 0, bad = 0, warn = 0;
  for (const [k, arr] of Object.entries(점검항목)) {
    if (sec && k !== sec) continue;
    for (const [key] of arr) { total++; const s = d.items?.[key]?.s; if (s) { done++; if (s === "bad") bad++; if (s === "warn") warn++; } }
  }
  if (!sec || sec === "under") for (const [p] of 타이어위치) {
    total++; const s = 타이어상태(d.tires?.[p]); if (s) { done++; if (s === "bad") bad++; if (s === "warn") warn++; }
  }
  return { total, done, bad, warn };
}

/** 사고 판단 — 주요골격 교환·판금·용접, 또는 2랭크 외판(쿼터·루프·사이드실) 교환·용접이면 사고.
 *  나머지 외판·범퍼·라디에이터 서포트의 교환·판금은 단순 교환. 흠집·요철·부식·손상은 판단에 넣지 않는다. */
export function 사고판단(d) {
  const hit = c => (c || []).some(x => x === "X" || x === "W");
  const 글 = (n, c) => n + " " + c.join("");
  const frame = 골격.filter(f => f.rank !== "1" && hit(d.frame?.[f.k])).map(f => 글(f.n, d.frame[f.k]));
  const r2 = 외판.filter(p => p.rank === "2" && hit(d.panels?.[p.k])).map(p => 글(p.n, d.panels[p.k]));
  const outer = 외판.filter(p => p.rank !== "2" && hit(d.panels?.[p.k])).map(p => 글(p.n, d.panels[p.k]));
  if (hit(d.frame?.radiator)) outer.push(글("라디에이터 서포트", d.frame.radiator));
  if (frame.length || r2.length) return { tone: "bad", label: "사고 이력", short: "사고", parts: [...frame, ...r2, ...outer] };
  if (outer.length) return { tone: "warn", label: "단순 교환·판금", short: "단순교환", parts: outer };
  return { tone: "ok", label: "교환·판금 없음", short: "", parts: [] };
}
/** 사고 판단에 안 들어가는 외판·골격 표시 (흠집·요철·부식·손상) */
export function 기타외판(d) {
  const out = [];
  const add = (n, c) => { const r = (c || []).filter(x => x !== "X" && x !== "W"); if (r.length) out.push(n + " " + r.map(x => `${x}(${기호[x]})`).join(" ")); };
  for (const p of 외판) add(p.n, d.panels?.[p.k]);
  for (const f of 골격) add(f.n, d.frame?.[f.k]);
  return out;
}
/** 불량·주의 항목 (불량 먼저) */
export function 문제목록(d, now = Date.now()) {
  const out = [];
  for (const [k, v] of Object.entries(d.items || {})) {
    if (!항목찾기[k] || (v?.s !== "bad" && v?.s !== "warn")) continue;
    out.push({ tone: v.s, name: 항목찾기[k].name, note: v.note || "", sec: 항목찾기[k].sec });
  }
  for (const [p, label] of 타이어위치) {
    const t = d.tires?.[p], s = 타이어상태(t, now);
    if (s !== "bad" && s !== "warn") continue;
    const age = 타이어연수(t.dot, now);
    out.push({ tone: s, name: "타이어 " + label, note: `트레드 ${t.mm}mm` + (age != null ? ` · 생산 ${Math.floor(age)}년 지남` : ""), sec: "under" });
  }
  return out.sort((a, b) => (a.tone === "bad" ? 0 : 1) - (b.tone === "bad" ? 0 : 1));
}
export const 사진수 = d => 필수컷.filter(([k]) => d.photos?.[k]).length;
export const 판정이름 = (kind, v) => (판정목록(kind).find(x => x[0] === v) || [])[1] || "";

const 원 = n => Number(n || 0).toLocaleString("ko-KR");
/** 웍스·카톡에 붙여 넣는 요약 (사무실용 — 매입가·메모 포함) */
export function 요약글(row, d, when = "") {
  const i = d.info, L = [];
  L.push(`[${종류[row.kind] || "검수"}] ${row.plate || "번호 미입력"} ${row.car_name || ""}`.trim());
  const meta = [i.year, i.km ? 원(i.km) + "km" : "", i.fuel, i.color].filter(Boolean).join(" · ");
  if (meta) L.push(meta);
  L.push(`검수 ${when}${i.inspector ? " · " + i.inspector : ""} · ${row.status === "완료" ? "완료" : "진행중"}`);
  const acc = 사고판단(d);
  L.push(`사고 판단: ${acc.label}${acc.parts.length ? " (" + acc.parts.join(", ") + ")" : ""}`);
  const etc = 기타외판(d); if (etc.length) L.push("외판 기타: " + etc.join(", "));
  if (d.verdict) L.push("판정: " + 판정이름(row.kind, d.verdict));
  if (Number(d.cost)) L.push(`예상 상품화 비용: ${원(d.cost)}원`);
  if (Number(d.price)) L.push(`${row.kind === "매입" || row.kind === "대차" ? "제시 매입가" : "판매가"}: ${원(d.price)}원`);
  const iss = 문제목록(d);
  if (iss.length) { L.push(""); for (const x of iss) L.push(`- [${상태이름[x.tone]}] ${x.name}${x.note ? ": " + x.note : ""}`); }
  if (d.memo) { L.push(""); L.push("메모: " + d.memo); }
  return L.join("\n");
}

/** 고객 링크로 내보낼 값만 (사용자 2026-10-13: 점검 결과·사진, 불량·주의 메모, 예상 상품화 비용, 제시 매입가).
 *  빼는 것: 종합 메모, 판정, 고객 이름·연락처, 차대번호, 검수 장소, 양호 항목에 적은 메모. 사진은 경로만 — 서버가 임시 주소로 바꾼다. */
export function 고객용(row, raw) {
  const d = 검수정리(raw);
  const items = {};
  for (const [k, v] of Object.entries(d.items)) {
    if (!항목찾기[k] || !v?.s) continue;
    items[k] = v.s === "ok" ? { s: "ok" } : { s: v.s, note: String(v.note || "").slice(0, 500) };
  }
  const 표시 = path => { const m = d.marks[path]; return m && m.w > 0 && m.h > 0 ? { w: +m.w, h: +m.h, s: 선정리(m.s) } : null; };
  const photos = 필수컷.filter(([k]) => d.photos[k]).map(([k, label]) => ({ label, path: d.photos[k], mark: 표시(d.photos[k]) }));
  for (const x of d.extra) if (x?.path) photos.push({ label: String(x.cap || "추가 사진").slice(0, 80), path: x.path, mark: 표시(x.path) });
  return {
    plate: row.plate, car_name: row.car_name, kind: row.kind, status: row.status,
    created_at: row.created_at, completed_at: row.completed_at,
    info: { year: d.info.year, km: d.info.km, fuel: d.info.fuel, color: d.info.color, inspector: d.info.inspector },
    items, panels: d.panels, frame: d.frame, tires: d.tires, photos, sketch: 선정리(d.sketch),
    cost: Number(d.cost) || 0, price: Number(d.price) || 0,
  };
}
