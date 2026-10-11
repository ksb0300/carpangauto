// TierONE 업무관리 — 계산 엔진.
// 똑순이 2.0 에서 테스트 차량으로 실측한 값과 같은 결과를 내도록 맞췄다 (docs/똑순이_분석.md §5).
// 화면과 서버가 같은 규칙을 쓰도록 순수 함수만 둔다.

/** 부가세 포함 금액을 공급가/부가세로 나눈다. 비과세면 부가세 0. */
export function 부가세분리(금액, 과세 = true) {
  const 원 = Math.round(Number(금액) || 0);
  if (!과세) return { 금액: 원, 공급가: 원, 부가세: 0 };
  const 공급가 = Math.round(원 / 1.1);
  return { 금액: 원, 공급가, 부가세: 원 - 공급가 };
}

const 취득세율 = { 승용: 0.07, 경차: 0.04, 승합: 0.05, 화물: 0.05, 특수: 0.05 };

/**
 * 매매용 중고차 (예상)취득세.
 * 지방세특례제한법 §68 감면 + 최소납부세제: 감면세액이 200만원을 넘을 때만 15% 납부, 아니면 0.
 * 10원 미만 절사. (예: 승용 348,030,000 → 3,654,310)
 */
export function 예상취득세(제시금액, 차종 = "승용") {
  const 세율 = 취득세율[차종] ?? 0.07;
  const 감면세액 = (Number(제시금액) || 0) * 세율;
  if (감면세액 <= 2_000_000) return 0;
  return Math.floor((감면세액 * 0.15) / 10) * 10;
}

/** 재고금융 이자. 이율은 % 단위(연). */
export function 대출이자(대출금액, 연이율, 개월) {
  const a = Number(대출금액) || 0, r = (Number(연이율) || 0) / 100, m = Number(개월) || 0;
  return {
    월이자: Math.round((a * r) / 12),
    일이자: Math.round((a * r) / 365),
    총이자: Math.round((a * r * m) / 12),
  };
}

/** 두 날짜(YYYY-MM-DD) 사이 일수. 같은 날이면 1일로 친다 (똑순이 실측: 실행일=정산일 → 1일치). */
export function 경과일수(시작, 끝) {
  const d0 = Date.parse(시작 + "T00:00:00Z"), d1 = Date.parse(끝 + "T00:00:00Z");
  if (Number.isNaN(d0) || Number.isNaN(d1)) return 0;
  return Math.max(1, Math.round((d1 - d0) / 86_400_000) + 1);
}

/** 정산 시점 딜러 미납이자 = 딜러 일이자 × 경과일수 − 이미 낸 이자 (0 미만이면 0). */
export function 미납이자(대출, 정산일) {
  const { 일이자 } = 대출이자(대출.대출금액, 대출.딜러이율, 대출.개월);
  const 누계 = Number(대출.납입이자누계) || 0;
  return Math.max(0, 일이자 * 경과일수(대출.실행일, 정산일) - 누계);
}

function 합(행들) {
  return 행들.reduce((s, r) => ({ 금액: s.금액 + r.금액, 공급가: s.공급가 + r.공급가, 부가세: s.부가세 + r.부가세 }),
                    { 금액: 0, 공급가: 0, 부가세: 0 });
}

/**
 * 차량 정산.
 * @param {object} p
 * @param {Array<{금액:number, 과세?:boolean}>} p.매출   매도금액 + 기타매출
 * @param {number} p.제시금액
 * @param {Array<{금액:number, 과세:boolean, 지출구분:'딜러'|'상사', 정산반영:boolean}>} p.비용  상품화비용 행
 * @param {Array<{항목:string, 금액:number}>} p.상계    재고금융·미납이자·기타상계 (상사선지출은 자동 합산)
 * @param {boolean} p.원천징수대상
 * @param {'일괄'|'분할'} p.방식                          딜러 정산 13.3% 처리 방법
 * @param {boolean} [p.마이너스허용=false]                정산기준금액이 음수일 때 그대로 둘지(아니면 0)
 */
