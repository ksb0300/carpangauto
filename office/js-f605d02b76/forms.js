// 게시판 양식 — 송금요청·매도정보의 칸(form) 읽기·글로 쓰기. 브라우저와 node(테스트·옛 글 채우기) 모두에서 쓰는 순수 함수.
// 송금요청은 엔카·헤이딜러 알림을 그대로 붙여넣는 경우가 절반 — 라벨(입금금액·예금주·계좌…)을 먼저 읽고, 없으면 계좌번호 앞뒤에서 찾는다.
// 금액 + 예금주가 있어야 통장 출금과 자동으로 짝지을 수 있다 (DB 함수 board_match_payments).

export const 송금종류 = ["매입대금", "수수료", "업무비"];
export const 매도형태들 = ["내수", "수출", "엔카믿고"];
const PLATE = /(\d{2,3})\s*([가-힣])\s*(\d{4})/;
const BANK = /(카카오페이증권|카카오뱅크|케이뱅크|토스뱅크|우체국|새마을금고|새마을|신협|수협|SC제일|씨티|(?:국민|신한|우리|하나|기업|부산|경남|대구|광주|전북|제주|농협|산업|KB|NH|IBK|BNK)(?:은행)?)(?![가-힣])/;
const ACC = /(?<![\d-])(\d[\d -]{8,}\d)(?![\d-]|\s*[만원,.])/;      // 숫자 10자리 이상(띄어쓰기·하이픈 허용) — 바로 뒤가 '만·원'이면 금액이라 아님
const 전화 = /^0(?:1[016789]|2|[3-6]\d)[- ]?\d{3,4}[- ]?\d{4}$/;
const 라벨들 = /^(차량매입금|고객 계좌 번호|고객 성함|매입경로|템플릿|수정|작성자|최근 수정자)/;

/** "1,311만원" 13110000 / "365,000원" 365000 / "4만원" 40000 / "15000원입니다" 15000 — 못 읽으면 null */
export function 금액(s) {
  const t = String(s ?? "").replace(/\s/g, "");
  let m = t.match(/(\d[\d,]*(?:\.\d+)?)만(\d[\d,]*)?원?/);
  if (m) return Math.round(parseFloat(m[1].replace(/,/g, "")) * 10000) + (m[2] ? Number(m[2].replace(/,/g, "")) : 0);
  m = t.match(/(\d[\d,]*)원/) || t.match(/^(\d[\d,]*)$/);
  return m ? Number(m[1].replace(/,/g, "")) || null : null;
}
export const 원 = n => (Number(n) || 0).toLocaleString("ko-KR") + "원";
export const 번호판 = s => { const m = String(s ?? "").match(PLATE); return m ? m.slice(1).join("") : null; };
/** 이름 비교용 — 통장은 받는 이름을 잘라 적는다 ("(주)피알앤디컴퍼", "엔카닷컴 주식회") */
export const 이름키 = s => String(s ?? "").toLowerCase().replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|[\s()[\]·.,-]/g, "");

/** 괄호 짝 맞추기 — "(주)피알앤디컴퍼니)" → "(주)피알앤디컴퍼니" */
const 짝 = s => { let t = String(s || "").trim(); while ((t.match(/\)/g) || []).length > (t.match(/\(/g) || []).length && t.endsWith(")")) t = t.slice(0, -1).trim(); return t; };

/** 라벨 값: 라벨은 줄 맨 앞(▶·*- 뒤)에 있을 때만 — "우리은행"의 '은행'을 라벨로 착각하지 않게.
 *  같은 줄 나머지, 비었으면 다음 줄 (다음 줄이 다른 라벨이면 없음). colon=true 면 ':' 이 있어야 라벨 */
function 값(s, label, colon = false) {
  const m = s.match(new RegExp("(?:^|\\n)[ \\t]*[▶·*\\-]?[ \\t]*" + label + "[ \\t]*" + (colon ? "[:：]" : "[:：]?") + "[ \\t]*([^\\n]*)(?:\\n+[ \\t]*([^\\n]+))?"));
  if (!m) return null;
  const v = 짝((m[1].trim() || (m[2] || "").trim()).replace(/^[:：\s]+/, ""));
  return v && !라벨들.test(v) && !/^[▶·*-]/.test(v) ? v : null;
}

