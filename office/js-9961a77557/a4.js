// A4 공식 문서 미리보기 · 인쇄 · PDF 저장 (서류 화면 — 3일 환불 약정서·비사업용 확인서, 2026-10-20 사용자: "A4 공식문서처럼, 미리보기도, 인쇄와 PDF 저장은 다른 버튼")
//   문서 내용(.sign-paper)을 화면 밖에서 그린 뒤 A4 쪽(여백 15mm)으로 나눠 보여 준다 — 표는 줄, 조항은 항목 단위로 다음 쪽에.
//   인쇄 = 그 쪽들 그대로 (@page A4 여백 0) / PDF 저장 = 쪽마다 그림으로 떠서 A4 PDF 파일로 내려받기.
import { html, useEffect, useRef } from "./ui.js";

export const W = 680, FULL = 1009, H = FULL - 30;                 // 본문 폭·높이 (A4 210×297mm − 여백 15mm, 96dpi 기준 px), 아래 쪽번호 자리

/** 원본(.sign-paper) 안의 블록을 A4 쪽들에 나눠 담는다 → pages 상자 안에 .a4page 들 */
export function 쪽나누기(src, pagesBox) {
  pagesBox.innerHTML = "";
  let cur; const pages = [];
  const 새쪽 = () => {
    const pg = document.createElement("div"); pg.className = "a4page";
    const body = pg.appendChild(document.createElement("div")); body.className = "sign-paper a4body";
    pagesBox.appendChild(pg); pages.push(pg); cur = body;
  };
  const 넘침 = () => cur.offsetHeight > H;
  새쪽();
  for (const el of [...src.cloneNode(true).children]) {
    cur.appendChild(el);
    if (!넘침()) continue;
    cur.removeChild(el);
    let rows = el.tagName === "TABLE" ? [...el.querySelectorAll("tr")] : el.tagName === "OL" ? [...el.children] : [];
    if (rows.length < 2) { 새쪽(); cur.appendChild(el); continue; }
    let n = 0;
    const 껍데기 = () => { const s = el.cloneNode(false); if (s.tagName === "OL") s.start = n + 1; const b = s.tagName === "TABLE" ? s.appendChild(document.createElement("tbody")) : s; cur.appendChild(s); return b; };
    let into = 껍데기();
    for (const r of rows) {
      into.appendChild(r); n++;
      if (넘침() && into.children.length > 1) { into.removeChild(r); 새쪽(); into = 껍데기(); into.appendChild(r); }
    }
  }
  pages.forEach((p, i) => { const f = document.createElement("div"); f.className = "a4no"; f.textContent = pages.length > 1 ? `- ${i + 1} / ${pages.length} -` : ""; p.appendChild(f); });
  const z = Math.min(1, (pagesBox.clientWidth - 4) / 794);           // 폰처럼 좁으면 종이째 줄여 보이기 (인쇄·PDF 는 원래 크기)
  if (z < 1) pages.forEach(p => { p.style.zoom = z; });
  return pages;
}

/** 미리보기: children 이 문서 내용 (.sign-paper 안에 들어갈 h1·table·ol… 블록). deps 가 바뀌면(서명 그림 등) 다시 나눈다 */
export function A4Preview({ children, deps = [] }) {
  const src = useRef(null), box = useRef(null);
  useEffect(() => {
    const go = () => src.current && box.current && 쪽나누기(src.current, box.current);
    go();
    const imgs = [...(src.current?.querySelectorAll("img") || [])].filter(i => !i.complete);
    imgs.forEach(i => i.addEventListener("load", go, { once: true }));
    document.fonts?.ready.then(go);
  }, deps);
  return html`<div class="a4-wrap">
    <div class="sign-paper a4src" ref=${src}>${children}</div>
    <div class="a4-pages" ref=${box}></div>
  </div>`;
}

const 스크립트 = (src, has) => has() ? Promise.resolve() : new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });

/** 화면의 A4 쪽들 → PDF 파일 내려받기 */
export async function A4PDF저장(파일이름) {
  const pages = [...document.querySelectorAll(".a4-pages .a4page")];
  if (!pages.length) throw new Error("미리보기가 아직 없습니다");
  await Promise.all([
    스크립트("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", () => window.html2canvas),
    스크립트("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => window.jspdf),
  ]);
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const z = pages.map(p => p.style.zoom); pages.forEach(p => { p.style.zoom = ""; });
  try {
    for (let i = 0; i < pages.length; i++) {
      const c = await window.html2canvas(pages[i], { scale: 2.5, backgroundColor: "#ffffff", useCORS: true });
      if (i) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    }
  } finally { pages.forEach((p, i) => { p.style.zoom = z[i]; }); }
  pdf.save(파일이름);
}