export function 정산(p) {
  const 매출 = 합((p.매출 || []).map(r => 부가세분리(r.금액, r.과세 !== false)));
  const 제시 = 부가세분리(p.제시금액, true);
  const 반영비용 = (p.비용 || []).filter(r => r.정산반영);
  const C = 합(반영비용.map(r => 부가세분리(r.금액, r.과세)));

  const A = 매출.금액, B = 제시.금액;
  const M = A - B;
  const 상사선지출 = 반영비용.filter(r => r.지출구분 === "상사").reduce((s, r) => s + Math.round(r.금액), 0);
  const 상계행 = [...(p.상계 || []).filter(r => Number(r.금액)), ...(상사선지출 ? [{ 항목: "상사선지출", 금액: 상사선지출 }] : [])];
  const L = 상계행.reduce((s, r) => s + Math.round(Number(r.금액)), 0);

  // 정산기준금액 전체. 알선딜러가 있으면 그 몫(X)을 떼어 따로 세금을 매기고, 나머지가 차주딜러 몫이다.
  let 전체D = M - C.금액;
  if (전체D < 0 && !p.마이너스허용) 전체D = 0;
  const 전체F = Math.max(0, 매출.부가세 - 제시.부가세 - C.부가세);   // 예수부가세 (항목별)
  const X = Math.min(Math.max(0, Math.round(Number(p.알선?.금액) || 0)), Math.max(0, 전체D));
  const 알선F = 전체D > 0 ? Math.round(전체F * X / 전체D) : 0;
  const 세금 = (기준, F몫) => {
    if (p.방식 === "분할") {
      const 소득 = 기준 - F몫, s = Math.round(소득 * 0.03), l = Math.round(s * 0.1);
      return { 소득금액: 소득, 소득세: s, 지방세: l, 세액: F몫 + s + l, F: F몫 };
    }
    const t = Math.round(기준 * 0.133);
    return { 소득금액: 기준, 소득세: t, 지방세: 0, 세액: t, F: 0 };   // 똑순이는 일괄이면 13.3% 전체를 소득세 칸에 담는다
  };

  let D = 0, F = 0, 소득금액 = 0, 소득세 = 0, 지방세 = 0, I = 0;
  if (p.원천징수대상) {
    D = 전체D - X;
    const t = 세금(D, 전체F - 알선F);
    ({ 소득금액, 소득세, 지방세 } = t); I = t.세액; F = t.F;
  }
  let 알선 = null;
  if (X > 0) {
    const t = p.알선.원천징수대상 === false ? { 소득금액: X, 소득세: 0, 지방세: 0, 세액: 0 } : 세금(X, 알선F);
    알선 = { 기준: X, 소득금액: t.소득금액, 소득세: t.소득세, 지방세: t.지방세, 세액: t.세액, 지급액: X - t.세액 };
  }
  // D 의 공급가/부가세는 ÷1.1 이 아니라 항목별 차감이다 (똑순이 정산내역서: 공급가 1,104,545 / 예수부가세 115,455).
  let D공급가 = 0, D부가세 = 0;
  if (D !== 0) {
    D부가세 = 매출.부가세 - 제시.부가세 - C.부가세 - 알선F;   // 알선 몫의 부가세는 알선딜러 쪽
    D공급가 = D - D부가세;
  }
  return {
    A, 매출, B, 제시, M, C, D, D공급가, D부가세,
    예수부가세: F, 소득금액, 소득세, 지방세, 징수세액: I,
    세후소득: Math.floor(D - I),
    상사선지출, 상계: 상계행, L,
    알선,                                   // 알선딜러 몫 (없으면 null)
    실지급액: A - (I + L) - X,              // 차주딜러 실지급 — 알선 몫은 알선딜러에게 따로 간다
  };
}

/** 금액 표시용: 1234567 → "1,234,567" */
export const 원 = n => (Math.round(Number(n) || 0)).toLocaleString("ko-KR");

/**
 * 타상사 알선 정산 (docs §5 알선).
 * 기준 = 알선수수료 − 공제비용. 원천징수 대상이면
 *   일괄: 세액 = round(기준 × 13.3%)
 *   분할: 기준을 공급가/부가세로 나눠 부가세(10%) 먼저, 공급가에서 소득세 3%·지방세 0.3%
 * 딜러지급액 = 기준 − 세액
 */
export function 알선정산({ 수수료, 공제비용 = 0, 원천징수대상 = true, 방식 = "일괄" }) {
  const 기준 = Math.max(0, Math.round(Number(수수료) || 0) - Math.round(Number(공제비용) || 0));
  const { 공급가, 부가세 } = 부가세분리(기준);
  let 소득세 = 0, 지방세 = 0, 세액 = 0;
  if (원천징수대상) {
    if (방식 === "분할") {
      소득세 = Math.round(공급가 * 0.03);
      지방세 = Math.round(소득세 * 0.1);
      세액 = 부가세 + 소득세 + 지방세;
    } else {
      세액 = Math.round(기준 * 0.133);
      소득세 = 세액;
    }
  }
  return { 기준, 공급가, 부가세, 소득세, 지방세, 세액, 지급액: 기준 - 세액 };
}

