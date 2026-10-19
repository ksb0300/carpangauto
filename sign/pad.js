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
/* 사본 저장: 보통 브라우저는 인쇄 창(PDF 저장), 카톡 등 앱 안 브라우저는 인쇄가 안 되므로 사본을 사진으로 만들어 길게 눌러 저장 */
SignPad.inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|; wv\)/i.test(navigator.userAgent);
SignPad.saveCopy = function (paper, btn) {
  if (!SignPad.inApp) return window.print();
  var old = paper.previousElementSibling;
  if (old && old.className === "copyimg") { old.scrollIntoView({ behavior: "smooth" }); return; }
  var label = btn.textContent; btn.disabled = true; btn.textContent = "사본 사진 만드는 중…";
  var load = window.html2canvas ? Promise.resolve() : new Promise(function (ok, bad) {
    var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s);
  });
  load.then(function () { return html2canvas(paper, { scale: 3, backgroundColor: "#ffffff" }); }).then(function (c) {
    var box = document.createElement("div"); box.className = "copyimg"; box.style.cssText = "margin:14px 0;text-align:center";
    box.innerHTML = "<p style='font-size:14px;margin:0 0 8px'>아래 사진을 <b>길게 눌러 '이미지 저장'</b>을 누르시면 사진첩에 보관됩니다.</p>";
    var img = new Image(); img.src = c.toDataURL("image/png"); img.alt = "사본"; img.style.cssText = "width:100%;border:1px solid #ccc;border-radius:6px";
    box.appendChild(img); paper.parentNode.insertBefore(box, paper); paper.hidden = true;
    btn.textContent = label; btn.disabled = false; box.scrollIntoView({ behavior: "smooth" });
  }).catch(function () {
    btn.textContent = label; btn.disabled = false;
    alert("사본 사진을 만들지 못했습니다. 아래 사본 화면을 캡처해 보관해 주세요.");
  });
};