/** 계좌 줄 하나에서 은행·계좌·예금주 */
function 계좌줄(line) {
  const out = {};
  let s = String(line || "");
  const pm = s.match(/\(\s*예금주\s*[:：]?\s*(.+)\)\s*$/) || s.match(/예금주\s*[:：]?\s*(.+)$/);
  if (pm) { out.payee = 짝(pm[1]); s = s.replace(pm[0], " "); }
  const b = s.match(BANK); if (b) { out.bank = b[1]; s = s.replace(b[1], " "); }
  const a = s.match(ACC); if (a && !전화.test(a[1].trim())) { out.account = a[1].trim(); s = s.replace(a[1], " "); }
  if (!out.payee) {
    const rest = s.replace(/\d[\d,.]*\s*만?\s*원[가-힣]*/g, " ").replace(/입금[가-힣 ]*|부탁[가-힣]*|입니다|하면 ?됨|감사[가-힣]*/g, " ").trim();
    const tok = rest.split(/\s+/).find(w => /[가-힣A-Za-z]{2,}/.test(w));
    if (tok) out.payee = tok.replace(/(으로|로|에게|님|입니다)$/, "").trim() || null;
  }
  return out;
}

/** 송금요청 글(붙여넣은 알림·딜러 양식·자유글) → 칸. author 는 '나한테 입금' 일 때 받는 사람 */
export function 송금읽기(text, { title = "", author = "" } = {}) {
  const s = String(text ?? "").replace(/\r/g, "").replace(/ /g, " ");
  const all = title + "\n" + s;
  const f = {};
  f.kind = /수수료|이용권/.test(all) && !/차대금|차량대금|차량매입금/.test(s) ? "수수료" : /차대금|차량대금|차량매입금|\[딜러\]송금요청|매입송금/.test(all) ? "매입대금" : "업무비";
  if (/이용권|광고비/.test(all)) f.kind = "업무비";
  const 헤이 = /헤이딜러|차대금 입금 요청|zero 거래|피알앤디/.test(s), 엔카 = /엔카/.test(s);
  f.route = f.kind === "업무비" ? null : 헤이 ? "헤이딜러" : 엔카 ? "엔카" : null;
  f.plate = 번호판(s) || 번호판(title);

  // 금액: 라벨 먼저 (매입가·내견적은 보낼 돈이 아님)
  for (const re of [/총\s*입금\s*금액\s*[:：]?\s*([\d,]+\s*원)/, /수수료\s*입금\s*금액\s*[:：]?\s*([\d,]+\s*원)/,
    /입금\s*금액\s*[:：]?\s*(?:총\s*)?([\d,]+\s*원)/, /(?:^|[\s·-])금액\s*[:：]\s*([\d,.]+\s*만?\s*원)/m, /수수료\s*[:：]?\s*([\d,]+\s*원)/]) {
    const m = s.match(re);
    if (m && (f.amount = 금액(m[1]))) break;
  }
  if (!f.amount) { const m = s.match(/차량매입금\s*\[만원\]\s*\n+\s*([\d,]+)/); if (m) f.amount = Number(m[1].replace(/,/g, "")) * 10000; }
  if (!f.amount) {
    const t = s.replace(/(매입가|내견적)\s*[:：]?\s*[\d,.]+\s*만?\s*원/g, "");
    const hits = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?\s*만\s*원?|\d[\d,]*\s*원)/g)];
    if (hits.length) f.amount = 금액(hits[hits.length - 1][1]);
  }

  // 받는 곳: 라벨(예금주·입금은행·계좌) → 계좌 줄 → 글 전체
  const 예금주 = 값(s, "예금주"), 은행 = 값(s, "(?:입금\\s*)?은행", true);
  const 줄 = 값(s, "(?:입금\\s*계좌|고객\\s*계좌\\s*번호)") || (s.match(/(?:^|\n)[ \t]*[·\-*▶]?[ \t]*계좌[ \t]*[:：][ \t]*([^\n]+)/) || [])[1];
  let c = 줄 ? 계좌줄(줄) : {};
  if (!c.account) {     // 라벨 없는 자유글: 계좌번호가 있는 줄 (+ 이름이 다음 줄에 따로 있는 경우)
    const lines = s.split("\n").map(x => x.trim()).filter(Boolean);
    const i = lines.findIndex(l => { const a = l.match(ACC); return a && !전화.test(a[1].trim()); });
    if (i >= 0) {
      c = { ...계좌줄(lines[i]), ...c };
      if (!c.bank && i > 0) { const b = lines[i - 1].match(BANK); if (b) c.bank = b[1]; }
      if (!c.payee && lines[i + 1] && /^[가-힣()㈜ ]{2,20}$/.test(lines[i + 1])) c.payee = lines[i + 1];
    }
  }
  f.bank = (은행 && (은행.match(BANK) || [])[1]) || 은행 || c.bank || null;
  f.account = c.account || null;
  f.payee = (예금주 && 예금주.replace(/^[:：\s]+/, "").trim()) || c.payee || null;
  if (!f.payee && /(나|저)한테|제\s*계좌/.test(s) && author) f.payee = author;
  if (f.payee && BANK.test(f.payee) && f.payee.match(BANK)[0] === f.payee) f.payee = null;
  // 말이 없어도: 차번호 있는 100만원 넘는 송금 / 엔카·헤이딜러로 가는 큰돈은 차값 (웍스 글 2건이 그랬다)
  if (f.kind === "업무비" && !/이용권|광고비/.test(all) && f.amount >= 1000000 && (f.plate || /엔카닷컴|피알앤디/.test(f.payee || ""))) {
    f.kind = "매입대금"; f.route = /피알앤디/.test(f.payee || "") || 헤이 ? "헤이딜러" : /엔카/.test(f.payee || "") || 엔카 ? "엔카" : null;
  }
  // 예금주를 안 적었어도 엔카·헤이딜러는 받는 곳이 정해져 있다
  if (!f.payee && (f.route === "헤이딜러" || (f.kind !== "업무비" && 헤이))) f.payee = "(주)피알앤디컴퍼니";
  else if (!f.payee && (f.route === "엔카" || /\[엔카\]|엔카닷컴/.test(s))) f.payee = "엔카닷컴";

  f.due = (s.match(/(?:탁송\s*출발|탁송일시|입금\s*기한)\s*[:：]\s*([^\n]+)/) || [])[1]?.trim() || null;
  const 고객 = 값(s, "고객\\s*성함,?\\s*주민번호");
  if (고객 && f.kind === "매입대금") f.customer = 고객;
  return f;
}