/**
 * 원천징수 신고용 분해. 일괄(13.3%)은 한 덩어리로 저장돼 있으므로
 * 소득세 3% · 지방소득세 0.3% · 나머지(예수부가세 몫)로 나눠 보여준다.
 */
export function 원천징수분해({ 방식, 소득금액, 소득세, 지방세, 징수세액 }) {
  const 금액 = Math.round(Number(소득금액) || 0);
  if (방식 === "분할") {
    return { 지급액: 금액, 소득세: Number(소득세) || 0, 지방세: Number(지방세) || 0,
             예수부가세: (Number(징수세액) || 0) - (Number(소득세) || 0) - (Number(지방세) || 0) };
  }
  const s = Math.round(금액 * 0.03), l = Math.round(s * 0.1);
  return { 지급액: 금액, 소득세: s, 지방세: l, 예수부가세: (Number(징수세액) || 0) - s - l };
}

/** 대출이 [from, to] 기간 안에 걸친 날수 × 일이자 (연이율 %, 일이자는 원 반올림 전 값으로 계산). */
export function 기간이자(대출금액, 연이율, 실행일, 종료일, from, to) {
  const s = [실행일, from].sort()[1], e = [종료일 || to, to].sort()[0];
  if (!s || !e || s > e) return 0;
  const days = Math.round((Date.parse(e + "T00:00:00Z") - Date.parse(s + "T00:00:00Z")) / 86_400_000) + 1;
  return Math.round((Number(대출금액) || 0) * ((Number(연이율) || 0) / 100) / 365 * days);
}

/**
 * 대표 차량 손익 (공동대표 차는 딜러 정산 대신 이걸로 실적을 본다).
 *   매출 = 매도금액 + 기타매출 + 상사매도비(과세) + 할부금융 수익(원천징수 뺀)
 *   성능보험료는 손님이 내는 돈이라 매출에도 비용에도 넣지 않는다 (KAIWA 연동도 비용으로 안 넣음)
 *   부가세 = 매출VAT − 제시VAT(의제·세금계산서 공제, 계산서는 0) − 비용VAT   (음수면 환급)
 *   손익 = 매출 − 제시금액 − 상품화비 − 캐피탈이자                  ← 부가세는 빼지 않는다 (사용자 결정, 대장과 같게)
 *   부가세 = 참고용 (매출VAT − 제시VAT − 비용VAT)
 * 상사매입비·원천징수·딜러이자는 없다.
 */
export function 대표손익(p) {
  const 매출행 = [
    { 금액: p.매도금액, 과세: true },
    ...(p.기타매출 || []).map(r => ({ 금액: r.금액, 과세: r.과세 !== false })),
    { 금액: p.상사매도비 || 0, 과세: true },
    { 금액: p.할부수익 || 0, 과세: false },          // 할부금융 수수료 − 원천징수
  ];
  const 매출 = 합(매출행.map(r => 부가세분리(r.금액, r.과세)));
  const 제시 = 부가세분리(p.제시금액, p.제시증빙 !== "계산서");
  const C = 합((p.비용 || []).filter(r => r.정산반영 !== false).map(r => 부가세분리(r.금액, r.과세)));
  const 이자 = Math.round(Number(p.캐피탈이자) || 0);
  const 부가세 = 매출.부가세 - 제시.부가세 - C.부가세;
  const 세전 = 매출.금액 - 제시.금액 - C.금액 - 이자;
  return { 매출, 제시, C, 이자, 부가세, 세전손익: 세전, 손익: 세전 };
}

/** 차 한 대의 재고금융 비용 합 — 이자(실행일 ~ 상환일, 상환 전이면 기준일까지) + 상환 때 낸 해지비용(저당해지비용·중도상환수수료) */
export function 차량캐피탈이자(loans, 기준일) {
  return (loans || []).reduce((t, l) => t + 재고금융이자(l, l.start_date, 기준일) + (l.status === "상환완료" ? Number(l.repay_fee) || 0 : 0), 0);
}

