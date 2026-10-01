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

  let D = 0, F = 0, 소득금액 = 0, 소득세 = 0, 지방세 = 0, I = 0;
  if (p.원천징수대상) {
    D = M - C.금액;
    if (D < 0 && !p.마이너스허용) D = 0;
    if (p.방식 === "분할") {
      F = Math.max(0, 매출.부가세 - 제시.부가세 - C.부가세);   // 예수부가세 (항목별)
      소득금액 = D - F;
      소득세 = Math.round(소득금액 * 0.03);
      지방세 = Math.round(소득세 * 0.1);
      I = F + 소득세 + 지방세;
    } else {
      소득금액 = D;
      I = Math.round(D * 0.133);
      소득세 = I;                                              // 똑순이는 일괄이면 13.3% 전체를 소득세 칸에 담는다
    }
  }
  // D 의 공급가/부가세는 ÷1.1 이 아니라 항목별 차감이다 (똑순이 정산내역서: 공급가 1,104,545 / 예수부가세 115,455).
  let D공급가 = 0, D부가세 = 0;
  if (D !== 0) {
    D부가세 = 매출.부가세 - 제시.부가세 - C.부가세;
    D공급가 = D - D부가세;
  }
  return {
    A, 매출, B, 제시, M, C, D, D공급가, D부가세,
    예수부가세: F, 소득금액, 소득세, 지방세, 징수세액: I,
    세후소득: Math.floor(D - I),
    상사선지출, 상계: 상계행, L,
    실지급액: A - (I + L),
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
