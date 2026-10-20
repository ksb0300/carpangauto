/* 서류 작성 페이지 공통: 손가락 서명 패드 (비사업용 확인서 · 3일 환불 약정서) */
function SignPad(canvas, onInk) {
  var ctx = canvas.getContext("2d"), drawing = false, ink = false;
  function size() {
    var r = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * r; canvas.height = canvas.offsetHeight * r;
    ctx.scale(r, r); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#f4f4f6";
  }
  size();
  window.addEventListener("resize", function () {
    var data = ink ? canvas.toDataURL() : null; size();
    if (data) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight); }; img.src = data; }
  });
  function pos(e) { var r = canvas.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  function start(e) { e.preventDefault(); drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    if (!ink) { ink = true; onInk && onInk(true); } }
  canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", function () { drawing = false; });
  canvas.addEventListener("touchstart", start, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", function () { drawing = false; });
  return {
    hasInk: function () { return ink; },
    clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = false; onInk && onInk(false); },
    /* 화면은 어두운 패드 위 흰 선, 서류는 흰 종이 → 선만 골라 검정으로 */
    blackPng: function () {
      var c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height;
      var x = c.getContext("2d"); x.drawImage(canvas, 0, 0);
      var im = x.getImageData(0, 0, c.width, c.height), px = im.data;
      for (var i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { px[i] = 17; px[i + 1] = 17; px[i + 2] = 17; }
      x.putImageData(im, 0, 0); return c.toDataURL("image/png");
    }
  };
}
/* 숫자 칸: 다 채우면 다음 칸, 빈 칸에서 지우기 누르면 앞 칸. 목록 = [[id, 길이, 다음id, 앞id], ...] */
SignPad.autoNext = function ($, list) {
  list.forEach(function (c) {
    var el = $(c[0]);
    el.addEventListener("input", function () { var v = this.value.replace(/[^0-9]/g, "").slice(0, c[1]); this.value = v; if (v.length >= c[1] && c[2]) $(c[2]).focus(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Backspace" && this.value === "" && c[3]) $(c[3]).focus(); });
  });
};
/* 사본 저장: 보통 브라우저는 인쇄 창(A4, PDF 저장). 카톡 등 앱 안 브라우저는 인쇄가 막혀 있어서
   사본을 A4 쪽으로 나눈 PDF 로 만들어 서버에 올리고(car-files/sign/<id>-copy.pdf) 그 주소를 연다 — 안드로이드는 내려받기, 아이폰은 바로 보기 */
SignPad.inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|; wv\)/i.test(navigator.userAgent);
function 스크립트(src, has) {
  return has() ? Promise.resolve() : new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
}
/* 사본(.paper) → 화면에 A4 종이로 나눠 보여 주기 (box 안에 .a4page 들). 여백 15mm, 표는 줄·조항은 항목 단위로 다음 쪽에 이어서.
   미리보기 = 인쇄 = PDF 가 같은 모양 (2026-10-20 사용자: A4 공식 문서처럼, 미리보기도) */
SignPad.a4Pages = function (paper, box) {
  var W = 680, FULL = 1009, H = FULL - 30;              // 본문 폭·높이 (A4 − 여백 15mm, 96dpi px), 아래 쪽번호 자리
  box.innerHTML = "";
  var pages = [], cur;
  function newPage() {     // 쪽(A4 고정) 안에 본문 칸(cur) — 넘침은 본문 칸 높이로 잰다
    var pg = document.createElement("div"); pg.className = "a4page";
    cur = pg.appendChild(document.createElement("div")); cur.className = "paper a4body";
    box.appendChild(pg); pages.push(pg);
  }
  var over = function () { return cur.offsetHeight > H; };
  newPage();
  var src = document.createElement("div"); src.innerHTML = paper.innerHTML;
  Array.prototype.slice.call(src.children).forEach(function (el) {
    cur.appendChild(el);
    if (!over()) return;
    cur.removeChild(el);
    var rows = el.tagName === "TABLE" ? el.querySelectorAll("tr") : el.tagName === "OL" ? el.children : [];
    if (rows.length < 2) { newPage(); cur.appendChild(el); return; }
    rows = Array.prototype.slice.call(rows);                       // 표·조항은 줄 단위로 나눠 담는다
    var n = 0, shell = function () {
      var s = el.cloneNode(false); if (s.tagName === "OL") s.start = n + 1;
      var body = s.tagName === "TABLE" ? s.appendChild(document.createElement("tbody")) : s;
      cur.appendChild(s); return body;
    };
    var into = shell();
    rows.forEach(function (r) {
      into.appendChild(r); n++;
      if (over() && into.children.length > 1) { into.removeChild(r); newPage(); into = shell(); into.appendChild(r); }
    });
  });
  pages.forEach(function (p, i) {
    var f = document.createElement("div"); f.className = "a4no"; f.textContent = pages.length > 1 ? "- " + (i + 1) + " / " + pages.length + " -" : ""; p.appendChild(f);
  });
  var z = Math.min(1, (box.clientWidth - 4) / 794);       // 폰 화면이면 종이째 줄여 보이기 (인쇄·PDF 는 원래 크기)
  if (z < 1) pages.forEach(function (p) { p.style.zoom = z; });
  return pages;
};
/* 화면의 A4 종이들 → PDF Blob (쪽마다 그림, A4 꽉 차게) */
SignPad.a4Pdf = function (box) {
  var pages = Array.prototype.slice.call(box.querySelectorAll(".a4page"));
  return Promise.all([
    스크립트("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", function () { return window.html2canvas; }),
    스크립트("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function () { return window.jspdf; })
  ]).then(function () {
    var zs = pages.map(function (p) { return p.style.zoom; }); pages.forEach(function (p) { p.style.zoom = ""; });
    var pdf = new jspdf.jsPDF({ unit: "mm", format: "a4" });
    return pages.reduce(function (p, pg, i) {
      return p.then(function () { return html2canvas(pg, { scale: 2.5, backgroundColor: "#ffffff" }); }).then(function (c) {
        if (i) pdf.addPage();
        pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
      });
    }, Promise.resolve()).then(function () { return pdf.output("blob"); })
      .finally(function () { pages.forEach(function (p, i) { p.style.zoom = zs[i]; }); });
  });
};
/* 🖨 인쇄: A4 종이만 따로 빈 문서(보이지 않는 iframe)에 옮겨 인쇄 — 사이트 검은 바탕·머리줄이 섞이지 않게 */
SignPad.printA4 = function (box) {
  var f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  var d = f.contentDocument, 됨 = false;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title>사본</title><link rel="stylesheet" href="/sign/sign.css?v=4">' +
    '<style>html,body{margin:0;background:#fff}.a4-pages{background:none;padding:0;margin:0;border-radius:0}.a4page{zoom:1 !important;box-shadow:none;margin:0}</style></head>' +
    '<body><div class="a4-pages">' + box.innerHTML + '</div></body></html>');
  d.close();
  var go = function () { if (됨) return; 됨 = true; f.contentWindow.focus(); f.contentWindow.print(); setTimeout(function () { f.remove(); }, 60000); };
  var link = d.querySelector("link"); if (link) link.onload = go;
  setTimeout(go, 1500);
};
/* 📄 PDF 저장: 보통 브라우저는 파일로 내려받기, 카톡 등 앱 안 브라우저는 내려받기가 안 돼서 서버에 올리고 그 주소를 연다 */
SignPad.savePdf = function (box, btn, api, id, 파일이름) {
  if (SignPad.copyUrl) { location.href = SignPad.copyUrl; return; }
  var label = btn.textContent; btn.disabled = true; btn.textContent = "PDF 만드는 중…";
  var done = function () { btn.textContent = label; btn.disabled = false; };
  if (!SignPad.inApp) {
    SignPad.a4Pdf(box).then(function (blob) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = 파일이름;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); done();
    }).catch(function () { done(); alert("PDF 를 만들지 못했습니다. [인쇄]에서 'PDF로 저장'을 골라 주세요."); });
    return;
  }
  SignPad.a4Pdf(box).then(function (blob) {
    return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(",")[1]); }; r.readAsDataURL(blob); });
  }).then(function (b64) {
    return fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "사본", id: id, pdf: b64 }) }).then(function (r) { return r.json(); });
  }).then(function (res) {
    if (!res || !res.ok) throw new Error(res && res.msg);
    SignPad.copyUrl = res.url; btn.textContent = "📄 사본 PDF 다시 열기"; btn.disabled = false;
    location.href = res.url;
  }).catch(function (e) {
    btn.textContent = label; btn.disabled = false;
    alert((e && e.message) || "사본 PDF 를 만들지 못했습니다. 아래 사본 화면을 캡처해 보관해 주세요.");
  });
};