// ───────────────────────── 재고금융 (금융사별 조건) ─────────────────────────
const 더하기월 = (d, m) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + Number(m || 0)); return x.toISOString().slice(0, 10); };
const 전날 = d => new Date(Date.parse(d + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
const 일수 = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

/** 대출 구간: 기본(실행일 ~ 연장 전날, 원금 전액·기본 이율) + 연장(연장 시작 ~, 먼저 갚은 원금 뺀 잔액·연장 이율) */
export function 대출구간(l) {
  const 끝 = l.repaid_date || null;
  // 기간별 이율 (키움: 1~2개월 6.7% / 3~4개월 7.7% / 5~6개월 8.8%) — [[몇 개월까지, 연 %], …], 마지막 단계는 그 뒤로도 이어진다
  const tiers = Array.isArray(l.rate_tiers) ? l.rate_tiers : null;
  if (tiers?.length && !l.ext_start) {
    const segs = []; let from = l.start_date;
    for (const [i, [upto, rate]] of tiers.entries()) {
      if (끝 && from > 끝) break;
      const last = i === tiers.length - 1, edge = 전날(더하기월(l.start_date, upto));
      const to = last ? 끝 : (끝 && 끝 < edge ? 끝 : edge);
      segs.push({ from, to, 원금: Number(l.amount) || 0, 이율: rate });
      from = 더하기월(l.start_date, upto);
    }
    return segs;
  }
  if (!l.ext_start) return [{ from: l.start_date, to: 끝, 원금: Number(l.amount) || 0, 이율: l.lender_rate }];
  const segs = [{ from: l.start_date, to: 끝 && 끝 < l.ext_start ? 끝 : 전날(l.ext_start), 원금: Number(l.amount) || 0, 이율: l.lender_rate }];
  if (!끝 || 끝 >= l.ext_start)
    segs.push({ from: l.ext_start, to: 끝, 원금: (Number(l.amount) || 0) - (Number(l.principal_repaid) || 0), 이율: l.ext_rate ?? l.lender_rate });
  return segs;
}

/** [from, to] 기간에 걸친 재고금융 이자 (구간별 원금·이율, 양끝 포함 일할) */
export function 재고금융이자(l, from, to) {
  return 대출구간(l).reduce((t, g) => t + 기간이자(g.원금, g.이율, g.from, g.to, from, to), 0);
}

/** 대출 진행 상태 — 기본만기·최종만기·단계·남은 날 */
export function 대출상태(l, 오늘) {
  const 기본 = Number(l.base_months ?? l.months) || 0;
  const 기본만기 = 더하기월(l.start_date, 기본), 최종만기 = 더하기월(l.start_date, l.months);
  const 연장됨 = !!l.ext_start || Number(l.months) > 기본;
  const 만기 = 연장됨 ? 최종만기 : 기본만기;
  return { 기본만기, 최종만기, 연장됨, 단계: 연장됨 ? "연장" : "기본", 만기, 남은일: 일수(오늘, 만기),
    원금잔액: (Number(l.amount) || 0) - (Number(l.principal_repaid) || 0) };
}

/** 연장 가능 여부와 조건 (금융사 설정 기준) */
export function 연장조건(l, lender) {
  const s = 대출상태(l, l.start_date);
  const 가능 = !s.연장됨 && Number(lender?.ext_months) > 0;
  return { 가능, 개월: Number(lender?.ext_months) || 0, 시작일: s.기본만기,
    상환필요: Math.round((Number(l.amount) || 0) * (Number(lender?.ext_repay_pct) || 0) / 100),
    이율: lender?.ext_rate ?? l.lender_rate };
}

/** 상환해지수수료 — 정률: 잔액 × 율 / 일할: 잔액 × 율 × 남은일수 ÷ 전체일수 (만기 이후 상환이면 0) */
export function 해지수수료(l, lender, 상환일) {
  const 방식 = lender?.repay_fee_method || "없음", 율 = Number(lender?.repay_fee_pct) || 0;
  if (방식 === "없음" || !율) return 0;
  const s = 대출상태(l, 상환일), 잔액 = s.원금잔액;
  if (방식 === "정률") return Math.round(잔액 * 율 / 100);
  const 전체 = 일수(l.start_date, s.만기), 남은 = Math.max(0, 일수(상환일, s.만기));
  return 전체 > 0 ? Math.round(잔액 * 율 / 100 * 남은 / 전체) : 0;
}

/** 상환할 때 드는 돈 = 상환해지수수료(중도상환) + 저당해지비용(금융사 설정, 보통 19,300원) */
export function 상환비용(l, lender, 상환일) {
  return 해지수수료(l, lender, 상환일) + (Number(lender?.release_fee) || 0);
}

/** 할부금융 수수료: 할부금액 × 할부피% − 원천징수(소득세 3%·지방세 0.3%, 각 10원 미만 절사). DB 트리거와 같은 계산 */
export function 할부수수료(할부금액, 할부피) {
  const 수수료 = Math.floor((Number(할부금액) || 0) * (Number(할부피) || 0) / 100);
  const 소득세 = Math.floor(수수료 * 0.03 / 10) * 10, 지방세 = Math.floor(소득세 * 0.1 / 10) * 10;
  return { 수수료, 소득세, 지방세, 원천징수: 소득세 + 지방세, 수익: 수수료 - 소득세 - 지방세 };
}