/** 송금요청 칸 → 글 (붙여넣은 원문이 있으면 원문이 본문, 없으면 이 글이 본문) */
export function 송금글(f, memo = "") {
  return [
    `종류: ${f.kind || "-"}${f.route ? ` (${f.route})` : ""}`,
    f.plate && `차량: ${f.plate}`,
    `받는 곳: ${[f.bank, f.account, f.payee].filter(Boolean).join(" ") || "-"}`,
    `금액: ${f.amount ? 원(f.amount) : "-"}`,
    f.due && `기한: ${f.due}`,
    f.customer && `고객: ${f.customer}`,
    memo && "", memo,
  ].filter(x => x !== false && x != null).join("\n").trim();
}

/** 매도정보 글('항목: 값' 줄, 옮겨 온 웍스 양식) → 칸 */
export function 매도읽기(text, { title = "" } = {}) {
  const s = String(text ?? "");
  const g = k => (s.match(new RegExp("^" + k + "\\s*:\\s*(.+)$", "m")) || [])[1]?.trim() || "";
  const 형태 = g("매도형태"), 차량 = g("차량"), 구매자 = g("구매자"), 매도 = g("매도 금액"), 계약 = g("계약금");
  const 폰 = (구매자.match(/0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/) || [])[0] || null;
  const f = {
    type: /수출/.test(형태) ? "수출" : /믿고/.test(형태) ? "엔카믿고" : 형태 ? "내수" : null,
    plate: 번호판(차량) || 번호판(title),
    car_name: 차량.replace(PLATE, "").trim() || null,
    buyer: 구매자.replace(폰 || "", "").replace(/[(),]/g, " ").replace(/\s+/g, " ").trim() || null,
    phone: 폰,
    amount: 금액(매도.replace(/매도비\s*(포함|별도)/g, "")),
    fee_included: /포함/.test(매도) ? true : /별도/.test(매도) ? false : null,
    deposit: /없음/.test(계약) ? 0 : 금액((계약.match(/\d[\d,.]*\s*만\s*원?|\d[\d,]*\s*원/) || [])[0]),
    deposit_when: (계약.match(/\d{2,4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}일?(?:\s*\d{1,2}[:시]\s*\d{0,2}분?)?|\d{1,2}월\s*\d{1,2}일(?:\s*\d{1,2}시\s*\d{0,2}분?)?|\d{1,2}\/\d{1,2}/) || [])[0] || null,
  };
  if (f.buyer === "-") f.buyer = null;
  return f;
}

/** 매도정보 칸 → 글 ('항목: 값' — 웍스에서 옮겨 온 글과 같은 모양) */
export function 매도글(f, memo = "") {
  const 금 = f.amount ? `${f.fee_included === true ? "매도비 포함 " : f.fee_included === false ? "매도비 별도 " : ""}${원(f.amount)}` : "-";
  return [
    `매도형태: ${f.type || "-"}`,
    `차량: ${[f.plate, f.car_name].filter(Boolean).join(" ") || "-"}`,
    `구매자: ${[f.buyer, f.phone].filter(Boolean).join(" ") || "-"}`,
    `매도 금액: ${금}`,
    `계약금: ${f.deposit === 0 ? "없음" : [f.deposit_when, f.deposit ? 원(f.deposit) : ""].filter(Boolean).join(" ") || "-"}`,
    memo && "", memo,
  ].filter(x => x !== false && x != null).join("\n").trim();
}
