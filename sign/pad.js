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
/* 사본(.paper) → A4 PDF Blob. 여백 15mm. 먼저 화면에서 쪽을 나누고(표는 줄, 조항은 항목 단위로 다음 쪽에 이어서) 쪽마다 그린다 */
SignPad.a4Pdf = function (paper) {
  var W = 680, MM = 180 / W, FULL = Math.floor(267 / MM), H = FULL - 30;   // 본문 폭 180mm = 680px, 쪽 높이(아래 쪽번호 자리 빼고)
  var host = document.createElement("div"); host.style.cssText = "position:absolute;left:-10000px;top:0";
  document.body.appendChild(host);
  var pages = [], cur;
  function newPage() {     // 쪽(A4 높이 고정) 안에 본문 칸(cur) — 넘침은 본문 칸 높이로 잰다
    var pg = document.createElement("div"); pg.className = "paper";
    pg.style.cssText = "width:" + W + "px;height:" + FULL + "px;max-width:none;margin:0 0 20px;padding:0;border-radius:0;box-sizing:content-box;position:relative;overflow:hidden";
    cur = pg.appendChild(document.createElement("div")); cur.style.cssText = "display:flow-root";
    host.appendChild(pg); pages.push(pg);
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
  return Promise.all([
    스크립트("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", function () { return window.html2canvas; }),
    스크립트("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function () { return window.jspdf; })
  ]).then(function () {
    if (pages.length > 1) pages.forEach(function (p, i) {
      var f = document.createElement("div"); f.textContent = "- " + (i + 1) + " / " + pages.length + " -";
      f.style.cssText = "position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:10px;color:#555"; p.appendChild(f);
    });
    var pdf = new jspdf.jsPDF({ unit: "mm", format: "a4" });
    return pages.reduce(function (p, pg, i) {
      return p.then(function () { return html2canvas(pg, { scale: 2.5, backgroundColor: "#ffffff" }); }).then(function (c) {
        if (i) pdf.addPage();
        pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 15, 15, 180, FULL * MM);
      });
    }, Promise.resolve()).then(function () { return pdf.output("blob"); });
  }).finally(function () { host.remove(); });
};
SignPad.saveCopy = function (paper, btn, api, id) {
  if (!SignPad.inApp) return window.print();
  if (SignPad.copyUrl) { location.href = SignPad.copyUrl; return; }
  var label = btn.textContent; btn.disabled = true; btn.textContent = "PDF 만드는 중…";
  SignPad.a4Pdf(paper).then(function (blob) {
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
